/* xlsx-write —— 零依赖 xlsx 写出（配套 xlsx-lite 只读的另一半）
   金蝶凭证导入模版必须是 .xlsx：CSV 传上去它不认日期格式，科目代码还会被
   Excel 当数字截掉前导零。所以这里自己拼一个最小可用的 xlsx。

   用法：
     const blob = XLSXWrite.build([{ name: '凭证模版', rows: [[...], [...]] }]);
   单元格写法：
     'abc' / 123        → 直接按文本 / 数字写
     { d: '2026-08-11' } → 真日期（格式 yyyy-mm-dd）
     { n: 9.94 }        → 金额（格式 #,##0.00）
     { s: '100202' }    → 强制文本（科目代码这类，防止被当数字）
     null / ''          → 空单元格（金蝶要求空就是空，不能写 0）

   ZIP 用 store（不压缩）模式：省掉压缩依赖，凭证文件几千行也就几百 KB。 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP（store 模式） ---------- */
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new Uint8Array(30 + name.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);            // version needed
      dv.setUint16(6, 0x0800, true);        // 文件名按 UTF-8
      dv.setUint16(8, 0, true);             // 不压缩
      dv.setUint16(10, 0, true);            // 时间
      dv.setUint16(12, 0x2821, true);       // 日期（固定值，避免每次导出文件不一致）
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);

      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0x2821, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    const csize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, csize, true);
    ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eocd]),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- XML ---------- */
  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // 控制字符会让 Excel 直接判文件损坏
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  /* Excel 日期序列号：1899-12-30 为 0（含 1900 闰年那个历史 bug） */
  function dateSerial(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!m) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round(ms / 86400000) + 25569;
  }

  const S_DEFAULT = 0, S_DATE = 1, S_NUM = 2, S_HEAD = 3;

  function cellXml(ref, v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object') {
      if (v.d !== undefined) {
        const n = dateSerial(v.d);
        return n === null
          ? `<c r="${ref}" t="inlineStr"><is><t>${esc(v.d)}</t></is></c>`
          : `<c r="${ref}" s="${S_DATE}"><v>${n}</v></c>`;
      }
      if (v.n !== undefined) {
        if (v.n === '' || v.n === null || !isFinite(v.n)) return '';
        return `<c r="${ref}" s="${S_NUM}"><v>${v.n}</v></c>`;
      }
      if (v.s !== undefined) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.s)}</t></is></c>`;
      if (v.h !== undefined) return `<c r="${ref}" s="${S_HEAD}" t="inlineStr"><is><t>${esc(v.h)}</t></is></c>`;
      return '';
    }
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  }

  function sheetXml(rows) {
    const body = rows.map((row, ri) => {
      const cells = row.map((v, ci) => cellXml(colName(ci) + (ri + 1), v)).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="176" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="177" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="11"/><name val="宋体"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="176" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="177" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function build(sheets) {
    const files = [];
    const sheetOverrides = sheets.map((s, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const add = (name, str) => files.push({ name, data: enc.encode(str) });

    add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetOverrides}</Types>`);

    add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

    add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`);

    add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

    add('xl/styles.xml', STYLES);
    sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
    return zip(files);
  }

  global.XLSXWrite = { build };
})(typeof window !== 'undefined' ? window : globalThis);

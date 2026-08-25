/* xlsx-lite —— 零依赖表格解析
   支持：.xlsx（ZIP + sheetXML）/ .csv / .tsv / .txt（UTF-8 与 GBK 自动识别）
   仅做读取，不做写入。写入走 CSV。 */
(function (global) {
  'use strict';

  /* ---------- ZIP ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持解压 xlsx，请另存为 CSV 后再导入');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    // 找中央目录结束记录
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
      // 本地头
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      const raw = u8.subarray(start, start + csize);
      files[name] = { method, raw };
      p += 46 + nlen + elen + clen;
    }
    const out = {};
    for (const name of Object.keys(files)) {
      const f = files[name];
      out[name] = f.method === 0 ? f.raw : await inflateRaw(f.raw);
    }
    return out;
  }

  /* ---------- XLSX ---------- */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Excel 序列号 → yyyy-MM-dd
  function serialToDate(n) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(n);
    const p = x => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  async function parseXLSX(buf) {
    const zip = await unzip(buf);
    const dec = new TextDecoder('utf-8');
    const parser = new DOMParser();

    // 共享字符串
    let shared = [];
    if (zip['xl/sharedStrings.xml']) {
      const doc = parser.parseFromString(dec.decode(zip['xl/sharedStrings.xml']), 'application/xml');
      shared = Array.from(doc.getElementsByTagName('si')).map(si => {
        const ts = si.getElementsByTagName('t');
        let s = '';
        for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
        return s;
      });
    }

    // 日期样式：找出 numFmt 为日期的 cellXfs 索引
    const dateStyles = new Set();
    if (zip['xl/styles.xml']) {
      const sd = parser.parseFromString(dec.decode(zip['xl/styles.xml']), 'application/xml');
      const dateFmtIds = new Set([14,15,16,17,22,27,30,36,45,46,47,50,57,58]);
      Array.from(sd.getElementsByTagName('numFmt')).forEach(nf => {
        const code = nf.getAttribute('formatCode') || '';
        if (/[yYmMdD]/.test(code) && /[-/年]/.test(code)) dateFmtIds.add(+nf.getAttribute('numFmtId'));
      });
      const xfs = sd.getElementsByTagName('cellXfs')[0];
      if (xfs) Array.from(xfs.getElementsByTagName('xf')).forEach((xf, i) => {
        if (dateFmtIds.has(+(xf.getAttribute('numFmtId') || 0))) dateStyles.add(i);
      });
    }

    // 第一张表
    const sheetName = Object.keys(zip).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    if (!sheetName) throw new Error('xlsx 中没有找到工作表');
    const doc = parser.parseFromString(dec.decode(zip[sheetName]), 'application/xml');

    const rows = [];
    Array.from(doc.getElementsByTagName('row')).forEach(tr => {
      const row = [];
      Array.from(tr.getElementsByTagName('c')).forEach(c => {
        const idx = colIndex(c.getAttribute('r'));
        const t = c.getAttribute('t');
        const s = c.getAttribute('s');
        let v = '';
        if (t === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          v = is ? is.textContent : '';
        } else {
          const vEl = c.getElementsByTagName('v')[0];
          const raw = vEl ? vEl.textContent : '';
          if (t === 's') v = shared[+raw] || '';
          else if (raw !== '' && s !== null && dateStyles.has(+s) && !isNaN(+raw)) v = serialToDate(+raw);
          else v = raw;
        }
        while (row.length < idx) row.push('');
        row[idx] = v;
      });
      rows.push(row);
    });
    return rows;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    // 猜分隔符
    const head = text.slice(0, 4000);
    const cand = [',', '\t', ';', '|'];
    let sep = ',', best = -1;
    cand.forEach(s => {
      const n = (head.split('\n')[0] || '').split(s).length;
      if (n > best) { best = n; sep = s; }
    });
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    // BOM
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    const utf = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    // 替换字符过多 → 判为 GBK
    const bad = (utf.match(/�/g) || []).length;
    if (bad > 2) {
      try { return new TextDecoder('gbk').decode(u8); } catch (e) { /* 忽略 */ }
    }
    return utf;
  }

  /* ---------- 统一入口 ---------- */
  async function readTable(file) {
    const name = (file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    let rows;
    if (/\.xlsx$/.test(name)) rows = await parseXLSX(buf);
    else if (/\.xls$/.test(name)) throw new Error('旧版 .xls 不支持，请在 Excel 中另存为 .xlsx 或 CSV');
    else rows = parseCSV(decodeText(buf));
    // 去掉全空行
    rows = rows.filter(r => r.some(c => String(c == null ? '' : c).trim() !== ''));
    if (!rows.length) throw new Error('文件里没有读到任何数据');
    return rows;
  }

  /* ---------- 表头定位 ---------- */
  // 银行流水常见前几行是标题/账号说明，真正表头往往在第 1—8 行
  function findHeaderRow(rows, keywords) {
    let best = 0, bestScore = -1;
    const scan = Math.min(rows.length, 12);
    for (let i = 0; i < scan; i++) {
      const cells = rows[i].map(c => String(c || '').replace(/\s/g, ''));
      const filled = cells.filter(c => c !== '').length;
      let hit = 0;
      cells.forEach(c => { if (keywords.some(k => c.includes(k))) hit++; });
      const score = hit * 10 + filled;
      if (hit >= 2 && score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  global.XLSXLite = { readTable, parseCSV, parseXLSX, decodeText, findHeaderRow };
})(window);

/* 基础 · 科目设置
   与核算共用同一份科目（SE_CHART 标准表 + 各主体自建），这里是维护入口。
   参考金蝶/用友的科目管理：
   - 编码级次 4-2-2：一级 4 位（1002）、二级 6 位（100201）、三级 8 位（10020101）
   - 只能在上级科目下加下级；有下级的科目按惯例不该直接记账（本系统提示不硬拦，
     因为已有规则挂在上级科目上，硬拦会打断在用的流程）
   - 辅助核算：客户/供应商/部门/职员/项目 五类标记
   - 有发生额（凭证/规则在用）的科目不许删，只能停用
   - 标准科目不可删；改名/加辅助会落成本主体的自建覆盖，不动别的主体 */
'use strict';

const BS_AUX = [['customer', '客户'], ['supplier', '供应商'], ['dept', '部门'], ['staff', '职员'], ['project', '项目']];
const BSS = { parent: '', edit: '' };   // edit = 正在编辑的科目编码

/* 类别与默认余额方向：按小企业会计准则编码段判，背离方向的备抵科目单列 */
const BS_CONTRA = new Set(['1602', '1702', '1622']);   // 累计折旧/累计摊销
function bsClass(code) {
  const c = String(code)[0];
  return c === '1' ? '资产' : c === '2' ? '负债' : c === '3' ? '权益' : c === '4' ? '成本' : c === '5' ? '损益' : '其他';
}
function bsDir(code, opts) {
  if (opts && opts.dir) return opts.dir;
  const base = String(code).slice(0, 4);
  if (BS_CONTRA.has(base)) return '贷';
  const c = String(code)[0];
  if (c === '1' || c === '4') return '借';
  if (c === '2' || c === '3') return '贷';
  return /^(5001|5051|5111|5301)/.test(code) ? '贷' : '借';
}
const bsLevel = code => { const n = String(code).replace(/\D/g, '').length; return n <= 4 ? 1 : n <= 6 ? 2 : 3; };
const bsIsStd = code => SE_CHART.some(a => a[0] === String(code));
const bsCustom = () => (RS ? RS.accounts : []);
const bsFind = code => ACCOUNTS(1).find(a => String(a[0]) === String(code));
const bsChildren = code => ACCOUNTS(1).filter(a => String(a[0]).length === String(code).length + 2 && String(a[0]).startsWith(String(code)));

/* 科目有没有在被用——凭证行、规则里挂着都算「在用」，在用不许删（金蝶同款规矩） */
function bsUsed(code) {
  const c = String(code);
  try {
    if (vchLoad(CUR_ENT).some(v => v.lines.some(l => {
      const b = String(l.acct).split('_')[0];
      return b === c || b.startsWith(c) && b.length > c.length;
    }))) return '凭证';
  } catch (e) { /* 忽略 */ }
  if ((RULES || []).some(r => String(r.acct).split('_')[0] === c)) return '规则';
  return '';
}
/* 下一个可用的下级编码后缀（01 起顺延） */
function bsNextCode(parent) {
  const kids = bsChildren(parent).map(a => +String(a[0]).slice(-2)).filter(n => !isNaN(n));
  return String(parent) + String((kids.length ? Math.max(...kids) : 0) + 1).padStart(2, '0');
}

S['bs-acct'] = () => {
  if (!CUR_ENT) return needEnt('科目设置');
  const all = ACCOUNTS(1);
  const editing = BSS.edit ? bsFind(BSS.edit) : null;
  const eOpts = editing && editing[2] ? editing[2] : {};

  /* 新增/编辑表单 */
  const parentOpts = all.filter(a => bsLevel(a[0]) < 3 && !String(a[0]).includes('{'))
    .map(a => `<option value="${H(a[0])}" ${String(BSS.parent) === String(a[0]) ? 'selected' : ''}>${H(a[0])} ${H(a[1])}</option>`).join('');
  const nextCode = editing ? String(editing[0]) : (BSS.parent ? bsNextCode(BSS.parent) : '');
  const form = cardp(editing ? `编辑科目 ${H(editing[0])}` : '新增下级科目', `
    <div class="cols c4">
      <div class="field"><label class="fl">上级科目</label>
        ${editing ? `<input value="${H(String(editing[0]).slice(0, -2) || '（一级）')}" disabled>` :
      `<select id="bsParent"><option value="">— 选上级 —</option>${parentOpts}</select>`}</div>
      <div class="field"><label class="fl">科目编码（上级 + 2 位）</label>
        <input id="bsCode" value="${H(nextCode)}" ${editing ? 'disabled' : ''} placeholder="选上级后自动给号"></div>
      <div class="field"><label class="fl">科目名称</label>
        <input id="bsName" value="${editing ? H(editing[1]) : ''}" placeholder="如：管理费用_差旅费"></div>
      <div class="field"><label class="fl">余额方向</label>
        <select id="bsDir">${['默认', '借', '贷'].map(d =>
      `<option ${((eOpts.dir || '默认') === d) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:9px">辅助核算：${BS_AUX.map(([k, n]) =>
      `<label style="margin-right:12px"><input type="checkbox" data-bsaux="${k}" ${(eOpts.aux || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}
      <span class="mut" style="font-size:11px">项目辅助已在凭证里落地（科目_项目码，T2 在用）；其余类别先登记，录凭证界面接入后生效。</span></div>
    <div style="text-align:right;margin-top:9px">
      ${editing ? '<button class="btn" data-act="bsCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="bsSave">${editing ? '保存修改' : '新增科目'}</button></div>`);

  /* 科目树 */
  const customSet = new Set(bsCustom().map(a => String(a[0])));
  const rows = all.filter(a => !String(a[0]).includes('{')).map(a => {
    const code = String(a[0]), opts = a[2] || {};
    const lv = bsLevel(code);
    const kids = bsChildren(code).length;
    const used = bsUsed(code);
    const isStd = bsIsStd(code) && !customSet.has(code);
    const off = opts.off;
    return [
      `<span style="padding-left:${(lv - 1) * 22}px"><span class="code">${H(code)}</span></span>`,
      `<span style="${off ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${H(a[1])}</span>`,
      bsClass(code), bsDir(code, opts), String(lv),
      (opts.aux || []).map(k => { const f = BS_AUX.find(x => x[0] === k); return f ? pill(f[1], 'ok') : ''; }).join('') || '<span class="mut">—</span>',
      kids ? pill(`${kids} 个下级`, 'mu') : (used ? pill('在用·' + used, 'wa') : ''),
      isStd ? pill('标准', 'mu') : pill('自建', 'ok'),
      `${lv < 3 ? `<button class="btn sm" data-bssub="${H(code)}">加下级</button>` : ''}
       <button class="btn sm" data-bsedit="${H(code)}">编辑</button>
       ${customSet.has(code) ? (off
        ? `<button class="btn sm" data-bson="${H(code)}">启用</button>`
        : `<button class="btn sm" data-bsoff="${H(code)}">停用</button>`) : ''}
       ${customSet.has(code) && !used && !kids ? `<button class="btn sm" data-bsdel="${H(code)}">删除</button>` : ''}`,
    ];
  });
  return head('科目设置', `${H(entName())} · 与核算模块同一份科目：小企业会计准则标准表 + 本主体自建。编码级次 4-2-2（一级4位/二级6位/三级8位）。`, '基础 · 科目',
    `<button class="btn" data-act="bsImpGo">导入科目余额表</button>
     <button class="btn pri" data-act="bsExp">导出科目表</button>`)
    + kpis([
      { k: '科目总数', v: String(rows.length), u: '个' },
      { k: '标准科目', v: String(SE_CHART.length), u: '个' },
      { k: '本主体自建', v: String(bsCustom().length), u: '个' },
      { k: '停用', v: String(bsCustom().filter(a => a[2] && a[2].off).length), u: '个' },
    ])
    + `<div class="note"><b>规矩（照金蝶/用友的惯例）：</b>有下级或在用（凭证/规则挂着）的科目不能删，只能停用；
      标准科目不可删、改名会落成本主体的覆盖；有下级的科目按惯例不该直接记账——系统提示但不硬拦，因为已有规则挂在上级科目上。停用的科目不再出现在 T2 科目下拉和期初余额里，历史数据不受影响。</div>`
    + form
    + card('科目树', table(
      [{ t: '编码' }, { t: '名称' }, { t: '类别' }, { t: '方向' }, { t: '级次' }, { t: '辅助核算' }, { t: '状态' }, { t: '来源' }, { t: '' }], rows));
};

/* ============ 事件 ============ */
document.addEventListener('change', e => {
  if (e.target.id === 'bsParent') {
    BSS.parent = e.target.value;
    const c = $('bsCode'); if (c && BSS.parent) c.value = bsNextCode(BSS.parent);
  }
  if (e.target.id === 'bsiFile' && e.target.files && e.target.files[0]) { bsiLoad(e.target.files[0]); return; }
  if (e.target.id === 'bsiHead' && BSI.rows) {
    BSI.headRow = +e.target.value;
    const c = bsiCompose(BSI.rows, BSI.headRow);
    BSI.dataFrom = c.dataFrom; BSI.header = c.header; BSI.map = bsiMap(c.header);
    go('bs-imp'); return;
  }
  if (e.target.dataset && e.target.dataset.bsimap && BSI.rows) {
    const k = e.target.dataset.bsimap;
    if (e.target.value === '') delete BSI.map[k]; else BSI.map[k] = +e.target.value;
    go('bs-imp'); return;
  }
  if (e.target.id === 'bsiWipe') { BSI.wipe = e.target.checked ? 1 : 0; return; }
});
document.addEventListener('click', e => {
  const sub = e.target.closest('[data-bssub]');
  if (sub) { BSS.parent = sub.dataset.bssub; BSS.edit = ''; go('bs-acct'); return; }
  const ed = e.target.closest('[data-bsedit]');
  if (ed) { BSS.edit = ed.dataset.bsedit; go('bs-acct'); return; }
  const del = e.target.closest('[data-bsdel]');
  if (del && RS) {
    const code = del.dataset.bsdel;
    const used = bsUsed(code);
    if (used) { toast(`该科目在${used}里在用，不能删，只能停用`); return; }
    if (!confirm(`确认删除科目 ${code}？`)) return;
    RS.accounts = RS.accounts.filter(a => String(a[0]) !== code);
    saveRSet(CUR_ENT, RS); toast('已删除'); go('bs-acct'); return;
  }
  const off = e.target.closest('[data-bsoff]') || e.target.closest('[data-bson]');
  if (off && RS) {
    const code = off.dataset.bsoff || off.dataset.bson;
    const a = RS.accounts.find(x => String(x[0]) === code);
    if (a) { a[2] = a[2] || {}; a[2].off = off.dataset.bsoff ? 1 : 0; saveRSet(CUR_ENT, RS); }
    toast(off.dataset.bsoff ? '已停用（不再出现在录入下拉里）' : '已启用'); go('bs-acct'); return;
  }
  const act = e.target.closest('[data-act]');
  if (!act || !CUR_ENT) return;
  if (act.dataset.act === 'bsCancel') { BSS.edit = ''; go('bs-acct'); return; }
  if (act.dataset.act === 'bsSave') {
    if (!RS) RS = initRSet(CUR_ENT);
    const name = (($('bsName') || {}).value || '').trim();
    if (!name) { toast('科目名称不能为空'); return; }
    const dirSel = ($('bsDir') || {}).value;
    const aux = [...document.querySelectorAll('[data-bsaux]:checked')].map(x => x.dataset.bsaux);
    const opts = {};
    if (dirSel && dirSel !== '默认') opts.dir = dirSel;
    if (aux.length) opts.aux = aux;
    if (BSS.edit) {
      // 编辑：自建的就地改；标准的落成本主体覆盖（同编码进 RS.accounts）
      const code = BSS.edit;
      let a = RS.accounts.find(x => String(x[0]) === code);
      if (!a) { a = [code, name]; RS.accounts.push(a); }
      const keep = a[2] || {};
      a[1] = name;
      a[2] = Object.assign({}, opts, keep.off ? { off: keep.off } : {});
      if (opts.dir) a[2].dir = opts.dir; else delete a[2].dir;
      if (aux.length) a[2].aux = aux; else delete a[2].aux;
      saveRSet(CUR_ENT, RS); BSS.edit = '';
      toast(`科目 ${code} 已更新`); go('bs-acct'); return;
    }
    const code = (($('bsCode') || {}).value || '').trim();
    if (!BSS.parent) { toast('先选上级科目'); return; }
    if (!new RegExp('^' + BSS.parent + '\\d{2}$').test(code)) {
      toast(`编码必须是「${BSS.parent} + 2 位数字」，如 ${bsNextCode(BSS.parent)}`); return;
    }
    if (bsFind(code)) { toast('编码已存在：' + code); return; }
    RS.accounts.push([code, name, Object.keys(opts).length ? opts : undefined].filter(x => x !== undefined));
    saveRSet(CUR_ENT, RS);
    toast(`已新增 ${code} ${name}`); go('bs-acct'); return;
  }
  if (act.dataset.act === 'bsImpGo') { go('bs-imp'); return; }
  if (act.dataset.act === 'bsImpBack') { go('bs-acct'); return; }
  if (act.dataset.act === 'bsImpCancel') { Object.assign(BSI, { rows: null, map: {}, fileName: '' }); go('bs-imp'); return; }
  if (act.dataset.act === 'bsImpApply') { bsiApply(); return; }
  if (act.dataset.act === 'bsImpTpl') {
    download('科目余额表导入模板.csv', toCSV([
      ['科目编码', '科目名称', '期初余额借方', '期初余额贷方'],
      ['1002', '银行存款', '', ''],
      ['100201', '银行存款_工行基本户', '130547.25', ''],
      ['100202', '银行存款_建行一般户', '50000.00', ''],
      ['2202', '应付账款', '', ''],
      ['220201', '应付账款_供应商A', '', '80000.00'],
      ['3104', '利润分配_未分配利润', '', '100547.25'],
    ]));
    toast('模板已下载（也可直接用用友/金蝶导出的原表）'); return;
  }
  if (act.dataset.act === 'bsExp') {
    const rows = [['编码', '名称', '类别', '余额方向', '级次', '辅助核算', '来源', '状态']];
    ACCOUNTS(1).filter(a => !String(a[0]).includes('{')).forEach(a => {
      const opts = a[2] || {};
      rows.push([a[0], a[1], bsClass(a[0]), bsDir(a[0], opts), bsLevel(a[0]),
        (opts.aux || []).map(k => (BS_AUX.find(x => x[0] === k) || [])[1] || '').join(' '),
        bsIsStd(a[0]) && !bsCustom().some(c => String(c[0]) === String(a[0])) ? '标准' : '自建',
        opts.off ? '停用' : '启用']);
    });
    download(`科目表_${entName()}.csv`, toCSV(rows)); toast('已导出');
  }
});

/* ============ 科目余额表导入（建科目 + 录期初，一个文件两件事） ============ */
/* 用友/金蝶导出的科目余额表丢进来：先把系统没有的一/二/三级科目补建好，
   再把期初余额写进期初凭证（__ob__，核算模块那张）。口径约束：
   - 只认 4-2-2 级次（与本系统一致）；其它级次（用友可配 4-3-3）如实列为问题行，不硬转
   - 一级科目允许补建（编码 1-5 开头才收——准则表没配齐的行业科目能进来）
   - 期初余额只导「末级」行：上级行是汇总数，导了会和下级双计；
     文件里上级 ≠ 下级合计的地方如实提示（多半是源表筛过行）
   - 金蝶常见的两行表头（「期初余额」跨列 + 下行「借方/贷方」）自动合成
   - 只读「期初/年初」列，绝不碰「本期发生/期末」列——期末数导进期初是灾难 */
const BSI = { rows: null, headRow: 0, dataFrom: 1, map: {}, fileName: '', wipe: 1 };
const BSI_ALIAS = {
  code: ['科目编码', '科目代码', '科目编号', '编码', '代码'],
  name: ['科目名称', '科目全称', '科目全名', '科目名', '名称'],
  dr: ['期初余额借方', '期初借方', '借方期初余额', '借方期初', '年初余额借方', '年初借方'],
  cr: ['期初余额贷方', '期初贷方', '贷方期初余额', '贷方期初', '年初余额贷方', '年初贷方'],
  dir: ['余额方向', '借贷方向', '方向', '借或贷'],
  bal: ['期初余额', '年初余额', '期初金额'],
};
/* 金蝶两行表头合成：顶行「期初余额」（合并单元格导出后右边是空）+ 下行「借方/贷方」
   → 拼成「期初余额借方 / 期初余额贷方」。空顶格沿用左边最近的非空值。 */
function bsiCompose(rows, h) {
  const top = rows[h] || [], sub = rows[h + 1] || [];
  const subCells = sub.map(c => String(c == null ? '' : c).replace(/\s|　/g, ''));
  const isSub = subCells.some(c => c === '借方' || c === '贷方') && !subCells.some(c => c.includes('科目'));
  if (!isSub) return { header: top.map(c => String(c == null ? '' : c)), dataFrom: h + 1 };
  let carry = '';
  const header = top.map((c, i) => {
    const t = String(c == null ? '' : c).trim();
    if (t) carry = t;
    return (t || carry) + (subCells[i] || '');
  });
  return { header, dataFrom: h + 2 };
}
function bsiMap(header) {
  const cells = header.map(c => String(c == null ? '' : c).replace(/\s|　/g, ''));
  const bad = /发生|期末|本年|累计|本期/;   // 这些列长得像但绝不能要
  const map = {};
  const pick = (k, aliases) => {
    for (const exact of [1, 0]) {
      for (let i = 0; i < cells.length; i++) {
        if (Object.values(map).includes(i) || !cells[i]) continue;
        if (!aliases.some(a => (exact ? cells[i] === a : cells[i].includes(a)))) continue;
        if (k !== 'code' && k !== 'name' && k !== 'dir' && bad.test(cells[i])) continue;
        map[k] = i; return;
      }
    }
  };
  pick('code', BSI_ALIAS.code); pick('name', BSI_ALIAS.name);
  pick('dr', BSI_ALIAS.dr); pick('cr', BSI_ALIAS.cr);
  pick('dir', BSI_ALIAS.dir); pick('bal', BSI_ALIAS.bal);
  // 简版表兜底：整表没有任何期初/年初字样时，裸「借方/贷方」也认（仍躲开发生/期末列）
  if (map.dr === undefined && map.bal === undefined) pick('dr', ['借方']);
  if (map.cr === undefined && map.bal === undefined) pick('cr', ['贷方']);
  return map;
}
async function bsiLoad(file) {
  try {
    // RS（科目集）必须是当前主体的——外部脚本或异常路径改了 CUR_ENT 没重载 RS 时，
    // 「科目已存在」的判定会拿别的主体的科目表判，期初凭证名称也会写错
    if (CUR_ENT && typeof useRuleSet === 'function') useRuleSet(CUR_ENT);
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, BSI_ALIAS.code.concat(BSI_ALIAS.name));
    const c = bsiCompose(rows, hr);
    Object.assign(BSI, { rows, headRow: hr, dataFrom: c.dataFrom, map: bsiMap(c.header), fileName: file.name, header: c.header });
    go('bs-imp');
    toast(`读到 ${rows.length} 行，表头定在第 ${hr + 1} 行`);
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}
/* 预览与导入共用一份计划——两边算法永远一致 */
function bsiPlan() {
  const out = { create: [], balLines: [], skipParentBal: [], badLevel: [], noParent: [], renamed: [],
    dup: 0, sumWarn: [], tdr: 0, tcr: 0, rows: 0, negFixed: 0 };
  if (!BSI.rows || BSI.map.code === undefined) return out;
  const im = BSI;
  const seen = new Map();
  im.rows.slice(im.dataFrom).forEach(r => {
    const g = i => (i === undefined ? '' : String(r[i] == null ? '' : r[i]).trim());
    const rawCode = g(im.map.code).replace(/\s|　/g, '');
    if (!rawCode) return;
    const name = g(im.map.name).replace(/\s|　/g, '') || '（未命名）';
    if (!/^\d+$/.test(rawCode)) {
      if (!/合计|总计/.test(rawCode + name)) out.badLevel.push({ code: rawCode, name, why: '编码含非数字' });
      return;
    }
    if (![4, 6, 8].includes(rawCode.length)) {
      out.badLevel.push({ code: rawCode, name, why: `级次不是 4-2-2（${rawCode.length} 位）` }); return;
    }
    let dr = 0, cr = 0;
    if (im.map.bal !== undefined && im.map.dr === undefined) {
      const v = numOf(g(im.map.bal));
      if (/贷/.test(g(im.map.dir))) cr = v; else dr = v;
    } else {
      dr = numOf(g(im.map.dr)); cr = numOf(g(im.map.cr));
    }
    // 负数按会计惯例转对方向（用友红字）
    if (dr < 0) { cr += -dr; dr = 0; out.negFixed++; }
    if (cr < 0) { dr += -cr; cr = 0; out.negFixed++; }
    dr = +dr.toFixed(2); cr = +cr.toFixed(2);
    if (seen.has(rawCode)) { out.dup++; return; }
    seen.set(rawCode, { code: rawCode, name, dr, cr });
  });
  const codes = new Set(seen.keys());
  const sorted = [...seen.values()].sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
  const willCreate = new Set();
  sorted.forEach(x => {
    const exist = bsFind(x.code);
    if (exist) {
      if (x.name !== '（未命名）' && String(exist[1]).replace(/\s|　/g, '') !== x.name) {
        out.renamed.push({ code: x.code, sys: exist[1], file: x.name });
      }
      return;
    }
    if (x.code.length === 4) {
      if (!/^[1-5]/.test(x.code)) { out.badLevel.push({ code: x.code, name: x.name, why: '一级编码不是 1-5 开头' }); return; }
      willCreate.add(x.code); out.create.push(x); return;
    }
    const parent = x.code.slice(0, -2);
    if (!bsFind(parent) && !willCreate.has(parent)) { out.noParent.push(x); return; }
    willCreate.add(x.code); out.create.push(x);
  });
  const blocked = new Set(out.noParent.map(x => x.code).concat(out.badLevel.map(x => x.code)));
  const hasChildInFile = c => { for (const k of codes) { if (k.length === c.length + 2 && k.startsWith(c)) return true; } return false; };
  const hasChildInSys = c => ACCOUNTS(1).some(a => String(a[0]).length === String(c).length + 2 && String(a[0]).startsWith(String(c)));
  sorted.forEach(x => {
    if (!x.dr && !x.cr) return;
    if (blocked.has(x.code)) return;                        // 建不了的科目，余额也不导
    if (hasChildInFile(x.code)) { out.skipParentBal.push(x); return; }   // 文件内的上级汇总行
    if (hasChildInSys(x.code) && !willCreate.has(x.code)) { out.skipParentBal.push(x); return; }  // 系统里已有下级
    out.balLines.push(x);
    out.tdr = +(out.tdr + x.dr).toFixed(2); out.tcr = +(out.tcr + x.cr).toFixed(2);
  });
  // 表内勾稽：上级行的数 vs 文件内下级合计，对不上说明源表被筛过行
  sorted.forEach(p => {
    if (!hasChildInFile(p.code) || (!p.dr && !p.cr)) return;
    let sdr = 0, scr = 0;
    seen.forEach(k => { if (k.code.length === p.code.length + 2 && k.code.startsWith(p.code)) { sdr += k.dr; scr += k.cr; } });
    if (Math.abs(sdr - p.dr) > 0.01 || Math.abs(scr - p.cr) > 0.01) out.sumWarn.push({ code: p.code, name: p.name });
  });
  out.rows = seen.size;
  return out;
}
function bsiApply() {
  if (CUR_ENT && typeof useRuleSet === 'function') useRuleSet(CUR_ENT);   // 同 bsiLoad：落库前再对一次表
  const p = bsiPlan();
  if (!p.create.length && !p.balLines.length) { toast('这张表没有可导入的科目或期初余额'); return; }
  if (!RS) RS = initRSet(CUR_ENT);
  p.create.forEach(x => { RS.accounts.push([x.code, x.name]); });
  if (p.create.length) saveRSet(CUR_ENT, RS);
  let obNote = '';
  if (p.balLines.length && typeof obGet === 'function') {
    const old = obGet(CUR_ENT);
    let lines = BSI.wipe ? [] : (old ? old.lines.slice() : []);
    const touched = new Set(p.balLines.map(x => x.code));
    lines = lines.filter(l => !touched.has(String(l.acct)));
    p.balLines.forEach(x => { lines.push({ acct: x.code, name: acctName(x.code), dr: x.dr, cr: x.cr, memo: '期初余额' }); });
    const list = vchLoad(CUR_ENT).filter(v => v.id !== OB_ID);
    if (lines.length) list.unshift({ id: OB_ID, period: '2025-12', date: '2025-12-31', word: '期初', no: '0', posted: 1, src: '科目余额表导入', lines });
    vchSave(CUR_ENT, list);
    const d = +(lines.reduce((s, l) => s + l.dr - l.cr, 0)).toFixed(2);
    obNote = Math.abs(d) > 0.005 ? `；期初借贷差 ${money(d)}，报表中心会拦到录平为止` : '；期初借贷平衡';
  }
  Object.assign(BSI, { rows: null, map: {}, fileName: '' });
  toast(`导入完成：新建科目 ${p.create.length} 个、期初余额 ${p.balLines.length} 条${obNote}`, 6200);
  go(p.balLines.length ? 'ac-open' : 'bs-acct');
}
S['bs-imp'] = () => {
  if (!CUR_ENT) return needEnt('导入科目余额表');
  const tools = `<button class="btn" data-act="bsImpBack">← 返回科目设置</button>
     <button class="btn" data-act="bsImpTpl">下载模板</button>`;
  if (!BSI.rows) {
    return head('导入科目余额表', '用友/金蝶导出的科目余额表丢进来，<b>建科目 + 录期初一次完成</b>。', '基础 · 科目', tools)
      + cardp('选择文件', `<input type="file" id="bsiFile" accept=".xlsx,.csv,.txt">
        <div class="note" style="margin-top:11px"><b>表里至少要有「科目编码」和「科目名称」两列</b>；期初余额认
          「期初/年初余额 借方、贷方」两列式，或「期初余额 + 方向」单列式，金蝶的两行表头自动识别。
          只读期初列，<b>本期发生额、期末余额一概不碰</b>。</div>
        <div class="note"><b>导入规则：</b>系统没有的一/二/三级科目自动补建（编码必须是 4-2-2 级次）；
          期初余额只取<b>末级科目</b>行——上级行是汇总数，由下级自动汇总，导了会双计。
          已存在的科目不重建、不改名（名称不同会提示）。</div>`);
  }
  const p = bsiPlan();
  const ready = BSI.map.code !== undefined && (BSI.map.dr !== undefined || BSI.map.bal !== undefined || BSI.map.cr !== undefined);
  const header = BSI.header || [];
  const fields = [['code', '科目编码', 1], ['name', '科目名称', 1], ['dr', '期初借方', 0], ['cr', '期初贷方', 0], ['bal', '期初余额（单列式）', 0], ['dir', '余额方向（单列式）', 0]];
  const opts = k => header.map((h, j) => `<option value="${j}" ${BSI.map[k] === j ? 'selected' : ''}>第${j + 1}列 ${H(String(h || '(空)').slice(0, 16))}</option>`).join('');
  const mapRows = fields.map(([k, n, must]) => [
    H(n) + (must ? ' <span class="red">*</span>' : ''),
    `<select data-bsimap="${k}"><option value="">— 不使用 —</option>${opts(k)}</select>`,
  ]);
  const headOpts = BSI.rows.slice(0, Math.min(BSI.rows.length, 12)).map((r, i) =>
    `<option value="${i}" ${i === BSI.headRow ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 46))}</option>`).join('');
  const cut = (arr, n) => arr.slice(0, n).map(x => `${H(x.code)} ${H(x.name)}`).join('、') + (arr.length > n ? ` … 等 ${arr.length} 个` : '');
  const diff = +(p.tdr - p.tcr).toFixed(2);
  return head('导入科目余额表', `${H(BSI.fileName)} · ${BSI.rows.length} 行 · 主体 ${H(entName())}`, '基础 · 科目', tools)
    + cardp('表头在第几行', `<select id="bsiHead" style="min-width:340px">${headOpts}</select>
      <span class="mut" style="margin-left:8px">金蝶两行表头（期初余额+借方/贷方）已自动合成</span>`)
    + card('列对应关系', table([{ t: '字段' }, { t: '对应哪一列' }], mapRows))
    + (ready ? kpis([
      { k: '有效科目行', v: String(p.rows), u: '个' },
      { k: '将新建科目', v: String(p.create.length), u: '个', t: p.create.length ? 'g' : '' },
      { k: '将写期初余额', v: String(p.balLines.length), u: '条', t: p.balLines.length ? 'g' : '' },
      { k: '期初借方合计', v: money(p.tdr) },
      { k: '期初贷方合计', v: money(p.tcr) },
      { k: '借贷差额', v: money(diff), t: Math.abs(diff) < 0.005 ? 'g' : 'c' },
    ]) : '<div class="note c"><b>还不能继续：</b>「科目编码」必须对应上，且期初余额至少认出一列（借方/贷方或单列+方向）。</div>')
    + (ready && p.create.length ? `<div class="note g"><b>将新建 ${p.create.length} 个科目：</b>${cut(p.create, 10)}</div>` : '')
    + (ready && p.renamed.length ? `<div class="note w"><b>${p.renamed.length} 个科目已存在但名称不同，不改名：</b>${
        p.renamed.slice(0, 5).map(x => `${H(x.code)} 系统「${H(x.sys)}」/ 表里「${H(x.file)}」`).join('；')}${p.renamed.length > 5 ? ' …' : ''}</div>` : '')
    + (ready && p.skipParentBal.length ? `<div class="note"><b>${p.skipParentBal.length} 行是上级汇总行，余额不导</b>（由下级自动汇总）：${cut(p.skipParentBal, 6)}</div>` : '')
    + (ready && p.sumWarn.length ? `<div class="note c"><b>表内勾稽对不上 ${p.sumWarn.length} 处</b>（上级行 ≠ 下级合计，源表可能筛过行，导完请核对）：${
        p.sumWarn.slice(0, 5).map(x => H(x.code) + ' ' + H(x.name)).join('、')}</div>` : '')
    + (ready && p.noParent.length ? `<div class="note c"><b>${p.noParent.length} 个科目找不到上级，跳过</b>（上级既不在系统也不在表里）：${cut(p.noParent, 6)}</div>` : '')
    + (ready && p.badLevel.length ? `<div class="note c"><b>${p.badLevel.length} 行编码不合规，跳过：</b>${
        p.badLevel.slice(0, 5).map(x => `${H(x.code)}（${H(x.why)}）`).join('；')}${p.badLevel.length > 5 ? ' …' : ''}</div>` : '')
    + (ready && p.dup ? `<div class="note w"><b>表里有 ${p.dup} 行重复编码</b>，只取第一次出现的。</div>` : '')
    + (ready && p.negFixed ? `<div class="note w"><b>${p.negFixed} 行余额是负数</b>，已按会计惯例转到对方向。</div>` : '')
    + cardp('期初写入方式', `<label style="font-size:12px"><input type="checkbox" id="bsiWipe" ${BSI.wipe ? 'checked' : ''}>
        以这张表为准，<b>清空原有期初后写入</b>（不勾 = 只覆盖表里出现的科目，其余保留）</label>
      <div class="note" style="margin-top:9px">期初进的是核算模块那张「期初凭证」（2025-12-31），科目余额表/资产负债表年初数/明细账全部自动生效。重复导同一张表结果一致，不会翻倍。</div>`)
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn" data-act="bsImpCancel">换个文件</button>
        <button class="btn pri" data-act="bsImpApply" ${ready && (p.create.length || p.balLines.length) ? '' : 'disabled'}>确认导入</button>
      </div>`;
};

/* ============ 客户 / 供应商维护 ============ */
/* 按主体各存各的（垂直下放）。这是 科目设置 里「客户/供应商」辅助核算的名册。
   销项票的购方就是客户、进项票的销方就是供应商——可一键从票池收进来，不用手抄。 */
const DIM_KEY = (kind, e) => 'fsc_dim_' + kind + '_' + e + '_v1';
const dimLoad = kind => { try { return JSON.parse(localStorage.getItem(DIM_KEY(kind, CUR_ENT)) || '[]'); } catch (e) { return []; } };
const dimSave = (kind, v) => { try { localStorage.setItem(DIM_KEY(kind, CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败'); } };
const DIMS = { edit: '' };

function dimScreen(kind) {
  const isCust = kind === 'cust';
  const title = isCust ? '客户维护' : '供应商维护';
  if (!CUR_ENT) return needEnt(title);
  const list = dimLoad(kind);
  const editing = DIMS.edit ? list.find(x => x.id === DIMS.edit) : null;
  // 票据里出现次数（信息参考，也是「在用」判断）
  const pool = ivLoad(isCust ? IV_OUT_KEY(CUR_ENT) : IV_IN_KEY(CUR_ENT));
  const cnt = {};
  pool.forEach(x => { if (x.who) cnt[x.who] = (cnt[x.who] || 0) + 1; });
  const rows = list.map(x => [
    H(x.name), H(x.taxno || '—'), H(x.contact || '—'), H(x.phone || '—'), H(x.memo || '—'),
    cnt[x.name] ? pill(`票据 ${cnt[x.name]} 张`, 'ok') : '<span class="mut">—</span>',
    x.off ? pill('停用', 'wa') : pill('启用', 'ok'),
    `<button class="btn sm" data-dimedit="${H(x.id)}">编辑</button>
     <button class="btn sm" data-dimtoggle="${H(x.id)}">${x.off ? '启用' : '停用'}</button>
     <button class="btn sm" data-dimdel="${H(x.id)}">删除</button>`,
  ]);
  return head(title, `${H(entName())} · ${isCust ? '销项票的购买方就是客户' : '进项票的销售方就是供应商'}，可从票池一键收录。名册按主体隔离。`, '基础 · 辅助核算',
    `<button class="btn" data-act="dimHarvest">从${isCust ? '销项票收客户' : '进项票收供应商'}</button>
     <button class="btn pri" data-act="dimExp">导出</button>`)
    + kpis([
      { k: isCust ? '客户数' : '供应商数', v: String(list.length), u: '个' },
      { k: '票池可收录', v: String(Object.keys(cnt).filter(n => !list.some(x => x.name === n)).length), u: '个', t: 'g' },
      { k: '停用', v: String(list.filter(x => x.off).length), u: '个' },
    ])
    + cardp(editing ? `编辑：${H(editing.name)}` : '新增' + (isCust ? '客户' : '供应商'), `
      <div class="cols c4">
        <div class="field"><label class="fl">名称 <span class="red">*</span></label><input id="dmName" value="${editing ? H(editing.name) : ''}"></div>
        <div class="field"><label class="fl">纳税人识别号</label><input id="dmTax" value="${editing ? H(editing.taxno || '') : ''}"></div>
        <div class="field"><label class="fl">联系人</label><input id="dmContact" value="${editing ? H(editing.contact || '') : ''}"></div>
        <div class="field"><label class="fl">电话</label><input id="dmPhone" value="${editing ? H(editing.phone || '') : ''}"></div>
      </div>
      <div class="field" style="margin-top:8px"><label class="fl">备注</label><input id="dmMemo" value="${editing ? H(editing.memo || '') : ''}"></div>
      <div style="text-align:right;margin-top:9px">
        ${editing ? '<button class="btn" data-act="dimCancel">取消</button> ' : ''}
        <button class="btn pri" data-act="dimSave">${editing ? '保存修改' : '新增'}</button></div>`)
    + card('名册', rows.length ? table(
      [{ t: '名称' }, { t: '纳税人识别号' }, { t: '联系人' }, { t: '电话' }, { t: '备注' }, { t: '票据' }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有${isCust ? '客户' : '供应商'}——手工新增，或从票池一键收录</div>`);
}
S['bs-cust'] = () => dimScreen('cust');
S['bs-supp'] = () => dimScreen('supp');

/* ============ 项目维护 ============ */
/* 项目就是 T2 在用的那份（RS.projects）——单一真相源，不另存一份。
   关键词（kw）是 T2 自动认项目的依据：摘要/户名里含关键词就归到该项目。 */
S['bs-proj'] = () => {
  if (!CUR_ENT) return needEnt('项目维护');
  const ps = (RS && RS.projects) || [];
  const editing = DIMS.edit ? ps.find(x => x.code === DIMS.edit) : null;
  const usedCnt = code => {
    try { return vchLoad(CUR_ENT).reduce((s, v) => s + v.lines.filter(l => String(l.acct).endsWith('_' + code)).length, 0); }
    catch (e) { return 0; }
  };
  const rows = ps.map(x => {
    const n = usedCnt(x.code);
    return [`<span class="code">${H(x.code)}</span>`, H(x.name), `<span class="code">${H(x.kw || '—')}</span>`,
      n ? pill(`凭证 ${n} 行`, 'ok') : '<span class="mut">—</span>',
      `<button class="btn sm" data-pjedit="${H(x.code)}">编辑</button>
       ${n ? '' : `<button class="btn sm" data-pjdel="${H(x.code)}">删除</button>`}`];
  });
  return head('项目维护', `${H(entName())} · 项目按主体隔离，是科目后缀（如 5001_${ps[0] ? H(ps[0].code) : '2001'}）和 T2 自动归项的依据。`, '基础 · 辅助核算')
    + kpis([{ k: '项目数', v: String(ps.length), u: '个' }])
    + `<div class="note"><b>关键词是 T2 自动认项目的依据：</b>银行流水的摘要或对方户名里含关键词（支持正则，| 分隔多个），就自动归到该项目。凭证里项目落在科目后缀上（科目编码_项目代码），报表按项目拆分靠它。有凭证在用的项目不能删。</div>`
    + cardp(editing ? `编辑项目 ${H(editing.code)}` : '新增项目', `
      <div class="cols c4">
        <div class="field"><label class="fl">项目代码（4 位数字）<span class="red">*</span></label>
          <input id="pjCode" value="${editing ? H(editing.code) : ''}" ${editing ? 'disabled' : ''} placeholder="如 3001"></div>
        <div class="field"><label class="fl">项目名称 <span class="red">*</span></label><input id="pjName" value="${editing ? H(editing.name) : ''}"></div>
        <div class="field" style="grid-column:span 2"><label class="fl">识别关键词（正则，| 分隔）</label>
          <input id="pjKw" value="${editing ? H(editing.kw || '') : ''}" placeholder="如 花都|UU公寓"></div>
      </div>
      <div style="text-align:right;margin-top:9px">
        ${editing ? '<button class="btn" data-act="pjCancel">取消</button> ' : ''}
        <button class="btn pri" data-act="pjSave">${editing ? '保存修改' : '新增项目'}</button></div>`)
    + card('项目清单', rows.length ? table(
      [{ t: '代码' }, { t: '名称' }, { t: '识别关键词' }, { t: '在用' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有项目</div>`);
};

/* ============ 客商/项目事件 ============ */
document.addEventListener('click', e => {
  const kindOf = () => (CURS === 'bs-cust' ? 'cust' : 'supp');
  const de = e.target.closest('[data-dimedit]');
  if (de) { DIMS.edit = de.dataset.dimedit; go(CURS); return; }
  const dt = e.target.closest('[data-dimtoggle]');
  if (dt) {
    const list = dimLoad(kindOf());
    const x = list.find(v => v.id === dt.dataset.dimtoggle);
    if (x) { x.off = x.off ? 0 : 1; dimSave(kindOf(), list); }
    go(CURS); return;
  }
  const dd = e.target.closest('[data-dimdel]');
  if (dd) {
    const list = dimLoad(kindOf());
    const x = list.find(v => v.id === dd.dataset.dimdel);
    if (!x || !confirm(`确认删除「${x.name}」？票据数据不受影响。`)) return;
    dimSave(kindOf(), list.filter(v => v.id !== x.id));
    toast('已删除'); go(CURS); return;
  }
  const pe = e.target.closest('[data-pjedit]');
  if (pe) { DIMS.edit = pe.dataset.pjedit; go('bs-proj'); return; }
  const pd = e.target.closest('[data-pjdel]');
  if (pd && RS) {
    if (!confirm('确认删除该项目？')) return;
    RS.projects = (RS.projects || []).filter(x => x.code !== pd.dataset.pjdel);
    saveRSet(CUR_ENT, RS); toast('已删除'); go('bs-proj'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'dimCancel' || act === 'pjCancel') { DIMS.edit = ''; go(CURS); return; }
  if (act === 'dimSave') {
    const name = (($('dmName') || {}).value || '').trim();
    if (!name) { toast('名称不能为空'); return; }
    const kind = kindOf(); const list = dimLoad(kind);
    if (!DIMS.edit && list.some(x => x.name === name)) { toast('已存在同名记录'); return; }
    const rec = DIMS.edit ? list.find(x => x.id === DIMS.edit)
      : (list.push({ id: uid() }), list[list.length - 1]);
    Object.assign(rec, { name, taxno: ($('dmTax') || {}).value || '', contact: ($('dmContact') || {}).value || '',
      phone: ($('dmPhone') || {}).value || '', memo: ($('dmMemo') || {}).value || '' });
    dimSave(kind, list); DIMS.edit = '';
    toast('已保存'); go(CURS); return;
  }
  if (act === 'dimHarvest') {
    const kind = kindOf();
    const pool = ivLoad(kind === 'cust' ? IV_OUT_KEY(CUR_ENT) : IV_IN_KEY(CUR_ENT));
    const list = dimLoad(kind);
    const have = new Set(list.map(x => x.name));
    let n = 0;
    [...new Set(pool.map(x => x.who).filter(Boolean))].forEach(nm => {
      if (!have.has(nm)) { list.push({ id: uid(), name: nm, memo: '从票池收录' }); n++; }
    });
    dimSave(kind, list);
    toast(n ? `收录 ${n} 个（票池里已有名册的跳过）` : '票池里没有新名字', 4200); go(CURS); return;
  }
  if (act === 'dimExp') {
    const kind = kindOf(); const list = dimLoad(kind);
    download(`${kind === 'cust' ? '客户' : '供应商'}名册_${entName()}.csv`,
      toCSV([['名称', '纳税人识别号', '联系人', '电话', '备注', '状态']]
        .concat(list.map(x => [x.name, x.taxno || '', x.contact || '', x.phone || '', x.memo || '', x.off ? '停用' : '启用']))));
    toast('已导出'); return;
  }
  if (act === 'pjSave') {
    if (!RS) RS = initRSet(CUR_ENT);
    RS.projects = RS.projects || [];
    const name = (($('pjName') || {}).value || '').trim();
    const kw = (($('pjKw') || {}).value || '').trim();
    if (!name) { toast('项目名称不能为空'); return; }
    try { if (kw) new RegExp(kw); } catch (err) { toast('关键词不是合法正则：' + err.message); return; }
    if (DIMS.edit) {
      const x = RS.projects.find(v => v.code === DIMS.edit);
      if (x) { x.name = name; x.kw = kw; }
    } else {
      const code = (($('pjCode') || {}).value || '').trim();
      if (!/^\d{4}$/.test(code)) { toast('项目代码要 4 位数字，如 3001'); return; }
      if (RS.projects.some(v => v.code === code)) { toast('代码已存在：' + code); return; }
      RS.projects.push({ code, name, kw });
    }
    saveRSet(CUR_ENT, RS); DIMS.edit = '';
    toast('已保存'); go('bs-proj'); return;
  }
});

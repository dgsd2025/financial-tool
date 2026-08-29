/* 核算模块 —— 凭证库 → 账簿
   链条：① 凭证（T2 产出，入库）→ ② 账簿（科目余额表/明细账/总分类账）
   账簿全部从凭证库实时汇总，不单独存一份数。
   依赖 app.js 的工具函数与规则集。 */
'use strict';

/* ============ 凭证库 ============ */
const VCH_KEY = e => 'fsc_vch_' + e + '_v1';

/** 一张凭证 = { id, date, word, no, period, lines:[{acct,name,memo,dr,cr,proj,opp,ref}], src, posted } */
function vchLoad(entId) {
  try { return JSON.parse(localStorage.getItem(VCH_KEY(entId)) || '[]'); }
  catch (e) { return []; }
}
function vchSave(entId, list) {
  try { localStorage.setItem(VCH_KEY(entId), JSON.stringify(list)); return true; }
  catch (e) { toast('凭证库保存失败：存储空间不足'); return false; }
}
/** 把 T2 生成的凭证行入库（15 列格式）*/
function vchImport(entId, rows, srcName) {
  const list = vchLoad(entId);
  const byNo = {};
  rows.forEach(r => {
    const [date, word, no, memo, acct, name, dr, cr, ent, line, proj, contract, opp, ref, bankNo] = r;
    const key = date + '|' + word + '|' + no;
    if (!byNo[key]) byNo[key] = {
      id: uid(), date, word, no, period: String(date).slice(0, 7),
      lines: [], src: srcName || 'T2', posted: 0, at: new Date().toLocaleString('zh-CN'),
    };
    byNo[key].lines.push({
      acct, name, memo, dr: +dr || 0, cr: +cr || 0,
      proj: proj || '', opp: opp || '', ref: ref || '', line: line || '',
    });
  });
  const added = Object.values(byNo);
  // 同来源同凭证号视为重复，覆盖而非追加
  const keep = list.filter(v => !added.some(a => a.date === v.date && a.word === v.word && a.no === v.no && a.src === v.src));
  const out = keep.concat(added).sort((a, b) => (a.date + a.no).localeCompare(b.date + b.no));
  vchSave(entId, out);
  return added.length;
}

/* ============ 账簿汇总（全部从凭证库实时算） ============ */
/* 期间是日期区间（AC.from 〜 AC.to），按凭证日期取数。
   老凭证可能只有 period 没有 date，回退到当月 1 号参与比较。 */
const vDate = v => v.date || (v.period ? v.period + '-01' : '');
/** 区间内的凭证，可选是否含未过账 */
function vchIn(entId, from, to, includeUnposted) {
  return vchLoad(entId).filter(v => {
    const d = vDate(v);
    return d >= from && d <= to && (includeUnposted || v.posted);
  });
}
/** 区间起点之前的全部凭证（算期初用） */
function vchBefore(entId, from, includeUnposted) {
  return vchLoad(entId).filter(v =>
    vDate(v) < from && (includeUnposted || v.posted));
}
/** 科目余额：{acct:{name,期初借,期初贷,本期借,本期贷,本年借,本年贷}} */
function acctBalance(entId, from, to, inc) {
  const year = String(from).slice(0, 4);
  const m = {};
  const touch = a => (m[a] = m[a] || { acct: a, name: '', ob: 0, dr: 0, cr: 0, ydr: 0, ycr: 0 });
  // 期初 = 区间起点之前所有发生额净额
  vchBefore(entId, from, inc).forEach(v => v.lines.forEach(l => {
    const o = touch(l.acct); o.name = o.name || l.name;
    o.ob += (l.dr - l.cr);
    if (vDate(v).slice(0, 4) === year) { o.ydr += l.dr; o.ycr += l.cr; }
  }));
  vchIn(entId, from, to, inc).forEach(v => v.lines.forEach(l => {
    const o = touch(l.acct); o.name = o.name || l.name;
    o.dr += l.dr; o.cr += l.cr; o.ydr += l.dr; o.ycr += l.cr;
  }));
  Object.values(m).forEach(o => { o.eb = o.ob + o.dr - o.cr; });
  return m;
}
/** 明细账：某科目在期间内的逐笔 */
function acctDetail(entId, acct, from, to, inc) {
  const year = String(from).slice(0, 4);
  let bal = 0, ydr = 0, ycr = 0;
  vchBefore(entId, from, inc).forEach(v => v.lines.forEach(l => {
    if (l.acct !== acct) return;
    bal += l.dr - l.cr;
    if (vDate(v).slice(0, 4) === year) { ydr += l.dr; ycr += l.cr; }
  }));
  const rows = [];
  let dr = 0, cr = 0;
  vchIn(entId, from, to, inc).forEach(v => v.lines.forEach(l => {
    if (l.acct !== acct) return;
    bal += l.dr - l.cr; dr += l.dr; cr += l.cr;
    rows.push({ date: v.date, vno: v.word + '-' + v.no, memo: l.memo, dr: l.dr, cr: l.cr, bal, opp: l.opp });
  }));
  return { open: bal - dr + cr, rows, dr, cr, close: bal, ydr: ydr + dr, ycr: ycr + cr };
}
/** 总分类账：某科目按月 */
function acctByMonth(entId, acct, year, inc) {
  const all = vchLoad(entId).filter(v => (inc || v.posted) && vDate(v).slice(0, 4) === year);
  const m = {};
  all.forEach(v => v.lines.forEach(l => {
    if (l.acct !== acct) return;
    const k = vDate(v).slice(5, 7);
    const o = m[k] = m[k] || { dr: 0, cr: 0 };
    o.dr += l.dr; o.cr += l.cr;
  }));
  // 年初 = 该年之前的净额
  let ob = 0;
  vchLoad(entId).forEach(v => { if ((inc || v.posted) && vDate(v).slice(0, 4) < year) v.lines.forEach(l => { if (l.acct === acct) ob += l.dr - l.cr; }); });
  let bal = ob;
  const rows = Object.keys(m).sort().map(k => { const o = m[k]; bal += o.dr - o.cr; return { mm: +k, dr: o.dr, cr: o.cr, bal }; });
  return { ob, rows, close: bal, tdr: rows.reduce((s, r) => s + r.dr, 0), tcr: rows.reduce((s, r) => s + r.cr, 0) };
}

/* ============ 状态 ============ */
/* 默认区间 = 本月 1 号到月末。用 ym() 拼而不是 toISOString——后者按 UTC 算，
   东八区每月 1 号早上 8 点前会算成上个月。记住上次选的区间。 */
const _acRange = (() => {
  try {
    const s0 = localStorage.getItem('fsc_ac_range') || '';
    if (/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(s0)) return s0.split('~');
  } catch (e) { /* 忽略 */ }
  const n = new Date();
  const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  return [ym(n) + '-01', ym(n) + '-' + String(last).padStart(2, '0')];
})();
const AC = {
  from: _acRange[0], to: _acRange[1],
  inc: 1,          // 是否含未过账凭证
  acct: '',        // 明细账/总分类账当前科目
  showZero: 0,     // 科目余额表是否显示无发生额科目
};
const entName = () => { const e = ENTITIES.find(x => x.id === CUR_ENT); return e ? e.full : ''; };
const needEnt = title => head(title, '请先在顶栏选主体。账簿按主体隔离，各算各的。', '核算')
  + `<div class="note w"><b>还没选主体。</b>顶栏右上角选一个，账簿会读该主体的凭证库。</div>`;
const dirOf = v => v >= 0 ? '借' : '贷';
const absM = v => money(Math.abs(v));

/* ============ 凭证库界面 ============ */
S['ac-vch'] = () => {
  if (!CUR_ENT) return needEnt('凭证库');
  const all = vchLoad(CUR_ENT);
  const cur = all.filter(v => { const d = vDate(v); return d >= AC.from && d <= AC.to; });
  const un = cur.filter(v => !v.posted).length;
  const rows = cur.slice(0, 300).map(v => {
    const dr = v.lines.reduce((s, l) => s + l.dr, 0);
    const bal = Math.abs(dr - v.lines.reduce((s, l) => s + l.cr, 0)) < 0.005;
    return [
      v.date, `<span class="code">${H(v.word)}-${H(v.no)}</span>`,
      H(v.lines[0] ? v.lines[0].memo : ''), `<span class="mono">${v.lines.length}</span>`,
      money(dr), bal ? pill('平', 'ok') : pill('不平', 'cr'),
      H(v.src), v.posted ? pill('已过账', 'ok') : pill('未过账', 'wa'),
      `<button class="btn sm" data-acv="${v.id}">${v.posted ? '反过账' : '过账'}</button>`,
    ];
  });
  return head('凭证库', `${H(entName())} · 账簿的唯一数据来源。<b>T2 生成的凭证在这里入库</b>，账簿与报表全部从这里实时汇总。`, '核算 · 链条起点',
    `期间 ${acRangeHtml('ac')}
     <button class="btn" data-act="acPostAll">全部过账</button>
     <button class="btn pri" data-s="t2">去 T2 生成凭证</button>`)
    + kpis([
      { k: '本期凭证', v: String(cur.length), u: '张' },
      { k: '凭证行', v: String(cur.reduce((s, v) => s + v.lines.length, 0)), u: '行' },
      { k: '未过账', v: String(un), u: '张', t: un ? 'w' : 'g' },
      { k: '本期借方', v: money(cur.reduce((s, v) => s + v.lines.reduce((a, l) => a + l.dr, 0), 0)) },
      { k: '累计凭证', v: String(all.length), u: '张' },
    ])
    + (all.length ? '' : `<div class="note"><b>凭证库是空的。</b>去 T2 处理一批银行流水，导出前点「入库」，凭证就进来了——账簿随即可用。</div>`)
    + (un ? `<div class="note w"><b>${un} 张未过账。</b>账簿默认<b>包含</b>未过账凭证（可在科目余额表切换）。正式出报表前应全部过账。</div>` : '')
    + card('本期凭证', rows.length ? table(
      [{ t: '日期' }, { t: '凭证字号' }, { t: '摘要' }, { t: '行数', n: 1 }, { t: '金额', n: 1 }, { t: '平衡' }, { t: '来源' }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">本期没有凭证</div>`);
};

/* ============ 科目余额表 ============ */
S['ac-bal'] = () => {
  if (!CUR_ENT) return needEnt('科目余额表');
  const m = acctBalance(CUR_ENT, AC.from, AC.to, AC.inc);
  let list = Object.values(m).sort((a, b) => a.acct.localeCompare(b.acct));
  if (!AC.showZero) list = list.filter(o => o.dr || o.cr || Math.abs(o.ob) > 0.005 || Math.abs(o.eb) > 0.005);
  const T = { ob: 0, dr: 0, cr: 0, ydr: 0, ycr: 0, eb: 0 };
  list.forEach(o => { T.dr += o.dr; T.cr += o.cr; T.ydr += o.ydr; T.ycr += o.ycr; });
  const obD = list.reduce((s, o) => s + Math.max(0, o.ob), 0), obC = list.reduce((s, o) => s + Math.max(0, -o.ob), 0);
  const ebD = list.reduce((s, o) => s + Math.max(0, o.eb), 0), ebC = list.reduce((s, o) => s + Math.max(0, -o.eb), 0);
  const bal = Math.abs(T.dr - T.cr) < 0.005;
  const rows = list.map(o => [
    `<span class="code">${H(o.acct)}</span>`, H(o.name || acctName(o.acct)),
    o.ob > 0 ? money(o.ob) : '', o.ob < 0 ? money(-o.ob) : '',
    o.dr ? money(o.dr) : '', o.cr ? money(o.cr) : '',
    o.ydr ? money(o.ydr) : '', o.ycr ? money(o.ycr) : '',
    o.eb > 0 ? money(o.eb) : '', o.eb < 0 ? money(-o.eb) : '',
    `<button class="btn sm" data-acd="${H(o.acct)}">明细</button>`,
  ]);
  return head('科目余额表', `${H(entName())} · 期初、本期、本年累计、期末，四组借贷。`, '核算 · 账簿',
    `期间 ${acRangeHtml('ac')}
     <button class="btn" data-act="acToggleZero">${AC.showZero ? '隐藏' : '显示'}无发生额</button>
     <button class="btn" data-act="acToggleInc">${AC.inc ? '含' : '不含'}未过账</button>
     <button class="btn pri" data-act="acExpBal">导出</button>`)
    + kpis([
      { k: '科目数', v: String(list.length), u: '个' },
      { k: '本期借方', v: money(T.dr) },
      { k: '本期贷方', v: money(T.cr) },
      { k: '借贷平衡', v: bal ? '✓' : '✗', t: bal ? 'g' : 'c' },
      { k: '含未过账', v: AC.inc ? '是' : '否', t: AC.inc ? 'w' : 'g' },
    ])
    + (bal ? '' : `<div class="note c"><b>本期借贷不平衡</b>，差额 ${money(T.dr - T.cr)}。凭证库里有不平的凭证，先去凭证库查。</div>`)
    + (list.length ? card('科目余额表 · ' + AC.from + ' 〜 ' + AC.to, table(
      [{ t: '科目编码' }, { t: '科目名称' }, { t: '期初借方', n: 1 }, { t: '期初贷方', n: 1 },
       { t: '本期借方', n: 1 }, { t: '本期贷方', n: 1 }, { t: '本年借方', n: 1 }, { t: '本年贷方', n: 1 },
       { t: '期末借方', n: 1 }, { t: '期末贷方', n: 1 }, { t: '' }], rows,
      ['<b>合计</b>', '', `<b>${money(obD)}</b>`, `<b>${money(obC)}</b>`, `<b>${money(T.dr)}</b>`, `<b>${money(T.cr)}</b>`,
       `<b>${money(T.ydr)}</b>`, `<b>${money(T.ycr)}</b>`, `<b>${money(ebD)}</b>`, `<b>${money(ebC)}</b>`, '']))
      : `<div class="note"><b>本期没有数据。</b>先去<b>凭证库</b>确认有没有凭证——账簿是从凭证实时汇总的，没凭证就没账。</div>`);
};

/* ============ 明细账 ============ */
S['ac-detail'] = () => {
  if (!CUR_ENT) return needEnt('明细账');
  const m = acctBalance(CUR_ENT, AC.from, AC.to, AC.inc);
  const accts = Object.values(m).sort((a, b) => a.acct.localeCompare(b.acct));
  if (!AC.acct && accts.length) AC.acct = accts[0].acct;
  const d = AC.acct ? acctDetail(CUR_ENT, AC.acct, AC.from, AC.to, AC.inc) : null;
  const nm = AC.acct ? (m[AC.acct] ? m[AC.acct].name : '') || acctName(AC.acct) : '';
  const rows = d ? [
    { cls: 'sum', d: [AC.from, '', '<b>期初余额</b>', '', '', dirOf(d.open), `<b>${absM(d.open)}</b>`] },
  ].concat(d.rows.map(r => [
    r.date, `<span class="code">${H(r.vno)}</span>`, H(r.memo || ''),
    r.dr ? money(r.dr) : '', r.cr ? money(r.cr) : '', dirOf(r.bal), absM(r.bal),
  ])).concat([
    { cls: 'sum', d: ['', '', '<b>本月合计</b>', `<b>${money(d.dr)}</b>`, `<b>${money(d.cr)}</b>`, dirOf(d.close), `<b>${absM(d.close)}</b>`] },
    { cls: 'sum', d: ['', '', '<b>本年累计</b>', `<b>${money(d.ydr)}</b>`, `<b>${money(d.ycr)}</b>`, dirOf(d.close), `<b>${absM(d.close)}</b>`] },
  ]) : [];
  return head('明细账', `${H(entName())} · 三栏式，按科目逐笔。`, '核算 · 账簿',
    `<select id="acAcctSel">${accts.map(a => `<option value="${H(a.acct)}" ${a.acct === AC.acct ? 'selected' : ''}>${H(a.acct)} ${H(a.name || acctName(a.acct))}</option>`).join('')}</select>
     期间 ${acRangeHtml('ac')}
     <button class="btn pri" data-act="acExpDetail">导出</button>`)
    + (accts.length
      ? card(`明细账 · ${H(AC.acct)} ${H(nm)}`, table(
        [{ t: '日期' }, { t: '凭证字号' }, { t: '摘要' }, { t: '借方', n: 1 }, { t: '贷方', n: 1 }, { t: '方向' }, { t: '余额', n: 1 }], rows))
      : `<div class="note"><b>本期没有科目发生额。</b>先去凭证库确认凭证。</div>`)
    + (d && d.rows.length === 0 ? `<div class="note w"><b>该科目本期无发生额</b>，只显示期初与合计。</div>` : '');
};

/* ============ 总分类账 ============ */
S['ac-gl'] = () => {
  if (!CUR_ENT) return needEnt('总分类账');
  const year = AC.from.slice(0, 4);
  const m = acctBalance(CUR_ENT, AC.from, AC.to, AC.inc);
  const accts = Object.values(m).sort((a, b) => a.acct.localeCompare(b.acct));
  if (!AC.acct && accts.length) AC.acct = accts[0].acct;
  const g = AC.acct ? acctByMonth(CUR_ENT, AC.acct, year, AC.inc) : null;
  const nm = AC.acct ? (m[AC.acct] ? m[AC.acct].name : '') || acctName(AC.acct) : '';
  const rows = g ? [{ cls: 'sum', d: ['', '<b>年初余额</b>', '', '', dirOf(g.ob), `<b>${absM(g.ob)}</b>`] }]
    .concat(g.rows.map(r => [r.mm + '月', '本月合计', r.dr ? money(r.dr) : '', r.cr ? money(r.cr) : '', dirOf(r.bal), absM(r.bal)]))
    .concat([{ cls: 'sum', d: ['', '<b>本年累计</b>', `<b>${money(g.tdr)}</b>`, `<b>${money(g.tcr)}</b>`, dirOf(g.close), `<b>${absM(g.close)}</b>`] }]) : [];
  return head('总分类账', `${H(entName())} · 按科目、按月汇总。查具体一笔用明细账，看趋势用这张。`, '核算 · 账簿',
    `<select id="acAcctSel">${accts.map(a => `<option value="${H(a.acct)}" ${a.acct === AC.acct ? 'selected' : ''}>${H(a.acct)} ${H(a.name || acctName(a.acct))}</option>`).join('')}</select>
     <span class="sel">年度 <b>${year}</b></span>
     <button class="btn pri" data-act="acExpGl">导出</button>`)
    + (accts.length
      ? card(`总分类账 · ${H(AC.acct)} ${H(nm)} · ${year} 年`, table(
        [{ t: '月份' }, { t: '摘要' }, { t: '借方', n: 1 }, { t: '贷方', n: 1 }, { t: '方向' }, { t: '余额', n: 1 }], rows))
      : `<div class="note"><b>本年没有数据。</b></div>`);
};

/* ============ 交互 ============ */
function acExport(kind) {
  if (!CUR_ENT) { toast('请先选主体'); return; }
  const en = entName();
  if (kind === 'bal') {
    const m = acctBalance(CUR_ENT, AC.from, AC.to, AC.inc);
    const hdr = ['主体', '期间', '科目编码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '本年借方', '本年贷方', '期末借方', '期末贷方'];
    const rows = Object.values(m).sort((a, b) => a.acct.localeCompare(b.acct)).map(o => [
      en, AC.from + '~' + AC.to, o.acct, o.name || acctName(o.acct),
      o.ob > 0 ? o.ob.toFixed(2) : '', o.ob < 0 ? (-o.ob).toFixed(2) : '',
      o.dr.toFixed(2), o.cr.toFixed(2), o.ydr.toFixed(2), o.ycr.toFixed(2),
      o.eb > 0 ? o.eb.toFixed(2) : '', o.eb < 0 ? (-o.eb).toFixed(2) : '']);
    download(`科目余额表_${AC.from}_${AC.to}.csv`, toCSV([hdr].concat(rows)));
  } else if (kind === 'detail') {
    const d = acctDetail(CUR_ENT, AC.acct, AC.from, AC.to, AC.inc);
    const hdr = ['主体', '科目', '日期', '凭证字号', '摘要', '借方', '贷方', '方向', '余额'];
    const rows = [[en, AC.acct, AC.from, '', '期初余额', '', '', dirOf(d.open), Math.abs(d.open).toFixed(2)]]
      .concat(d.rows.map(r => [en, AC.acct, r.date, r.vno, r.memo, r.dr ? r.dr.toFixed(2) : '', r.cr ? r.cr.toFixed(2) : '', dirOf(r.bal), Math.abs(r.bal).toFixed(2)]))
      .concat([[en, AC.acct, '', '', '本月合计', d.dr.toFixed(2), d.cr.toFixed(2), dirOf(d.close), Math.abs(d.close).toFixed(2)]]);
    download(`明细账_${AC.acct}_${AC.from}_${AC.to}.csv`, toCSV([hdr].concat(rows)));
  } else {
    const year = AC.from.slice(0, 4);
    const g = acctByMonth(CUR_ENT, AC.acct, year, AC.inc);
    const hdr = ['主体', '科目', '月份', '摘要', '借方', '贷方', '方向', '余额'];
    const rows = [[en, AC.acct, '', '年初余额', '', '', dirOf(g.ob), Math.abs(g.ob).toFixed(2)]]
      .concat(g.rows.map(r => [en, AC.acct, r.mm + '月', '本月合计', r.dr.toFixed(2), r.cr.toFixed(2), dirOf(r.bal), Math.abs(r.bal).toFixed(2)]))
      .concat([[en, AC.acct, '', '本年累计', g.tdr.toFixed(2), g.tcr.toFixed(2), dirOf(g.close), Math.abs(g.close).toFixed(2)]]);
    download(`总分类账_${AC.acct}_${year}.csv`, toCSV([hdr].concat(rows)));
  }
  toast('已导出');
}

document.addEventListener('click', e => {
  const d = e.target.closest('[data-acd]');
  if (d) { AC.acct = d.dataset.acd; go('ac-detail'); return; }
  const v = e.target.closest('[data-acv]');
  if (v) {
    const list = vchLoad(CUR_ENT);
    const t = list.find(x => x.id === v.dataset.acv);
    if (t) { t.posted = t.posted ? 0 : 1; vchSave(CUR_ENT, list); toast(t.posted ? '已过账' : '已反过账'); go('ac-vch'); }
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'acToggleZero') { AC.showZero = AC.showZero ? 0 : 1; go('ac-bal'); }
  else if (act === 'acToggleInc') { AC.inc = AC.inc ? 0 : 1; go(CURS); }
  else if (act === 'acPostAll') {
    const list = vchLoad(CUR_ENT);
    let n = 0;
    list.forEach(x => { const d = vDate(x); if (d >= AC.from && d <= AC.to && !x.posted) { x.posted = 1; n++; } });
    vchSave(CUR_ENT, list); toast(`已过账 ${n} 张`); go('ac-vch');
  }
  else if (act === 'acExpBal') acExport('bal');
  else if (act === 'acExpDetail') acExport('detail');
  else if (act === 'acExpGl') acExport('gl');
});
document.addEventListener('change', e => {
  if (e.target.id === 'acAcctSel') { AC.acct = e.target.value; go(CURS); }
});

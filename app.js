/* 财务中心 · 星逸平台
   一期：系统结构 + 工具箱（仅 T2 银行流水转凭证可用）
   全部逻辑在浏览器端运行，数据不出本机 */
'use strict';

/* ============ 工具函数 ============ */
const $ = id => document.getElementById(id);
const H = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
const pill = (t, k) => `<span class="pill p-${k}">${H(t)}</span>`;

function toast(msg, ms) {
  const el = $('toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), ms || 2600);
}
function kpis(arr) {
  return `<div class="kpis">${arr.map(k => `<div class="kpi ${k.t || ''}">
    <div class="k">${H(k.k)}</div><div class="v">${k.v}${k.u ? `<small>${H(k.u)}</small>` : ''}</div>
    ${k.d ? `<div class="d">${H(k.d)}</div>` : ''}</div>`).join('')}</div>`;
}
function table(cols, rows, foot) {
  return `<div class="tw"><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'num' : ''}">${H(c.t)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${cols[i] && cols[i].n ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td class="${cols[i] && cols[i].n ? 'num' : ''}">${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
}
const card = (t, b, tools) => `<div class="card"><div class="ch"><h3>${H(t)}</h3><span class="sp"></span>${tools || ''}</div><div class="cb flush">${b}</div></div>`;
const cardp = (t, b, tools) => `<div class="card"><div class="ch"><h3>${H(t)}</h3><span class="sp"></span>${tools || ''}</div><div class="cb">${b}</div></div>`;
const head = (t, sub, code, tools) => `<div class="phead"><div><h2>${H(t)}</h2><div class="sub2">${sub}</div></div>
  <div class="mid">${code ? `<span class="mcode">${H(code)}</span>` : ''}${tools || ''}</div></div>`;

function download(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const csvCell = v => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

/* ============ 系统结构（一期只开工具箱） ============ */
const DOMS = [
  { id: 'home', n: '工作台', ic: '◆', ready: 1, items: [] },
  { id: 'tools', n: '工具箱', ic: '🧰', ready: 1, items: [
      ['tool-list', '我的工具'], ['t1', 'T1 资金日报'], ['t2', 'T2 流水转凭证'], ['t3', 'T3 对账核对'], ['t4', 'T4 日损益'],
      ['tool-rules', '规则库'], ['tool-log', '处理记录'], ['tool-plan', '开发排期'] ] },
  { id: 'fund', n: '资金', ic: '◈', items: [['p-fund-daily', '资金日报'], ['p-fund-account', '账户与U盾'], ['p-fund-recon', '流水与对账'], ['p-pay', '付款申请']] },
  { id: 'inv', n: '票据', ic: '▼', items: [['p-inv-in', '进项票池'], ['p-inv-out', '销项开票']] },
  { id: 'ar', n: '应收', ic: '◫', items: [['p-ar-contract', '合同台账'], ['p-ar-bill', '应收账单'], ['p-ar-claim', '收款认领'], ['p-ar-aging', '账龄与催收']] },
  { id: 'cost', n: '费控', ic: '▧', items: [['p-exp', '报销与费控'], ['p-flow', '审批路由']] },
  { id: 'close', n: '核算', ic: '▩', items: [['p-stock', '进销存台账'], ['p-count', '月末盘点'], ['p-close', '月结检查单'], ['p-ic', '往来对平'], ['p-report', '报表中心'], ['p-tax-cal', '申报日历']] },
  { id: 'analysis', n: '分析', ic: '◧', items: [['p-dash', '经营看板'], ['p-daily', '日损益'], ['p-project', '项目盈利']] },
  { id: 'control', n: '管控', ic: '⚑', items: [['p-related', '关联方'], ['p-alert', '预警中心'], ['p-log', 'Agent日志']] },
  { id: 'base', n: '基础', ic: '⚙', items: [['p-entity', '主体档案'], ['p-dim', '核算维度'], ['p-match', '跨系统对码'], ['p-perm', '用户与权限']] },
];

/* ============ 主数据 ============ */
/* 主体：规则库按主体隔离。不同主体业务完全不同，共用一套规则必然记错账。 */
const ENTITIES = [
  { id: 'youqi', short: '优栖', full: '优栖（广州）服务管理有限公司', line: '出租屋' },
  { id: 'aole',  short: '澳乐', full: '澳乐', line: '电商' },
  { id: 'dongbei', short: '东蓓', full: '东蓓', line: '电商' },
  { id: 'ruimian', short: '瑞眠', full: '瑞眠', line: '电商' },
  { id: 'mutong', short: '牧童', full: '牧童', line: '电商' },
  { id: 'xinyi', short: '新艺文化', full: '新艺文化', line: '电商' },
  { id: 'szyc', short: '数智云仓', full: '数智云仓', line: '物业收租' },
  { id: 'yunpa', short: '云帕', full: '云帕', line: '物业收租' },
  { id: 'yundi', short: '云迪', full: '云迪', line: '物业收租' },
  { id: 'yunji', short: '云基', full: '云基', line: '物业收租' },
  { id: 'yunpai', short: '云湃', full: '云湃', line: '物业收租' },
  { id: 'jibao', short: '集包厂', full: '集包厂', line: '集包' },
  { id: 'cjyt', short: '昌记云泰', full: '昌记云泰', line: '物业收租' },
];
const LINES = ['电商', '集包', '物业收租', '手机租赁', '出租屋', '设备租赁', '塑料制造'];

/* ============ 规则集（按主体） ============ */
/* 优栖 —— 取自 2026年第8期真实凭证。二房东模式：
   从业主手里租房付租金（成本），转租给租客收租金（收入）。
   科目带项目后缀：{p} → 1001 花都UU公寓 / 2001 冼村复建房六期 */
const RS_YOUQI = {
  projects: [
    { code: '2001', name: '冼村复建房六期', kw: '冼村|洗村|复建房' },
    { code: '1001', name: '花都UU公寓', kw: '花都|UU公寓' },
  ],
  accounts: [
    ['100201', '银行存款_张华工行7239'],
    ['100202', '银行存款_张华工行9999'],
    ['100203', '银行存款_优栖工行6418'],
    ['1122_{p}', '应收账款'],
    ['122104', '其他应收款_社保个人部分'],
    ['221101', '应付职工薪酬_工资'],
    ['222112', '应交税费_应交个人所得税'],
    ['22210107', '应交税费_应交增值税_销项税额'],
    ['224101_{p}', '其他应付款_押金'],
    ['5001_{p}', '主营业务收入'],
    ['5402_{p}', '其他业务成本'],
    ['560202_{p}', '管理费用_房租'],
    ['560204_{p}', '管理费用_水电费'],
    ['560206_{p}', '管理费用_清洁费'],
    ['560209_{p}', '管理费用_工资'],
    ['560223_{p}', '管理费用_服务费'],
    ['560303_{p}', '财务费用_手续费'],
  ],
  /* 业主名单：付业主租金的摘要常是「跨行汇款」「网转」，没有业务含义，只能靠户名认 */
  owners: {
    '2001': ['黄巧嫦','李彩屏','潘燕波','卢国秋','冼国锋','康智敏','卢佑江','谢薇','梁翠红',
             '冼东君','卢国湛','冼世竣','冼艳桃','冼树六','骆维','徐淑荣','梁小冬','黄凤香',
             '卢尤添','冼章荣','卢志方','潘妙春','卢尤满'],
  },
  ownerAcct: '5402_{p}',
  ownerMemo: '付业主租金',
  /* 在编员工名单：名单内走 221101 应付职工薪酬（社保个人部分与个税另由月末计提凭证处理），
     名单外（项目现场、临时人员）走 560209 管理费用_工资。取自真实凭证：董伟森走应付职工薪酬全套。 */
  staff: ['董伟森'],
  staffAcct: '221101',
  /* 默认项目：手续费、服务费这类摘要里没有项目信息，真账都记冼村 */
  defaultProj: '2001',
  rules: [
    // 顺序要紧：命中第一条即停，越具体的越靠前
    { kw: '复建房|冼村|洗村', dir: 'out', acct: '5402_{p}', memo: '付业主租金' },
    // 收款：平台提现是冲应收，不是确认收入，必须排在收租金前面
    { kw: '寓小二|提现', dir: 'in', acct: '1122_{p}', memo: '平台提现冲应收',
      note: '租金在挂应收时已确认收入，提现只是收款' },
    { kw: '房租', dir: 'in', acct: '1122_{p}', memo: '收租金冲应收' },
    { kw: '收.*租金|租金.*收', dir: 'in', acct: '5001_{p}', memo: '收租金', tax: 0.01,
      note: '银行直收、未先挂应收的，确认收入并拆销项税' },
    // 水电费收入：借银行存款，贷主营业务收入，贷销项税（贵司口径）
    { kw: '水费|电费|水电|代收电费|代收水费', dir: 'in', acct: '5001_{p}', memo: '收水电费', tax: 0.01,
      proj: '1001',
      note: '按贵司分录：借银行存款 / 贷主营业务收入 + 贷销项税额。' +
            '水电代收只发生在花都，项目定死 1001，不吃全局默认项目；' +
            '但摘要里明写冼村的仍按摘要走' },
    // 押金
    { kw: '收.*押金|收到.*押金|押金', dir: 'in', acct: '224101_{p}', memo: '收押金',
      warn: '押金是负债不是收入' },
    { kw: '退押金', dir: 'out', acct: '5001_{p}', memo: '退押金', red: 1,
      warn: '按贵司做法用红字冲收入' },
    // 付房东与运营
    { kw: '房租.*电费|电费.*房租', dir: 'out', acct: '560202_{p}', memo: '付房东房租',
      warn: '这类通常要拆房租与水电两行，请复核' },
    { kw: '水费|电费|水电', dir: 'out', acct: '560204_{p}', memo: '付水电费' },
    { kw: '清洁|保洁|劳务费', dir: 'out', acct: '560206_{p}', memo: '付清洁费' },
    { kw: '工资|薪酬|薪金|代发', dir: 'out', acct: '560209_{p}', memo: '发放工资',
      byStaff: 1,
      note: '对方户名在在编员工名单里 → 221101 应付职工薪酬；不在 → 560209 管理费用_工资' },
    { kw: '财务.*费用|服务费|代理费', dir: 'out', acct: '560223_{p}', memo: '付服务费' },
    { kw: '手续费|汇费|工本费|短信费|账户管理费|年费', dir: 'out', acct: '560303_{p}', memo: '银行手续费' },
  ],
};
/* 其余主体尚无规则集——它们业务不同（电商、集包、塑料制造），
   规则要各自从真账里学，不能套用优栖这套。 */
const RULE_SETS = { youqi: RS_YOUQI };

/* 当前生效的规则集（随 T2 选的主体切换） */
let RS = null;
function useRuleSet(entId) {
  RS = RULE_SETS[entId] || null;
  RULES = RS ? loadRules(entId) : [];
  return RS;
}
/** 主体自带的默认项目（用户可在步骤 2 改） */
const defaultProjOf = () => (RS && RS.defaultProj) || '';
const PROJECTS = () => (RS ? RS.projects : []);
const ACCOUNTS = () => (RS ? RS.accounts : []);

function detectProj(text) {
  const s = String(text || '');
  for (const p of PROJECTS()) if (new RegExp(p.kw).test(s)) return p;
  return null;
}
const fillAcct = (code, proj) => String(code).replace('{p}', proj ? proj.code : '____');
const acctName = code => {
  const list = ACCOUNTS();
  const hit = list.find(a => a[0] === code);
  if (hit) return hit[1];
  const tpl = list.find(a => a[0].includes('{p}') &&
    new RegExp('^' + a[0].replace('{p}', '\\d+') + '$').test(code));
  return tpl ? tpl[1] : '';
};
/** 对方户名是否业主；是则返回项目代码 */
function ownerProj(opp) {
  if (!RS || !RS.owners) return null;
  const s = String(opp || '').trim();
  if (!s) return null;
  for (const code of Object.keys(RS.owners)) {
    if (RS.owners[code].some(n => s === n || s.includes(n))) return code;
  }
  return null;
}

/** 对方户名是否在编员工 */
function isStaff(opp) {
  if (!RS || !RS.staff) return false;
  const s = String(opp || '').trim();
  return !!s && RS.staff.some(n => s === n || s.includes(n));
}

/* ============ 规则库（按主体分开存） ============ */
/* v5：手续费规则补「汇费」「年费」（建行对账单里手续费叫汇费）。
   v4：水电收入规则定死花都项目。
   v3：工资按在编员工名单分流 + 主体默认项目。
   版本号必须随预置规则变更递增，否则老用户浏览器里缓存的旧规则不会更新。 */
const RULE_KEY = e => 'fsc_t2_rules_' + e + '_v5';
const LOG_KEY = 'fsc_t2_log_v1';

function loadRules(entId) {
  try {
    const s = localStorage.getItem(RULE_KEY(entId));
    if (s) return JSON.parse(s);
  } catch (e) { /* 忽略 */ }
  const set = RULE_SETS[entId];
  if (!set) return [];
  const init = set.rules.map(r => Object.assign({ id: uid(), hits: 0, src: '预置' }, r));
  saveRules(entId, init); return init;
}
function saveRules(entId, r) {
  try { localStorage.setItem(RULE_KEY(entId), JSON.stringify(r)); }
  catch (e) { toast('规则保存失败：浏览器存储空间不足'); }
}
let RULES = [];

function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 200))); } catch (e) { /* 忽略 */ } }
function addLog(entry) { const l = loadLog(); l.unshift(entry); saveLog(l); }

/* ============ T2 状态 ============ */
const T2 = {
  step: 1, rows: null, headRow: 0, map: {}, file: null,
  // acctId = T1 账户台账里的账户 id（账户主数据的唯一真相源在 T1）
  // acctNo = 从该账户带出来的账号文本，只用于凭证备注列和银行存款科目匹配
  ent: '', entId: '', line: '', acctId: '', acctNo: '', vchWord: '记', defProj: '',
  balPush: null,   // 余额回写结果，步骤 3 里摊开说
  sniffNo: null, autoBind: null,   // 上传时从文件里嗅到的卡号 / 自动认账户的结果
  result: null, tab: 'ok'
};

/* 表头别名 */
const FIELDS = [
  { k: 'date', n: '日期', alias: ['交易日期', '记账日期', '日期', '交易时间', '业务日期', 'date'], must: 1 },
  { k: 'memo', n: '摘要', alias: ['摘要', '摘要说明', '用途', '附言', '交易摘要', '备注', '交易类型'], must: 1 },
  { k: 'inAmt', n: '收入金额', alias: ['收入', '贷方发生额', '贷方金额', '收入金额', '存入', '收款金额'] },
  { k: 'outAmt', n: '支出金额', alias: ['支出', '借方发生额', '借方金额', '支出金额', '支取', '付款金额'] },
  { k: 'amt', n: '发生额（单列）', alias: ['金额', '发生额', '交易金额'] },
  { k: 'dc', n: '借贷标志', alias: ['借贷', '借贷标志', '收付标志', '资金流向'] },
  { k: 'opp', n: '对方户名', alias: ['对方户名', '对方账户名称', '对方名称', '收款人名称', '付款人名称', '对方单位'] },
  { k: 'oppAcct', n: '对方账号', alias: ['对方账号', '对方账户', '对方卡号'] },
  { k: 'bal', n: '余额', alias: ['余额', '账户余额', '当前余额'] },
  { k: 'ref', n: '流水号', alias: ['流水号', '交易流水号', '凭证号', '业务编号', '交易序号'] },
];
const ALL_ALIAS = FIELDS.reduce((a, f) => a.concat(f.alias), []);

/* 某个单元格算不算「一笔钱」——空、横杠、0 都不算 */
const cellHasAmt = v => {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '');
  if (s === '' || s === '-' || s === '—') return false;
  const n = Number(s);
  return !isNaN(n) && n !== 0;
};

/* 找「借贷两列」。
   建行这类导出把收入和支出都叫「记账金额」，两列列名一模一样，靠名字分不出来；
   前面还有两列同样叫「交易金额」但整列是横杠。所以只能看数据形态：
   相邻两列、各自都出现过数字、且没有任何一行两列同时有数 —— 这就是一对借贷列。 */
function detectDcPair(body, map, ncol) {
  const taken = new Set(Object.values(map).filter(v => v !== undefined));
  for (let i = 0; i + 1 < ncol; i++) {
    if (taken.has(i) || taken.has(i + 1)) continue;
    let a = 0, b = 0, both = 0;
    body.forEach(r => {
      const x = cellHasAmt(r[i]), y = cellHasAmt(r[i + 1]);
      if (x) a++; if (y) b++; if (x && y) both++;
    });
    if (a > 0 && b > 0 && both === 0) return [i, i + 1];
  }
  return null;
}

/* 两列谁是收入谁是支出：拿余额的变动方向投票。
   余额变大的那一笔，钱在哪一列，哪一列就是收入。列名骗人，余额不会。 */
function orderDcPair(body, pair, balCol, asc) {
  if (balCol === undefined) return null;
  let firstIsIn = 0, firstIsOut = 0;
  for (let i = 0; i < body.length; i++) {
    // 「这笔之前」的余额：正序在上一行，倒序（新的在上面）在下一行
    const j = asc ? i - 1 : i + 1;
    if (j < 0 || j >= body.length) continue;
    const before = numOf(body[j][balCol]), after = numOf(body[i][balCol]);
    if (!before || !after || before === after) continue;
    const up = after > before;
    if (cellHasAmt(body[i][pair[0]])) { up ? firstIsIn++ : firstIsOut++; }
    else if (cellHasAmt(body[i][pair[1]])) { up ? firstIsOut++ : firstIsIn++; }
  }
  if (firstIsIn === firstIsOut) return null;       // 分不出就别猜
  return firstIsIn > firstIsOut
    ? { inAmt: pair[0], outAmt: pair[1] }
    : { inAmt: pair[1], outAmt: pair[0] };
}

function autoMap(headerCells, body) {
  const map = {};
  const norm = s => String(s || '').replace(/\s|　/g, '');
  headerCells.forEach((h, i) => {
    const c = norm(h); if (!c) return;
    for (const f of FIELDS) {
      if (map[f.k] !== undefined) continue;
      if (f.alias.some(a => c === a)) { map[f.k] = i; return; }
    }
  });
  // 第二趟：包含匹配
  headerCells.forEach((h, i) => {
    const c = norm(h); if (!c) return;
    if (Object.values(map).includes(i)) return;
    for (const f of FIELDS) {
      if (map[f.k] !== undefined) continue;
      if (f.alias.some(a => c.includes(a))) { map[f.k] = i; return; }
    }
  });

  if (!body || !body.length) return map;

  // 金额列光看列名会认错：建行导出里「交易金额」整列是横杠，真正的钱在「记账金额」。
  // 整列一个数都没有的，不当金额列用。
  ['inAmt', 'outAmt', 'amt'].forEach(k => {
    if (map[k] === undefined) return;
    if (!body.some(r => cellHasAmt(r[map[k]]))) delete map[k];
  });

  // 收入/支出没认出来时，按数据形态找借贷两列，再用余额方向定谁收谁支
  if (map.inAmt === undefined && map.outAmt === undefined) {
    const ncol = body.reduce((m, r) => Math.max(m, r.length), headerCells.length);
    const pair = detectDcPair(body, map, ncol);
    // 文件是正序还是倒序：判方向要靠它，倒序时「这笔之前」的余额在下一行
    let asc = true;
    if (map.date !== undefined) {
      const ds = body.map(r => normDate(r[map.date])).filter(Boolean);
      if (ds.length > 1) asc = ds[0] <= ds[ds.length - 1];
    }
    const ord = pair ? orderDcPair(body, pair, map.bal, asc) : null;
    if (ord) {
      map.inAmt = ord.inAmt; map.outAmt = ord.outAmt;
      delete map.amt;                 // 有了借贷两列，单列发生额就别再掺和
      map._dcGuess = [ord.inAmt, ord.outAmt];   // 界面上要如实说这是推断出来的
    }
  }
  return map;
}

const numOf = v => {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = /^(\d{4})[-/年.]?(\d{1,2})[-/月.]?(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

/* 核心：跑规则 */
function runRules() {
  const { rows, headRow, map } = T2;
  const body = rows.slice(headRow + 1);
  const ok = [], ex = [];
  body.forEach((r, i) => {
    const get = k => (map[k] === undefined ? '' : r[map[k]]);
    const date = normDate(get('date'));
    const memo = String(get('memo') || '').trim();
    let inA = numOf(get('inAmt')), outA = numOf(get('outAmt'));
    // 单列金额 + 借贷标志
    if (map.inAmt === undefined && map.outAmt === undefined && map.amt !== undefined) {
      const a = numOf(get('amt'));
      const flag = String(get('dc') || '').trim();
      const isOut = /借|支|付|出|-/.test(flag) || a < 0;
      if (isOut) outA = Math.abs(a); else inA = Math.abs(a);
    }
    const amt = inA > 0 ? inA : outA;
    const dir = inA > 0 ? 'in' : 'out';
    const opp = String(get('opp') || '').trim();
    const rec = {
      no: i + 1, date, memo, dir, amt,
      opp, oppAcct: String(get('oppAcct') || '').trim(),
      ref: String(get('ref') || '').trim(),
      raw: r
    };
    if (!date || !amt) { rec.why = !date ? '日期为空或无法识别' : '金额为 0 或无法识别'; ex.push(rec); return; }
    // 匹配范围：默认只看摘要。对方户名容易误命中（如「交通运输部」含「运输」），
    // 必须由规则显式声明 scope:'both' 才纳入。
    let hitField = '';
    // 对方户名在业主名单里 + 付款方向 → 直接判定为付业主租金，
    // 不依赖摘要（银行流水里这类摘要是「跨行汇款」「网转」，没有业务含义）
    const ownerCode = ownerProj(opp);
    if (ownerCode && dir === 'out') {
      const pj = PROJECTS().find(p => p.code === ownerCode);
      rec.rule = { id: 'owner', kw: '业主名单', memo: '付业主租金' };
      rec.hitField = '业主名单'; rec.proj = pj;
      rec.acct = fillAcct(RS.ownerAcct, pj); rec.vmemo = RS.ownerMemo;
      rec.tax = 0; rec.red = 0; rec.warn = '';
      ok.push(rec); return;
    }
    const hit = RULES.find(rule => {
      if (rule.dir !== 'any' && rule.dir !== dir) return false;
      const re = new RegExp(rule.kw);
      if (re.test(memo)) { hitField = '摘要'; return true; }
      if (rule.scope === 'both' && opp && re.test(opp)) { hitField = '对方户名'; return true; }
      return false;
    });
    if (!hit) { rec.why = '摘要未命中任何规则'; ex.push(rec); return; }
    // 项目识别，优先级从高到低：
    // 摘要 → 对方户名 → 业主名单 → 规则自带的固定项目 → 用户设的全局默认项目
    // 规则固定项目排在全局默认之上：某些业务只发生在一个项目（如水电代收只在花都），
    // 但摘要里明写了别的项目时，仍以摘要为准。
    const oc = ownerProj(opp);
    const byCode = c => (c ? PROJECTS().find(p => p.code === c) : null);
    const proj = detectProj(memo) || detectProj(opp)
      || byCode(oc) || byCode(hit.proj) || byCode(T2.defProj);
    rec.rule = hit; rec.vmemo = hit.memo || memo; rec.hitField = hitField;
    rec.proj = proj;
    rec.tax = hit.tax || 0; rec.red = hit.red || 0;
    rec.warn = hit.warn || '';
    // 工资类按在编员工名单分流：名单内冲应付职工薪酬，名单外记管理费用_工资
    let acctTpl = hit.acct;
    if (hit.byStaff && isStaff(opp)) {
      acctTpl = RS.staffAcct;
      rec.vmemo = '发放工资（冲应付职工薪酬）';
      rec.hitField = hitField + ' + 员工名单';
      rec.warn = '本行只冲应付职工薪酬（实发数）；社保个人部分与个税代扣由月末计提凭证处理';
    }
    rec.acct = fillAcct(acctTpl, proj);
    // 科目需要项目但没识别出来 → 不硬填，进例外让人指定
    // 注意查的是分流后真正要用的科目：221101 应付职工薪酬本就不带项目，不该因缺项目进例外
    if (String(acctTpl).includes('{p}') && !proj) {
      rec.why = '命中规则「' + hit.memo + '」，但摘要里认不出是哪个项目';
      ex.push(rec); return;
    }
    ok.push(rec);
  });
  T2.result = { ok, ex, total: body.length };
  // 命中计数
  ok.forEach(r => { const t = RULES.find(x => x.id === r.rule.id); if (t) t.hits = (t.hits || 0) + 1; });
  saveRules(T2.entId, RULES);
}

/* 生成凭证行 */
function vouchers() {
  const { ok } = T2.result;
  const out = [];
  const bankAcct = () => {
    const hit = ACCOUNTS().find(a => T2.acctNo && a[1].includes(T2.acctNo));
    return hit || ['100203', '银行存款_优栖工行6418'];
  };
  ok.forEach((r, i) => {
    const no = String(i + 1).padStart(4, '0');
    const bank = bankAcct();
    const other = [r.acct, acctName(r.acct)];
    const push = (a, d, c) => out.push([
      r.date, T2.vchWord, no, r.vmemo, a[0], a[1],
      d ? d.toFixed(2) : '', c ? c.toFixed(2) : '',
      T2.ent, T2.line, r.proj ? r.proj.name : '', '', r.opp, r.ref, T2.acctNo,
    ]);
    if (r.dir === 'in' && r.tax) {
      // 含税收入：拆主营业务收入 + 销项税额（按征收率）
      const net = +(r.amt / (1 + r.tax)).toFixed(2);
      const vat = +(r.amt - net).toFixed(2);
      push(bank, r.amt, 0);
      push(other, 0, net);
      push(['22210107', '应交税费_应交增值税_销项税额'], 0, vat);
    } else if (r.red) {
      // 红字冲销：两行都在贷方，冲减方为负数（贵司退押金的做法）
      push(other, 0, -r.amt);
      push(bank, 0, r.amt);
    } else if (r.dir === 'in') {
      push(bank, r.amt, 0); push(other, 0, r.amt);
    } else {
      push(other, r.amt, 0); push(bank, 0, r.amt);
    }
  });
  return out;
}

/* ============ 界面：工具箱 ============ */
const TOOLS = [
  { id: 'T1', n: '资金日报生成器', save: 20, ready: 1, go: 't1', own: '出纳',
    d: '账户台账预置，每天只填变动的；三级汇总 + 覆盖倍数红线 + 一键生成钉钉日报文本' },
  { id: 'T2', n: '银行流水转凭证', save: 24, ready: 1, go: 't2', own: '出纳 · 总账',
    d: '网银导出的流水，自动归一化 + 规则匹配科目，生成可导入账务系统的凭证文件' },
  { id: 'T3', n: '对账单核对器', save: 22, ready: 1, go: 't3', own: '会计 · 通用',
    d: '我方台账与对方对账单逐笔勾对，三类差异；列对应可存模板，下月复用' },
  { id: 'T4', n: '日损益速算表', save: 35, ready: 1, go: 't4', own: '会计',
    d: '六渠道三层结构；取数天数不对齐时禁止出汇总，硬推口径显式标注' },
  { id: 'T5', n: '商品对码工具', save: 0, own: '会计', d: '销售端与采购端商品名归一化匹配，产出对码表' },
  { id: 'T8', n: '申报数据汇总表', save: 12, own: '税务会计', d: '多主体申报数据汇集与账表税比对' },
  { id: 'T6', n: '发票查重与打标', save: 7, own: '会计', d: '进项票查重、按合同号打标四级维度' },
  { id: 'T9', n: '社保增减员台账', save: 0, own: '税务会计', d: '人员异动登记与超期预警' },
  { id: 'T10', n: '盘点差异表', save: 4, own: '项目财务', d: '账面与实盘差异、强制归因' },
  { id: 'T7', n: '月结检查清单', save: 0, own: '全员', d: '月结 24 项清单执行与留痕' },
];

const S = {};

S['home'] = () => head('工作台', '一期已上线「工具箱」。其余功能域为二期规划，点击可查看规划说明。', '')
  + kpis([
    { k: '已上线工具', v: String(TOOLS.filter(t => t.ready).length), u: '个', t: 'g', d: 'T2 · T4' },
    { k: '规划中工具', v: String(TOOLS.filter(t => !t.ready).length), u: '个' },
    { k: '已上线合计月省', v: String(TOOLS.filter(t => t.ready).reduce((s, t) => s + t.save, 0)), u: 'h', t: 'g' },
    { k: 'T2 规则库', v: String(RULES.length), u: '条', d: '可持续累积' },
    { k: 'T2 累计处理', v: String(loadLog().length), u: '批次' },
  ])
  + `<div class="note"><b>一期范围：</b>系统整体结构已搭好（9 个功能域），功能上只开放<b>工具箱</b>。其余模块按方案二期起逐个开发，点进去能看到各自的规划说明与对应模块编号。</div>`
  + card('快速开始', `<div style="padding:14px">
      <div class="tgrid">${TOOLS.filter(t => t.ready).map(toolCard).join('')}</div>
    </div>`);

function toolCard(t) {
  const soon = !t.ready;
  return `<button class="tcard ${soon ? 'soon' : ''}" ${t.ready ? `data-go="${t.go}"` : ''}>
    <span class="tc-h"><span class="tc-id">${t.id}</span><span class="tc-n">${H(t.n)}</span><span class="tc-sp"></span>
      ${t.save ? `<span class="tc-sv">省 ${t.save}<small> h/月</small></span>` : `<span class="tc-sv" style="color:var(--accent)">降差错</span>`}</span>
    <span class="tc-d">${H(t.d)}</span>
    <span class="tc-m">${t.ready ? pill('已上线', 'ok') : pill('规划中', 'mu')}<span class="tc-tag">${H(t.own)}</span></span>
  </button>`;
}

S['tool-list'] = () => head('我的工具', '工具箱是常设能力——新工具会持续加进来。当前已上线 1 个，其余按方案排期逐个开发。', '工具箱')
  + `<div class="note g"><b>先跑通一个再做下一个。</b>T2 用顺了、规则库养起来了，再开 T3。这样每个工具上线时都能真正被用起来，而不是堆一堆没人用的功能。</div>`
  + `<div class="tgrid">${TOOLS.map(toolCard).join('')}</div>`;

S['tool-plan'] = () => head('开发排期', '十个工具分三批。当前处于第一批第 1 个。', '工具箱')
  + card('排期', table(
    [{ t: '批次' }, { t: '工具' }, { t: '状态' }, { t: '可省', n: 1 }],
    [
      ['第一批', 'T2 银行流水转凭证', pill('已上线', 'ok'), '24 h/月'],
      ['第一批', 'T3 对账单核对器', pill('待开发', 'mu'), '22 h/月'],
      ['第一批', 'T1 资金日报生成器', pill('待开发', 'mu'), '20 h/月'],
      ['第一批', 'T5 商品对码工具', pill('待开发', 'mu'), '前置'],
      ['第二批', 'T4 / T8 / T6 / T9', pill('规划中', 'mu'), '54 h/月'],
      ['第三批', 'T10 / T7', pill('规划中', 'mu'), '4 h/月'],
    ]))
  + `<div class="note"><b>推进原则：</b>跑完一个、用好一个，再开下一个。每个工具上线一个月后复盘实测节省，达成率低于 70% 的先优化再往下走。</div>`;

/* 规则库界面 */
S['tool-rules'] = () => {
  if (!RS) {
    const withRules = ENTITIES.filter(e => RULE_SETS[e.id]);
    return head('规则库', '规则库<b>按主体隔离</b>——不同主体业务不同，共用一套规则必然记错账。', '工具箱 · T2')
      + `<div class="note"><b>请先选主体。</b>下面是已有规则库的主体，点进去查看；其余主体的规则要各自从真账里学。</div>`
      + `<div class="tgrid">${withRules.map(e => `<button class="tcard" data-useent="${e.id}">
          <span class="tc-h"><span class="tc-n">${H(e.full)}</span><span class="tc-sp"></span>
          <span class="tc-sv">${RULE_SETS[e.id].rules.length}<small> 条</small></span></span>
          <span class="tc-d">${H(e.line)} · ${RULE_SETS[e.id].projects.length} 个项目</span></button>`).join('')}</div>`
      + `<div class="note w"><b>其余 ${ENTITIES.length - withRules.length} 个主体暂无规则库。</b>
         电商、集包、塑料制造的业务与出租屋完全不同，规则不能套用——需要各自提供一期真实凭证来学。</div>`;
  }
  const rows = RULES.map(r => [
    `<span class="code">${H(r.kw.length > 26 ? r.kw.slice(0, 26) + '…' : r.kw)}</span>`,
    r.dir === 'in' ? pill('收入', 'ok') : r.dir === 'out' ? pill('支出', 'wa') : pill('不限', 'mu'),
    `<span class="code">${r.acct}</span> ${H(acctName(r.acct))}`,
    H(r.memo || ''),
    `<span class="num">${r.hits || 0}</span>`,
    H(r.src || '自建'),
    `<button class="btn sm" data-delrule="${r.id}">删除</button>`
  ]);
  const curEnt = ENTITIES.find(e => e.id === T2.entId);
  return head('规则库 · ' + (curEnt ? curEnt.full : ''),
    '摘要关键词 → 会计科目。每处理一次例外就可以存成规则，规则库越养越准。<b>规则按主体隔离</b>。', '工具箱 · T2',
    `<button class="btn" data-act="exportRules">导出规则</button><button class="btn pri" data-act="addRule">+ 新增规则</button>`)
    + kpis([
      { k: '规则总数', v: String(RULES.length), u: '条' },
      { k: '累计命中', v: String(RULES.reduce((s, r) => s + (r.hits || 0), 0)), u: '次', t: 'g' },
      { k: '自建规则', v: String(RULES.filter(r => r.src !== '预置').length), u: '条' },
      { k: '从未命中', v: String(RULES.filter(r => !r.hits).length), u: '条', t: 'w', d: '可考虑清理' },
    ])
    + `<div class="note"><b>规则匹配顺序：</b>从上到下，命中第一条即停。所以<b>越具体的规则要放越前面</b>。新增规则默认插在最前。</div>`
    + card('规则列表', table(
      [{ t: '关键词（正则）' }, { t: '方向' }, { t: '科目' }, { t: '凭证摘要' }, { t: '命中', n: 1 }, { t: '来源' }, { t: '' }], rows));
};

S['tool-log'] = () => {
  const log = loadLog();
  if (!log.length) return head('处理记录', '每次转换都会留痕：谁、什么时候、处理了多少笔、导出了什么。', '工具箱 · T2')
    + `<div class="soonbox"><div class="si">▷</div><h3>还没有处理记录</h3><p>用 T2 转换一次银行流水后，这里会记录下来。</p></div>`;
  return head('处理记录', '每次转换都会留痕：谁、什么时候、处理了多少笔、导出了什么。', '工具箱 · T2',
    `<button class="btn" data-act="clearLog">清空记录</button>`)
    + card('记录', table(
      [{ t: '时间' }, { t: '文件' }, { t: '主体' }, { t: '总笔数', n: 1 }, { t: '已匹配', n: 1 }, { t: '例外', n: 1 }, { t: '匹配率' }, { t: '导出' }],
      log.map(l => [l.time, H(l.file), H(l.ent || '—'), l.total, l.ok, l.ex,
        `<b class="${l.rate >= 90 ? 'grn' : l.rate >= 70 ? '' : 'red'}">${l.rate}%</b>`,
        l.exported ? pill('已导出', 'ok') : pill('未导出', 'mu')])));
};

/* ============ T2 主界面 ============ */
function stepBar() {
  const names = ['选择文件', '识别表头', '匹配规则', '处理例外', '导出凭证'];
  return `<div class="steps">${names.map((n, i) => {
    const k = i + 1;
    const cls = T2.step === k ? 'on' : T2.step > k ? 'dn' : '';
    return `<span class="stp ${cls}"><i>${T2.step > k ? '✓' : k}</i>${n}</span>${i < 4 ? '<span class="stln"></span>' : ''}`;
  }).join('')}</div>`;
}

S['t2'] = () => {
  let body = '';
  if (T2.step === 1) body = t2Step1();
  else if (T2.step === 2) body = t2Step2();
  else if (T2.step === 3) body = t2Step3();
  else if (T2.step === 4) body = t2Step4();
  else body = t2Step5();
  return head('T2　银行流水转凭证',
    '网银导出的流水丢进来，自动识别表头、按规则匹配科目、生成可导入账务系统的凭证文件。匹配不上的单独列出，绝不猜。',
    '工具箱 · 已上线',
    T2.step > 1 ? `<button class="btn" data-act="t2reset">重新开始</button>` : '')
    + stepBar() + body;
};

function t2Step1() {
  return `<div class="note"><b>支持格式：</b>.xlsx / .csv / .tsv / .txt（UTF-8 与 GBK 自动识别）。文件只在你的浏览器里解析，<b>不会上传到任何服务器</b>。</div>
  <div class="card"><div class="cb">
    <div class="drop" id="drop">
      <div class="di">⇪</div>
      <div class="dt">把银行流水文件拖到这里，或点击选择</div>
      <div class="dm">一次处理一个账户的流水。多账户请分别处理。</div>
    </div>
  </div></div>
  ${cardp('这个工具替你做什么', `
    <div style="font-size:12.5px;line-height:1.95">
    ① 各家银行导出格式不同，<b>自动归一化</b>列名与日期格式<br>
    ② 按<b>摘要关键词规则库</b>匹配会计科目与借贷方向<br>
    ③ 自动带出<b>主体、业务线</b>等核算维度<br>
    ④ 生成<b>可直接导入账务系统</b>的凭证文件（借贷平衡）<br>
    ⑤ 匹配不上的进<b>例外清单</b>，由你逐条处理，并可存成新规则
    </div>
    <div class="note w" style="margin:12px 0 0"><b>工具不替你做的：</b>不猜科目、不自动入账、不碰网银。生成的是<b>草稿</b>，导入账务系统前请复核。</div>`)}`;
}

/* 当前主体的简称——T1 账户台账用简称存主体（「优栖」），ENTITIES 里存全称 */
const t2EntShort = () => {
  const e = ENTITIES.find(x => x.id === T2.entId);
  return e ? e.short : '';
};
/* 选定收付账户：只记 id，账号文本从 T1 台账带出来（账号为空就退回用账户名） */
function t2SetAcct(id) {
  T2.acctId = id || '';
  const a = (typeof t1AccById === 'function' && id) ? t1AccById(id) : null;
  T2.acctNo = a ? (a.no || a.name) : '';
}
/* 收付账户下拉：账户主数据只在 T1 台账里存一份，这里只引用，不自己存 */
function t2AcctSelect() {
  if (!T2.entId) {
    return '<select disabled><option>— 请先选主体 —</option></select>';
  }
  const accs = (typeof t1Accounts === 'function') ? t1Accounts(t2EntShort()) : [];
  if (!accs.length) {
    return '<select disabled><option>— 该主体在 T1 台账里没有在管账户 —</option></select>'
      + '<div class="mut" style="font-size:11px;margin-top:4px">去 <b>T1 资金日报 → 账户台账</b> 添加，这里就能选到</div>';
  }
  return `<select id="acctSel"><option value="">— 请选择 —</option>${accs.map(a =>
    `<option value="${a.id}" ${T2.acctId === a.id ? 'selected' : ''}>${H(a.name)}${a.no ? ' · ' + H(a.no) : ''}</option>`
  ).join('')}</select>`
    + '<div class="mut" style="font-size:11px;margin-top:4px">来自 T1 账户台账。跑完流水，期末余额会回写到 T1 当日余额。</div>';
}

/* 从文件表头上方那几行里把卡号抠出来。
   银行对账单表头之前一般有「卡号: 6215****1234」这类说明行，
   有了它就能自动认出是哪个账户，用户上传完不用再手选。 */
function t2SniffAcctNo(rows, headRow) {
  const re = /(?:卡号|账号|帐号|账户号|户号)\s*[:：]?\s*([0-9][0-9*＊\-\s]{5,})/;
  const scan = rows.slice(0, Math.min(headRow + 1, 12));
  for (const r of scan) {
    for (const c of r) {
      const m = re.exec(String(c == null ? '' : c));
      if (m) {
        const no = m[1].trim();
        if (no.replace(/[^0-9]/g, '').length >= 4) return no;
      }
    }
  }
  return null;
}

/* 上传文件后自动认账户：靠文件里的卡号去 T1 台账匹配。
   认出来就顺带把主体也定了，并立刻回写余额——不用等用户走完匹配规则那一步。 */
function t2AutoBind() {
  T2.sniffNo = null; T2.autoBind = null;
  if (!T2.rows || typeof t1FindAccByNo !== 'function') return;
  const no = t2SniffAcctNo(T2.rows, T2.headRow);
  if (!no) return;
  T2.sniffNo = no;
  const acc = t1FindAccByNo(no);
  if (!acc) { T2.autoBind = { miss: 1 }; return; }
  const ent = ENTITIES.find(e => e.short === acc.ent);
  if (ent) {
    T2.entId = ent.id; T2.ent = ent.full;
    useRuleSet(T2.entId); T2.defProj = defaultProjOf();
    if (!T2.line && ent.line) T2.line = ent.line;
  }
  t2SetAcct(acc.id);
  T2.autoBind = { accId: acc.id, ent: acc.ent, name: acc.name, no: acc.no };
  t2PushBalance();   // 认出账户就直接把期末余额写进 T1，上传完 T1 里就能看到
}

/* 从流水里取期末余额。
   坑：网银导出有正序也有倒序的，同一天多笔时「最后一笔」在文件里可能是第一行。
   所以先比首末两行判断排序方向，再决定同日取哪一行，不能闭眼取最后一行。 */
function t2ClosingBal() {
  const { rows, headRow, map } = T2;
  if (!rows || map.bal === undefined || map.date === undefined) return null;
  const body = rows.slice(headRow + 1)
    .map(r => ({ d: normDate(r[map.date]), raw: r[map.bal] }))
    .filter(x => x.d && String(x.raw == null ? '' : x.raw).trim() !== '');
  if (!body.length) return null;
  const asc = body[0].d <= body[body.length - 1].d;
  const maxD = body.reduce((m, x) => (x.d > m ? x.d : m), body[0].d);
  const sameDay = body.filter(x => x.d === maxD);
  const pick = asc ? sameDay[sameDay.length - 1] : sameDay[0];
  return { date: maxD, val: numOf(pick.raw), asc };
}

/* 把期末余额回写到 T1 的当日余额。
   那天已有手工录的数且对不上时先问，不静默覆盖。 */
function t2PushBalance() {
  // 上一次是写到别的账户上的（用户在下拉里改了账户）→ 把那笔撤掉再写新的，
  // 否则旧账户会凭空多出一笔它从没有过的余额
  const prev = T2.balPush;
  if (prev && prev.ok && prev.accId && prev.accId !== T2.acctId && typeof t1ClearBalance === 'function') {
    t1ClearBalance(prev.accId, prev.date, 'T2', prev.val);
  }
  T2.balPush = null;
  if (typeof t1PutBalance !== 'function' || !T2.acctId) return;
  const cb = t2ClosingBal();
  if (!cb) { T2.balPush = { skip: 1 }; return; }
  let r = t1PutBalance(T2.acctId, cb.date, cb.val, 'T2');
  if (r.conflict) {
    const diff = cb.val - r.old;
    const ok = confirm(
      `${cb.date} 这天 T1 里已经有余额 ${money(r.old)}，\n`
      + `流水算出来的期末余额是 ${money(cb.val)}，差 ${(diff >= 0 ? '+' : '') + money(diff)}。\n\n`
      + `用流水的数覆盖吗？\n取消 = 保留原来手工录的数。`);
    if (!ok) { T2.balPush = { kept: 1, accId: T2.acctId, date: cb.date, val: cb.val, old: r.old }; return; }
    r = t1PutBalance(T2.acctId, cb.date, cb.val, 'T2', 1);
  }
  T2.balPush = r.ok ? { ok: 1, accId: T2.acctId, date: cb.date, val: cb.val } : { err: r.reason };
}

/* 上传后自动认账户的结果，连同余额有没有写进 T1，一并摊开说 */
function t2AutoBindNote() {
  const ab = T2.autoBind;
  if (!ab) return T2.sniffNo ? '' : '';
  if (ab.miss) {
    return `<div class="note w"><b>文件里的卡号是 ${H(T2.sniffNo)}，但 T1 台账里没有账号对得上的账户。</b>
      下面手动选一下是哪个账户${T2.acctId ? `，然后 <button class="btn sm" data-act="t2bindNo">把这个卡号记到该账户</button>，下次上传就自动认出来了` : '——选完可以把卡号记进台账，下次就自动了'}。</div>`;
  }
  const p = T2.balPush;
  const bal = !p ? ''
    : p.ok ? `期末余额 ${money(p.val)}（${p.date}）<b>已写入 T1</b>。`
    : p.kept ? `期末余额 ${money(p.val)} 和 T1 里已有的 ${money(p.old)} 对不上，你选了保留原值。`
    : p.skip ? '这份文件没有余额列，T1 余额没动。'
    : '';
  return `<div class="note g"><b>已按文件里的卡号 ${H(T2.sniffNo)} 认出账户：${H(ab.ent)} · ${H(ab.name)}。</b>
    主体也一并定了。${bal} 认错了在下面改，改完余额会重新写。</div>`;
}

function t2Step2() {
  const rows = T2.rows, hr = T2.headRow;
  const header = rows[hr] || [];
  const preview = rows.slice(hr + 1, hr + 4);
  // 带列序号和样值：银行导出常有两列同名（两个「记账金额」），光看列名选不出来是哪个
  const sampleOf = j => {
    const v = preview.map(r => r && r[j]).find(x => String(x == null ? '' : x).trim() !== '' && String(x).trim() !== '-');
    return v === undefined ? '' : ' ＝ ' + String(v).slice(0, 10);
  };
  const opts = i => header.map((h, j) =>
    `<option value="${j}" ${T2.map[i] === j ? 'selected' : ''}>第${j + 1}列 ${H(String(h || '(空)').slice(0, 14))}${H(sampleOf(j))}</option>`).join('');
  const fieldRows = FIELDS.map(f => [
    H(f.n) + (f.must ? ' <span class="red">*</span>' : ''),
    `<select data-map="${f.k}"><option value="">— 不使用 —</option>${opts(f.k)}</select>`,
    T2.map[f.k] !== undefined ? `<span class="mut">${H(String(preview[0] && preview[0][T2.map[f.k]] || '').slice(0, 22))}</span>` : '<span class="mut">—</span>'
  ]);
  const headOpts = rows.slice(0, Math.min(rows.length, 12)).map((r, i) =>
    `<option value="${i}" ${i === hr ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 46))}</option>`).join('');
  const ready = T2.map.date !== undefined && T2.map.memo !== undefined &&
    (T2.map.inAmt !== undefined || T2.map.outAmt !== undefined || T2.map.amt !== undefined);
  return `<div class="frow" style="margin-bottom:13px">
      <span class="fi">✓</span>
      <span><span class="fn">${H(T2.file.name)}</span><br><span class="fm">${rows.length} 行 · ${(T2.file.size / 1024).toFixed(0)} KB</span></span>
      <span class="sp"></span><button class="btn" data-act="t2reset">换个文件</button>
    </div>
    ${cardp('表头在第几行', `<select id="headSel" style="min-width:340px">${headOpts}</select>
      <div class="note" style="margin:11px 0 0">银行流水前几行常是账号、户名等说明文字，工具已自动猜测表头位置。如果猜错了，在上面改。</div>`)}
    ${card('列对应关系', table([{ t: '需要的字段' }, { t: '对应文件里的哪一列' }, { t: '示例值' }], fieldRows))}
    ${T2.map._dcGuess ? `<div class="note w"><b>收入/支出这两列是按数据推断的，请核一眼。</b>
      这份文件里它们的列名一样（分不出谁是谁），所以改用余额的变动方向判断：
      余额变大的那笔钱在第 ${T2.map._dcGuess[0] + 1} 列 → 当成<b>收入</b>，第 ${T2.map._dcGuess[1] + 1} 列 → 当成<b>支出</b>。
      推断错了直接在上面改。</div>` : ''}
    ${t2AutoBindNote()}
    ${cardp('这批流水属于', `
      <div class="cols c2">
        <div><div class="field"><label class="fl">主体 <span class="red">*</span></label>
          <select id="entSel2"><option value="">— 请选择 —</option>${ENTITIES.map(e => `<option value="${e.id}" ${T2.entId === e.id ? 'selected' : ''}>${e.full}${RULE_SETS[e.id] ? '' : '（无规则库）'}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">业务线</label>
          <select id="lineSel"><option value="">— 不指定 —</option>${LINES.map(e => `<option ${T2.line === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">默认项目（摘要与户名都认不出时用）</label>
          <select id="defProj"><option value="">— 不设，认不出就进例外 —</option>${PROJECTS().map(p => `<option value="${p.code}" ${T2.defProj === p.code ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div></div>
        <div><div class="field"><label class="fl">收付账户 <span class="red">*</span></label>
          ${t2AcctSelect()}</div>
          <div class="field"><label class="fl">凭证字</label><input type="text" id="vchWord" value="${H(T2.vchWord)}"></div></div>
      </div>`)}
    <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
      <button class="btn pri" data-act="t2run" ${ready ? '' : 'disabled'}>下一步：匹配规则</button>
    </div>
    ${ready ? '' : `<div class="note c" style="margin-top:11px"><b>还不能继续：</b>日期、摘要、以及至少一个金额列（收入/支出，或发生额）必须对应上。</div>`}`;
}

/* 余额回写结果，摊开说清楚写没写、写到哪个账户哪一天 */
function t2BalNote() {
  const p = T2.balPush;
  if (!p) return '';
  const acc = (typeof t1AccById === 'function') ? t1AccById(T2.acctId) : null;
  const who = acc ? `${H(acc.ent)} · ${H(acc.name)}` : T2.acctId;
  if (p.skip) return `<div class="note"><b>T1 余额没动。</b>这份流水里没有余额列（或余额列是空的），工具不会替你估——去 T1 手工录一下 ${who} 的余额。</div>`;
  if (p.err) return `<div class="note c"><b>余额没能写进 T1：</b>${H(p.err)}</div>`;
  if (p.kept) return `<div class="note w"><b>保留了 T1 原来的手工余额。</b>${who} ${p.date}：T1 是 ${money(p.old)}，流水期末是 ${money(p.val)}，差 ${money(p.val - p.old)}。你选了不覆盖——两边现在对不上，建议查一下是漏了一笔还是流水不全。</div>`;
  return `<div class="note g"><b>已回写 T1 当日余额。</b>${who} ${p.date} 期末余额 ${money(p.val)}，在 T1 里标了「来自 T2 流水」。</div>`;
}

function t2Step3() {
  const { ok, ex, total } = T2.result;
  const rate = total ? Math.round(ok.length / total * 100) : 0;
  return kpis([
    { k: '流水总笔数', v: String(total), u: '笔' },
    { k: '已匹配', v: String(ok.length), u: '笔', t: 'g' },
    { k: '例外', v: String(ex.length), u: '笔', t: ex.length ? 'c' : 'g' },
    { k: '匹配率', v: String(rate), u: '%', t: rate >= 90 ? 'g' : rate >= 70 ? 'w' : 'c' },
    { k: '收入合计', v: money(ok.filter(r => r.dir === 'in').reduce((s, r) => s + r.amt, 0)) },
    { k: '支出合计', v: money(ok.filter(r => r.dir === 'out').reduce((s, r) => s + r.amt, 0)) },
  ])
    + (ex.length ? `<div class="note w"><b>有 ${ex.length} 笔没匹配上。</b>工具不会替你猜科目——下一步逐条处理，处理完还能存成规则，下次就自动了。</div>`
      : `<div class="note g"><b>全部匹配成功。</b>可以直接进入导出。</div>`)
    + t2BalNote()
    + `<div class="tabs">
        <button data-tab="ok" class="${T2.tab === 'ok' ? 'on' : ''}">已匹配<span class="cnt">${ok.length}</span></button>
        <button data-tab="ex" class="${T2.tab === 'ex' ? 'on' : ''}">例外<span class="cnt">${ex.length}</span></button>
      </div>`
    + card('', T2.tab === 'ok' ? okTable(ok) : exTable(ex))
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        ${ex.length ? `<button class="btn" data-act="t2ex">处理例外（${ex.length}）</button>` : ''}
        <button class="btn pri" data-act="t2export">下一步：导出凭证</button>
      </div>`;
}

function okTable(ok) {
  return table(
    [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '匹配科目' }, { t: '匹配依据' }, { t: '凭证摘要' }, { t: '提示' }],
    ok.slice(0, 300).map(r => [
      r.no, r.date, H(r.memo.slice(0, 26)), H(r.opp.slice(0, 16)),
      r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'),
      money(r.amt), `<span class="code">${r.acct}</span> ${H(acctName(r.acct))}`,
      r.hitField ? `<span class="mut" style="font-size:11px">${H(r.hitField)}</span>` : '<span class="mut">人工指定</span>',
      H(r.vmemo),
      r.warn ? pill(r.warn, 'cr') : ''
    ]));
}
function exTable(ex) {
  return table(
    [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '原因' }],
    ex.slice(0, 300).map(r => [
      r.no, r.date || '<span class="red">缺失</span>', H(r.memo.slice(0, 30)), H(r.opp.slice(0, 16)),
      r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'),
      r.amt ? money(r.amt) : '<span class="red">0</span>', `<span class="red">${H(r.why)}</span>`
    ]));
}

function t2Step4() {
  const ex = T2.result.ex;
  const acctOpts = ACCOUNTS().map(a => `<option value="${a[0]}">${a[0]} ${a[1]}</option>`).join('');
  const rows = ex.map((r, i) => [
    r.no, r.date || '<span class="red">缺失</span>', H(r.memo.slice(0, 28)), H(r.opp.slice(0, 14)),
    r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'), money(r.amt),
    `<select data-fix="${i}"><option value="">— 跳过 —</option>${acctOpts}</select>`,
    `<select data-save="${i}" style="min-width:120px">
       <option value="">不存规则</option>
       <option value="memo"${r.memo ? '' : ' disabled'}>按摘要「${H(r.memo.slice(0, 6))}」</option>
       <option value="opp"${r.opp ? '' : ' disabled'}>按户名「${H(r.opp.slice(0, 8))}」</option>
     </select>`
  ]);
  return `<div class="note"><b>逐条指定科目。</b>勾选「存为规则」的，会把该笔<b>摘要的前 4 个字</b>加进规则库，下次自动匹配。不确定的留「跳过」，这些笔不会进凭证文件，会单独导出成清单。</div>`
    + card(`例外清单（${ex.length} 笔）`, table(
      [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '指定科目' }, { t: '' }], rows))
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn" data-act="t2back3">返回</button>
        <button class="btn pri" data-act="t2applyfix">应用并继续</button>
      </div>`;
}

function t2Step5() {
  const { ok, ex, total } = T2.result;
  const v = vouchers();
  const dr = v.reduce((s, r) => s + (Number(r[6]) || 0), 0);
  const cr = v.reduce((s, r) => s + (Number(r[7]) || 0), 0);
  const bal = Math.abs(dr - cr) < 0.005;
  return kpis([
    { k: '生成凭证', v: String(ok.length), u: '张' },
    { k: '凭证行数', v: String(v.length), u: '行' },
    { k: '借方合计', v: money(dr) },
    { k: '贷方合计', v: money(cr) },
    { k: '借贷平衡', v: bal ? '✓' : '✗', t: bal ? 'g' : 'c' },
    { k: '未处理例外', v: String(ex.length), u: '笔', t: ex.length ? 'w' : 'g' },
  ])
    + (bal ? `<div class="note g"><b>借贷平衡，可以导出。</b>导入账务系统后请复核科目与维度，确认无误再过账。</div>`
      : `<div class="note c"><b>借贷不平衡，请勿导入。</b>请返回检查金额列是否对应正确。</div>`)
    + `<div class="cols c2">
      ${cardp('凭证导入文件', `<div style="font-size:12.5px;line-height:1.8">
        ${ok.length} 张凭证 / ${v.length} 行<br>
        <span class="mut">列：日期·凭证字·凭证号·摘要·科目编码·科目名称·借方·贷方·主体·业务线·项目·合同号·对方户名·流水号·账号</span></div>
        <button class="btn pri" style="margin-top:11px" data-act="dlVoucher" ${bal ? '' : 'disabled'}>下载凭证 CSV</button>`)}
      ${cardp('例外清单', ex.length ? `<div style="font-size:12.5px;line-height:1.8">
        ${ex.length} 笔未能自动匹配<br><span class="mut">这些笔不在凭证文件里，需人工在账务系统单独处理</span></div>
        <button class="btn" style="margin-top:11px" data-act="dlEx">下载例外清单 CSV</button>`
      : `<div style="font-size:12.5px;color:var(--good)">没有例外，全部已匹配。</div>`)}
    </div>`
    + card('凭证预览（前 30 行）', table(
      [{ t: '日期' }, { t: '凭证字号' }, { t: '摘要' }, { t: '科目' }, { t: '借方', n: 1 }, { t: '贷方', n: 1 }, { t: '主体' }],
      v.slice(0, 30).map(r => [r[0], r[1] + '-' + r[2], H(r[3]), `<span class="code">${r[4]}</span> ${H(r[5])}`,
        r[6] ? money(r[6]) : '', r[7] ? money(r[7]) : '', H(r[8])])));
}

/* ============ 二期占位 ============ */
const PHASE2 = {
  'p-fund-daily': ['资金日报', 'M2', '47 个账户余额自动归集，红线预警，日报自动推送'],
  'p-fund-account': ['账户与U盾', 'M2', '账户台账、U 盾领用登记、持盾人与知密人分权'],
  'p-fund-recon': ['流水与对账', 'M2', '银企互联取流水、自动勾对、差异标红'],
  'p-pay': ['付款申请', 'M4', '钉钉电子流、权限自动路由、三单匹配'],
  'p-inv-in': ['进项票池', 'M1', '数字账户直连取票、按合同号打标、查重'],
  'p-inv-out': ['销项开票', 'M1', '应收账单自动触发开票'],
  'p-ar-contract': ['合同台账', 'M3', '对接智慧园区系统自动同步'],
  'p-ar-bill': ['应收账单', 'M3', '合同驱动按月自动生成应收'],
  'p-ar-claim': ['收款认领', 'M3', '流水按规则自动匹配应收'],
  'p-ar-aging': ['账龄与催收', 'M3', '四级逾期分级预警'],
  'p-exp': ['报销与费控', 'M4', '预算前置管控、备用金超期拦截'],
  'p-flow': ['审批路由', 'M4', '权限表内置自动路由'],
  'p-stock': ['进销存台账', 'M11', '加权平均法、期初只读自动推算'],
  'p-count': ['月末盘点', 'M11', '差异强制归因与处理动作'],
  'p-close': ['月结检查单', 'M5', '24 项清单自动跑、强校验阻断'],
  'p-ic': ['往来对平', 'M5', '主体间往来双边自动对平'],
  'p-report': ['报表中心', 'M5', '报表 5 号前出齐'],
  'p-tax-cal': ['申报日历', 'M6', '征期前 3 工作日红线预警'],
  'p-dash': ['经营看板', 'M7', '分板块经营、北极星指标'],
  'p-daily': ['日损益', 'M7', '平台数据自动抓取算毛利'],
  'p-project': ['项目盈利', 'M7', '项目/合同级盈利与成本分摊'],
  'p-related': ['关联方', 'M8', '自动打标、独立报告线'],
  'p-alert': ['预警中心', 'M8', '全系统预警汇总与超期升级'],
  'p-log': ['Agent日志', 'M9', '执行留痕与流程心跳'],
  'p-entity': ['主体档案', 'M0', '多主体统一登记'],
  'p-dim': ['核算维度', 'M0', '主体/业务线/项目/合同四级'],
  'p-match': ['跨系统对码', 'M0', '销售端与采购端主数据映射'],
  'p-perm': ['用户与权限', '权限', '功能权限 + 数据权限 + 操作权限三维'],
};
function phase2(id) {
  const [n, m, d] = PHASE2[id] || ['该功能', '—', ''];
  return head(n, d, m)
    + `<div class="soonbox">
      <div class="si">⏱</div>
      <h3>${H(n)} · 二期开发</h3>
      <p>${H(d)}。本模块属方案中的 <b>${H(m)}</b>，一期不开发。</p>
      <p style="margin-top:9px">一期先把<b>工具箱</b>跑通——用小工具直接节省时间，等规则在真账上养熟了，再接入正式模块。</p>
      <span class="tag">对应模块 ${H(m)} · 二期起逐个开发</span>
    </div>`;
}

/* ============ 路由 ============ */
let CURD = 'home', CURS = 'home';
function renderNav() {
  $('domNav').innerHTML = DOMS.map(d =>
    `<button data-d="${d.id}" class="${d.id === CURD ? 'on' : ''}">
      <span class="ic">${d.ic}</span>${d.n}${d.ready ? '' : '<span class="p2">二期</span>'}</button>`).join('');
  const d = DOMS.find(x => x.id === CURD);
  $('subNav').innerHTML = (d && d.items.length)
    ? d.items.map(([id, n]) => `<button data-s="${id}" class="${id === CURS ? 'on' : ''}">${n}</button>`).join('')
    : `<button class="on">${d ? d.n : ''}</button>`;
}
function go(id) {
  if (/^t[1234]($|-)/.test(id) || id.startsWith('tool-')) CURD = 'tools';
  else {
    const d = DOMS.find(x => x.items.some(i => i[0] === id) || x.id === id);
    if (d) CURD = d.id;
  }
  CURS = id;
  const view = $('view');
  if (S[id]) view.innerHTML = S[id]();
  else if (PHASE2[id]) view.innerHTML = phase2(id);
  else view.innerHTML = S['home']();
  renderNav();
  bindDynamic();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ============ 事件 ============ */
async function loadFile(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    T2.file = file; T2.rows = rows;
    T2.headRow = XLSXLite.findHeaderRow(rows, ALL_ALIAS);
    T2.map = autoMap(rows[T2.headRow] || [], rows.slice(T2.headRow + 1));
    t2AutoBind();          // 认出账户就当场把余额写进 T1，上传完 T1 里立刻能看到
    T2.step = 2;
    go('t2');
    const got = Object.keys(T2.map).length;
    const ab = T2.autoBind;
    toast(ab && ab.accId
      ? `读到 ${rows.length} 行 · 已认出账户「${ab.ent} · ${ab.name}」`
      + (T2.balPush && T2.balPush.ok ? `，余额已写入 T1` : '')
      : `读到 ${rows.length} 行，自动识别 ${got} 个字段`, 4200);
  } catch (e) {
    toast('读取失败：' + e.message, 4200);
  }
}

function bindDynamic() {
  const drop = $('drop');
  if (drop) {
    drop.onclick = () => $('filePick').click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); };
    drop.ondragleave = () => drop.classList.remove('hot');
    drop.ondrop = e => {
      e.preventDefault(); drop.classList.remove('hot');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    };
  }
  const hs = $('headSel');
  if (hs) hs.onchange = () => {
    T2.headRow = +hs.value;
    T2.map = autoMap(T2.rows[T2.headRow] || [], T2.rows.slice(T2.headRow + 1));
    go('t2');
  };
  document.querySelectorAll('[data-map]').forEach(sel => {
    sel.onchange = () => {
      const k = sel.dataset.map;
      if (sel.value === '') delete T2.map[k]; else T2.map[k] = +sel.value;
      go('t2');
    };
  });
  // 收付账户：选的是 T1 账户 id，账号文本从台账带出来，不让用户重复手填
  const accSel = $('acctSel');
  if (accSel) accSel.onchange = () => {
    t2SetAcct(accSel.value);
    if (T2.acctId) t2PushBalance();   // 换了账户，余额得写到新账户上
    go('t2');
  };
  ['entSel2:ent', 'lineSel:line', 'vchWord:vchWord', 'defProj:defProj'].forEach(p => {
    const [id, key] = p.split(':');
    const el = $(id);
    if (el) el.onchange = () => {
      if (id === 'entSel2') {
        T2.entId = el.value;
        const ei = ENTITIES.find(x => x.id === T2.entId);
        T2.ent = ei ? ei.full : '';
        useRuleSet(T2.entId); T2.defProj = defaultProjOf();
        t2SetAcct('');   // 账户按主体分，换主体原来选的账户就不成立了
        T2.balPush = null; T2.autoBind = null;
        go('t2');
      } else T2[key] = el.value;
    };
  });
}

document.addEventListener('click', e => {
  const d = e.target.closest('[data-d]');
  if (d) { const dom = DOMS.find(x => x.id === d.dataset.d); go(dom.items.length ? dom.items[0][0] : dom.id); return; }
  const s = e.target.closest('[data-s]');
  if (s) { go(s.dataset.s); return; }
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { T2.tab = tb.dataset.tab; go('t2'); return; }
  const ue = e.target.closest('[data-useent]');
  if (ue) {
    T2.entId = ue.dataset.useent;
    const ei = ENTITIES.find(x => x.id === T2.entId);
    T2.ent = ei ? ei.full : '';
    useRuleSet(T2.entId); T2.defProj = defaultProjOf(); go('tool-rules'); return;
  }
  const dr = e.target.closest('[data-delrule]');
  if (dr) {
    RULES = RULES.filter(r => r.id !== dr.dataset.delrule); saveRules(T2.entId, RULES);
    toast('规则已删除'); go('tool-rules'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;

  if (act === 't2reset') { Object.assign(T2, { step: 1, rows: null, result: null, file: null, map: {}, balPush: null, sniffNo: null, autoBind: null }); go('t2'); }
  else if (act === 't2run') {
    T2.entId = ($('entSel2') || {}).value || T2.entId;
    const ei = ENTITIES.find(x => x.id === T2.entId);
    T2.ent = ei ? ei.full : '';
    T2.line = ($('lineSel') || {}).value || T2.line;
    t2SetAcct(($('acctSel') || {}).value || T2.acctId);
    T2.vchWord = ($('vchWord') || {}).value || '记';
    T2.defProj = ($('defProj') || {}).value || '';
    if (!T2.entId) { toast('请先选择这批流水属于哪个主体'); return; }
    if (!T2.acctId) { toast('请选择这批流水是哪个账户的——余额要回写到 T1 那个账户上', 4200); return; }
    if (!useRuleSet(T2.entId)) {
      toast('「' + T2.ent + '」还没有规则库，全部会进例外', 4200);
    }
    runRules(); t2PushBalance();
    T2.step = 3; T2.tab = T2.result.ex.length ? 'ex' : 'ok'; go('t2');
  }
  else if (act === 't2ex') { T2.step = 4; go('t2'); }
  else if (act === 't2back3') { T2.step = 3; go('t2'); }
  else if (act === 't2applyfix') {
    const still = [];
    let fixed = 0, added = 0;
    T2.result.ex.forEach((r, i) => {
      const sel = document.querySelector(`[data-fix="${i}"]`);
      const save = document.querySelector(`[data-save="${i}"]`);
      if (sel && sel.value) {
        r.acct = sel.value; r.vmemo = r.memo || acctName(sel.value); r.warn = '';
        T2.result.ok.push(r); fixed++;
        // 存为规则：可按摘要，也可按对方户名。
        // 银行流水里「跨行汇款」「网转」这类摘要是交易类型、不含业务含义，
        // 这时只能按对方户名建规则。
        const how = save ? save.value : '';
        if (how) {
          const esc = s => s.replace(/[|\\^$*+?.()[\]{}]/g, '');
          const kw = how === 'opp' ? esc(r.opp).slice(0, 10) : esc(r.memo).slice(0, 4);
          if (kw) {
            RULES.unshift({
              id: uid(), kw, dir: r.dir, acct: sel.value,
              scope: how === 'opp' ? 'both' : undefined,
              memo: (how === 'opp' ? r.opp : r.memo).slice(0, 20),
              hits: 0, src: how === 'opp' ? '例外沉淀·按户名' : '例外沉淀·按摘要',
            });
            added++;
          }
        }
      } else still.push(r);
    });
    T2.result.ok.sort((x, y) => x.no - y.no);
    T2.result.ex = still;
    if (added) saveRules(T2.entId, RULES);
    toast(`已处理 ${fixed} 笔${added ? `，新增 ${added} 条规则` : ''}`);
    T2.step = 5; go('t2');
  }
  else if (act === 't2bindNo') {
    if (!T2.acctId || !T2.sniffNo) { toast('先选一个账户'); return; }
    if (typeof t1BindAcctNo === 'function' && t1BindAcctNo(T2.acctId, T2.sniffNo)) {
      t2SetAcct(T2.acctId);
      T2.autoBind = { accId: T2.acctId, ent: (t1AccById(T2.acctId) || {}).ent, name: (t1AccById(T2.acctId) || {}).name, no: T2.sniffNo };
      t2PushBalance();
      toast('卡号已记进 T1 台账，下次上传自动认出来', 4200); go('t2');
    } else toast('没能写进台账');
  }
  else if (act === 't2export') { T2.step = 5; go('t2'); }
  else if (act === 'dlVoucher') {
    const hdr = ['日期', '凭证字', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额', '主体', '业务线', '项目', '合同号', '对方户名', '流水号', '账号'];
    download(`凭证导入_${T2.ent}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([hdr].concat(vouchers())));
    const { ok, ex, total } = T2.result;
    addLog({
      time: new Date().toLocaleString('zh-CN'), file: T2.file.name, ent: T2.ent,
      total, ok: ok.length, ex: ex.length,
      rate: total ? Math.round(ok.length / total * 100) : 0, exported: 1
    });
    toast('凭证文件已下载，处理记录已留痕');
  }
  else if (act === 'dlEx') {
    const hdr = ['行号', '日期', '摘要', '对方户名', '方向', '金额', '未匹配原因'];
    const rows = T2.result.ex.map(r => [r.no, r.date, r.memo, r.opp, r.dir === 'in' ? '收' : '付', r.amt, r.why]);
    download(`例外清单_${T2.ent}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([hdr].concat(rows)));
    toast('例外清单已下载');
  }
  else if (act === 'exportRules') {
    const hdr = ['关键词', '方向', '科目编码', '科目名称', '凭证摘要', '命中次数', '来源'];
    download('T2规则库.csv', toCSV([hdr].concat(RULES.map(r => [r.kw, r.dir, r.acct, acctName(r.acct), r.memo || '', r.hits || 0, r.src || '自建']))));
    toast('规则库已导出');
  }
  else if (act === 'addRule') {
    const kw = prompt('关键词（支持正则，用 | 分隔多个）'); if (!kw) return;
    const acct = prompt('科目编码\n可选：' + ACCOUNTS().slice(0, 8).map(a => a[0]).join(' / ')); if (!acct) return;
    if (!ACCOUNTS().some(x => x[0] === acct)) { toast('科目编码不存在：' + acct); return; }
    const dir = (prompt('方向：in=收入 / out=支出 / any=不限', 'out') || 'out').trim();
    RULES.unshift({ id: uid(), kw, dir, acct, memo: '', hits: 0, src: '手工新增' });
    saveRules(T2.entId, RULES); toast('规则已新增'); go('tool-rules');
  }
  else if (act === 'clearLog') {
    if (confirm('确认清空全部处理记录？')) { saveLog([]); toast('已清空'); go('tool-log'); }
  }
});

$('filePick').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
$('themeBtn').addEventListener('click', () => {
  const r = document.documentElement, cur = r.getAttribute('data-theme');
  const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
  r.setAttribute('data-theme', (cur || (sys ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark');
});
/* 返回星逸平台工作台。
   优先用 URL 上的 ?from= （门户跳转时带过来），否则回退到本地门户地址。 */
const PORTAL_FALLBACK = 'http://localhost:5173/apps';
function portalUrl() {
  try {
    const from = new URLSearchParams(location.search).get('from');
    if (from) {
      const u = new URL(from, location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    }
  } catch (e) { /* 忽略非法参数 */ }
  return PORTAL_FALLBACK;
}
$('backPortal').addEventListener('click', e => {
  e.preventDefault();
  location.href = portalUrl();
});

/* 启动 */
$('curPeriod').textContent = new Date().toISOString().slice(0, 7);
go('home');

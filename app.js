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
      ['tool-list', '我的工具'], ['tool-rules', '规则库'], ['tool-log', '处理记录'], ['tool-plan', '开发排期'] ] },
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
const ENTITIES = ['澳乐', '东蓓', '优栖', '瑞眠', '牧童', '新艺文化', '数智云仓', '云帕', '云迪', '云基', '云湃', '集包厂', '昌记云泰'];
const LINES = ['电商', '集包', '物业收租', '手机租赁', '出租屋', '设备租赁', '塑料制造'];

/* 科目表（可扩展） */
const ACCOUNTS = [
  ['1002', '银行存款'],
  ['1122', '应收账款'], ['1221', '其他应收款'], ['1221.01', '其他应收款-内部往来'],
  ['2202', '应付账款'], ['2241', '其他应付款'], ['2211', '应付职工薪酬'], ['2211.02', '应付职工薪酬-社保公积金'],
  ['2221', '应交税费'], ['2203', '预收账款'], ['1123', '预付账款'],
  ['6001', '主营业务收入'], ['6051', '其他业务收入'],
  ['6401', '主营业务成本'],
  ['6601', '销售费用'], ['6601.01', '销售费用-推广费'], ['6601.02', '销售费用-运输费'],
  ['6602', '管理费用'], ['6602.01', '管理费用-办公费'], ['6602.02', '管理费用-水电费'], ['6602.03', '管理费用-租赁费'],
  ['6603', '财务费用'], ['6603.01', '财务费用-手续费'], ['6603.02', '财务费用-利息'],
];
const acctName = code => (ACCOUNTS.find(a => a[0] === code) || [, ''])[1];

/* ============ 规则库 ============ */
const RULE_KEY = 'fsc_t2_rules_v1';
const LOG_KEY = 'fsc_t2_log_v1';

const PRESET_RULES = [
  { kw: '手续费|服务费|账户管理费|工本费|短信费', dir: 'out', acct: '6603.01', memo: '银行手续费' },
  { kw: '利息|结息|计息', dir: 'in', acct: '6603.02', memo: '利息收入' },
  { kw: '代发工资|工资|薪金|劳务费发放', dir: 'out', acct: '2211', memo: '发放工资' },
  { kw: '社保|医保|公积金|养老保险', dir: 'out', acct: '2211.02', memo: '缴纳社保公积金' },
  { kw: '税|扣税|税收缴款|增值税|所得税', dir: 'out', acct: '2221', memo: '缴纳税费' },
  { kw: '货款|采购|付供应商|材料款', dir: 'out', acct: '2202', memo: '支付货款' },
  { kw: '物流|快递|运费|运输', dir: 'out', acct: '6601.02', memo: '支付物流费' },
  { kw: '推广|广告|投流|营销', dir: 'out', acct: '6601.01', memo: '支付推广费' },
  { kw: '房租|租金|物业费', dir: 'out', acct: '6602.03', memo: '支付租金' },
  { kw: '电费|水费|水电', dir: 'out', acct: '6602.02', memo: '支付水电费' },
  { kw: '报销|备用金', dir: 'out', acct: '6602', memo: '费用报销' },
  { kw: '内部|调拨|往来|借支', dir: 'any', acct: '1221.01', memo: '主体间往来', warn: '主体间调拨须走专用审批流' },
  { kw: '货款|销售|回款|收款|结算', dir: 'in', acct: '1122', memo: '收回货款' },
  { kw: '租金|房租', dir: 'in', acct: '6051', memo: '收取租金' },
  { kw: '退款|退货|退回', dir: 'in', acct: '1122', memo: '退款退回' },
];

function loadRules() {
  try {
    const s = localStorage.getItem(RULE_KEY);
    if (s) return JSON.parse(s);
  } catch (e) { /* 忽略 */ }
  const init = PRESET_RULES.map(r => Object.assign({ id: uid(), hits: 0, src: '预置' }, r));
  saveRules(init); return init;
}
function saveRules(r) { try { localStorage.setItem(RULE_KEY, JSON.stringify(r)); } catch (e) { toast('规则保存失败：浏览器存储空间不足'); } }
let RULES = loadRules();

function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 200))); } catch (e) { /* 忽略 */ } }
function addLog(entry) { const l = loadLog(); l.unshift(entry); saveLog(l); }

/* ============ T2 状态 ============ */
const T2 = {
  step: 1, rows: null, headRow: 0, map: {}, file: null,
  ent: '', line: '', acctNo: '', vchWord: '银',
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

function autoMap(headerCells) {
  const map = {};
  const norm = s => String(s || '').replace(/\s|　/g, '');
  headerCells.forEach((h, i) => {
    const c = norm(h); if (!c) return;
    for (const f of FIELDS) {
      if (map[f.k] !== undefined) continue;
      if (f.alias.some(a => c === a)) { map[f.k] = i; return; }
    }
  });
  // второй проход：包含匹配
  headerCells.forEach((h, i) => {
    const c = norm(h); if (!c) return;
    if (Object.values(map).includes(i)) return;
    for (const f of FIELDS) {
      if (map[f.k] !== undefined) continue;
      if (f.alias.some(a => c.includes(a))) { map[f.k] = i; return; }
    }
  });
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
    const hit = RULES.find(rule => {
      if (rule.dir !== 'any' && rule.dir !== dir) return false;
      const re = new RegExp(rule.kw);
      if (re.test(memo)) { hitField = '摘要'; return true; }
      if (rule.scope === 'both' && opp && re.test(opp)) { hitField = '对方户名'; return true; }
      return false;
    });
    if (!hit) { rec.why = '摘要未命中任何规则'; ex.push(rec); return; }
    rec.rule = hit; rec.acct = hit.acct; rec.vmemo = hit.memo || memo; rec.hitField = hitField;
    rec.warn = hit.warn || '';
    ok.push(rec);
  });
  T2.result = { ok, ex, total: body.length };
  // 命中计数
  ok.forEach(r => { const t = RULES.find(x => x.id === r.rule.id); if (t) t.hits = (t.hits || 0) + 1; });
  saveRules(RULES);
}

/* 生成凭证行 */
function vouchers() {
  const { ok } = T2.result;
  const out = [];
  ok.forEach((r, i) => {
    const no = String(i + 1).padStart(4, '0');
    const bank = ['1002', '银行存款'];
    const other = [r.acct, acctName(r.acct)];
    const pair = r.dir === 'in'
      ? [[bank, r.amt, 0], [other, 0, r.amt]]
      : [[other, r.amt, 0], [bank, 0, r.amt]];
    pair.forEach(([a, d, c]) => {
      out.push([r.date, T2.vchWord, no, r.vmemo, a[0], a[1],
        d ? d.toFixed(2) : '', c ? c.toFixed(2) : '',
        T2.ent, T2.line, '', '', r.opp, r.ref, T2.acctNo]);
    });
  });
  return out;
}

/* ============ 界面：工具箱 ============ */
const TOOLS = [
  { id: 'T2', n: '银行流水转凭证', save: 24, ready: 1, own: '出纳 · 总账',
    d: '网银导出的流水，自动归一化 + 规则匹配科目，生成可导入账务系统的凭证文件' },
  { id: 'T3', n: '对账单核对器', save: 22, own: '会计 · 通用', d: '我方台账与对方对账单逐笔勾对，输出差异清单' },
  { id: 'T1', n: '资金日报生成器', save: 20, own: '出纳', d: '多主体余额汇总、覆盖倍数红线、一键生成日报' },
  { id: 'T5', n: '商品对码工具', save: 0, own: '会计', d: '销售端与采购端商品名归一化匹配，产出对码表' },
  { id: 'T4', n: '日损益速算表', save: 35, own: '会计', d: '平台数据归集算毛利，异常标记' },
  { id: 'T8', n: '申报数据汇总表', save: 12, own: '税务会计', d: '多主体申报数据汇集与账表税比对' },
  { id: 'T6', n: '发票查重与打标', save: 7, own: '会计', d: '进项票查重、按合同号打标四级维度' },
  { id: 'T9', n: '社保增减员台账', save: 0, own: '税务会计', d: '人员异动登记与超期预警' },
  { id: 'T10', n: '盘点差异表', save: 4, own: '项目财务', d: '账面与实盘差异、强制归因' },
  { id: 'T7', n: '月结检查清单', save: 0, own: '全员', d: '月结 24 项清单执行与留痕' },
];

const S = {};

S['home'] = () => head('工作台', '一期已上线「工具箱」。其余功能域为二期规划，点击可查看规划说明。', '')
  + kpis([
    { k: '已上线工具', v: '1', u: '个', t: 'g', d: 'T2 银行流水转凭证' },
    { k: '规划中工具', v: '9', u: '个' },
    { k: '本工具月省', v: '24', u: 'h', t: 'g', d: '出纳凭证录入' },
    { k: '规则库', v: String(RULES.length), u: '条', d: '可持续累积' },
    { k: '累计处理', v: String(loadLog().length), u: '批次' },
  ])
  + `<div class="note"><b>一期范围：</b>系统整体结构已搭好（9 个功能域），功能上只开放<b>工具箱</b>。其余模块按方案二期起逐个开发，点进去能看到各自的规划说明与对应模块编号。</div>`
  + card('快速开始', `<div style="padding:14px">
      <div class="tgrid">${toolCard(TOOLS[0])}</div>
    </div>`);

function toolCard(t) {
  const soon = !t.ready;
  return `<button class="tcard ${soon ? 'soon' : ''}" ${t.ready ? `data-go="t2"` : ''}>
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
  const rows = RULES.map(r => [
    `<span class="code">${H(r.kw.length > 26 ? r.kw.slice(0, 26) + '…' : r.kw)}</span>`,
    r.dir === 'in' ? pill('收入', 'ok') : r.dir === 'out' ? pill('支出', 'wa') : pill('不限', 'mu'),
    `<span class="code">${r.acct}</span> ${H(acctName(r.acct))}`,
    H(r.memo || ''),
    `<span class="num">${r.hits || 0}</span>`,
    H(r.src || '自建'),
    `<button class="btn sm" data-delrule="${r.id}">删除</button>`
  ]);
  return head('规则库', '摘要关键词 → 会计科目。每处理一次例外就可以存成规则，规则库越养越准。', '工具箱 · T2',
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

function t2Step2() {
  const rows = T2.rows, hr = T2.headRow;
  const header = rows[hr] || [];
  const preview = rows.slice(hr + 1, hr + 4);
  const opts = i => header.map((h, j) =>
    `<option value="${j}" ${T2.map[i] === j ? 'selected' : ''}>${H(String(h || '(空)').slice(0, 18))}</option>`).join('');
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
    ${cardp('这批流水属于', `
      <div class="cols c2">
        <div><div class="field"><label class="fl">主体 <span class="red">*</span></label>
          <select id="entSel2"><option value="">— 请选择 —</option>${ENTITIES.map(e => `<option ${T2.ent === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">业务线</label>
          <select id="lineSel"><option value="">— 不指定 —</option>${LINES.map(e => `<option ${T2.line === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div></div>
        <div><div class="field"><label class="fl">银行账号（备注用）</label><input type="text" id="acctNo" value="${H(T2.acctNo)}" placeholder="如 6222...1234"></div>
          <div class="field"><label class="fl">凭证字</label><input type="text" id="vchWord" value="${H(T2.vchWord)}"></div></div>
      </div>`)}
    <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
      <button class="btn pri" data-act="t2run" ${ready ? '' : 'disabled'}>下一步：匹配规则</button>
    </div>
    ${ready ? '' : `<div class="note c" style="margin-top:11px"><b>还不能继续：</b>日期、摘要、以及至少一个金额列（收入/支出，或发生额）必须对应上。</div>`}`;
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
  const acctOpts = ACCOUNTS.map(a => `<option value="${a[0]}">${a[0]} ${a[1]}</option>`).join('');
  const rows = ex.map((r, i) => [
    r.no, r.date || '<span class="red">缺失</span>', H(r.memo.slice(0, 28)), H(r.opp.slice(0, 14)),
    r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'), money(r.amt),
    `<select data-fix="${i}"><option value="">— 跳过 —</option>${acctOpts}</select>`,
    `<label style="font-size:11px;color:var(--text-2);white-space:nowrap"><input type="checkbox" data-save="${i}"> 存为规则</label>`
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
  if (id === 't2') CURD = 'tools';
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
    T2.map = autoMap(rows[T2.headRow] || []);
    T2.step = 2;
    go('t2');
    const got = Object.keys(T2.map).length;
    toast(`读到 ${rows.length} 行，自动识别 ${got} 个字段`);
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
    T2.map = autoMap(T2.rows[T2.headRow] || []);
    go('t2');
  };
  document.querySelectorAll('[data-map]').forEach(sel => {
    sel.onchange = () => {
      const k = sel.dataset.map;
      if (sel.value === '') delete T2.map[k]; else T2.map[k] = +sel.value;
      go('t2');
    };
  });
  ['entSel2:ent', 'lineSel:line', 'acctNo:acctNo', 'vchWord:vchWord'].forEach(p => {
    const [id, key] = p.split(':');
    const el = $(id);
    if (el) el.onchange = () => { T2[key] = el.value; if (id === 'entSel2') go('t2'); };
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
  const dr = e.target.closest('[data-delrule]');
  if (dr) {
    RULES = RULES.filter(r => r.id !== dr.dataset.delrule); saveRules(RULES);
    toast('规则已删除'); go('tool-rules'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;

  if (act === 't2reset') { Object.assign(T2, { step: 1, rows: null, result: null, file: null, map: {} }); go('t2'); }
  else if (act === 't2run') {
    T2.ent = ($('entSel2') || {}).value || T2.ent;
    T2.line = ($('lineSel') || {}).value || T2.line;
    T2.acctNo = ($('acctNo') || {}).value || '';
    T2.vchWord = ($('vchWord') || {}).value || '银';
    if (!T2.ent) { toast('请先选择这批流水属于哪个主体'); return; }
    runRules(); T2.step = 3; T2.tab = T2.result.ex.length ? 'ex' : 'ok'; go('t2');
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
        if (save && save.checked && r.memo) {
          const kw = r.memo.replace(/[|\\^$*+?.()[\]{}]/g, '').slice(0, 4);
          if (kw) {
            RULES.unshift({ id: uid(), kw, dir: r.dir, acct: sel.value, memo: r.memo.slice(0, 20), hits: 0, src: '例外沉淀' });
            added++;
          }
        }
      } else still.push(r);
    });
    T2.result.ok.sort((x, y) => x.no - y.no);
    T2.result.ex = still;
    if (added) saveRules(RULES);
    toast(`已处理 ${fixed} 笔${added ? `，新增 ${added} 条规则` : ''}`);
    T2.step = 5; go('t2');
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
    const acct = prompt('科目编码（如 6602）\n可选：' + ACCOUNTS.slice(0, 8).map(a => a[0]).join(' / ')); if (!acct) return;
    if (!ACCOUNTS.some(x => x[0] === acct)) { toast('科目编码不存在：' + acct); return; }
    const dir = (prompt('方向：in=收入 / out=支出 / any=不限', 'out') || 'out').trim();
    RULES.unshift({ id: uid(), kw, dir, acct, memo: '', hits: 0, src: '手工新增' });
    saveRules(RULES); toast('规则已新增'); go('tool-rules');
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

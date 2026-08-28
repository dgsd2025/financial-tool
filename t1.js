/* T1 资金日报生成器
   账户台账预置 → 每日只填变动的 → 三级汇总 + 覆盖倍数红线 → 一键生成钉钉文本
   诚实定位：登网银抄余额这步省不掉，工具省的是抄完之后的汇总/算/排版/发。
   依赖 app.js 的工具函数。 */
'use strict';

const T1_ACC_KEY = 'fsc_t1_accounts_v1';
const T1_DAY_KEY = 'fsc_t1_daily_v1';
const T1_CFG_KEY = 'fsc_t1_cfg_v1';

/* 预置账户台账（可在界面里增删改） */
const T1_PRESET = [
  // 主体, 账户/平台名, 类型, 月固定支出
  ['澳乐', '工行基本户', 'bank'], ['澳乐', '建行一般户', 'bank'], ['澳乐', '招行一般户', 'bank'],
  ['澳乐', '中行一般户', 'bank'], ['澳乐', '农行一般户', 'bank'], ['澳乐', '交行一般户', 'bank'],
  ['澳乐', '抖店账户', 'plat'], ['澳乐', '拼多多账户', 'plat'], ['澳乐', '天猫账户', 'plat'],
  ['东蓓', '工行基本户', 'bank'], ['东蓓', '建行一般户', 'bank'], ['东蓓', '招行一般户', 'bank'],
  ['东蓓', '抖店账户', 'plat'], ['东蓓', '拼多多账户', 'plat'], ['东蓓', '京东账户', 'plat'],
  ['优栖', '工行基本户', 'bank'], ['优栖', '建行一般户', 'bank'],
  ['优栖', '抖店账户', 'plat'], ['优栖', '拼多多账户', 'plat'],
  ['瑞眠', '工行基本户', 'bank'], ['瑞眠', '招行一般户', 'bank'], ['瑞眠', '平台账户', 'plat'],
  ['数智云仓', '招行基本户', 'bank'], ['数智云仓', '工行一般户', 'bank'], ['数智云仓', '智慧园区收款', 'plat'],
  ['云帕', '工行基本户', 'bank'], ['云帕', '建行一般户', 'bank'],
  ['云迪', '工行基本户', 'bank'], ['云迪', '招行一般户', 'bank'],
  ['云基', '工行基本户', 'bank'], ['云基', '建行一般户', 'bank'],
  ['云湃', '工行基本户', 'bank'], ['云湃', '招行一般户', 'bank'],
  ['集包厂', '工行基本户', 'bank'], ['集包厂', '建行一般户', 'bank'], ['集包厂', '中行一般户', 'bank'],
  ['昌记云泰', '工行基本户', 'bank'], ['昌记云泰', '招行一般户', 'bank'],
  ['牧童', '工行基本户', 'bank'], ['牧童', '建行一般户', 'bank'],
  ['新艺文化', '工行基本户', 'bank'], ['新艺文化', '招行一般户', 'bank'],
];
/* 各主体月固定支出（用于算覆盖倍数，可在台账里改） */
const T1_FIXED = {
  澳乐: 1860000, 东蓓: 1120000, 优栖: 520000, 瑞眠: 340000,
  数智云仓: 680000, 云帕: 210000, 云迪: 160000, 云基: 130000, 云湃: 110000,
  集包厂: 920000, 昌记云泰: 120000, 牧童: 90000, 新艺文化: 140000,
};

const T1 = { date: new Date().toISOString().slice(0, 10), view: 'daily', filterEnt: '', imp: null };

function t1LoadAcc() {
  try { const s = JSON.parse(localStorage.getItem(T1_ACC_KEY) || 'null'); if (s && s.length) return s; } catch (e) { /* 忽略 */ }
  const init = T1_PRESET.map((p, i) => ({ id: 'A' + String(i + 1).padStart(3, '0'), ent: p[0], name: p[1], type: p[2], no: '', on: 1 }));
  t1SaveAcc(init); return init;
}
function t1SaveAcc(a) { try { localStorage.setItem(T1_ACC_KEY, JSON.stringify(a)); } catch (e) { toast('账户台账保存失败'); } }
let T1_ACC = t1LoadAcc();

function t1LoadCfg() {
  try { const s = JSON.parse(localStorage.getItem(T1_CFG_KEY) || 'null'); if (s) return s; } catch (e) { /* 忽略 */ }
  return { ratio: 1.5, fixed: { ...T1_FIXED } };
}
function t1SaveCfg(c) { try { localStorage.setItem(T1_CFG_KEY, JSON.stringify(c)); } catch (e) { /* 忽略 */ } }
let T1_CFG = t1LoadCfg();

function t1LoadDay() { try { return JSON.parse(localStorage.getItem(T1_DAY_KEY) || '{}'); } catch (e) { return {}; } }
function t1SaveDay(d) { try { localStorage.setItem(T1_DAY_KEY, JSON.stringify(d)); } catch (e) { toast('余额保存失败'); } }

const t1Prev = date => {
  const all = Object.keys(t1LoadDay()).filter(d => d < date).sort();
  return all.length ? all[all.length - 1] : null;
};

/** 取某日各账户的有效余额：今日填了用今日；没填则沿用最近一次，并标记 stale */
function t1Effective(date) {
  const day = t1LoadDay();
  const today = day[date] || {};
  const hist = Object.keys(day).filter(d => d <= date).sort();
  const out = {};
  T1_ACC.filter(a => a.on).forEach(a => {
    if (today[a.id] !== undefined) { out[a.id] = { v: +today[a.id], stale: 0, from: date }; return; }
    for (let i = hist.length - 1; i >= 0; i--) {
      const d = hist[i];
      if (day[d] && day[d][a.id] !== undefined) { out[a.id] = { v: +day[d][a.id], stale: 1, from: d }; return; }
    }
    out[a.id] = { v: null, stale: 0, from: null };  // 从未有数
  });
  return out;
}

/** 按主体汇总 */
function t1ByEnt(date) {
  const eff = t1Effective(date), prevD = t1Prev(date);
  const prevEff = prevD ? t1Effective(prevD) : null;
  const m = {};
  T1_ACC.filter(a => a.on).forEach(a => {
    const e = m[a.ent] = m[a.ent] || { ent: a.ent, bal: 0, prev: 0, n: 0, stale: 0, miss: 0, accs: [] };
    const v = eff[a.id];
    if (v.v === null) { e.miss++; }
    else { e.bal += v.v; e.n++; if (v.stale) e.stale++; }
    if (prevEff && prevEff[a.id] && prevEff[a.id].v !== null) e.prev += prevEff[a.id].v;
    e.accs.push({ ...a, ...v });
  });
  Object.values(m).forEach(e => {
    e.delta = prevEff ? e.bal - e.prev : null;
    e.fixed = T1_CFG.fixed[e.ent] || 0;
    // 有账户从未录入时余额是不全的，此时算出来的覆盖倍数偏低且不可信，
    // 不报红线——否则会把「没抄数」误报成「快没钱了」。
    e.incomplete = e.miss > 0;
    e.cover = (e.fixed && !e.incomplete) ? e.bal / e.fixed : null;
    e.red = e.cover !== null && e.cover < T1_CFG.ratio;
  });
  return Object.values(m).sort((a, b) => b.bal - a.bal);
}

const wan = n => (n / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ============ 给 T2 用的接口 ============ */
/* 账户主数据只有 T1 这一份，T2 不自己存账户，只通过下面两个函数引用。
   放在这里是为了让「谁在用 T1 的账户」一眼可见——改这两个函数前先看 T2 的调用点。 */

/** 某主体的在管账户列表（T2 步骤 2 的账户下拉用）。ent 传主体简称，如「优栖」 */
function t1Accounts(ent) {
  return T1_ACC.filter(a => a.on && (!ent || a.ent === ent));
}
/** 按 id 取账户 */
const t1AccById = id => T1_ACC.find(a => a.id === id) || null;

/* 余额来源留痕：哪些余额是 T2 流水带进来的，T1 界面上要标出来，
   否则用户分不清哪个数是自己抄的、哪个是机器填的。 */
const T1_SRC_KEY = 'fsc_t1_balsrc_v1';
function t1LoadSrc() { try { return JSON.parse(localStorage.getItem(T1_SRC_KEY) || '{}'); } catch (e) { return {}; } }
function t1SaveSrc(s) { try { localStorage.setItem(T1_SRC_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ } }

/**
 * 把某账户某天的余额写进 T1。
 * 不传 force 时遇到「那天已有值且和新值对不上」不写，返回 conflict 让调用方去问用户，
 * 避免静默盖掉手工抄的数。
 * @returns {{ok:boolean, conflict?:boolean, old?:number, val?:number, reason?:string}}
 */
function t1PutBalance(accId, date, val, from, force) {
  const acc = t1AccById(accId);
  if (!acc) return { ok: false, reason: '账户不存在：' + accId };
  if (!date || isNaN(Number(val))) return { ok: false, reason: '日期或金额无效' };
  const day = t1LoadDay();
  const d = day[date] || (day[date] = {});
  const old = d[accId];
  if (old !== undefined && Math.abs(old - val) > 0.005 && !force) {
    return { ok: false, conflict: true, old, val };
  }
  d[accId] = Number(val);
  t1SaveDay(day);
  const src = t1LoadSrc();
  (src[date] || (src[date] = {}))[accId] = from || 'T2';
  t1SaveSrc(src);
  return { ok: true, val: Number(val) };
}
/** 该余额是不是 T2 带进来的 */
const t1BalFrom = (date, accId) => (t1LoadSrc()[date] || {})[accId] || '';

/* ============ 台账导入 ============ */
/* 一个入口两件事：导账户台账；表里带余额列就顺手把余额也导了。
   只写 T1 自己的三份数据（账户台账 / 月固定支出 / 每日余额），不碰别的模块。 */

const T1_IMP_ALIAS = {
  ent:   ['主体', '公司', '单位', '企业', '所属'],
  name:  ['账户名', '账户', '平台', '户名', '开户行'],
  no:    ['账号', '卡号', '银行账号'],
  type:  ['类型', '性质', '类别'],
  fixed: ['月固定支出', '固定支出', '月支出', '月均支出'],
  bal:   ['余额', '当前余额', '账户余额'],
  date:  ['日期', '余额日期', '数据日期'],
};
const T1_IMP_FIELDS = [
  ['ent', '主体', 1], ['name', '账户 / 平台', 1], ['no', '账号', 0],
  ['type', '类型', 0], ['fixed', '月固定支出', 0], ['bal', '余额', 0], ['date', '余额日期', 0],
];

/* 新账户编号取现有最大序号 +1。不能用 length —— 删过账户会撞号 */
function t1NextSeq() {
  let max = 0;
  T1_ACC.forEach(a => { const m = /^A(\d+)$/.exec(a.id || ''); if (m) max = Math.max(max, +m[1]); });
  return max + 1;
}
const t1MkId = n => 'A' + String(n).padStart(3, '0');
const t1Norm = v => String(v == null ? '' : v).replace(/\s|　/g, '');
const t1ImpType = v => (/平台|电商|店|网店|plat/i.test(String(v)) ? 'plat' : 'bank');

function t1ImpAutoMap(header) {
  const cells = header.map(t1Norm);
  const map = {}, used = new Set();
  // 先精确后包含，避免「账户名」被「账户」抢走
  [1, 0].forEach(exact => {
    T1_IMP_FIELDS.forEach(([k]) => {
      if (map[k] !== undefined) return;
      for (let i = 0; i < cells.length; i++) {
        if (used.has(i) || !cells[i]) continue;
        const hit = T1_IMP_ALIAS[k].some(a => (exact ? cells[i] === a : cells[i].includes(a)));
        if (hit) { map[k] = i; used.add(i); break; }
      }
    });
  });
  return map;
}

async function t1ImpLoad(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const allAlias = Object.keys(T1_IMP_ALIAS).reduce((a, k) => a.concat(T1_IMP_ALIAS[k]), []);
    const headRow = XLSXLite.findHeaderRow(rows, allAlias);
    T1.imp = { fileName: file.name, rows, headRow, map: t1ImpAutoMap(rows[headRow] || []), offStale: 0 };
    go('t1-imp');
    toast(`读到 ${rows.length} 行，表头定在第 ${headRow + 1} 行`);
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

/* 账户匹配：账号是唯一的，优先按账号认；没账号才退回「主体+账户名」。
   认上了就复用原 id —— 历史余额按 id 存，换了 id 等于把历史全丢了。 */
function t1FindAcc(ent, name, no) {
  if (no) { const byNo = T1_ACC.find(a => a.no && t1Norm(a.no) === t1Norm(no)); if (byNo) return byNo; }
  return T1_ACC.find(a => t1Norm(a.ent) === t1Norm(ent) && t1Norm(a.name) === t1Norm(name)) || null;
}

/* 先算清楚要改什么再落盘。预览和真正导入共用这一份，避免两边算法走样。 */
function t1ImpPlan() {
  const im = T1.imp;
  const out = { add: [], upd: [], same: [], bad: [], dup: 0, fixed: {}, bals: [], keys: new Set() };
  if (!im || im.map.ent === undefined || im.map.name === undefined) return out;
  const seen = new Set();
  im.rows.slice(im.headRow + 1).forEach((r, i) => {
    const cell = k => (im.map[k] === undefined ? '' : String(r[im.map[k]] == null ? '' : r[im.map[k]]).trim());
    const ent = cell('ent'), name = cell('name'), no = cell('no');
    const blank = !r.some(c => String(c == null ? '' : c).trim());
    if (!ent || !name) {
      if (!blank) out.bad.push({ no: im.headRow + i + 2, ent, name, why: !ent ? '缺主体' : '缺账户名' });
      return;
    }
    const key = t1Norm(ent) + '' + t1Norm(name);
    if (seen.has(key)) { out.dup++; return; }
    seen.add(key); out.keys.add(key);

    const type = im.map.type === undefined ? null : t1ImpType(cell('type'));
    if (im.map.fixed !== undefined) {
      const f = Number(cell('fixed').replace(/[,，¥￥]/g, ''));
      if (!isNaN(f) && f > 0 && out.fixed[ent] === undefined) out.fixed[ent] = f;
    }
    const hit = t1FindAcc(ent, name, no);
    if (!hit) out.add.push({ ent, name, no, type: type || 'bank' });
    else {
      const chg = [];
      if (no && t1Norm(hit.no) !== t1Norm(no)) chg.push('账号');
      if (type && hit.type !== type) chg.push('类型');
      if (!hit.on) chg.push('重新启用');
      if (t1Norm(hit.name) !== t1Norm(name)) chg.push('账户名');
      if (chg.length) out.upd.push({ id: hit.id, ent, name, no, type, chg });
      else out.same.push({ ent, name });
    }
    // 余额列：有值才导，没有就只导台账
    if (im.map.bal !== undefined) {
      const v = Number(cell('bal').replace(/[,，¥￥]/g, ''));
      if (cell('bal') !== '' && !isNaN(v)) {
        const d = im.map.date !== undefined && cell('date') ? normDate(cell('date')) : T1.date;
        out.bals.push({ key, ent, name, no, date: d, val: v });
      }
    }
  });
  return out;
}

function t1ImpApply() {
  const plan = t1ImpPlan();
  let seq = t1NextSeq();
  const idOf = {};
  plan.add.forEach(a => {
    const id = t1MkId(seq++);
    T1_ACC.push({ id, ent: a.ent, name: a.name, type: a.type, no: a.no || '', on: 1 });
    idOf[t1Norm(a.ent) + '' + t1Norm(a.name)] = id;
  });
  plan.upd.forEach(u => {
    const a = T1_ACC.find(x => x.id === u.id);
    if (!a) return;
    if (u.no) a.no = u.no;
    if (u.type) a.type = u.type;
    a.name = u.name; a.on = 1;
    idOf[t1Norm(u.ent) + '' + t1Norm(u.name)] = a.id;
  });
  plan.same.forEach(s => {
    const a = t1FindAcc(s.ent, s.name, '');
    if (a) idOf[t1Norm(s.ent) + '' + t1Norm(s.name)] = a.id;
  });
  // 表里没有的在管账户 → 停用而不是删除，历史余额一律保留
  let off = 0;
  if (T1.imp.offStale) {
    T1_ACC.forEach(a => {
      if (a.on && !plan.keys.has(t1Norm(a.ent) + '' + t1Norm(a.name))) { a.on = 0; off++; }
    });
  }
  Object.keys(plan.fixed).forEach(e => { T1_CFG.fixed[e] = plan.fixed[e]; });
  t1SaveAcc(T1_ACC); t1SaveCfg(T1_CFG);

  // 余额：导入的表是用户自己给的口径，直接写；来源标 T1导入，跟 T2 流水分得开
  let nb = 0;
  plan.bals.forEach(b => {
    const id = idOf[b.key]; if (!id) return;
    if (t1PutBalance(id, b.date, b.val, 'T1导入', 1).ok) nb++;
  });

  T1.imp = null;
  toast(`导入完成：新增 ${plan.add.length} 户、更新 ${plan.upd.length} 户`
    + (nb ? `、余额 ${nb} 条` : '') + (off ? `、停用 ${off} 户` : ''), 4600);
  go('t1-acc');
}

function t1ImpTemplate() {
  download('账户台账导入模板.csv', toCSV([
    ['主体', '账户/平台', '账号', '类型', '月固定支出', '余额', '余额日期'],
    ['优栖', '建行基本户', '6215****1234', '银行', '520000', '130547.25', T1.date],
    ['优栖', '抖店账户', '', '平台', '', '', ''],
    ['澳乐', '工行基本户', '6222****5678', '银行', '1860000', '', ''],
  ]));
  toast('模板已下载');
}

/* ============ 界面 ============ */
S['t1'] = () => {
  const ents = t1ByEnt(T1.date);
  const tot = ents.reduce((s, e) => s + e.bal, 0);
  const prevD = t1Prev(T1.date);
  const totPrev = ents.reduce((s, e) => s + e.prev, 0);
  const delta = prevD ? tot - totPrev : null;
  const red = ents.filter(e => e.red);
  const staleN = ents.reduce((s, e) => s + e.stale, 0);
  const missN = ents.reduce((s, e) => s + e.miss, 0);
  const onN = T1_ACC.filter(a => a.on).length;

  const rows = ents.map(e => [
    `<b>${H(e.ent)}</b>`,
    `<span class="mono">${e.n}</span>${e.miss ? `<span class="red"> +${e.miss} 缺</span>` : ''}`,
    wan(e.bal),
    e.delta === null ? '<span class="mut">—</span>'
      : `<span class="${e.delta >= 0 ? 'grn' : 'red'}">${e.delta >= 0 ? '+' : ''}${wan(e.delta)}</span>`,
    e.fixed ? wan(e.fixed) : '<span class="mut">未设</span>',
    e.incomplete ? '<span class="mut" title="有账户未录入，余额不全">数据不全</span>'
      : e.cover === null ? '<span class="mut">—</span>'
      : `<b class="${e.red ? 'red' : ''}">${e.cover.toFixed(2)}</b>`,
    e.stale ? pill(`${e.stale} 户沿用昨日`, 'wa') : (e.miss ? pill(`${e.miss} 户无数`, 'cr') : pill('今日已更新', 'ok')),
  ]);

  return head('T1　资金日报生成器',
    '账户台账预置，每天只填<b>变动的</b>。汇总、覆盖倍数、红线、日报文本自动出。<b>登网银抄余额这步省不掉</b>——工具省的是抄完之后的活。',
    '工具箱 · 已上线',
    `<input type="date" id="t1date" value="${T1.date}">
     <button class="btn" data-t1go="acc">账户台账</button>
     <button class="btn" data-t1go="imp">导入</button>
     <button class="btn" data-t1go="entry">录入余额</button>
     <button class="btn pri" data-t1act="gen">生成日报</button>`)
    + kpis([
      { k: '账户总余额', v: wan(tot), u: '万' },
      { k: '较上一日', v: delta === null ? '—' : (delta >= 0 ? '+' : '') + wan(delta), u: delta === null ? '' : '万', t: delta === null ? '' : (delta >= 0 ? 'g' : 'c') },
      { k: '在管账户', v: String(onN), u: '个' },
      { k: '今日已更新', v: String(onN - staleN - missN), u: '个', t: 'g' },
      { k: '沿用昨日', v: String(staleN), u: '个', t: staleN ? 'w' : 'g' },
      { k: '红线预警', v: String(red.length), u: '户', t: red.length ? 'c' : 'g' },
    ])
    + (missN ? `<div class="note c"><b>${missN} 个账户从未录过余额</b>，没有计入合计。这些账户所属主体<b>不计算覆盖倍数、也不报红线</b>——余额不全时算出来的倍数偏低，会把「没抄数」误报成「快没钱了」。</div>` : '')
    + (staleN ? `<div class="note w"><b>${staleN} 个账户今天没更新，用的是上一次的余额。</b>日报里会单独列出来——沿用昨日的数和今天实抄的数不是一回事，收款人看到才好判断。</div>` : '')
    + (red.length ? `<div class="note c"><b>红线预警 ${red.length} 户：</b>${red.map(e => `${H(e.ent)}（覆盖倍数 ${e.cover.toFixed(2)}）`).join('、')}。低于阈值 ${T1_CFG.ratio} 倍，已在日报中标出。</div>` : '')
    + card('分主体资金分布', table(
      [{ t: '主体' }, { t: '账户数' }, { t: '余额（万）', n: 1 }, { t: '较上日（万）', n: 1 },
       { t: '月固定支出（万）', n: 1 }, { t: '覆盖倍数', n: 1 }, { t: '更新状态' }], rows,
      ['<b>合计</b>', `<b>${onN - missN}</b>`, `<b>${wan(tot)}</b>`,
       delta === null ? '—' : `<b>${delta >= 0 ? '+' : ''}${wan(delta)}</b>`, '', '', '']))
    + cardp('红线规则', `<div class="cols c2">
        <div class="field"><label class="fl">覆盖倍数阈值（余额 ÷ 月固定支出）</label>
          <input type="number" step="0.1" id="t1ratio" value="${T1_CFG.ratio}"></div>
        <div class="note" style="margin:0"><b>建议值 1.5 倍</b>——单主体活期余额低于当月固定支出的 1.5 倍时预警。这是方案第十二章待老板拍板的第 4 项，改了这里等于改了口径。</div>
      </div>`);
};

/* 录入 */
S['t1-entry'] = () => {
  const day = t1LoadDay(), today = day[T1.date] || {};
  const eff = t1Effective(T1.date);
  const ents = [...new Set(T1_ACC.filter(a => a.on).map(a => a.ent))];
  const list = T1.filterEnt ? ents.filter(e => e === T1.filterEnt) : ents;
  const blocks = list.map(ent => {
    const accs = T1_ACC.filter(a => a.on && a.ent === ent);
    const rows = accs.map(a => {
      const e = eff[a.id];
      const cur = today[a.id];
      const src = t1BalFrom(T1.date, a.id);
      const hint = e.v === null ? '<span class="red">从未录入</span>'
        : (cur !== undefined
          ? (src ? pill('来自 ' + src + ' 流水', 'ok') : pill('今日已填', 'ok'))
          : `<span class="mut">上次 ${H(e.from)}：${money(e.v)}</span>`);
      return [
        `${a.type === 'plat' ? '▣' : '▤'} ${H(a.name)}`
        + (a.no ? `<div class="mut" style="font-size:11px">${H(a.no)}</div>` : ''),
        `<input type="number" step="0.01" class="t1in" data-t1cell="${a.id}" value="${cur !== undefined ? cur : ''}" placeholder="${e.v !== null ? money(e.v) : '—'}">`,
        hint,
      ];
    });
    return card(`${ent}（${accs.length} 户）`, table(
      [{ t: '账户 / 平台' }, { t: '今日余额', n: 1 }, { t: '状态' }], rows));
  }).join('');

  return head('录入余额', `只填<b>今天变动过的</b>账户。留空 = 沿用上一次的余额，日报里会标出来。`, '工具箱 · T1',
    `<input type="date" id="t1date" value="${T1.date}">
     <select id="t1entFilter"><option value="">全部主体</option>${ents.map(e => `<option ${T1.filterEnt === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
     <button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn pri" data-t1act="save">保存</button>`)
    + `<div class="note"><b>为什么设计成「只填变动的」：</b>一般户、平台账户很多天不动，每天全填 47 个是浪费。留空自动沿用，但<b>沿用的会在日报里单独标注</b>——避免收报表的人把陈数当新数。</div>`
    + blocks;
};

/* 账户台账 */
S['t1-acc'] = () => {
  const rows = T1_ACC.map(a => [
    `<span class="code">${a.id}</span>`,
    `<input class="t1in wide" data-t1acc="${a.id}:ent" value="${H(a.ent)}">`,
    `<input class="t1in wide" data-t1acc="${a.id}:name" value="${H(a.name)}">`,
    `<input class="t1in wide" data-t1acc="${a.id}:no" value="${H(a.no || '')}" placeholder="选填">`,
    `<select data-t1acc="${a.id}:type"><option value="bank" ${a.type === 'bank' ? 'selected' : ''}>银行</option><option value="plat" ${a.type === 'plat' ? 'selected' : ''}>平台</option></select>`,
    `<label style="font-size:11px;white-space:nowrap"><input type="checkbox" data-t1on="${a.id}" ${a.on ? 'checked' : ''}> 在管</label>`,
    `<button class="btn sm" data-t1del="${a.id}">删除</button>`,
  ]);
  const ents = [...new Set(T1_ACC.map(a => a.ent))];
  const fixRows = ents.map(e => [
    H(e),
    `<input type="number" step="1000" class="t1in wide" data-t1fix="${H(e)}" value="${T1_CFG.fixed[e] || 0}">`,
    `<span class="mut">${wan(T1_CFG.fixed[e] || 0)} 万</span>`,
  ]);
  return head('账户台账', `在管 <b>${T1_ACC.filter(a => a.on).length}</b> / 共 ${T1_ACC.length} 个。改完点保存。`, '工具箱 · T1',
    `<button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn" data-t1go="imp">导入台账</button>
     <button class="btn" data-t1act="addAcc">+ 新增账户</button>
     <button class="btn pri" data-t1act="saveAcc">保存台账</button>`)
    + `<div class="note"><b>预置了 ${T1_PRESET.length} 个账户</b>（按访谈里 47 户的结构估的），实际户名和数量请按你们真实情况改。<b>停用的账户不进日报</b>，但历史数据保留。</div>`
    + `<div class="note"><b>账号填了才能在 T2 里选到这个账户。</b>T2 导流水时从这张台账选账户——账户主数据只有这一份，两边永远对得上。填了账号的账户，凭证里的银行存款科目也靠它自动对上。</div>`
    + card('账户', table(
      [{ t: '编号' }, { t: '主体' }, { t: '账户 / 平台' }, { t: '账号' }, { t: '类型' }, { t: '状态' }, { t: '' }], rows))
    + card('各主体月固定支出（算覆盖倍数用）', table(
      [{ t: '主体' }, { t: '月固定支出（元）', n: 1 }, { t: '折合' }], fixRows));
};

/* 导入台账 */
S['t1-imp'] = () => {
  const im = T1.imp;
  const tools = `<button class="btn" data-t1go="acc">← 返回台账</button>
     <button class="btn" data-t1act="impTpl">下载模板</button>`;

  if (!im) {
    return head('导入账户台账', '一张表把账户建好。<b>带余额列就顺手把余额也导了</b>——不带就只导台账。', '工具箱 · T1', tools)
      + cardp('选择文件', `
        <input type="file" id="t1file" accept=".xlsx,.csv,.txt">
        <div class="note" style="margin-top:11px"><b>表里至少要有「主体」和「账户/平台」两列</b>，其余都是选填：
          账号（填了 T2 才能按账号认账户）、类型（银行/平台）、月固定支出、余额、余额日期。
          列名不用跟模板一字不差，认得出就行；认错了下一步能手动改。</div>
        <div class="note"><b>已有账户不会被重建。</b>按账号认，没账号就按「主体+账户名」认——认上了复用原编号，
          历史余额是按编号存的，换编号等于把历史丢了。</div>`);
  }

  const header = im.rows[im.headRow] || [];
  const preview = im.rows.slice(im.headRow + 1, im.headRow + 4);
  const sampleOf = j => {
    const v = preview.map(r => r && r[j]).find(x => String(x == null ? '' : x).trim() !== '');
    return v === undefined ? '' : ' ＝ ' + String(v).slice(0, 10);
  };
  const opts = k => header.map((h, j) =>
    `<option value="${j}" ${im.map[k] === j ? 'selected' : ''}>第${j + 1}列 ${H(String(h || '(空)').slice(0, 14))}${H(sampleOf(j))}</option>`).join('');
  const mapRows = T1_IMP_FIELDS.map(([k, n, must]) => [
    H(n) + (must ? ' <span class="red">*</span>' : ''),
    `<select data-t1map="${k}"><option value="">— 不使用 —</option>${opts(k)}</select>`,
    im.map[k] !== undefined ? `<span class="mut">${H(String(preview[0] && preview[0][im.map[k]] || '').slice(0, 22))}</span>` : '<span class="mut">—</span>',
  ]);
  const headOpts = im.rows.slice(0, Math.min(im.rows.length, 12)).map((r, i) =>
    `<option value="${i}" ${i === im.headRow ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 46))}</option>`).join('');

  const p = t1ImpPlan();
  const ready = im.map.ent !== undefined && im.map.name !== undefined;
  const cut = (arr, n) => arr.slice(0, n).map(x => `${H(x.ent)} · ${H(x.name)}`).join('、')
    + (arr.length > n ? ` … 等 ${arr.length} 户` : '');

  return head('导入账户台账', `${H(im.fileName)} · ${im.rows.length} 行`, '工具箱 · T1', tools)
    + cardp('表头在第几行', `<select id="t1head" style="min-width:340px">${headOpts}</select>`)
    + card('列对应关系', table([{ t: '字段' }, { t: '对应哪一列' }, { t: '示例值' }], mapRows))
    + (ready ? kpis([
      { k: '新增账户', v: String(p.add.length), u: '户', t: p.add.length ? 'g' : '' },
      { k: '更新账户', v: String(p.upd.length), u: '户', t: p.upd.length ? 'w' : '' },
      { k: '无变化', v: String(p.same.length), u: '户' },
      { k: '带余额', v: String(p.bals.length), u: '条', t: p.bals.length ? 'g' : '' },
      { k: '问题行', v: String(p.bad.length), u: '行', t: p.bad.length ? 'c' : 'g' },
    ]) : '<div class="note c"><b>还不能继续：</b>「主体」和「账户 / 平台」两列必须对应上。</div>')
    + (ready && p.add.length ? `<div class="note g"><b>会新增 ${p.add.length} 户：</b>${cut(p.add, 8)}</div>` : '')
    + (ready && p.upd.length ? `<div class="note w"><b>会更新 ${p.upd.length} 户</b>（复用原编号，历史余额不丢）：${
        p.upd.slice(0, 6).map(u => `${H(u.ent)} · ${H(u.name)}（${u.chg.join('、')}）`).join('；')}${p.upd.length > 6 ? ' …' : ''}</div>` : '')
    + (ready && p.dup ? `<div class="note w"><b>文件里有 ${p.dup} 行重复</b>（主体+账户名相同），只取第一次出现的那行。</div>` : '')
    + (ready && p.bad.length ? `<div class="note c"><b>${p.bad.length} 行没法用，会跳过：</b>${
        p.bad.slice(0, 5).map(b => `第 ${b.no} 行 ${b.why}`).join('；')}${p.bad.length > 5 ? ' …' : ''}</div>` : '')
    + (ready && p.bals.length ? `<div class="note"><b>余额会写到 ${
        [...new Set(p.bals.map(b => b.date))].join('、')}</b>，在 T1 里标「来自 T1导入」。
        表里没有余额日期列时用当前选的日期 ${T1.date}。</div>` : '')
    + cardp('导入方式', `<label style="font-size:12px"><input type="checkbox" id="t1off" ${im.offStale ? 'checked' : ''}>
        把「这张表里没有、但当前在管」的账户设为<b>停用</b></label>
      <div class="note" style="margin-top:9px"><b>不勾就是纯追加合并</b>：表里没提到的账户原样不动。
        勾了也只是停用、<b>不删除</b>，历史余额一律保留，随时能在台账里改回在管。</div>`)
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn" data-t1act="impCancel">换个文件</button>
        <button class="btn pri" data-t1act="impApply" ${ready ? '' : 'disabled'}>确认导入</button>
      </div>`;
};

/* 日报文本 */
function t1Text() {
  const ents = t1ByEnt(T1.date);
  const tot = ents.reduce((s, e) => s + e.bal, 0);
  const prevD = t1Prev(T1.date);
  const totPrev = ents.reduce((s, e) => s + e.prev, 0);
  const delta = prevD ? tot - totPrev : null;
  const red = ents.filter(e => e.red);
  const stale = [];
  ents.forEach(e => e.accs.forEach(a => { if (a.stale) stale.push(`${e.ent}·${a.name}（${a.from}）`); }));
  const miss = [];
  ents.forEach(e => e.accs.forEach(a => { if (a.v === null) miss.push(`${e.ent}·${a.name}`); }));

  let t = `【资金日报】${T1.date}\n`;
  t += `━━━━━━━━━━━━━━\n`;
  t += `集团合计　${wan(tot)} 万`;
  if (delta !== null) t += `　较上日 ${delta >= 0 ? '+' : ''}${wan(delta)} 万`;
  t += `\n在管账户 ${T1_ACC.filter(a => a.on).length} 个\n\n`;

  ents.forEach(e => {
    t += `▍${e.ent}　${wan(e.bal)} 万`;
    if (e.delta !== null && Math.abs(e.delta) > 0.005) t += `　${e.delta >= 0 ? '↑' : '↓'}${wan(Math.abs(e.delta))}`;
    if (e.incomplete) t += `　覆盖 —（数据不全）`;
    else if (e.cover !== null) t += `　覆盖 ${e.cover.toFixed(2)}${e.red ? ' ⚠' : ''}`;
    t += `\n`;
  });

  if (red.length) {
    t += `\n⚠ 红线预警（低于 ${T1_CFG.ratio} 倍）\n`;
    red.forEach(e => { t += `　${e.ent}　覆盖 ${e.cover.toFixed(2)}　余额 ${wan(e.bal)} 万 / 月固定支出 ${wan(e.fixed)} 万\n`; });
  }
  if (stale.length) {
    t += `\n※ 以下 ${stale.length} 个账户今日未更新，沿用上次余额：\n　${stale.join('、')}\n`;
  }
  if (miss.length) {
    t += `\n※ 以下 ${miss.length} 个账户从未录入，未计入合计：\n　${miss.join('、')}\n`;
  }
  t += `\n━━━━━━━━━━━━━━\n由财务中心工具箱 T1 生成`;
  return t;
}

S['t1-report'] = () => {
  const txt = t1Text();
  return head('日报文本', '可直接复制粘贴到钉钉群。<b>沿用昨日的账户和从未录入的账户都会单独列出</b>——让收报表的人知道哪些数是新的。', '工具箱 · T1',
    `<button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn" data-t1act="dl">导出 CSV</button>
     <button class="btn pri" data-t1act="copy">复制文本</button>`)
    + `<div class="card"><div class="cb"><pre id="t1txt" class="t1pre">${H(txt)}</pre></div></div>`
    + `<div class="note"><b>改造前：</b>出纳每日盘点 11 个主体/平台资金并发群，约 1.2 小时。<b>改造后：</b>抄余额仍是人工，但汇总、算覆盖倍数、比对昨日、排版、生成文本全自动，约 15 分钟。</div>`;
};

/* ============ 交互 ============ */
function t1Export() {
  const ents = t1ByEnt(T1.date);
  const hdr = ['日期', '主体', '账户/平台', '类型', '余额', '数据状态', '取自日期'];
  const rows = [];
  ents.forEach(e => e.accs.forEach(a => {
    rows.push([T1.date, e.ent, a.name, a.type === 'plat' ? '平台' : '银行',
      a.v === null ? '' : a.v.toFixed(2),
      a.v === null ? '从未录入' : (a.stale ? '沿用上次' : '今日更新'), a.from || '']);
  }));
  rows.push([]);
  rows.push(['—— 主体汇总 ——', '', '', '', '', '', '']);
  ents.forEach(e => rows.push([T1.date, e.ent, '合计', '', e.bal.toFixed(2),
    e.incomplete ? '数据不全，未算覆盖倍数'
      : e.cover === null ? '' : `覆盖 ${e.cover.toFixed(2)}${e.red ? ' 红线预警' : ''}`, '']));
  download(`资金日报_${T1.date}.csv`, toCSV([hdr].concat(rows)));
  toast('已导出');
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-t1go]');
  if (g) { const v = g.dataset.t1go; go(v === 'daily' ? 't1' : 't1-' + v); return; }
  const d = e.target.closest('[data-t1del]');
  if (d) {
    if (!confirm('确认删除该账户？历史余额数据会保留。')) return;
    T1_ACC = T1_ACC.filter(a => a.id !== d.dataset.t1del); t1SaveAcc(T1_ACC);
    toast('已删除'); go('t1-acc'); return;
  }
  const a = e.target.closest('[data-t1act]');
  if (!a) return;
  const act = a.dataset.t1act;
  if (act === 'save') {
    const day = t1LoadDay(); const today = day[T1.date] || {};
    let n = 0;
    document.querySelectorAll('[data-t1cell]').forEach(inp => {
      const id = inp.dataset.t1cell, v = inp.value.trim();
      if (v === '') delete today[id];
      else { today[id] = Number(v) || 0; n++; }
    });
    day[T1.date] = today; t1SaveDay(day);
    toast(`已保存 ${n} 个账户余额`); go('t1');
  }
  else if (act === 'gen') go('t1-report');
  else if (act === 'copy') {
    const txt = t1Text();
    navigator.clipboard.writeText(txt).then(
      () => toast('已复制，粘贴到钉钉群即可'),
      () => {
        const el = document.getElementById('t1txt');
        const r = document.createRange(); r.selectNodeContents(el);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('已选中，按 ⌘C 复制', 3200);
      });
  }
  else if (act === 'dl') t1Export();
  else if (act === 'impTpl') t1ImpTemplate();
  else if (act === 'impCancel') { T1.imp = null; go('t1-imp'); }
  else if (act === 'impApply') {
    const p = t1ImpPlan();
    if (!p.add.length && !p.upd.length && !p.bals.length && !Object.keys(p.fixed).length && !T1.imp.offStale) {
      toast('这张表没有需要写入的改动'); return;
    }
    t1ImpApply();
  }
  else if (act === 'addAcc') {
    const id = 'A' + String(T1_ACC.length + 1).padStart(3, '0');
    T1_ACC.push({ id, ent: '新主体', name: '新账户', type: 'bank', on: 1 });
    t1SaveAcc(T1_ACC); go('t1-acc');
  }
  else if (act === 'saveAcc') {
    document.querySelectorAll('[data-t1acc]').forEach(inp => {
      const [id, k] = inp.dataset.t1acc.split(':');
      const a = T1_ACC.find(x => x.id === id); if (a) a[k] = inp.value;
    });
    document.querySelectorAll('[data-t1on]').forEach(cb => {
      const a = T1_ACC.find(x => x.id === cb.dataset.t1on); if (a) a.on = cb.checked ? 1 : 0;
    });
    document.querySelectorAll('[data-t1fix]').forEach(inp => {
      T1_CFG.fixed[inp.dataset.t1fix] = Number(inp.value) || 0;
    });
    t1SaveAcc(T1_ACC); t1SaveCfg(T1_CFG);
    toast('台账已保存'); go('t1');
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 't1file' && e.target.files && e.target.files[0]) { t1ImpLoad(e.target.files[0]); return; }
  if (e.target.id === 't1head' && T1.imp) {
    T1.imp.headRow = +e.target.value;
    T1.imp.map = t1ImpAutoMap(T1.imp.rows[T1.imp.headRow] || []);
    go('t1-imp'); return;
  }
  if (e.target.id === 't1off' && T1.imp) { T1.imp.offStale = e.target.checked ? 1 : 0; go('t1-imp'); return; }
  if (e.target.dataset && e.target.dataset.t1map && T1.imp) {
    const k = e.target.dataset.t1map;
    if (e.target.value === '') delete T1.imp.map[k]; else T1.imp.map[k] = +e.target.value;
    go('t1-imp'); return;
  }
  if (e.target.id === 't1date') { T1.date = e.target.value; go(location.hash ? 't1' : 't1'); }
  if (e.target.id === 't1entFilter') { T1.filterEnt = e.target.value; go('t1-entry'); }
  if (e.target.id === 't1ratio') { T1_CFG.ratio = Number(e.target.value) || 1.5; t1SaveCfg(T1_CFG); go('t1'); }
});

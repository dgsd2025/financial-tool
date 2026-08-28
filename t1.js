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

const T1 = { date: new Date().toISOString().slice(0, 10), view: 'daily', filterEnt: '' };

function t1LoadAcc() {
  try { const s = JSON.parse(localStorage.getItem(T1_ACC_KEY) || 'null'); if (s && s.length) return s; } catch (e) { /* 忽略 */ }
  const init = T1_PRESET.map((p, i) => ({ id: 'A' + String(i + 1).padStart(3, '0'), ent: p[0], name: p[1], type: p[2], on: 1 }));
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
      const hint = e.v === null ? '<span class="red">从未录入</span>'
        : (cur !== undefined ? pill('今日已填', 'ok')
          : `<span class="mut">上次 ${H(e.from)}：${money(e.v)}</span>`);
      return [
        `${a.type === 'plat' ? '▣' : '▤'} ${H(a.name)}`,
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
     <button class="btn" data-t1act="addAcc">+ 新增账户</button>
     <button class="btn pri" data-t1act="saveAcc">保存台账</button>`)
    + `<div class="note"><b>预置了 ${T1_PRESET.length} 个账户</b>（按访谈里 47 户的结构估的），实际户名和数量请按你们真实情况改。<b>停用的账户不进日报</b>，但历史数据保留。</div>`
    + card('账户', table(
      [{ t: '编号' }, { t: '主体' }, { t: '账户 / 平台' }, { t: '类型' }, { t: '状态' }, { t: '' }], rows))
    + card('各主体月固定支出（算覆盖倍数用）', table(
      [{ t: '主体' }, { t: '月固定支出（元）', n: 1 }, { t: '折合' }], fixRows));
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
  if (e.target.id === 't1date') { T1.date = e.target.value; go(location.hash ? 't1' : 't1'); }
  if (e.target.id === 't1entFilter') { T1.filterEnt = e.target.value; go('t1-entry'); }
  if (e.target.id === 't1ratio') { T1_CFG.ratio = Number(e.target.value) || 1.5; t1SaveCfg(T1_CFG); go('t1'); }
});

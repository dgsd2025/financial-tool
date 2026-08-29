/* 经营看板（BI 风格初稿）
   全图形化：KPI 光晕卡 + 趋势面积图 + 构成环图 + 排行条图 + 现金流柱图。
   图表全部手绘 SVG，不引外部库（本系统离线也要能跑）。
   数据实时取各主体凭证库；账里没数据时可载入「演示数据」看版式——
   演示态全程挂角标，绝不冒充真数。 */
'use strict';

const DASH = { demo: 0 };
const DC = { cyan: '#22d3ee', vio: '#a78bfa', pink: '#f472b6', amber: '#fbbf24', green: '#34d399', red: '#f87171', blue: '#60a5fa' };
const DPAL = [DC.cyan, DC.vio, DC.pink, DC.amber, DC.green, DC.blue, '#fb923c', '#2dd4bf'];
const dw = n => (typeof n === 'string' ? n : Math.abs(n) >= 1e8 ? (n / 1e8).toFixed(2) + ' 亿' : Math.abs(n) >= 1e4 ? (n / 1e4).toFixed(1) + ' 万' : (+n).toFixed(0));

/* ============ 取数：全集团逐月经营数据 ============ */
function dashData() {
  const year = String(new Date().getFullYear());
  const months = Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const ents = [];
  ENTITIES.forEach(e => {
    const vs = vchLoad(e.id); if (!vs.length) return;
    const rev = Array(12).fill(0), exp = Array(12).fill(0);
    let cash = 0, ar = 0, ap = 0;
    const fee = {};   // 费用结构（按 5403/5601/5602/5603/5711）
    const cf = { op: [0, 0], inv: [0, 0], fin: [0, 0] };
    vs.forEach(v => {
      if (!(AC.inc || v.posted)) return;
      const d = vDate(v); if (d.slice(0, 4) !== year) return;
      const mi = +d.slice(5, 7) - 1;
      const delta = v.lines.reduce((s, l) => s + (rptIsCash(l.acct) ? l.dr - l.cr : 0), 0);
      if (Math.abs(delta) > 0.005) {
        const opp = v.lines.filter(l => !rptIsCash(l.acct));
        if (opp.length) {
          const main = opp.reduce((a, b) => (a.dr + a.cr >= b.dr + b.cr ? a : b));
          const k = rptCfClass(String(main.acct).split('_')[0], main.name);
          if (delta > 0) cf[k][0] += delta; else cf[k][1] -= delta;
        }
      }
      v.lines.forEach(l => {
        const base = String(l.acct).split('_')[0];
        if (rptIsCash(base)) cash += l.dr - l.cr;
        else if (/^1122/.test(base)) ar += l.dr - l.cr;
        else if (/^(2202|2241)/.test(base)) ap += l.cr - l.dr;
        if (/^(5001|5051|5111|5301)/.test(base)) rev[mi] += l.cr - l.dr;
        else if (/^5/.test(base)) {
          exp[mi] += l.dr - l.cr;
          const g = /^5403/.test(base) ? '税金及附加' : /^5601/.test(base) ? '销售费用'
            : /^5602/.test(base) ? '管理费用' : /^5603/.test(base) ? '财务费用'
            : /^(5401|5402)/.test(base) ? '营业成本' : '其他';
          fee[g] = (fee[g] || 0) + l.dr - l.cr;
        }
      });
    });
    const trev = rev.reduce((a, b) => a + b, 0), texp = exp.reduce((a, b) => a + b, 0);
    if (!trev && !texp && !cash) return;
    ents.push({ id: e.id, name: e.full, rev, exp, trev, texp, profit: +(trev - texp).toFixed(2), cash: +cash.toFixed(2), ar, ap, fee, cf });
  });
  return { year, months, ents, demo: false };
}
/* 演示数据：只为看版式，处处标「演示」 */
function dashDemo() {
  const year = String(new Date().getFullYear());
  const mk = (base, amp, i) => Math.max(0, base + amp * Math.sin(i / 1.8) + amp * 0.5 * ((i * 7919) % 13) / 13);
  const names = ['广州澳乐电子商务科技有限公司', '优栖（广州）服务管理有限公司', '广州云帕供应链管理有限公司',
    '广州数智云仓产业园运营有限公司', '广州云迪物业管理服务合伙企业（有限合伙）', '广州瑞眠科技有限公司'];
  const ents = names.map((name, n) => {
    const rev = Array.from({ length: 12 }, (_, i) => +mk(280000 - n * 36000, 90000, i + n).toFixed(0));
    const exp = rev.map(v => +(v * (0.62 + 0.06 * ((n + 1) % 4))).toFixed(0));
    const trev = rev.reduce((a, b) => a + b, 0), texp = exp.reduce((a, b) => a + b, 0);
    return { id: 'demo' + n, name, rev, exp, trev, texp, profit: trev - texp,
      cash: 400000 - n * 52000, ar: 130000 - n * 15000, ap: 90000 - n * 9000,
      fee: { 营业成本: texp * 0.62, 管理费用: texp * 0.2, 销售费用: texp * 0.1, 财务费用: texp * 0.03, 税金及附加: texp * 0.05 },
      cf: { op: [trev * 0.9, texp * 0.85], inv: [20000, 90000 - n * 8000], fin: [150000 - n * 20000, 60000] } };
  });
  return { year, months: Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0')), ents, demo: true };
}

/* ============ SVG 图表（手绘） ============ */
const dGrad = (id, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${c}" stop-opacity=".55"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
function dArea(series, labels, w, h) {
  const P = 30, W = w - P * 2, Hh = h - 34;
  const max = Math.max(1, ...series.flatMap(s => s.vals));
  const x = i => P + W * i / (labels.length - 1);
  const y = v => 8 + (Hh - 8) * (1 - v / max);
  let defs = '', body = '';
  series.forEach((s, si) => {
    const pts = s.vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    defs += dGrad('g' + si, s.color);
    body += `<path d="M${pts.join(' L')} L${x(s.vals.length - 1)},${Hh + 8} L${P},${Hh + 8} Z" fill="url(#g${si})"/>`;
    body += `<path d="M${pts.join(' L')}" fill="none" stroke="${s.color}" stroke-width="2.2" style="filter:drop-shadow(0 0 5px ${s.color})"/>`;
    s.vals.forEach((v, i) => { body += `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"><title>${labels[i]} ${s.name} ${dw(v)}</title></circle>`; });
  });
  const grid = [0, .25, .5, .75, 1].map(t => `<line x1="${P}" y1="${8 + (Hh - 8) * t}" x2="${w - P}" y2="${8 + (Hh - 8) * t}" stroke="rgba(148,163,184,.14)"/>`).join('');
  const xl = labels.map((l, i) => i % 2 ? '' : `<text x="${x(i)}" y="${h - 8}" fill="#64748b" font-size="9.5" text-anchor="middle">${l.slice(5)}月</text>`).join('');
  const legend = series.map(s => `<tspan fill="${s.color}">● ${s.name}　</tspan>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%"><defs>${defs}</defs>${grid}${body}${xl}
    <text x="${P}" y="14" font-size="10">${legend}</text></svg>`;
}
function dDonut(segs, size, centerTop, centerBot) {
  const total = segs.reduce((s, x) => s + Math.max(0, x.val), 0) || 1;
  const R = size / 2 - 8, cx = size / 2, cy = size / 2, TH = 17;
  let a0 = -Math.PI / 2, body = '';
  segs.forEach((s, i) => {
    const frac = Math.max(0, s.val) / total; if (frac < 0.002) return;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > .5 ? 1 : 0;
    const p = a => [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    const q = a => [cx + (R - TH) * Math.cos(a), cy + (R - TH) * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1 - .015), [x2, y2] = q(a1 - .015), [x3, y3] = q(a0);
    const c = s.color || DPAL[i % DPAL.length];
    body += `<path d="M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${R - TH},${R - TH} 0 ${large} 0 ${x3},${y3} Z"
      fill="${c}" style="filter:drop-shadow(0 0 4px ${c}66)"><title>${s.label} ${dw(s.val)}（${(frac * 100).toFixed(1)}%）</title></path>`;
    a0 = a1;
  });
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;max-width:100%">${body}
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="700">${centerTop}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#64748b" font-size="9.5">${centerBot}</text></svg>`;
}
function dHBars(items, w) {
  const max = Math.max(1, ...items.map(x => Math.abs(x.val)));
  const rowH = 26, h = items.length * rowH + 4;
  let body = '';
  items.forEach((it, i) => {
    const y = i * rowH + 4, bw = Math.max(2, (w - 210) * Math.abs(it.val) / max);
    const c = it.color || (it.val >= 0 ? DC.green : DC.red);
    body += `<text x="0" y="${y + 12}" fill="#94a3b8" font-size="10.5">${it.label.length > 11 ? it.label.slice(0, 11) + '…' : it.label}</text>
      <rect x="128" y="${y + 3}" width="${bw}" height="12" rx="6" fill="${c}" opacity=".9" style="filter:drop-shadow(0 0 4px ${c}88)"><title>${it.label} ${dw(it.val)}</title></rect>
      <text x="${132 + bw}" y="${y + 13}" fill="${c}" font-size="10.5" font-weight="600">${dw(it.val)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%">${body}</svg>`;
}
function dCfBars(cf, w, h) {
  const acts = [['经营', cf.op, DC.cyan], ['投资', cf.inv, DC.vio], ['筹资', cf.fin, DC.amber]];
  const max = Math.max(1, ...acts.flatMap(a => a[1]));
  const gw = w / 3;
  let body = '';
  acts.forEach((a, i) => {
    const cx = i * gw + gw / 2;
    const ih = (h - 44) * a[1][0] / max, oh = (h - 44) * a[1][1] / max;
    body += `<rect x="${cx - 26}" y="${h - 26 - ih}" width="20" height="${Math.max(2, ih)}" rx="4" fill="${a[2]}" style="filter:drop-shadow(0 0 5px ${a[2]}aa)"><title>${a[0]}流入 ${dw(a[1][0])}</title></rect>
      <rect x="${cx + 6}" y="${h - 26 - oh}" width="20" height="${Math.max(2, oh)}" rx="4" fill="${a[2]}" opacity=".35"><title>${a[0]}流出 ${dw(a[1][1])}</title></rect>
      <text x="${cx}" y="${h - 10}" text-anchor="middle" fill="#94a3b8" font-size="10.5">${a[0]}</text>
      <text x="${cx}" y="12" text-anchor="middle" fill="${a[1][0] - a[1][1] >= 0 ? DC.green : DC.red}" font-size="10.5" font-weight="700">净 ${dw(a[1][0] - a[1][1])}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%">${body}</svg>`;
}
const dSpark = (vals, c) => {
  const max = Math.max(1, ...vals), w = 120, h = 30;
  const pts = vals.map((v, i) => `${(w * i / (vals.length - 1)).toFixed(1)},${(h - 3 - (h - 8) * v / max).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" class="bi-spark"><path d="M${pts.join(' L')}" fill="none" stroke="${c}" stroke-width="2" style="filter:drop-shadow(0 0 3px ${c})"/></svg>`;
};

/* ============ 看板 ============ */
S['p-dash'] = () => {
  const d = DASH.demo ? dashDemo() : dashData();
  if (!d.ents.length) {
    return head('经营看板', '全图形化 BI 看板。数据实时取各主体凭证库。', '分析 · 看板')
      + `<div class="soonbox"><div class="si">📊</div><h3>账里还没有可视化的数据</h3>
        <p>先用 T2 处理流水入库，看板会实时点亮；也可以先载入演示数据看版式。</p>
        <button class="btn pri" data-act="dashDemo">载入演示数据（仅展示样式）</button></div>`;
  }
  const trev = d.ents.reduce((s, e) => s + e.trev, 0);
  const tprofit = d.ents.reduce((s, e) => s + e.profit, 0);
  const tcash = d.ents.reduce((s, e) => s + e.cash, 0);
  const tar = d.ents.reduce((s, e) => s + e.ar, 0);
  const revM = Array.from({ length: 12 }, (_, i) => d.ents.reduce((s, e) => s + e.rev[i], 0));
  const profM = Array.from({ length: 12 }, (_, i) => d.ents.reduce((s, e) => s + e.rev[i] - e.exp[i], 0));
  const cf = { op: [0, 0], inv: [0, 0], fin: [0, 0] };
  d.ents.forEach(e => ['op', 'inv', 'fin'].forEach(k => { cf[k][0] += e.cf[k][0]; cf[k][1] += e.cf[k][1]; }));
  const cfNet = ['op', 'inv', 'fin'].reduce((s, k) => s + cf[k][0] - cf[k][1], 0);
  const fee = {};
  d.ents.forEach(e => Object.keys(e.fee).forEach(k => { fee[k] = (fee[k] || 0) + e.fee[k]; }));
  const byRev = d.ents.slice().sort((a, b) => b.trev - a.trev);
  const byProfit = d.ents.slice().sort((a, b) => b.profit - a.profit);
  const kpi = (t, v, c, sub, spark) => `<div class="bi-kpi" style="--c:${c}">
    <div class="bi-kt">${t}</div><div class="bi-kv">${dw(v)}</div>
    <div class="bi-ks">${sub}</div>${spark || ''}</div>`;
  return `<div class="bi">
    <div class="bi-head">
      <div><div class="bi-title">集团经营看板</div>
        <div class="bi-sub">${d.year} 年 · ${d.ents.length} 个经营主体 · 数据${d.demo ? '' : '实时取自凭证库'}</div></div>
      ${d.demo ? '<span class="bi-demo">演示数据 · 仅展示样式 <button class="btn sm" data-act="dashReal">切回真实数据</button></span>'
      : '<button class="btn sm" data-act="dashDemo">看演示版式</button>'}
    </div>
    <div class="bi-kpis">
      ${kpi('营业收入（年累计）', trev, DC.cyan, '全部经营主体加总', dSpark(revM, DC.cyan))}
      ${kpi('净利润（年累计）', tprofit, tprofit >= 0 ? DC.green : DC.red, '收入 − 成本费用', dSpark(profM.map(v => Math.max(0, v)), tprofit >= 0 ? DC.green : DC.red))}
      ${kpi('货币资金', tcash, DC.vio, '现金 + 银行 + 其他货币资金', '')}
      ${kpi('应收账款', tar, DC.amber, '待收回款项', '')}
      ${kpi('现金净流量', cfNet, cfNet >= 0 ? DC.green : DC.pink, '经营 + 投资 + 筹资', '')}
      ${kpi('利润率', trev ? (tprofit / trev * 100).toFixed(1) + '%' : '—', DC.blue, '净利润 ÷ 营业收入', '')}
    </div>
    <div class="bi-grid">
      <div class="bi-card bi-w2"><div class="bi-ct">月度收入 × 利润趋势</div>
        ${dArea([{ name: '营业收入', color: DC.cyan, vals: revM }, { name: '净利润', color: DC.green, vals: profM.map(v => Math.max(0, v)) }], d.months, 640, 230)}</div>
      <div class="bi-card"><div class="bi-ct">收入构成 · 按主体</div><div class="bi-center">
        ${dDonut(byRev.slice(0, 7).map((e, i) => ({ label: e.name, val: e.trev, color: DPAL[i] }))
      .concat(byRev.length > 7 ? [{ label: '其他', val: byRev.slice(7).reduce((s, e) => s + e.trev, 0), color: '#475569' }] : []), 190, dw(trev), '年收入合计')}
        <div class="bi-legend">${byRev.slice(0, 5).map((e, i) => `<span><i style="background:${DPAL[i]}"></i>${H(e.name.slice(0, 9))}</span>`).join('')}</div></div></div>
      <div class="bi-card"><div class="bi-ct">主体利润排行</div>
        ${dHBars(byProfit.slice(0, 8).map(e => ({ label: e.name.replace(/^(广州市|广州|深圳|中山市)/, ''), val: e.profit })), 460)}</div>
      <div class="bi-card"><div class="bi-ct">费用结构</div><div class="bi-center">
        ${dDonut(Object.keys(fee).sort((a, b) => fee[b] - fee[a]).map((k, i) => ({ label: k, val: fee[k], color: DPAL[(i + 3) % DPAL.length] })), 190,
      dw(Object.values(fee).reduce((s, v) => s + v, 0)), '成本费用合计')}
        <div class="bi-legend">${Object.keys(fee).sort((a, b) => fee[b] - fee[a]).slice(0, 5).map((k, i) => `<span><i style="background:${DPAL[(i + 3) % DPAL.length]}"></i>${H(k)}</span>`).join('')}</div></div></div>
      <div class="bi-card"><div class="bi-ct">现金流量 · 三类活动</div>${dCfBars(cf, 440, 190)}</div>
      <div class="bi-card bi-w2"><div class="bi-ct">货币资金分布 · 按主体</div>
        ${dHBars(d.ents.slice().sort((a, b) => b.cash - a.cash).slice(0, 8).map(e => ({ label: e.name.replace(/^(广州市|广州|深圳|中山市)/, ''), val: e.cash, color: DC.vio })), 640)}</div>
    </div>
    <div class="bi-foot">口径：收入=5001/5051/5111/5301 贷方净额 · 费用=其余损益类借方净额 · 现金流按凭证对方科目归类（与现金流量表同引擎）${d.demo ? ' · <b>当前为演示数据</b>' : ''}</div>
  </div>`;
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'dashDemo') { DASH.demo = 1; go('p-dash'); }
  else if (a.dataset.act === 'dashReal') { DASH.demo = 0; go('p-dash'); }
});

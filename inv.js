/* 票据与纳税申报：进项票/销项票导入 + 无票收入 → 增值税申报表
   → 所得税预缴申报表 → 印花税申报表。
   口径要点（都在界面上明说，不藏）：
   - 每个主体有税务档案：小规模纳税人（征收率 1%/3%/5%）或一般纳税人（税率 13%/9%/6%）
   - 小规模月销售额 ≤10 万免征增值税；六税两费减半——按 2026 年现行政策预置，可关
   - 申报表按税局样式列行次，但它是「草稿」：以电子税务局最终生成的为准 */
'use strict';

/* ============ 存储 ============ */
const IV_IN_KEY = e => 'fsc_iv_in_' + e + '_v1';       // 进项票
const IV_OUT_KEY = e => 'fsc_iv_out_' + e + '_v1';     // 销项票
const IV_NOINV_KEY = e => 'fsc_iv_noinv_' + e + '_v1'; // 无票收入
const IV_PROF_KEY = e => 'fsc_iv_prof_' + e + '_v1';   // 税务档案
const IV_ADJ_KEY = (e, m) => 'fsc_iv_adj_' + e + '_' + m + '_v1'; // 各期手工数（留抵等）

function ivLoad(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
function ivSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } }
function ivProf() {
  try { const p = JSON.parse(localStorage.getItem(IV_PROF_KEY(CUR_ENT)) || 'null'); if (p) return p; } catch (e) { /* 忽略 */ }
  // 默认小规模 1%——集团各主体现行做法（优栖租金按 1% 拆税），改了当场生效
  return { type: 'small', rate: 0.01, halve: 1 };
}
function ivProfSave(p) { try { localStorage.setItem(IV_PROF_KEY(CUR_ENT), JSON.stringify(p)); } catch (e) { /* 忽略 */ } }
function ivAdj(m) { try { return JSON.parse(localStorage.getItem(IV_ADJ_KEY(CUR_ENT, m)) || '{}'); } catch (e) { return {}; } }
function ivAdjSave(m, v) { try { localStorage.setItem(IV_ADJ_KEY(CUR_ENT, m), JSON.stringify(v)); } catch (e) { /* 忽略 */ } }

/* 当前申报期间（月），默认上月——申报的都是上个月的事 */
const IV = { month: (() => { const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth() - 1, 1); return ym(t); })() };
const ivQuarterOf = m => { const q = Math.floor((+m.slice(5, 7) - 1) / 3); return { y: m.slice(0, 4), q: q + 1, from: m.slice(0, 4) + '-' + String(q * 3 + 1).padStart(2, '0'), to: m.slice(0, 4) + '-' + String(q * 3 + 3).padStart(2, '0') }; };

/* ============ 发票导入 ============ */
/* 税务局/开票软件导出的表，列名各家不一。必备四列：号码/日期/金额/税额。 */
const IV_ALIAS = {
  no:   ['数电票号码', '发票号码', '全电发票号码', '号码'],
  code: ['发票代码'],
  date: ['开票日期', '日期'],
  who:  ['销售方名称', '销方名称', '销方', '购买方名称', '购方名称', '购方', '对方名称'],
  amt:  ['不含税金额', '合计金额', '金额'],
  tax:  ['合计税额', '税额'],
  total: ['价税合计', '含税金额'],
  state: ['发票状态', '状态'],
  kind: ['发票类型', '票种'],
};
function ivMap(header) {
  const cells = header.map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const map = {}, used = new Set();
  [1, 0].forEach(exact => Object.keys(IV_ALIAS).forEach(k => {
    if (map[k] !== undefined) return;
    for (const a of IV_ALIAS[k]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && (exact ? c === a : c.includes(a)));
      if (i >= 0) { map[k] = i; used.add(i); return; }
    }
  }));
  return map;
}
async function ivImport(file, dir) {  // dir: 'in' | 'out'
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, Object.values(IV_ALIAS).flat());
    const map = ivMap(rows[hr] || []);
    const miss = ['no', 'date', 'amt', 'tax'].filter(k => map[k] === undefined);
    if (miss.length) {
      toast('缺少必备列：' + miss.map(k => ({ no: '发票号码', date: '开票日期', amt: '金额', tax: '税额' }[k])).join('、') + '。请用税务局或开票软件的明细导出。', 5200);
      return;
    }
    const key = dir === 'in' ? IV_IN_KEY(CUR_ENT) : IV_OUT_KEY(CUR_ENT);
    const list = ivLoad(key);
    const seen = new Set(list.map(x => x.no));
    let add = 0, dup = 0, bad = 0, voided = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const no = g('no'); const date = normDate(g('date'));
      const amt = numOf(g('amt')), tax = numOf(g('tax'));
      if (!no || !date) { if (r.some(c => String(c == null ? '' : c).trim())) bad++; return; }
      if (seen.has(no)) { dup++; return; }
      const state = g('state');
      if (/作废/.test(state)) { voided++; return; }   // 作废票不进池；红冲票金额本身是负数，正常进
      seen.add(no);
      list.push({ no, code: g('code'), date, month: date.slice(0, 7), who: g('who'),
        amt, tax, total: numOf(g('total')) || +(amt + tax).toFixed(2),
        state: state || '正常', kind: g('kind'), src: file.name });
      add++;
    });
    ivSave(key, list);
    toast(`导入完成：新增 ${add} 张` + (dup ? `、重号跳过 ${dup}` : '') + (voided ? `、作废票剔除 ${voided}` : '') + (bad ? `、缺号码/日期跳过 ${bad}` : ''), 5200);
    go(dir === 'in' ? 'iv-in' : 'iv-out');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

/* ============ 票池界面（进项/销项共用一套渲染） ============ */
function ivPool(dir) {
  const isIn = dir === 'in';
  const title = isIn ? '进项票' : '销项票';
  if (!CUR_ENT) return needEnt(title);
  const list = ivLoad(isIn ? IV_IN_KEY(CUR_ENT) : IV_OUT_KEY(CUR_ENT));
  const cur = list.filter(x => x.month === IV.month);
  const amt = cur.reduce((s, x) => s + x.amt, 0), tax = cur.reduce((s, x) => s + x.tax, 0);
  const red = cur.filter(x => x.amt < 0).length;
  const rows = cur.slice(0, 300).map(x => [
    x.date, `<span class="code">${H(x.no.slice(-12))}</span>`, H(x.who || '—'),
    money(x.amt), money(x.tax), money(x.total),
    x.amt < 0 ? pill('红冲', 'cr') : pill(x.state, 'ok'),
    `<button class="btn sm" data-ivdel="${dir}:${H(x.no)}">删除</button>`,
  ]);
  return head(title, `${H(entName())} · ${isIn ? '供应商开给我们的票（抵扣/入成本用）' : '我们开出去的票（算销售额用）'}。同号自动查重，作废票剔除，红冲负数原样进池。`, '票据 · ' + IV.month,
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn pri" data-act="ivUp${isIn ? 'In' : 'Out'}">导入${title}</button>`)
    + kpis([
      { k: '本月张数', v: String(cur.length), u: '张' },
      { k: '不含税金额', v: money(amt) },
      { k: '税额', v: money(tax) },
      { k: '价税合计', v: money(amt + tax) },
      { k: '红冲票', v: String(red), u: '张', t: red ? 'w' : 'g' },
      { k: '累计在池', v: String(list.length), u: '张' },
    ])
    + (cur.length ? '' : `<div class="note"><b>本月还没有${title}。</b>从电子税务局（发票查询统计 → 全量发票明细导出）或开票软件导出明细表，点右上角导入。必备列：发票号码、开票日期、金额、税额。</div>`)
    + card(`${IV.month} ${title}明细`, rows.length ? table(
      [{ t: '开票日期' }, { t: '发票号码（后12位）' }, { t: isIn ? '销售方' : '购买方' }, { t: '不含税金额', n: 1 }, { t: '税额', n: 1 }, { t: '价税合计', n: 1 }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">本月没有${title}</div>`);
}
S['iv-in'] = () => ivPool('in');
S['iv-out'] = () => ivPool('out');

/* ============ 无票收入 ============ */
S['iv-noinv'] = () => {
  if (!CUR_ENT) return needEnt('无票收入');
  const p = ivProf();
  const list = ivLoad(IV_NOINV_KEY(CUR_ENT));
  const cur = list.filter(x => x.month === IV.month);
  const net = cur.reduce((s, x) => s + x.net, 0), tax = cur.reduce((s, x) => s + x.tax, 0);
  const rows = cur.map(x => [
    x.date, H(x.memo || '—'), money(x.gross), (x.rate * 100).toFixed(0) + '%',
    money(x.net), money(x.tax),
    `<button class="btn sm" data-ivdel="noinv:${H(x.id)}">删除</button>`,
  ]);
  return head('无票收入', `${H(entName())} · 收了钱没开票的收入也要申报。录含税金额，按征收率自动拆不含税与税额，进增值税申报表的销售额。`, '票据 · ' + IV.month,
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">`)
    + kpis([
      { k: '本月笔数', v: String(cur.length), u: '笔' },
      { k: '不含税收入', v: money(net) },
      { k: '税额', v: money(tax) },
    ])
    + cardp('新增一笔', `<div class="cols c4">
        <div class="field"><label class="fl">日期</label><input type="date" id="nvDate" value="${IV.month}-15" min="2026-01-01"></div>
        <div class="field"><label class="fl">含税金额</label><input type="number" step="0.01" id="nvGross" placeholder="0.00"></div>
        <div class="field"><label class="fl">征收率/税率</label><select id="nvRate">
          ${[0.01, 0.03, 0.05, 0.06, 0.09, 0.13].map(r => `<option value="${r}" ${Math.abs(r - p.rate) < 1e-9 ? 'selected' : ''}>${(r * 100).toFixed(0)}%</option>`).join('')}</select></div>
        <div class="field"><label class="fl">备注</label><input type="text" id="nvMemo" placeholder="如：个人租客现金租金"></div>
      </div>
      <div style="text-align:right;margin-top:8px"><button class="btn pri" data-act="nvAdd">添加</button></div>`)
    + card(`${IV.month} 无票收入`, rows.length ? table(
      [{ t: '日期' }, { t: '备注' }, { t: '含税金额', n: 1 }, { t: '率' }, { t: '不含税', n: 1 }, { t: '税额', n: 1 }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">本月没有无票收入</div>`);
};

/* ============ 增值税申报表 ============ */
/* 汇一个月的三个来源：销项票 + 无票收入（销售额侧）、进项票（一般纳税人抵扣侧）。 */
function ivVatData(m) {
  const p = ivProf();
  const out = ivLoad(IV_OUT_KEY(CUR_ENT)).filter(x => x.month === m);
  const noinv = ivLoad(IV_NOINV_KEY(CUR_ENT)).filter(x => x.month === m);
  const inn = ivLoad(IV_IN_KEY(CUR_ENT)).filter(x => x.month === m);
  const saleNet = out.reduce((s, x) => s + x.amt, 0) + noinv.reduce((s, x) => s + x.net, 0);
  const saleTax = out.reduce((s, x) => s + x.tax, 0) + noinv.reduce((s, x) => s + x.tax, 0);
  const inTax = inn.reduce((s, x) => s + x.tax, 0);
  const adj = ivAdj(m);
  if (p.type === 'small') {
    const free = saleNet <= 100000;   // 月销售额≤10万免征（2026 现行政策）
    const vat = free ? 0 : +(saleNet * p.rate).toFixed(2);
    return { p, saleNet, saleTax, inTax, free, vat, adj,
      sur: ivSur(vat, p), cnt: { out: out.length, noinv: noinv.length, in: inn.length } };
  }
  const carry = numOf(adj.carry);   // 上期留抵，手工填
  const deduct = Math.min(saleTax, inTax + carry);
  const vat = +(saleTax - deduct).toFixed(2);
  return { p, saleNet, saleTax, inTax, carry, deduct, vat,
    carryEnd: +(inTax + carry - deduct).toFixed(2), free: false, adj,
    sur: ivSur(vat, p), cnt: { out: out.length, noinv: noinv.length, in: inn.length } };
}
/* 附加税费：城建 7% + 教育费附加 3% + 地方教育 2%，基数=实缴增值税；
   小规模六税两费减半（档案里可关） */
function ivSur(vat, p) {
  const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
  const c = +(vat * 0.07 * k).toFixed(2), e = +(vat * 0.03 * k).toFixed(2), l = +(vat * 0.02 * k).toFixed(2);
  return { c, e, l, sum: +(c + e + l).toFixed(2), halved: k === 0.5 };
}
S['iv-vat'] = () => {
  if (!CUR_ENT) return needEnt('增值税申报表');
  const d = ivVatData(IV.month);
  const p = d.p;
  const profBar = `<div class="note"><b>税务档案：</b>
    <select id="ivType"><option value="small" ${p.type === 'small' ? 'selected' : ''}>小规模纳税人</option><option value="general" ${p.type === 'general' ? 'selected' : ''}>一般纳税人</option></select>
    ${p.type === 'small' ? `征收率 <select id="ivRate">${[0.01, 0.03, 0.05].map(r => `<option value="${r}" ${Math.abs(r - p.rate) < 1e-9 ? 'selected' : ''}>${(r * 100).toFixed(0)}%</option>`).join('')}</select>
      <label style="margin-left:8px"><input type="checkbox" id="ivHalve" ${p.halve ? 'checked' : ''}> 六税两费减半</label>` : ''}
    　档案按主体保存。<b>此表是申报草稿，以电子税务局最终生成的为准。</b></div>`;
  const F = (nm, v, cls) => ({ cls: cls || '', d: [nm, typeof v === 'number' ? money(v) : v] });
  let rows;
  if (p.type === 'small') {
    rows = [
      F('一、应征增值税不含税销售额（' + (p.rate * 100).toFixed(0) + '% 征收率）', d.free ? 0 : d.saleNet),
      F('　其中：销项票销售额 / 无票收入', `${d.cnt.out} 张票 ＋ ${d.cnt.noinv} 笔无票`),
      F('二、免税销售额（月销售额 ≤10 万）', d.free ? d.saleNet : 0),
      F('三、本期应纳税额', d.vat, 'sum'),
      F('四、城市维护建设税（7%' + (d.sur.halved ? '，减半' : '') + '）', d.sur.c),
      F('五、教育费附加（3%' + (d.sur.halved ? '，减半' : '') + '）', d.sur.e),
      F('六、地方教育附加（2%' + (d.sur.halved ? '，减半' : '') + '）', d.sur.l),
      F('七、本期应补（退）税费合计', +(d.vat + d.sur.sum).toFixed(2), 'sum'),
    ];
  } else {
    rows = [
      F('一、销项税额（销项票 ' + d.cnt.out + ' 张 ＋ 无票收入 ' + d.cnt.noinv + ' 笔）', d.saleTax),
      F('二、进项税额（进项票 ' + d.cnt.in + ' 张）', d.inTax),
      F('三、上期留抵税额（手工填报）', `<input type="number" step="0.01" id="ivCarry" value="${d.carry || ''}" placeholder="0.00" style="width:130px">`),
      F('四、实际抵扣税额', d.deduct),
      F('五、本期应纳税额', d.vat, 'sum'),
      F('六、期末留抵税额', d.carryEnd),
      F('七、城建税 / 教育费附加 / 地方教育附加', `${money(d.sur.c)} / ${money(d.sur.e)} / ${money(d.sur.l)}`),
      F('八、本期应补（退）税费合计', +(d.vat + d.sur.sum).toFixed(2), 'sum'),
    ];
  }
  return head('增值税及附加税费申报表' + (p.type === 'small' ? '（小规模纳税人适用）' : '（一般纳税人适用）'),
    `${H(entName())} · 税款所属期 ${IV.month}。销售额 = 销项票 + 无票收入${p.type === 'general' ? '，抵扣 = 进项票 + 上期留抵' : ''}。`, '票据 · 纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn" data-act="ivVchVat">生成凭证</button>
     <button class="btn pri" data-act="ivExpVat">导出</button>`)
    + profBar
    + kpis([
      { k: '不含税销售额', v: money(d.saleNet) },
      { k: p.type === 'small' ? '应纳增值税' : '销项税额', v: money(p.type === 'small' ? d.vat : d.saleTax) },
      p.type === 'general' ? { k: '进项税额', v: money(d.inTax) } : { k: '免税', v: d.free ? '是' : '否', t: d.free ? 'g' : '' },
      { k: '附加税费', v: money(d.sur.sum) },
      { k: '本期应补（退）合计', v: money(+(d.vat + d.sur.sum).toFixed(2)), t: 'g' },
    ])
    + (d.free && p.type === 'small' ? `<div class="note g"><b>本月不含税销售额 ${money(d.saleNet)} ≤ 10 万，免征增值税</b>（按 2026 年现行小规模优惠）。附加税费基数为零，一并免。仍需按期零申报。</div>` : '')
    + card('申报表（按税局行次）', table([{ t: '项目' }, { t: '金额', n: 1 }], rows));
};

/* ============ 企业所得税季度预缴 ============ */
/* 数据源两条路：本系统利润表（凭证库实时算）或导入利润表文件。 */
S['iv-cit'] = () => {
  if (!CUR_ENT) return needEnt('企业所得税申报表');
  const q = ivQuarterOf(IV.month);
  const adjKey = 'q' + q.y + q.q;
  const adj = ivAdj(adjKey);
  let src = adj.citSrc || 'book';
  // 本系统口径：本年 1 月 1 日到季末，取利润表引擎
  let rev = 0, cost = 0, profit = 0, note = '';
  if (src === 'book') {
    const pl = rptPlData(q.y + '-01-01', q.to + '-31');
    rev = pl.rev; cost = pl.cost + pl.taxSur; profit = pl.total;
    note = `取自本系统利润表（${q.y}-01-01 〜 ${q.to} 月末，含未过账凭证按科目余额表设置）`;
  } else {
    rev = numOf(adj.citRev); cost = numOf(adj.citCost); profit = numOf(adj.citProfit);
    note = '手工/导入填报';
  }
  const loss = numOf(adj.loss);                       // 弥补以前年度亏损
  const taxable = Math.max(0, +(profit - loss).toFixed(2));
  const small = taxable <= 3000000;                   // 小微：应纳税所得额≤300万 → 实际税负 5%
  const rate = small ? 0.05 : 0.25;
  const due = +(taxable * rate).toFixed(2);
  const paid = numOf(adj.paid);                       // 本年已预缴
  const pay = Math.max(0, +(due - paid).toFixed(2));
  const F = (nm, v, cls) => ({ cls: cls || '', d: [nm, typeof v === 'number' ? money(v) : v] });
  return head('企业所得税月（季）度预缴纳税申报表（A类）',
    `${H(entName())} · ${q.y} 年第 ${q.q} 季度（累计 ${q.y}-01-01 起）。${note}。`, '票据 · 纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn" data-act="ivVchCit">生成凭证</button>
     <button class="btn pri" data-act="ivExpCit">导出</button>`)
    + `<div class="note"><b>数据来源：</b>
      <label><input type="radio" name="citSrc" value="book" ${src === 'book' ? 'checked' : ''}> 本系统利润表（推荐，与账一致）</label>
      <label style="margin-left:10px"><input type="radio" name="citSrc" value="manual" ${src === 'manual' ? 'checked' : ''}> 手工填报（账在别处时用）</label>
      ${src === 'manual' ? `<div style="margin-top:8px">营业收入 <input type="number" id="citRev" value="${adj.citRev || ''}" style="width:120px">
        营业成本 <input type="number" id="citCost" value="${adj.citCost || ''}" style="width:120px">
        利润总额 <input type="number" id="citProfit" value="${adj.citProfit || ''}" style="width:120px">
        <button class="btn sm" data-act="citSave">保存</button></div>` : ''}</div>`
    + kpis([
      { k: '累计营业收入', v: money(rev) },
      { k: '累计利润总额', v: money(profit) },
      { k: '实际利润额', v: money(taxable) },
      { k: '适用税负', v: small ? '5%（小微）' : '25%', t: small ? 'g' : '' },
      { k: '本期应补（退）', v: money(pay), t: 'g' },
    ])
    + card('申报表（按税局行次）', table([{ t: '行次 · 项目' }, { t: '本年累计金额', n: 1 }], [
      F('1　营业收入', rev),
      F('2　营业成本', cost),
      F('3　利润总额', profit),
      F('4　减：弥补以前年度亏损（手工）', `<input type="number" step="0.01" id="citLoss" value="${adj.loss || ''}" placeholder="0.00" style="width:130px">`),
      F('5　实际利润额（3-4）', taxable, 'sum'),
      F('6　税率与减免', small ? '小微企业：减按 25% 计入 × 20%，实际 5%' : '25%'),
      F('7　本年应纳所得税额', due, 'sum'),
      F('8　减：本年已预缴（手工）', `<input type="number" step="0.01" id="citPaid" value="${adj.paid || ''}" placeholder="0.00" style="width:130px">`),
      F('9　本期应补（退）所得税额', pay, 'sum'),
    ]))
    + `<div class="note"><b>小微判定只看了「应纳税所得额 ≤300 万」一条。</b>从业人数 ≤300 人、资产总额 ≤5000 万这两条系统里没有数据，请自行确认符合，不符合就按 25% 报。</div>`;
};

/* ============ 印花税申报表 ============ */
const STAMP_ITEMS = [
  ['buy', '买卖合同（购销）', 0.0003],
  ['lease', '租赁合同', 0.001],
  ['loan', '借款合同', 0.00005],
  ['tech', '技术合同', 0.0003],
  ['transport', '运输合同', 0.0003],
  ['property', '产权转移书据', 0.0005],
  ['book', '营业账簿（实收资本+资本公积）', 0.00025],
];
S['iv-stamp'] = () => {
  if (!CUR_ENT) return needEnt('印花税申报表');
  const p = ivProf();
  const adjKey = 'st' + IV.month;
  const adj = ivAdj(adjKey);
  const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
  // 计税依据提示：买卖合同可参考本月进销票金额，营业账簿参考账上实收资本+资本公积
  const inAmt = ivLoad(IV_IN_KEY(CUR_ENT)).filter(x => x.month === IV.month).reduce((s, x) => s + x.amt, 0);
  const outAmt = ivLoad(IV_OUT_KEY(CUR_ENT)).filter(x => x.month === IV.month).reduce((s, x) => s + x.amt, 0);
  const bal = rptBalAt(CUR_ENT, IV.month + '-31', 1);
  const capital = -(((bal['3001'] || {}).net || 0) + ((bal['4001'] || {}).net || 0) + ((bal['3002'] || {}).net || 0));
  let total = 0;
  const rows = STAMP_ITEMS.map(it => {
    const base = numOf(adj[it[0]]);
    const tax = +(base * it[2] * k).toFixed(2);
    total += tax;
    return [H(it[1]), (it[2] * 1000).toFixed(2).replace(/\.?0+$/, '') + '‰',
      `<input type="number" step="0.01" data-stamp="${it[0]}" value="${adj[it[0]] || ''}" placeholder="0.00" style="width:150px">`,
      money(tax)];
  });
  return head('印花税申报表', `${H(entName())} · 税款所属期 ${IV.month}。计税金额按合同/账簿实际填，右侧税额实时算${k === 0.5 ? '（小规模六税两费减半已含）' : ''}。`, '票据 · 纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn" data-act="stampSave">保存</button>
     <button class="btn" data-act="ivVchStamp">生成凭证</button>
     <button class="btn pri" data-act="ivExpStamp">导出</button>`)
    + `<div class="note"><b>计税金额要按实际签的合同填</b>，系统只给参考：本月进项票不含税 ${money(inAmt)}、销项票不含税 ${money(outAmt)}（买卖合同可参考）；账上实收资本+资本公积 ${money(capital)}（营业账簿税目，首次或增资当期才计）。没签合同的税目留空。</div>`
    + kpis([
      { k: '本期应纳印花税', v: money(+total.toFixed(2)), t: 'g' },
      { k: '优惠', v: k === 0.5 ? '六税两费减半' : '无' },
    ])
    + card('按税目填报', table([{ t: '税目' }, { t: '税率' }, { t: '计税金额', n: 1 }, { t: '应纳税额', n: 1 }], rows,
      ['<b>合计</b>', '', '', `<b>${money(+total.toFixed(2))}</b>`]));
};

/* ============ 申报表 → 生成凭证 ============ */
/* 每张申报表可一键生成计提凭证，直接进凭证库：
   - 固定 id（按主体+税种+期间），重复点是覆盖不是重复入库
   - 一律「未过账」状态入库——申报数字该有人核对一遍再过账，
     报表首页的未过账检查会盯着它
   - 增值税本身在 T2 拆销项税时已逐笔计提，这里补的是月末那几笔：
     附加税费计提 / 小规模免税转收入 / 一般纳税人结转未交增值税 */
const ivMonthEnd = m => { const [y, mo] = m.split('-'); return m + '-' + String(new Date(+y, +mo, 0).getDate()).padStart(2, '0'); };
function ivPushVoucher(id, date, lines) {
  lines = lines.filter(l => l.dr > 0.005 || l.cr > 0.005);
  if (!lines.length) { toast('金额为零，本期无需生成凭证'); return; }
  const before = vchLoad(CUR_ENT);
  const list = before.filter(v => v.id !== id);
  const existed = list.length !== before.length;
  list.push({ id, period: date.slice(0, 7), date, word: '记', no: '税', posted: 0, src: '申报表生成', lines });
  vchSave(CUR_ENT, list);
  toast((existed ? '已重新生成（覆盖原凭证）' : '凭证已生成') + '：' + lines.length + ' 行，未过账。去凭证库核对后过账。', 5200);
  go('ac-vch');
}
const IVL = (acct, name, dr, cr, memo) => ({ acct, name, dr: +(+dr).toFixed(2), cr: +(+cr).toFixed(2), memo });

function ivVchVat() {
  const d = ivVatData(IV.month);
  const date = ivMonthEnd(IV.month);
  const memo = IV.month + ' 增值税申报计提';
  const lines = [];
  if (d.p.type === 'small') {
    if (d.free) {
      // 免征：把本月已逐笔计提的销项税额转营业外收入（小企业准则做法）
      if (d.saleTax > 0.005) {
        lines.push(IVL('22210107', '应交税费_应交增值税_销项税额', d.saleTax, 0, memo + '（免征，销项税转收入）'));
        lines.push(IVL('5301', '营业外收入', 0, d.saleTax, memo + '（免征转收入）'));
      }
    } else if (d.vat > 0.005) {
      lines.push(IVL('5403', '税金及附加', d.sur.sum, 0, memo + '（附加税费）'));
      lines.push(IVL('222106', '应交税费_城建税', 0, d.sur.c, memo));
      lines.push(IVL('222107', '应交税费_教育费附加', 0, d.sur.e, memo));
      lines.push(IVL('222108', '应交税费_地方教育附加', 0, d.sur.l, memo));
    }
  } else {
    if (d.vat > 0.005) {
      lines.push(IVL('222101', '应交税费_应交增值税', d.vat, 0, memo + '（结转未交增值税）'));
      lines.push(IVL('222110', '应交税费_未交增值税', 0, d.vat, memo));
      lines.push(IVL('5403', '税金及附加', d.sur.sum, 0, memo + '（附加税费）'));
      lines.push(IVL('222106', '应交税费_城建税', 0, d.sur.c, memo));
      lines.push(IVL('222107', '应交税费_教育费附加', 0, d.sur.e, memo));
      lines.push(IVL('222108', '应交税费_地方教育附加', 0, d.sur.l, memo));
    }
  }
  ivPushVoucher('__tax_vat_' + IV.month + '__', date, lines);
}
function ivVchCit() {
  const q = ivQuarterOf(IV.month);
  const adj = ivAdj('q' + q.y + q.q);
  // 与页面同一套算法：这里只重算应补数，避免两处口径漂移
  let profit = 0;
  if ((adj.citSrc || 'book') === 'book') { profit = rptPlData(q.y + '-01-01', q.to + '-31').total; }
  else profit = numOf(adj.citProfit);
  const taxable = Math.max(0, +(profit - numOf(adj.loss)).toFixed(2));
  const due = +(taxable * (taxable <= 3000000 ? 0.05 : 0.25)).toFixed(2);
  const pay = Math.max(0, +(due - numOf(adj.paid)).toFixed(2));
  const memo = q.y + '年Q' + q.q + ' 企业所得税预缴计提';
  ivPushVoucher('__tax_cit_' + q.y + 'q' + q.q + '__', ivMonthEnd(q.to), [
    IVL('5801', '所得税费用', pay, 0, memo),
    IVL('222105', '应交税费_应交企业所得税', 0, pay, memo),
  ]);
}
function ivVchStamp() {
  const p = ivProf();
  const adj = ivAdj('st' + IV.month);
  const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
  let total = 0;
  STAMP_ITEMS.forEach(it => { total += +((numOf(adj[it[0]]) || 0) * it[2] * k).toFixed(2); });
  total = +total.toFixed(2);
  const memo = IV.month + ' 印花税计提';
  ivPushVoucher('__tax_stamp_' + IV.month + '__', ivMonthEnd(IV.month), [
    IVL('5403', '税金及附加', total, 0, memo),
    IVL('222109', '应交税费_印花税', 0, total, memo),
  ]);
}

/* ============ 事件 ============ */
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'ivMonth') { if (t.value >= '2026-01') { IV.month = t.value; go(CURS); } return; }
  if (t.id === 'ivType' || t.id === 'ivRate' || t.id === 'ivHalve') {
    const p = ivProf();
    if (t.id === 'ivType') p.type = t.value;
    if (t.id === 'ivRate') p.rate = +t.value;
    if (t.id === 'ivHalve') p.halve = t.checked ? 1 : 0;
    ivProfSave(p); go(CURS); return;
  }
  if (t.id === 'ivCarry') { const a = ivAdj(IV.month); a.carry = numOf(t.value); ivAdjSave(IV.month, a); go(CURS); return; }
  if (t.name === 'citSrc') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const a = ivAdj(key); a.citSrc = t.value; ivAdjSave(key, a); go(CURS); return;
  }
  if (t.id === 'citLoss' || t.id === 'citPaid') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const a = ivAdj(key); a[t.id === 'citLoss' ? 'loss' : 'paid'] = numOf(t.value); ivAdjSave(key, a); go(CURS); return;
  }
});
document.addEventListener('click', e => {
  const del = e.target.closest('[data-ivdel]');
  if (del && CUR_ENT) {
    const [kind, id] = del.dataset.ivdel.split(':');
    const key = kind === 'in' ? IV_IN_KEY(CUR_ENT) : kind === 'out' ? IV_OUT_KEY(CUR_ENT) : IV_NOINV_KEY(CUR_ENT);
    ivSave(key, ivLoad(key).filter(x => (kind === 'noinv' ? x.id : x.no) !== id));
    toast('已删除'); go(CURS); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'ivVchVat') { ivVchVat(); return; }
  if (act === 'ivVchCit') { ivVchCit(); return; }
  if (act === 'ivVchStamp') { ivVchStamp(); return; }
  if (act === 'ivUpIn' || act === 'ivUpOut') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) ivImport(inp.files[0], act === 'ivUpIn' ? 'in' : 'out'); };
    inp.click();
  } else if (act === 'nvAdd') {
    const gross = numOf(($('nvGross') || {}).value);
    if (!gross) { toast('先填含税金额'); return; }
    const rate = +(($('nvRate') || {}).value || ivProf().rate);
    const net = +(gross / (1 + rate)).toFixed(2);
    const list = ivLoad(IV_NOINV_KEY(CUR_ENT));
    const date = ($('nvDate') || {}).value || IV.month + '-15';
    list.push({ id: uid(), date, month: date.slice(0, 7), gross, rate, net,
      tax: +(gross - net).toFixed(2), memo: ($('nvMemo') || {}).value || '' });
    ivSave(IV_NOINV_KEY(CUR_ENT), list);
    toast('已添加'); go('iv-noinv');
  } else if (act === 'citSave') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const adj = ivAdj(key);
    adj.citRev = numOf(($('citRev') || {}).value); adj.citCost = numOf(($('citCost') || {}).value);
    adj.citProfit = numOf(($('citProfit') || {}).value);
    ivAdjSave(key, adj); toast('已保存'); go('iv-cit');
  } else if (act === 'stampSave') {
    const key = 'st' + IV.month; const adj = ivAdj(key);
    document.querySelectorAll('[data-stamp]').forEach(el => { adj[el.dataset.stamp] = numOf(el.value); });
    ivAdjSave(key, adj); toast('印花税计税金额已保存'); go('iv-stamp');
  } else if (act === 'ivExpVat') {
    const d = ivVatData(IV.month);
    const rows = d.p.type === 'small'
      ? [['项目', '金额'], ['应征增值税不含税销售额', (d.free ? 0 : d.saleNet).toFixed(2)],
        ['免税销售额', (d.free ? d.saleNet : 0).toFixed(2)], ['本期应纳税额', d.vat.toFixed(2)],
        ['城建税', d.sur.c.toFixed(2)], ['教育费附加', d.sur.e.toFixed(2)], ['地方教育附加', d.sur.l.toFixed(2)],
        ['应补（退）合计', (d.vat + d.sur.sum).toFixed(2)]]
      : [['项目', '金额'], ['销项税额', d.saleTax.toFixed(2)], ['进项税额', d.inTax.toFixed(2)],
        ['上期留抵', (d.carry || 0).toFixed(2)], ['实际抵扣', d.deduct.toFixed(2)],
        ['本期应纳税额', d.vat.toFixed(2)], ['期末留抵', d.carryEnd.toFixed(2)],
        ['附加税费合计', d.sur.sum.toFixed(2)], ['应补（退）合计', (d.vat + d.sur.sum).toFixed(2)]];
    download(`增值税申报表_${entName()}_${IV.month}.csv`, toCSV(rows)); toast('已导出');
  } else if (act === 'ivExpCit') {
    toast('直接用页面数字抄进电子税务局；导出功能沿用页面表格', 3200);
    const q = ivQuarterOf(IV.month);
    const tbl = document.querySelector('#view table');
    if (tbl) {
      const rows = [...tbl.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      download(`企业所得税预缴_${entName()}_${q.y}Q${q.q}.csv`, toCSV(rows));
    }
  } else if (act === 'ivExpStamp') {
    const key = 'st' + IV.month; const adj = ivAdj(key);
    const p = ivProf(); const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
    const rows = [['税目', '税率', '计税金额', '应纳税额']];
    let total = 0;
    STAMP_ITEMS.forEach(it => {
      const base = numOf(adj[it[0]]); if (!base) return;
      const tax = +(base * it[2] * k).toFixed(2); total += tax;
      rows.push([it[1], it[2], base.toFixed(2), tax.toFixed(2)]);
    });
    rows.push(['合计', '', '', total.toFixed(2)]);
    download(`印花税申报表_${entName()}_${IV.month}.csv`, toCSV(rows)); toast('已导出');
  }
});

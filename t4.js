/* T4 日损益速算表
   三层结构：渠道子表 → 特卖汇总 → 事业部汇总
   核心约束：渠道取数天数不对齐时，禁止生成汇总。
   依赖 app.js 的工具函数（H/money/pill/kpis/table/card/cardp/head/toast/download/toCSV）
   与 lib/xlsx-lite.js。 */
'use strict';

/* ============ 渠道定义 ============ */
const T4_CH = [
  { id: 'tmall', n: '天猫', src: 'file', tier: '直属',
    files: [
      { k: 'sales', n: '销售单明细账', hint: '只取「天猫-澳乐旗舰店」，排除 zzzrest 旗舰店' },
      { k: 'ztc', n: '天猫直通车', hint: '按记账时间归属，不按消耗日' },
      { k: 'cps', n: '天猫CPS', hint: '按明细表日期列归属' },
    ] },
  { id: 'jdzy', n: '京东自营', src: 'file', tier: '特卖',
    files: [
      { k: 'income', n: '京东自营收入交易概况', hint: '取当日成交金额 → 零售收入' },
      { k: 'jzt', n: '京准通推广费', hint: '取当日支出金额，源表为负数需取绝对值' },
    ],
    hard: [
      { f: 'cost', n: '零售成本', rule: '收入 × 45%', k: 0.45 },
      { f: 'refund', n: '退货', rule: '收入 × -16%', k: -0.16 },
    ] },
  { id: 'jdpop', n: '京东POP', src: 'manual', tier: '特卖' },
  { id: 'vip', n: '唯品会', src: 'manual', tier: '特卖' },
  { id: 'ks', n: '快手', src: 'manual', tier: '直属' },
  { id: 'priv', n: '私域', src: 'manual', tier: '直属' },
];
const T4_CHM = Object.fromEntries(T4_CH.map(c => [c.id, c]));
const T4_FIELDS = [
  { k: 'income', n: '零售收入' },
  { k: 'cost', n: '零售成本' },
  { k: 'promo', n: '推广费' },
  { k: 'refund', n: '退货' },
];
/** 汇总禁用阈值：任意两渠道取数天数差超过这个值就禁止出汇总 */
const T4_GAP_LIMIT = 2;

/* ============ 状态 ============ */
const T4_KEY = 'fsc_t4_data_v1';
const T4 = {
  period: new Date().toISOString().slice(0, 7),
  data: {},          // { chId: { 'YYYY-MM-DD': {income,cost,promo,refund, _hard:[], _src:'file'|'manual'} } }
  view: 'overview',
  editCh: 'jdpop',
  imp: null,         // 导入中间态
};

function t4Load() {
  try {
    const s = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    if (s[T4.period]) T4.data = s[T4.period];
  } catch (e) { /* 忽略损坏数据 */ }
  T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
}
function t4Save() {
  try {
    const s = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    s[T4.period] = T4.data;
    localStorage.setItem(T4_KEY, JSON.stringify(s));
  } catch (e) { toast('保存失败：浏览器存储空间不足'); }
}

const t4Days = () => {
  const [y, m] = T4.period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
const t4Date = d => `${T4.period}-${String(d).padStart(2, '0')}`;
const t4Filled = ch => Object.keys(T4.data[ch] || {}).length;

/** 各渠道取数天数极差 */
function t4Gap() {
  const ns = T4_CH.map(c => t4Filled(c.id));
  return { max: Math.max(...ns), min: Math.min(...ns), gap: Math.max(...ns) - Math.min(...ns) };
}
/** 汇总可用：既要对齐，也要真有数据（全空时 gap=0，但那不叫对齐） */
const t4SumOK = () => { const g = t4Gap(); return g.max > 0 && g.gap <= T4_GAP_LIMIT; };

/** 单渠道某日的派生值 */
function t4Row(chId, date) {
  const r = (T4.data[chId] || {})[date];
  if (!r) return null;
  const income = +r.income || 0, cost = +r.cost || 0, promo = +r.promo || 0, refund = +r.refund || 0;
  const gross = income - cost - promo + refund;   // 退货存负数
  return { ...r, income, cost, promo, refund, gross, rate: income ? gross / income : 0 };
}
/** 渠道月累计 */
function t4Month(chId) {
  const o = { income: 0, cost: 0, promo: 0, refund: 0, gross: 0, days: 0 };
  Object.keys(T4.data[chId] || {}).forEach(d => {
    const r = t4Row(chId, d); if (!r) return;
    o.income += r.income; o.cost += r.cost; o.promo += r.promo; o.refund += r.refund; o.gross += r.gross; o.days++;
  });
  o.rate = o.income ? o.gross / o.income : 0;
  return o;
}
/** 分组汇总（特卖 / 直属 / 事业部） */
function t4Group(ids) {
  const o = { income: 0, cost: 0, promo: 0, refund: 0, gross: 0 };
  ids.forEach(id => { const m = t4Month(id); ['income','cost','promo','refund','gross'].forEach(k => o[k] += m[k]); });
  o.rate = o.income ? o.gross / o.income : 0;
  return o;
}
const T4_TMAI = T4_CH.filter(c => c.tier === '特卖').map(c => c.id);
const T4_ALL = T4_CH.map(c => c.id);

/* ============ 界面 ============ */
function t4Cal(chId) {
  const N = t4Days(); let h = '<div class="t4cal">';
  for (let d = 1; d <= N; d++) {
    const r = (T4.data[chId] || {})[t4Date(d)];
    const cls = !r ? 'n' : (r._hard && r._hard.length ? 'h' : 'f');
    h += `<i class="${cls}" title="${d} 日${r ? '' : ' · 未填'}">${d}</i>`;
  }
  return h + '</div>';
}

S['t4'] = () => {
  t4Load();
  const g = t4Gap(), ok = t4SumOK();
  const rows = T4_CH.map(c => {
    const n = t4Filled(c.id), m = t4Month(c.id);
    const st = n === 0 ? pill('未开始', 'cr') : n <= 5 ? pill('严重缺', 'cr') : n < 15 ? pill('缺口大', 'wa') : pill('较完整', 'ok');
    return [
      `<b>${H(c.n)}</b>`, c.tier === '特卖' ? pill('特卖', 'in') : pill('直属', 'mu'),
      `<b class="mono">${n}</b> / ${t4Days()}`, t4Cal(c.id),
      c.src === 'file' ? pill('有源文件', 'ok') : pill('人工填', 'wa'),
      n ? money(m.income) : '—', n ? money(m.gross) : '—',
      n && m.income ? (m.rate * 100).toFixed(1) + '%' : '—', st,
      `<button class="btn sm" data-t4go="${c.src === 'file' ? 'imp' : 'man'}:${c.id}">${c.src === 'file' ? '导入' : '录入'}</button>`
    ];
  });
  return head('T4　日损益速算表',
    '三层结构：6 个渠道子表 → 特卖汇总 → 事业部汇总。<b>汇总由工具重算，不接受导入</b>——杜绝跨表公式串行。',
    '工具箱 · 已上线',
    `<span class="sel">期间 <b>${T4.period}</b></span><button class="btn" data-t4go="rules">取数口径</button><button class="btn pri" data-t4go="sheet">看日损益表</button>`)
    + kpis([
      { k: '渠道', v: String(T4_CH.length), u: '个' },
      { k: '最多已填', v: String(g.max), u: '天' },
      { k: '最少已填', v: String(g.min), u: '天', t: g.min === 0 ? 'c' : '' },
      { k: '天数极差', v: String(g.gap), u: '天', t: ok ? 'g' : 'c', d: `阈值 ${T4_GAP_LIMIT} 天` },
      { k: '汇总可用', v: ok ? '是' : '否', t: ok ? 'g' : 'c' },
      { k: '本月毛利', v: ok ? money(t4Group(T4_ALL).gross) : '—', t: ok ? 'g' : 'mu' },
    ])
    + (ok
      ? `<div class="note g"><b>各渠道取数天数已对齐</b>（极差 ${g.gap} 天 ≤ ${T4_GAP_LIMIT}），汇总可用。</div>`
      : g.max === 0
        ? `<div class="note"><b>本期还没有任何数据。</b>有源文件的渠道（天猫、京东自营）点「导入」；其余四个点「录入」手工填。</div>`
        : `<div class="note c"><b>汇总已禁用。</b>渠道取数天数极差 <b>${g.gap} 天</b>，超过阈值 ${T4_GAP_LIMIT} 天。把「${g.max} 天的渠道」和「${g.min} 天的渠道」加起来得到的数没有业务含义，<b>拿去开经营会比没有数更危险</b>。请先把缺口补齐。</div>`)
    + card('六渠道取数进度', table(
      [{ t: '渠道' }, { t: '分组' }, { t: '已填', n: 1 }, { t: `日历（1—${t4Days()}）` }, { t: '数据源' },
       { t: '月累计收入', n: 1 }, { t: '月累计毛利', n: 1 }, { t: '毛利率' }, { t: '状态' }, { t: '' }], rows))
    + `<div class="t4lg">
        <span><em class="f"></em>已填</span>
        <span><em class="h"></em>含硬推口径</span>
        <span><em class="n"></em>未填</span>
      </div>`;
};

/* ── 手工录入 ── */
S['t4-man'] = () => {
  t4Load();
  const c = T4_CHM[T4.editCh], N = t4Days();
  const rows = [];
  for (let d = 1; d <= N; d++) {
    const dt = t4Date(d), r = (T4.data[c.id] || {})[dt] || {};
    rows.push([
      `<b class="mono">${d}</b>`,
      ...T4_FIELDS.map(f => `<input type="number" step="0.01" class="t4in" data-t4cell="${dt}:${f.k}" value="${r[f.k] != null ? r[f.k] : ''}" placeholder="—">`),
      r.income != null ? `<b class="${(t4Row(c.id, dt) || {}).gross >= 0 ? 'grn' : 'red'}">${money((t4Row(c.id, dt) || {}).gross)}</b>` : '<span class="mut">—</span>',
    ]);
  }
  return head(`录入　${c.n}`, `该渠道无数据源，按日人工录入。<b>退货填负数</b>。留空表示当日无数据，不会被当作 0 计入汇总。`, '工具箱 · T4',
    `<select id="t4chSel">${T4_CH.filter(x => x.src === 'manual').map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${x.n}</option>`).join('')}</select>
     <button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="saveMan">保存</button>`)
    + `<div class="note"><b>已填 ${t4Filled(c.id)} / ${N} 天。</b>留空与填 0 是<b>两回事</b>：留空 = 当天没数据（不计入天数），0 = 当天确实为零（计入天数）。这个区分直接影响汇总能不能用。</div>`
    + card(`${c.n} · ${T4.period}`, table(
      [{ t: '日' }, ...T4_FIELDS.map(f => ({ t: f.n, n: 1 })), { t: '边际毛利', n: 1 }], rows));
};

/* ── 文件导入 ── */
S['t4-imp'] = () => {
  t4Load();
  const c = T4_CHM[T4.editCh];
  const imp = T4.imp;
  if (!c || !c.files) {
    // 人工渠道没有源文件，别在这儿崩
    return head('导入', '该渠道没有可导入的源文件。', '工具箱 · T4',
      `<button class="btn" data-t4go="overview">← 返回</button>`)
      + `<div class="note w"><b>${H(c ? c.n : '该渠道')}</b> 目前无数据源，请用<b>手工录入</b>。
         有源文件的只有<b>天猫</b>和<b>京东自营</b>两个渠道。</div>`
      + `<div class="tgrid">${T4_CH.filter(x => x.files).map(x =>
          `<button class="tcard" data-t4go="imp:${x.id}"><span class="tc-h"><span class="tc-n">${H(x.n)}</span></span>
           <span class="tc-d">${x.files.map(f => H(f.n)).join(' · ')}</span></button>`).join('')}</div>`;
  }
  if (!imp) {
    return head(`导入　${c.n}`, '选择该渠道的源文件。工具按已确认的取数口径落到每一天。', '工具箱 · T4',
      `<button class="btn" data-t4go="overview">← 返回</button>`)
      + cardp('本渠道需要的源文件', table([{ t: '文件' }, { t: '取数口径' }, { t: '' }],
        c.files.map(f => [`<b>${H(f.n)}</b>`, `<span class="mut">${H(f.hint)}</span>`,
          `<button class="btn sm" data-t4file="${f.k}">选择文件</button>`])))
      + (c.hard ? `<div class="note c"><b>本渠道含硬推口径：</b>${c.hard.map(h => `${h.n} = <b>${h.rule}</b>`).join('、')}。这些不是算出来的，是设定的——导入后会在报表上标红，<b>不伪装成计算结果</b>。</div>` : '')
      + `<div class="note w"><b>没有源文件也能用：</b>切到「录入」手工填，两种方式的数据在汇总里等价处理，只是来源标记不同。</div>`;
  }
  // 已选文件 → 表头映射
  const head0 = imp.rows[imp.headRow] || [];
  const opt = k => head0.map((h, j) => `<option value="${j}" ${imp.map[k] === j ? 'selected' : ''}>${H(String(h || '(空)').slice(0, 20))}</option>`).join('');
  const need = [{ k: 'date', n: '日期' }, { k: 'val', n: imp.fileK === 'jzt' ? '支出金额' : '金额' }];
  return head(`导入　${c.n} · ${H(imp.fileN)}`, '确认列对应关系。', '工具箱 · T4',
    `<button class="btn" data-t4act="impCancel">取消</button>`)
    + `<div class="frow" style="margin-bottom:13px"><span class="fi">✓</span>
        <span><span class="fn">${H(imp.fileName)}</span><br><span class="fm">${imp.rows.length} 行</span></span></div>`
    + cardp('表头行', `<select id="t4head">${imp.rows.slice(0, Math.min(imp.rows.length, 12)).map((r, i) =>
      `<option value="${i}" ${i === imp.headRow ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 48))}</option>`).join('')}</select>`)
    + card('列对应', table([{ t: '需要' }, { t: '文件里的列' }],
      need.map(f => [H(f.n) + ' <span class="red">*</span>',
        `<select data-t4map="${f.k}"><option value="">— 选择 —</option>${opt(f.k)}</select>`])))
    + (imp.filter ? `<div class="note"><b>过滤规则生效中：</b>${H(imp.filter)}</div>` : '')
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn pri" data-t4act="impRun" ${imp.map.date !== undefined && imp.map.val !== undefined ? '' : 'disabled'}>导入</button>
      </div>`;
};

/* ── 日损益表（三层） ── */
S['t4-sheet'] = () => {
  t4Load();
  const ok = t4SumOK(), g = t4Gap();
  const chRows = T4_CH.map(c => {
    const m = t4Month(c.id), n = t4Filled(c.id);
    const hard = c.hard ? pill('含硬推', 'cr') : (c.src === 'manual' ? pill('人工填', 'wa') : pill('直取', 'ok'));
    return n ? [`<b>${H(c.n)}</b>`, `<span class="mono">${n}</span> 天`, money(m.income), money(m.cost),
      money(m.promo), money(m.refund), `<b class="${m.gross >= 0 ? 'grn' : 'red'}">${money(m.gross)}</b>`,
      (m.rate * 100).toFixed(1) + '%', hard]
      : [`<b>${H(c.n)}</b>`, '<span class="red">0</span> 天', '—', '—', '—', '—', '—', '—', pill('无数据', 'mu')];
  });
  const tm = t4Group(T4_TMAI), all = t4Group(T4_ALL);
  return head('日损益表', '第 1 层各渠道月累计；第 2、3 层由工具重算。', '工具箱 · T4',
    `<button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="export">导出</button>`)
    + (ok ? '' : `<div class="note c"><b>第 2、3 层已禁用。</b>渠道取数天数极差 ${g.gap} 天 &gt; ${T4_GAP_LIMIT} 天。可以看单渠道，不能看合计。</div>`)
    + card('第 1 层　渠道子表（月累计）', table(
      [{ t: '渠道' }, { t: '天数' }, { t: '零售收入', n: 1 }, { t: '零售成本', n: 1 }, { t: '推广费', n: 1 },
       { t: '退货', n: 1 }, { t: '边际毛利', n: 1 }, { t: '毛利率' }, { t: '口径' }], chRows))
    + `<div class="cols c2">
      ${cardp('第 2 层　特卖汇总',
        `<div class="mut" style="font-size:11.5px;margin-bottom:9px">= 京东自营 + 唯品会 + 京东POP</div>`
        + (ok ? table([{ t: '项' }, { t: '金额', n: 1 }], [
            ['零售收入', money(tm.income)], ['零售成本', money(tm.cost)], ['推广费', money(tm.promo)],
            ['退货', money(tm.refund)], ['<b>边际毛利</b>', `<b class="grn">${money(tm.gross)}</b>`],
            ['毛利率', (tm.rate * 100).toFixed(1) + '%']])
          : `<div class="note c" style="margin:0"><b>已禁用</b>——唯品会 ${t4Filled('vip')} 天、京东自营 ${t4Filled('jdzy')} 天，不对齐。</div>`))}
      ${cardp('第 3 层　事业部汇总',
        `<div class="mut" style="font-size:11.5px;margin-bottom:9px">= 天猫 + 特卖平台 + 快手 + 私域</div>`
        + (ok ? table([{ t: '项' }, { t: '金额', n: 1 }], [
            ['零售收入', money(all.income)], ['零售成本', money(all.cost)], ['推广费', money(all.promo)],
            ['退货', money(all.refund)], ['<b>边际毛利</b>', `<b class="grn">${money(all.gross)}</b>`],
            ['毛利率', (all.rate * 100).toFixed(1) + '%']])
          : `<div class="note c" style="margin:0"><b>已禁用。</b>旧 Excel 在这一层因私域列串行 7 行，算出「房租物业水电-公摊 = -659.18 元」的负房租。本工具不用跨表引用，按渠道结构重新聚合，不会重蹈覆辙。</div>`))}
    </div>`
    + (t4Filled('jdzy') ? `<div class="note c"><b>京东自营的毛利率是设定值，不是算出来的。</b>零售成本按收入 × 45%、退货按 -16% 硬推，所以毛利率恒定。经营会上讨论这个数之前，请先说明这一点。</div>` : '');
};

/* ── 取数口径 ── */
S['t4-rules'] = () => head('取数口径', '各渠道口径不同且有硬推项。写进工具，不再靠人记。', '工具箱 · T4',
  `<button class="btn" data-t4go="overview">← 返回</button>`)
  + card('已确认口径', table(
    [{ t: '渠道' }, { t: '项目' }, { t: '规则' }, { t: '类型' }],
    [
      ['天猫', '收入', '销售单明细账 → <b>只取「天猫-澳乐旗舰店」</b>，排除 zzzrest 旗舰店（属另一事业部）', pill('过滤', 'in')],
      ['天猫', '直通车', '按<b>记账时间</b>归属，不按消耗日', pill('归属口径', 'wa')],
      ['天猫', 'CPS', '按明细表<b>日期列</b>归属', pill('归属口径', 'wa')],
      ['京东自营', '收入', '「收入交易概况」→ 当日成交金额', pill('直取', 'ok')],
      ['京东自营', '推广费', '「京准通推广费」→ 当日支出金额，<b>源表为负数，取绝对值</b>', pill('符号处理', 'wa')],
      ['京东自营', '零售成本', '<b class="red">无数据源，按 收入 × 45% 硬推</b>', pill('硬推', 'cr')],
      ['京东自营', '退货', '<b class="red">按 收入 × -16% 硬推</b>', pill('硬推', 'cr')],
      ['全渠道', '留空 vs 0', '留空 = 当天无数据（不计入天数）；0 = 当天确实为零（计入天数）', pill('计数口径', 'in')],
    ]))
  + `<div class="note c"><b>硬推口径必须在报表上标出来。</b>Excel 里「算出来的」和「设定的」长得一样，工具里必须能区分——否则经营会上会把 55% 的恒定毛利率当成真实经营结果讨论。</div>`
  + cardp('工具消化掉的结构差异', table([{ t: '差异' }, { t: '旧 Excel' }, { t: '本工具' }],
    [
      ['日期列偏移', '天猫 K 列、京东自营 I 列、私域 E 列，步长还不同', '内部处理，用户不用记'],
      ['行号差异', '天猫推广费拆多行，京东自营只有第 14 行一行', '按字段名对齐'],
      ['汇总方式', '跨表公式引用，易串行', '按渠道结构重新聚合'],
      ['缺行处理', '悄悄取到隔壁行的数', '直接报「缺某行」'],
    ]));

/* ============ 交互 ============ */
function t4Export() {
  const N = t4Days(), hdr = ['期间', '渠道', '日期', '零售收入', '零售成本', '推广费', '退货', '边际毛利', '毛利率', '口径', '来源'];
  const rows = [];
  T4_CH.forEach(c => {
    for (let d = 1; d <= N; d++) {
      const dt = t4Date(d), r = t4Row(c.id, dt);
      if (!r) continue;
      rows.push([T4.period, c.n, dt, r.income.toFixed(2), r.cost.toFixed(2), r.promo.toFixed(2),
        r.refund.toFixed(2), r.gross.toFixed(2), (r.rate * 100).toFixed(1) + '%',
        (r._hard && r._hard.length) ? '含硬推:' + r._hard.join('/') : '直取', r._src === 'file' ? '文件' : '人工']);
    }
  });
  const ok = t4SumOK();
  rows.push([]);
  rows.push(['—— 汇总 ——', ok ? '' : '已禁用：渠道取数天数不对齐，极差 ' + t4Gap().gap + ' 天']);
  if (ok) {
    const tm = t4Group(T4_TMAI), all = t4Group(T4_ALL);
    rows.push(['特卖汇总', '京东自营+唯品会+京东POP', '', tm.income.toFixed(2), tm.cost.toFixed(2), tm.promo.toFixed(2), tm.refund.toFixed(2), tm.gross.toFixed(2), (tm.rate * 100).toFixed(1) + '%']);
    rows.push(['事业部汇总', '天猫+特卖+快手+私域', '', all.income.toFixed(2), all.cost.toFixed(2), all.promo.toFixed(2), all.refund.toFixed(2), all.gross.toFixed(2), (all.rate * 100).toFixed(1) + '%']);
  }
  download(`日损益表_${T4.period}.csv`, toCSV([hdr].concat(rows)));
  toast(ok ? '已导出（含汇总）' : '已导出（汇总因数据不对齐被禁用）', 3400);
}

async function t4PickFile(fileK) {
  const c = T4_CHM[T4.editCh];
  const f = c.files.find(x => x.k === fileK);
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx,.csv,.tsv,.txt';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      toast('正在解析…');
      const rows = await XLSXLite.readTable(file);
      const kw = ['日期', '时间', '金额', '成交', '支出', '消耗', '店铺', '渠道'];
      const hr = XLSXLite.findHeaderRow(rows, kw);
      const hd = rows[hr] || [];
      const map = {};
      hd.forEach((h, i) => {
        const s = String(h || '').replace(/\s/g, '');
        if (map.date === undefined && /日期|时间/.test(s)) map.date = i;
        if (map.val === undefined && /成交金额|支出金额|金额|消耗/.test(s)) map.val = i;
      });
      T4.imp = { fileK, fileN: f.n, fileName: file.name, rows, headRow: hr, map,
        filter: fileK === 'sales' ? '只取「天猫-澳乐旗舰店」' : '' };
      t4Go('imp');
      toast(`读到 ${rows.length} 行`);
    } catch (e) { toast('读取失败：' + e.message, 4200); }
  };
  inp.click();
}

function t4ImpRun() {
  const imp = T4.imp, c = T4_CHM[T4.editCh];
  const body = imp.rows.slice(imp.headRow + 1);
  const field = imp.fileK === 'income' ? 'income' : 'promo';
  const abs = imp.fileK === 'jzt';
  let n = 0, skip = 0;
  body.forEach(r => {
    const raw = String(r[imp.map.date] || '');
    const m = /(\d{4})[-/年.]?(\d{1,2})[-/月.]?(\d{1,2})/.exec(raw);
    if (!m) { skip++; return; }
    const dt = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    if (!dt.startsWith(T4.period)) { skip++; return; }
    // 天猫销售明细：按店铺过滤
    if (imp.fileK === 'sales') {
      const line = r.join(' ');
      if (!/澳乐旗舰店/.test(line) || /zzzrest/i.test(line)) { skip++; return; }
    }
    let v = Number(String(r[imp.map.val] || '').replace(/[,，\s¥￥]/g, '')) || 0;
    if (abs) v = Math.abs(v);
    if (!v) { skip++; return; }
    const cur = T4.data[c.id][dt] || { _src: 'file', _hard: [] };
    cur[field] = (cur[field] || 0) + v;
    cur._src = 'file';
    // 京东自营：硬推成本与退货
    if (c.hard && field === 'income') {
      cur._hard = [];
      c.hard.forEach(h => { cur[h.f] = +(v * h.k).toFixed(2); cur._hard.push(h.n); });
    }
    T4.data[c.id][dt] = cur;
    n++;
  });
  t4Save();
  T4.imp = null;
  t4Go('overview');
  toast(`导入 ${n} 天${skip ? `，跳过 ${skip} 行（非本期/无金额/被过滤）` : ''}`, 3800);
}

function t4Go(v) {
  T4.view = v;
  const id = v === 'overview' ? 't4' : 't4-' + v;
  go(id);
}

/* 事件（挂在 document 上，与 app.js 的委托并存） */
document.addEventListener('click', e => {
  const g = e.target.closest('[data-t4go]');
  if (g) {
    const [v, ch] = g.dataset.t4go.split(':');
    if (ch) T4.editCh = ch;
    if (v === 'imp') T4.imp = null;
    t4Go(v); return;
  }
  const f = e.target.closest('[data-t4file]');
  if (f) { t4PickFile(f.dataset.t4file); return; }
  const a = e.target.closest('[data-t4act]');
  if (!a) return;
  const act = a.dataset.t4act;
  if (act === 'saveMan') {
    let n = 0;
    document.querySelectorAll('[data-t4cell]').forEach(inp => {
      const [dt, k] = inp.dataset.t4cell.split(':');
      const v = inp.value.trim();
      const cur = T4.data[T4.editCh][dt];
      if (v === '') {
        if (cur) { delete cur[k]; if (!T4_FIELDS.some(f => cur[f.k] != null)) delete T4.data[T4.editCh][dt]; }
      } else {
        const o = cur || { _src: 'manual', _hard: [] };
        o[k] = Number(v) || 0; o._src = 'manual';
        T4.data[T4.editCh][dt] = o; n++;
      }
    });
    t4Save(); toast(`已保存 ${n} 个数值`); t4Go('overview');
  }
  else if (act === 'export') t4Export();
  else if (act === 'impCancel') { T4.imp = null; t4Go('imp'); }
  else if (act === 'impRun') t4ImpRun();
});
document.addEventListener('change', e => {
  if (e.target.id === 't4chSel') { T4.editCh = e.target.value; t4Go('man'); }
  if (e.target.id === 't4head' && T4.imp) { T4.imp.headRow = +e.target.value; T4.imp.map = {}; t4Go('imp'); }
  if (e.target.dataset && e.target.dataset.t4map && T4.imp) {
    const k = e.target.dataset.t4map;
    if (e.target.value === '') delete T4.imp.map[k]; else T4.imp.map[k] = +e.target.value;
    t4Go('imp');
  }
});

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
    `<button class="btn pri" data-act="bsExp">导出科目表</button>`)
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

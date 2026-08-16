/* 经期小记 — 纯净私密 PWA (vanilla JS, 本地存储) */
'use strict';

/* ---------- 存储 ---------- */
const KEY = 'cycle.tracker.v1';
function defaults() {
  return { periods: [], intimacy: [], settings: { avgCycle: 28, luteal: 14, periodLen: 5, lightIntensity: 0.55, passcode: null, theme: 'system', reminders: { period: true, fertile: false } } };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const d = defaults();
      d.periods = Array.isArray(o.periods) ? o.periods : [];
      d.intimacy = Array.isArray(o.intimacy) ? o.intimacy : [];
      if (o.settings) d.settings = Object.assign(d.settings, o.settings);
      return d;
    }
  } catch (e) { /* ignore */ }
  return defaults();
}
let S = load();
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- 日期工具 ---------- */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseKey(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function fmtMD(s) { const d = parseKey(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtFull(s) { const d = parseKey(s); const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]; return fmtMD(s) + ' 周' + w; }
function diffDays(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
function addDays(s, n) { const d = parseKey(s); d.setDate(d.getDate() + n); return dayKey(d); }
function todayKey() { return dayKey(new Date()); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- 推算算法 ---------- */
function sortedPeriods() { return [...S.periods].sort((a, b) => a.start < b.start ? -1 : 1); }
function periodDaySet() {
  const s = new Set();
  S.periods.forEach(p => { const [st, en] = periodSpan(p); let c = st; while (c <= en) { s.add(c); c = addDays(c, 1); } });
  return s;
}
function periodDayMap() {
  const m = new Map();
  S.periods.forEach(p => { const [st, en] = periodSpan(p); let c = st; while (c <= en) { if (!m.has(c)) m.set(c, p.start); c = addDays(c, 1); } });
  return m;
}
function cycleLengths() {
  const ps = sortedPeriods(); const out = [];
  for (let i = 1; i < ps.length; i++) out.push(diffDays(ps[i - 1].start, ps[i].start));
  return out;
}
function avgCycle() {
  const L = cycleLengths();
  if (L.length >= 1) return Math.round(L.reduce((a, b) => a + b, 0) / L.length);
  return S.settings.avgCycle;
}
function regularity() {
  const L = cycleLengths();
  if (L.length < 2) return { label: '数据不足', cv: null };
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const variance = L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length;
  const sd = Math.sqrt(variance); const cv = sd / mean;
  return { label: cv < 0.08 ? '很规律' : cv < 0.15 ? '较规律' : '不规律', cv, mean, sd };
}
function predictNextStart() {
  const ps = sortedPeriods();
  if (ps.length === 0) return addDays(todayKey(), S.settings.avgCycle);
  return addDays(ps[ps.length - 1].start, avgCycle());
}
function ovulation() { return addDays(predictNextStart(), -S.settings.luteal); }
function fertileWindow() { return [addDays(ovulation(), -5), addDays(ovulation(), 1)]; }

/* ---------- 经期跨度与推算 ---------- */
function latestPeriod() { const ps = sortedPeriods(); return ps.length ? ps[ps.length - 1] : null; }
/* 推算结束日：已记录用记录值，未结束用「开始 + 经期长度 - 1」 */
function periodEndEst(p) {
  if (!p) return null;
  if (p.end) return p.end;
  const len = S.settings.periodLen || 5;
  return addDays(p.start, len - 1);
}
/* 经期实际跨度 [start, end]：未结束的经期延展到「今天」（进行中显示到今天） */
function periodSpan(p) {
  const start = p.start;
  let end = p.end || p.start;
  if (!p.end) { const est = periodEndEst(p); const td = todayKey(); end = td > est ? est : td; }
  return [start, end];
}
/* 某天落在哪个经期（含进行中延展），返回该 period 或 null
   当存在重叠的进行中经期时，优先返回「开始日最早」的那条（即真正的本轮经期，
   避免误点「开始」生成的假经期覆盖今天的统计） */
function periodAt(dateStr) {
  const ps = sortedPeriods(); // 已按 start 升序
  for (let i = 0; i < ps.length; i++) {
    const [s, e] = periodSpan(ps[i]);
    if (dateStr >= s && dateStr <= e) return ps[i];
  }
  return null;
}

function phaseInfo(dateStr) {
  if (periodDaySet().has(dateStr)) return { phase: '月经期', cls: 'period' };
  const ps = sortedPeriods();
  if (ps.length === 0) return { phase: '待记录', cls: '' };
  const last = ps[ps.length - 1].start;
  const next = predictNextStart();
  const ovu = ovulation();
  if (dateStr < last) return { phase: '记录前', cls: '' };
  if (dateStr === ovu) return { phase: '排卵期', cls: 'ovu' };
  if (dateStr < ovu) return { phase: '卵泡期', cls: '' };
  if (dateStr <= next) return { phase: '黄体期', cls: '' };
  return { phase: '黄体期', cls: '' };
}

/* Wilcox 1995 单次同房受孕概率（相对排卵日偏移） */
const WILCOX = [[-6, 0.00], [-5, 0.10], [-4, 0.16], [-3, 0.14], [-2, 0.27], [-1, 0.31], [0, 0.33], [1, 0.15], [2, 0.04], [3, 0.01]];
function wilcox(off) {
  if (off <= -6) return 0;
  if (off >= 3) return 0.01;
  for (let i = 0; i < WILCOX.length - 1; i++) {
    const [a, pa] = WILCOX[i], [b, pb] = WILCOX[i + 1];
    if (off >= a && off <= b) return pa + (pb - pa) * (off - a) / (b - a);
  }
  return 0.01;
}
function pregnancy() {
  const ps = sortedPeriods();
  if (ps.length === 0) return { prob: 0, count: 0, has: false };
  const last = ps[ps.length - 1].start;
  const next = predictNextStart();
  const ovu = ovulation();
  const recs = S.intimacy.filter(r => r.hadSex && r.date >= last && r.date <= next);
  let P = 1;
  recs.forEach(r => {
    let p = wilcox(diffDays(ovu, r.date));
    if (r.contraception && r.contraception !== 'none') {
      const f = { condom: 0.13, pill: 0.01, other: 0.10 }[r.contraception] || 0.10;
      p = p * f;
    }
    P *= (1 - p);
  });
  return { prob: Math.round((1 - P) * 100), count: recs.length, has: true };
}
function conLabel(c) { return { none: '无措施', condom: '避孕套', pill: '口服', other: '其他' }[c] || c; }

/* ---------- 渲染 ---------- */
let currentTab = 'today';
let calMonth = new Date();
let currentLocked = false;

function renderToday() {
  const t = todayKey();
  const p = periodAt(t);
  let phase, countHtml, sub, dailyHtml = '';
  if (p) {
    const start = p.start;
    const d = diffDays(start, t) + 1;
    const endEst = periodEndEst(p);
    const toEnd = diffDays(t, endEst);
    const endMsg = toEnd > 0 ? `距离经期结束还有 ${toEnd} 天`
      : toEnd === 0 ? '今天是经期最后一天'
      : `经期已结束 ${-toEnd} 天，记得记录结束日`;
    phase = '月经期';
    countHtml = `<div class="count">${d}<small> 天</small></div>`;
    sub = `${endMsg} · 当前第 ${d} 天`;
    /* 展示今日过程记录（如果有） */
    if (Array.isArray(p.daily)) {
      const todayRec = p.daily.find(r => r.date === t);
      if (todayRec) {
        const dsym = todayRec.symptoms && todayRec.symptoms.length ? todayRec.symptoms.join(' ') : '';
        dailyHtml = `<div class="today-daily">
          <span class="td-flow">${todayRec.flow || ''}</span>
          ${dsym ? `<span class="td-sym">${esc(dsym)}</span>` : ''}
          ${todayRec.mood ? `<span class="td-mood">· ${todayRec.mood}</span>` : ''}
        </div>`;
      }
      /* 已记录天数提示 */
      const recCnt = p.daily.length;
      if (recCnt > 0) {
        sub += ` <small class="daily-badge">已记录 ${recCnt}/${d} 天</small>`;
      }
    }
  } else {
    const lp = latestPeriod();
    if (!lp) {
      phase = '待记录';
      countHtml = '';
      sub = '还没有经期记录，点下方按钮开始';
    } else {
      const next = predictNextStart(), ovu = ovulation();
      const toNext = diffDays(t, next), toOvu = diffDays(t, ovu);
      phase = phaseInfo(t).phase;
      if (toNext > 0) {
        countHtml = `<div class="count">${toNext}<small> 天</small></div>`;
        const o = toOvu > 0 ? `距排卵 ${toOvu} 天` : toOvu === 0 ? '今日排卵' : `已过排卵 ${-toOvu} 天`;
        sub = `距离经期开始还有 ${toNext} 天 · ${o}`;
      } else if (toNext === 0) {
        countHtml = `<div class="count">0<small> 天</small></div>`;
        sub = '预计今天来潮，记得记录';
      } else {
        countHtml = `<div class="count" style="color:var(--amber)">${-toNext}<small> 天</small></div>`;
        sub = `已逾期 ${-toNext} 天，记得记录经期`;
      }
    }
  }
  const last = sortedPeriods().slice(-1)[0];
  const mini = last ? `上次经期：${fmtMD(last.start)}` : '还没有经期记录，点下方按钮开始';
  return `<div class="card status">
      <div class="phase">${phase}</div>
      ${countHtml}
      <div class="sub">${sub}</div>
      ${dailyHtml}
    </div>
    <div class="btn-row">
      <button class="btn" data-action="open-period">记经期</button>
      <button class="btn primary" data-action="open-intimacy">记亲密</button>
    </div>
    <div class="mini">${mini}</div>`;
}

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMon = new Date(y, m + 1, 0).getDate();
  const set = periodDaySet();
  const ovu = ovulation(), fw = fertileWindow();
  const lp = latestPeriod();
  const lpEndEst = lp ? periodEndEst(lp) : null;
  const t = todayKey();
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div></div>`;
  for (let d = 1; d <= daysInMon; d++) {
    const ds = dayKey(new Date(y, m, d - 1));
    let cls = 'day';
    if (set.has(ds)) cls += ' period';
    else if (lp && !lp.end && ds > lp.start && ds <= lpEndEst) cls += ' period-pred';
    else if (ds >= fw[0] && ds <= fw[1]) cls += ' fertile';
    if (ds === ovu) cls += ' ovu';
    if (ds === t) cls += ' today';
    const hasIns = S.intimacy.some(r => r.date === ds);
    cells += `<div class="${cls}" data-action="day-open" data-date="${ds}">${d}${hasIns ? '<span class="dot"></span>' : ''}</div>`;
  }
  return `<div class="cal-head"><button data-action="cal-prev">‹</button><div class="m">${y}年${m + 1}月</div><button data-action="cal-next">›</button></div>
   <div class="cal-grid"><div class="cal-dow">一</div><div class="cal-dow">二</div><div class="cal-dow">三</div><div class="cal-dow">四</div><div class="cal-dow">五</div><div class="cal-dow">六</div><div class="cal-dow">日</div>${cells}</div>
   <div class="legend"><span><i style="background:var(--pink)"></i>经期</span><span><i style="background:rgba(244,143,177,.28);border:1px dashed rgba(236,106,152,.6)"></i>经期(推算)</span><span><i style="background:rgba(179,157,219,.35);border:1px solid rgba(179,157,219,.5)"></i>易孕窗口</span><span><i style="background:rgba(246,193,119,.42);border:1px solid rgba(246,193,119,.6);color:#8a6d2b"></i>排卵日</span><span><i style="background:var(--pink-deep);border-radius:50%;width:8px;height:8px"></i>亲密</span></div>`;
}

function renderStats() {
  const reg = regularity();
  const next = predictNextStart(), ovu = ovulation(), fw = fertileWindow();
  const preg = pregnancy();
  let html = `<div class="grid2">
    <div class="stat"><div class="k">平均周期</div><div class="v">${avgCycle()}<small> 天</small></div></div>
    <div class="stat"><div class="k">规律度</div><div class="v">${reg.label}</div></div>
    <div class="stat"><div class="k">下次经期(预测)</div><div class="v" style="font-size:15px">${fmtMD(next)}</div></div>
    <div class="stat"><div class="k">排卵日(预测)</div><div class="v" style="font-size:15px">${fmtMD(ovu)}</div></div>
    <div class="stat"><div class="k">易孕窗口</div><div class="v" style="font-size:13px">${fmtMD(fw[0])} ~ ${fmtMD(fw[1])}</div></div>
    <div class="stat"><div class="k">本月受孕概率</div><div class="v">${preg.has ? preg.prob + '%' : '—'}</div></div>
  </div>`;
  html += `<div class="card"><h3>说明</h3><div class="disclaimer">受孕概率为人群统计参考（Wilcox 1995），基于已记录的「爱爱」日期与推算排卵日估算，<b>非医学诊断、不可作为避孕依据</b>。记录越多、周期越规律，推算越准。</div></div>`;
  const ps = sortedPeriods();
  if (ps.length) {
    html += `<div class="card"><h3>历史周期</h3>`;
    [...ps].reverse().slice(0, 12).forEach(p => {
      const len = p.end ? diffDays(p.start, p.end) + 1 : null;
      const sym = (p.symptoms && p.symptoms.length) ? ' · ' + esc(p.symptoms.join('/')) : '';
      const dailyCnt = Array.isArray(p.daily) ? p.daily.length : 0;
      const dailyTag = dailyCnt > 0 ? ` <small style="color:var(--purple)">(${dailyCnt}天过程)</small>` : '';
      html += `<div class="row"><span class="label">${fmtMD(p.start)}${p.end ? ' ~ ' + fmtMD(p.end) : '（进行中）'}</span><span class="val">${p.flow || ''}${sym} ${len ? len + '天' : ''}${dailyTag}</span></div>`;
      /* 展示每日过程记录摘要（折叠式） */
      if (Array.isArray(p.daily) && p.daily.length > 0) {
        html += `<div class="daily-summary">`;
        p.daily.forEach(dr => {
          const dn = diffDays(p.start, dr.date) + 1;
          const dsym = dr.symptoms && dr.symptoms.length ? ' · ' + esc(dr.symptoms.join('/')) : '';
          html += `<div class="row sub-row"><span class="label">第${dn}天 ${fmtMD(dr.date)}</span><span class="val">${dr.flow || ''}${dsym} ${dr.mood || ''}</span></div>`;
        });
        html += `</div>`;
      }
    });
    html += `</div>`;
  } else {
    html += `<div class="empty">还没有经期记录，去「今天」记一笔吧</div>`;
  }
  return html;
}

function renderMe() {
  const st = S.settings;
  const li = Math.round((st.lightIntensity != null ? st.lightIntensity : 0.55) * 100);
  return `<div class="me-hero">
    <div class="avatar">🌸</div>
    <div class="me-name">小杜经期小记</div>
    <div class="me-sub">Yyy开发for小杜 · 纯净私密本地记录</div>
  </div>
  <div class="card"><h3>外观</h3>
    <div class="field"><label>主题</label><div class="seg" id="pTheme">
      <div class="chip${st.theme === 'system' || !st.theme ? ' on' : ''}" data-v="system">跟随系统</div>
      <div class="chip${st.theme === 'light' ? ' on' : ''}" data-v="light">浅色</div>
      <div class="chip${st.theme === 'dark' ? ' on' : ''}" data-v="dark">深色</div>
    </div></div>
    <div class="field slider-field">
      <div class="slider-head"><label>光效强度</label><span class="slider-val" id="liVal">${li}%</span></div>
      <input type="range" id="lightIntensity" class="range" min="10" max="90" value="${li}" style="--p:${li}%">
    </div>
  </div>
  <div class="card"><h3>推算设置</h3>
    <div class="field"><label>默认周期长度（天，记录不足时使用）</label><input type="number" id="setAvg" value="${st.avgCycle}" min="20" max="45"></div>
    <div class="field"><label>黄体期长度（天，默认14）</label><input type="number" id="setLut" value="${st.luteal}" min="9" max="20"></div>
    <div class="actions"><button class="btn primary" data-action="save-settings">保存设置</button></div>
  </div>
  <div class="card"><h3>隐私</h3>
    <div class="field"><label>启动密码（4位，留空则关闭）</label><input id="setPin" type="password" inputmode="numeric" maxlength="4" placeholder="选填"></div>
    <div class="actions"><button class="btn" data-action="set-passcode">设置密码</button></div>
    <div class="disclaimer">数据仅保存在本机浏览器，不上传任何服务器。</div>
  </div>
  <div class="card"><h3>数据</h3>
    <div class="actions"><button class="btn" data-action="export">导出备份(JSON)</button><button class="btn" data-action="import">导入</button></div>
    <div class="actions"><button class="btn ghost" data-action="clear-data">清空所有数据</button></div>
  </div>
  <div class="me-foot">小杜经期小记 v0.2 · 所有预测均为参考值，如有健康疑问请咨询医生。</div>`;
}

function render() {
  const v = document.getElementById('view');
  if (currentTab === 'today') v.innerHTML = renderToday();
  else if (currentTab === 'calendar') v.innerHTML = renderCalendar();
  else if (currentTab === 'stats') v.innerHTML = renderStats();
  else v.innerHTML = renderMe();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  const sub = { today: '今天', calendar: '日历', stats: '统计', me: '我的' }[currentTab];
  document.getElementById('headerSub').textContent = 'Yyy开发for小杜 · ' + sub;
  // 「我的」页隐藏顶部栏（页内已有 hero 卡片展示标题，避免重复）
  const hdr = document.querySelector('.app-header');
  if (hdr) hdr.classList.toggle('force-hide', currentTab === 'me');
}

/* ---------- 弹窗 ---------- */
function modal(html, locked) {
  currentLocked = !!locked;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
}
function closeModal() { if (currentLocked) return; document.getElementById('modalRoot').innerHTML = ''; }
function closeModalForce() { currentLocked = false; document.getElementById('modalRoot').innerHTML = ''; }

function bindChips(sel, single) {
  const box = document.querySelector(sel); if (!box) return;
  box.addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    if (single) { [...box.children].forEach(x => x.classList.remove('on')); c.classList.add('on'); }
    else c.classList.toggle('on');
  });
}
function getChips(sel) { const box = document.querySelector(sel); return [...box.querySelectorAll('.chip.on')].map(c => c.dataset.v); }

function openPeriodModal(prefill) {
  const d = prefill || todayKey();
  const flowOpts = ['少', '中', '多'];
  const symOpts = ['腰酸', '乳房胀痛', '腹痛', '头痛', '乏力', '情绪波动'];
  const moodOpts = ['开心', '平静', '焦虑', '低落', '易怒'];
  /* 检测是否有进行中的经期，用于显示「第几天」提示 */
  const active = [...S.periods].reverse().find(p => !p.end);
  /* 若有进行中的经期，默认选中「过程记录」而非「开始」，避免重复创建经期导致静默失败 */
  const defaultType = active ? 'daily' : 'start';
  const dayHint = active ? `<div class="day-hint" id="pDayHint">本轮经期第 <strong>${diffDays(active.start, d) + 1}</strong> 天（从 ${fmtMD(active.start)} 起算）</div>` : '';
  modal(`<h2>记录经期</h2>
   <div class="field"><label>类型</label><div class="seg" id="pType">
     <div class="chip${defaultType === 'start' ? ' on' : ''}${active ? ' disabled' : ''}" data-v="start">开始</div><div class="chip${defaultType === 'daily' ? ' on' : ''}" data-v="daily">过程记录</div><div class="chip" data-v="end">结束本次</div></div></div>
   ${active ? `<div class="field-note">已有进行中的经期（${fmtMD(active.start)} 起），无需再次「开始」。请用「过程记录」补充每日，或「结束本次」收尾。</div>` : ''}
   <div class="field" id="pDateWrap"><label id="pDateLabel">${defaultType === 'start' ? '开始日期' : '记录日期'}</label><input type="date" id="pDate" value="${d}"></div>
   ${dayHint}
   <div class="field" id="pFlowWrap"><label>经量</label><div class="chips" id="pFlow">
     ${flowOpts.map(f => `<div class="chip${f === '中' ? ' on' : ''}" data-v="${f}">${f}</div>`).join('')}</div></div>
   <div class="field"><label>症状（可多选）</label><div class="chips" id="pSym">
     ${symOpts.map(s => `<div class="chip" data-v="${s}">${s}</div>`).join('')}</div></div>
   <div class="field"><label>心情</label><div class="chips" id="pMood">
     ${moodOpts.map(mm => `<div class="chip" data-v="${mm}">${mm}</div>`).join('')}</div></div>
   <div class="field"><label>异常备注（如白带异常/血块）</label><input id="pAbn" placeholder="选填"></div>
   <div class="field"><label>备注</label><textarea id="pNote" placeholder="选填"></textarea></div>
   <div class="actions"><button class="btn ghost" data-action="close-modal">取消</button><button class="btn primary" data-action="save-period">保存</button></div>`);
  bindChips('#pFlow', true); bindChips('#pSym'); bindChips('#pMood', true);
  document.getElementById('pType').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    if (c.classList.contains('disabled')) return;
    [...e.currentTarget.children].forEach(x => x.classList.remove('on')); c.classList.add('on');
    const t = c.dataset.v;
    const isEnd = t === 'end';
    const isDaily = t === 'daily';
    const isStart = t === 'start';
    document.getElementById('pDateWrap').style.display = isEnd ? 'none' : '';
    document.getElementById('pFlowWrap').style.display = isEnd ? 'none' : '';
    document.getElementById('pDateLabel').textContent = isStart ? '开始日期' : '记录日期';
    const hint = document.getElementById('pDayHint');
    if (hint) hint.style.display = isDaily ? '' : 'none';
  });
  /* 初始化：根据默认类型显示/隐藏 dayHint */
  const hint0 = document.getElementById('pDayHint');
  if (hint0) hint0.style.display = defaultType === 'daily' ? '' : 'none';
}

function savePeriod() {
  const type = document.querySelector('#pType .chip.on').dataset.v;
  if (type === 'end') {
    const open = [...S.periods].reverse().find(p => !p.end);
    if (!open) { toast('没有进行中的经期'); return; }
    open.end = todayKey();
    save(); closeModal(); render(); toast('已记录经期结束');
    return;
  }
  if (type === 'daily') {
    const active = [...S.periods].reverse().find(p => !p.end);
    if (!active) { toast('没有进行中的经期，请先记录「开始」'); return; }
    const date = document.getElementById('pDate').value;
    if (!date) { toast('请选择日期'); return; }
    /* 日期必须在经期范围内 */
    if (date < active.start) { toast('记录日期不能早于经期开始日'); return; }
    if (active.end && date > active.end) { toast('记录日期不能晚于经期结束日'); return; }
    const flow = getChips('#pFlow')[0] || '中';
    const sym = getChips('#pSym');
    const mood = getChips('#pMood')[0] || '';
    const abn = document.getElementById('pAbn').value.trim();
    const note = document.getElementById('pNote').value.trim();
    /* 追加到 daily 数组（允许同一天多次记录，后者覆盖或并列展示） */
    if (!Array.isArray(active.daily)) active.daily = [];
    /* 移除同日期旧记录（简单覆盖） */
    active.daily = active.daily.filter(r => r.date !== date);
    active.daily.push({ date, flow, symptoms: sym, abnormal: abn, mood, note });
    active.daily.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeModal(); render();
    const dayNum = diffDays(active.start, date) + 1;
    toast(`已保存第 ${dayNum} 天过程记录`);
    return;
  }
  /* type === 'start' */
  /* 已有进行中的经期时，禁止再新建一条，避免重复覆盖今天统计 */
  const openExisting = S.periods.find(p => !p.end);
  if (openExisting) {
    toast('已有进行中的经期（从 ' + fmtMD(openExisting.start) + ' 起），请使用「过程记录」或「结束本次」');
    return;
  }
  const date = document.getElementById('pDate').value;
  const flow = getChips('#pFlow')[0] || '中';
  const sym = getChips('#pSym');
  const mood = getChips('#pMood')[0] || '';
  const abn = document.getElementById('pAbn').value.trim();
  const note = document.getElementById('pNote').value.trim();
  if (S.periods.some(p => p.start === date)) { toast('该日已有经期记录'); return; }
  S.periods.push({ id: uid(), start: date, end: null, flow, symptoms: sym, abnormal: abn, mood, note, daily: [] });
  save(); closeModal(); render(); toast('已保存');
}

function openIntimacyModal(prefill) {
  const d = prefill || todayKey();
  modal(`<h2>记录亲密</h2>
   <div class="field"><label>日期</label><input type="date" id="iDate" value="${d}"></div>
   <div class="field"><label>是否爱爱</label><div class="seg" id="iSex">
     <div class="chip on" data-v="yes">是</div><div class="chip" data-v="no">否</div></div></div>
   <div class="field"><label>避孕方式</label>
     <div class="custom-select" id="iConWrap">
       <button type="button" class="cs-trigger" id="iConTrigger">
         <span id="iConLabel">避孕套</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>
       <ul class="cs-menu" id="iConMenu">
         <li class="cs-opt" data-v="none">无措施</li>
         <li class="cs-opt on" data-v="condom">避孕套</li>
         <li class="cs-opt" data-v="pill">口服</li>
         <li class="cs-opt" data-v="other">其他</li>
       </ul>
       <input type="hidden" id="iCon" value="condom">
     </div></div>
   <div class="field"><label>备注</label><textarea id="iNote" placeholder="选填"></textarea></div>
   <div class="actions"><button class="btn ghost" data-action="close-modal">取消</button><button class="btn primary" data-action="save-intimacy">保存</button></div>`);
  bindChips('#iSex', true);
  initCustomSelect('iCon');
}

/* ---------- 自定义下拉组件 ---------- */
function initCustomSelect(id) {
  const wrap = document.getElementById(id + 'Wrap');
  const trigger = document.getElementById(id + 'Trigger');
  const label = document.getElementById(id + 'Label');
  const menu = document.getElementById(id + 'Menu');
  const hidden = document.getElementById(id);
  if (!wrap || !trigger || !menu) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.contains('open');
    closeAllCustomSelects();
    if (!open) { menu.classList.add('open'); trigger.classList.add('open'); }
  });
  menu.querySelectorAll('.cs-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      menu.querySelectorAll('.cs-opt').forEach(o => o.classList.remove('on'));
      opt.classList.add('on');
      label.textContent = opt.textContent;
      hidden.value = opt.dataset.v;
      menu.classList.remove('open'); trigger.classList.remove('open');
    });
  });
}
function closeAllCustomSelects() {
  document.querySelectorAll('.cs-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.cs-trigger.open').forEach(t => t.classList.remove('open'));
}
document.addEventListener('click', () => closeAllCustomSelects());

function saveIntimacy() {
  const date = document.getElementById('iDate').value;
  const had = document.querySelector('#iSex .chip.on').dataset.v === 'yes';
  const con = document.getElementById('iCon').value;
  const note = document.getElementById('iNote').value.trim();
  S.intimacy.push({ id: uid(), date, hadSex: had, contraception: con, note });
  save(); closeModal(); render(); toast('已保存');
}

function openDaySheet(dateStr) {
  const ps = S.periods.filter(p => p.start === dateStr || p.end === dateStr);
  /* 也查找包含该日期的过程记录 */
  const psWithDaily = S.periods.filter(p => {
    if (p.start === dateStr || p.end === dateStr) return true;
    if (!Array.isArray(p.daily)) return false;
    const [st, en] = periodSpan(p);
    return dateStr >= st && dateStr <= en && p.daily.some(r => r.date === dateStr);
  });
  const ins = S.intimacy.filter(r => r.date === dateStr);
  let html = `<h2>${fmtFull(dateStr)}</h2>`;
  if (psWithDaily.length || ins.length) {
    html += `<div class="card" style="box-shadow:none;margin-bottom:12px">`;
    psWithDaily.forEach(p => {
      const isStart = p.start === dateStr;
      const isEnd = p.end === dateStr;
      const dayNum = diffDays(p.start, dateStr) + 1;
      let tag = '';
      if (isStart) tag = '经期开始';
      else if (isEnd) tag = '经期结束';
      else tag = `第 ${dayNum} 天`;
      /* 显示周期主记录（开始日）或过程记录详情 */
      if (isStart) {
        html += `<div class="row"><span class="label"><b>🌸 ${tag}</b></span><span class="val">${p.flow || ''} ${p.symptoms && p.symptoms.length ? '· ' + p.symptoms.join('/') : ''}</span></div>`;
        if (p.mood) html += `<div class="row"><span class="label">心情</span><span class="val">${p.mood}</span></div>`;
        if (p.abnormal) html += `<div class="row"><span class="label">异常</span><span class="val">${esc(p.abnormal)}</span></div>`;
        if (p.note) html += `<div class="row"><span class="label">备注</span><span class="val">${esc(p.note)}</span></div>`;
      } else if (isEnd) {
        html += `<div class="row"><span class="label"><b>✅ ${tag}</b></span><span class="val"></span></div>`;
      }
      /* 展示该日的 daily 过程记录 */
      if (Array.isArray(p.daily)) {
        p.daily.filter(r => r.date === dateStr).forEach(dr => {
          html += `<div class="row" style="margin-top:6px;border-top:1px dashed rgba(236,106,152,.2);padding-top:6px"><span class="label"><b>📝 ${tag}</b></span><span class="val">${dr.flow || ''} ${dr.symptoms && dr.symptoms.length ? '· ' + dr.symptoms.join('/') : ''}</span></div>`;
          if (dr.mood) html += `<div class="row"><span class="label">心情</span><span class="val">${dr.mood}</span></div>`;
          if (dr.abnormal) html += `<div class="row"><span class="label">异常</span><span class="val">${esc(dr.abnormal)}</span></div>`;
          if (dr.note) html += `<div class="row"><span class="label">备注</span><span class="val">${esc(dr.note)}</span></div>`;
        });
      }
    });
    ins.forEach(r => { html += `<div class="row" style="margin-top:6px;border-top:1px dashed rgba(156,136,255,.25);padding-top:6px"><span class="label">${r.hadSex ? '💕 爱爱' : '亲密'}${r.contraception !== 'none' ? ' · ' + conLabel(r.contraception) : ''}</span><span class="val">${esc(r.note || '')}</span></div>`; });
    html += `</div>`;
  } else { html += `<div class="empty">这一天还没有记录</div>`; }
  /* 若该日是某条经期的「开始日」，允许删除整条经期（用于修正误点的开始） */
  const startP = S.periods.find(p => p.start === dateStr);
  html += `<div class="actions"><button class="btn" data-action="open-period" data-date="${dateStr}">记经期(此日)</button><button class="btn primary" data-action="open-intimacy" data-date="${dateStr}">记亲密(此日)</button></div>`;
  if (startP) {
    html += `<div class="actions"><button class="btn danger" data-action="delete-period" data-id="${startP.id}">删除这条经期记录</button></div>`;
  }
  html += `<div class="actions"><button class="btn ghost" data-action="close-modal">关闭</button></div>`;
  modal(html);
}

/* 删除整条经期记录（含其过程记录） */
function deletePeriod(id) {
  const p = S.periods.find(x => x.id === id);
  if (!p) return;
  if (!confirm('确定删除这条经期记录吗？\n（从 ' + fmtMD(p.start) + ' 起的整段记录都会被移除）')) return;
  S.periods = S.periods.filter(x => x.id !== id);
  save(); closeModal(); render(); toast('已删除该经期记录');
}

/* ---------- 动作分发 ---------- */
function doAction(a, el) {
  switch (a) {
    case 'open-period': openPeriodModal(el && el.dataset.date); break;
    case 'open-intimacy': openIntimacyModal(el && el.dataset.date); break;
    case 'save-period': savePeriod(); break;
    case 'save-intimacy': saveIntimacy(); break;
    case 'delete-period': deletePeriod(el.dataset.id); break;
    case 'day-open': openDaySheet(el.dataset.date); break;
    case 'cal-prev': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); break;
    case 'cal-next': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); break;
    case 'save-settings': {
      const avg = +document.getElementById('setAvg').value;
      const lut = +document.getElementById('setLut').value;
      if (avg >= 20 && avg <= 45) S.settings.avgCycle = avg;
      if (lut >= 9 && lut <= 20) S.settings.luteal = lut;
      save(); render(); toast('已保存'); break;
    }
    case 'set-passcode': {
      const pin = document.getElementById('setPin').value;
      if (pin.length === 4) S.settings.passcode = pin;
      else if (pin === '') S.settings.passcode = null;
      else { toast('请输入4位或留空'); break; }
      save(); toast(pin ? '密码已设置' : '密码已关闭');
      if (!pin) closeModalForce();
      break;
    }
    case 'unlock': {
      const v = document.getElementById('lockPin').value;
      if (v === S.settings.passcode) closeModalForce();
      else toast('密码错误');
      break;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '经期小记备份.json'; a.click();
      toast('已导出'); break;
    }
    case 'import': {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { try { const o = JSON.parse(rd.result); const d = defaults(); d.periods = o.periods || []; d.intimacy = o.intimacy || []; if (o.settings) d.settings = Object.assign(d.settings, o.settings); S = d; save(); render(); toast('导入成功'); } catch (e) { toast('文件格式错误'); } };
        rd.readAsText(f);
      };
      inp.click(); break;
    }
    case 'clear-data':
      if (confirm('确定清空所有数据？不可恢复')) { S = defaults(); save(); render(); toast('已清空'); }
      break;
    case 'close-modal': closeModal(); break;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-mask')) { closeModal(); return; }
  const tab = e.target.closest('.tab');
  if (tab) { currentTab = tab.dataset.tab; render(); return; }
  const th = e.target.closest('#pTheme .chip');
  if (th) { S.settings.theme = th.dataset.v; save(); applyTheme(); render(); toast('外观已更新'); return; }
  const el = e.target.closest('[data-action]');
  if (el) doAction(el.dataset.action, el);
});

/* 光效强度滑块：拖动时实时预览，松开后持久化 */
document.addEventListener('input', (e) => {
  if (e.target.id !== 'lightIntensity') return;
  const v = +e.target.value / 100;
  e.target.style.setProperty('--p', e.target.value + '%');
  document.documentElement.style.setProperty('--blob-op', v);
  const lab = document.getElementById('liVal');
  if (lab) lab.textContent = e.target.value + '%';
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'lightIntensity') return;
  S.settings.lightIntensity = +e.target.value / 100;
  save();
});

/* ---------- 启动密码门 ---------- */
function lockGate() {
  if (!S.settings.passcode) return;
  modal(`<h2>请输入密码</h2><div class="field"><input id="lockPin" type="password" inputmode="numeric" maxlength="4" placeholder="4位密码"></div><div class="actions"><button class="btn primary" data-action="unlock">进入</button></div>`, true);
}

/* ---------- 提示 ---------- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = (S.settings && S.settings.theme) || 'system';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = t === 'system' ? (prefersDark ? 'dark' : 'light') : t;
  document.documentElement.setAttribute('data-theme', theme);
}

/* ---------- 初始化 ---------- */
applyTheme();
const _li = (S.settings && S.settings.lightIntensity != null) ? S.settings.lightIntensity : 0.55;
document.documentElement.style.setProperty('--blob-op', _li);
render();
lockGate();
/* 滚动时顶栏淡入毛玻璃 — 监听 .app-wrap（实际滚动容器） */
const hdr = document.querySelector('.app-header');
const wrap = document.querySelector('.app-wrap');
if (hdr && wrap) {
  const onScroll = () => { hdr.classList.toggle('scrolled', wrap.scrollTop > 12); };
  wrap.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }

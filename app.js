/* 经期小记 — 纯净私密 PWA (vanilla JS, 本地存储) */
'use strict';

/* ---------- 存储 ---------- */
const KEY = 'cycle.tracker.v1';
function defaults() {
  return { periods: [], habits: [], settings: { avgCycle: 28, luteal: 14, periodLen: 5, lightIntensity: 0.55, passcode: null, theme: 'light', reminders: { period: true } }, _mig: { themeV1: false } };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const d = defaults();
      d.periods = Array.isArray(o.periods) ? o.periods : [];
      d.habits = Array.isArray(o.habits) ? o.habits : [];
      if (o.settings) d.settings = Object.assign(d.settings, o.settings);
      if (o._mig) d._mig = Object.assign(d._mig, o._mig);
      return d;
    }
  } catch (e) { /* ignore */ }
  return defaults();
}
let S = load();
let editingPeriodId = null; /* 非空时表示正在修改某条已有经期 */
/* 一次性迁移：旧默认主题（跟随系统）→ 浅色。仅执行一次，之后用户仍可手动切换回跟随系统 */
if (S._mig && !S._mig.themeV1) {
  if (!S.settings.theme || S.settings.theme === 'system') S.settings.theme = 'light';
  S._mig.themeV1 = true;
  save();
}
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
function avgPeriodLen() {
  const ps = sortedPeriods().filter(p => p.end);
  if (ps.length === 0) return null;
  const sum = ps.reduce((a, p) => a + diffDays(p.start, p.end) + 1, 0);
  return Math.round(sum / ps.length);
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

/* ---------- 经期健康习惯（打卡 + 统计 + 权威建议） ---------- */
function ensureTodayHabit() {
  let h = S.habits.find(x => x.date === todayKey());
  if (!h) { h = { date: todayKey(), spicy: 0, hotTea: 0, icedTea: 0, hotCoffee: 0, icedCoffee: 0, exercised: false, exerciseMin: 0 }; S.habits.push(h); }
  return h;
}
function bumpHabit(k, delta) {
  const h = ensureTodayHabit();
  let v = (h[k] || 0) + delta;
  if (v < 0) v = 0;
  h[k] = v;
  save(); render();
  const map = { spicy: ['吃辣', '份'], hotTea: ['热奶茶', '杯'], icedTea: ['冰奶茶', '杯'], hotCoffee: ['热咖啡', '杯'], icedCoffee: ['冰咖啡', '杯'], exerciseMin: ['运动', '分钟'] };
  const m = map[k] || [k, ''];
  toast(m[0] + ' ' + v + m[1]);
}
function toggleHabit(k) {
  const h = ensureTodayHabit();
  h[k] = !h[k];
  save(); render();
  toast(h[k] ? '已记录运动' : '已取消运动');
}
function setHabitNum(k, raw) {
  const h = ensureTodayHabit();
  let v = parseInt(raw, 10) || 0;
  if (v < 0) v = 0;
  if (k === 'exerciseMin' && v > 300) v = 300;
  h[k] = v;
  if (k === 'exerciseMin') h.exercised = v > 0;
  save(); render();
  toast(k === 'exerciseMin' ? `已更新运动 ${v} 分钟` : '已更新');
}
/* 统计某段经期区间内的习惯汇总（仅经期区间 [start, end]） */
function periodHabitStats(p) {
  if (!p) return null;
  const [s, e] = periodSpan(p);
  let spicy = 0, hotTea = 0, icedTea = 0, hotCoffee = 0, icedCoffee = 0, exDays = 0, exMin = 0;
  S.habits.forEach(h => {
    if (h.date >= s && h.date <= e) {
      spicy += h.spicy || 0; hotTea += h.hotTea || 0; icedTea += h.icedTea || 0;
      hotCoffee += h.hotCoffee || 0; icedCoffee += h.icedCoffee || 0;
      if (h.exercised) { exDays++; exMin += h.exerciseMin || 0; }
    }
  });
  return { spicy, hotTea, icedTea, hotCoffee, icedCoffee, exDays, exMin, start: s, end: e, days: diffDays(s, e) + 1 };
}
/* 本期是否含痛经（腹痛）症状 */
function periodHasCramp(p) {
  if (!p) return false;
  if (p.symptoms && p.symptoms.includes('腹痛')) return true;
  if (Array.isArray(p.daily)) return p.daily.some(d => d.symptoms && d.symptoms.includes('腹痛'));
  return false;
}
/* 权威知识库 + 实时分析（来源见文案）
   返回 { today:[], stage:[], next:[], risk:[], syms:[] } */
function healthAdvice(stats, p, h) {
  const today = [], stage = [], next = [], risk = [];
  const cramp = periodHasCramp(p);
  const totalCaffeine = (stats.icedTea || 0) + (stats.hotTea || 0) + (stats.icedCoffee || 0) + (stats.hotCoffee || 0);
  const t = todayKey();
  const ended = p && p.end && p.end < t; // 经期已结束
  const avgDays = stats.days || 1;

  /* ---------- 今日即时提醒 ---------- */
  if (h.icedTea > 0) today.push({ lv: 'warn', t: '今日冰奶茶提醒', d: `今天已记录 ${h.icedTea} 杯冰奶茶。生冷 + 咖啡因叠加，敏感人群容易出现小腹坠胀、腹泻或痛经加重。`, sym: '小腹坠胀、腹泻、痛经加重' });
  if (h.spicy > 0) today.push({ lv: 'warn', t: '今日吃辣提醒', d: `今天已记录 ${h.spicy} 份辣。辛辣促进前列腺素分泌，可能刺激子宫痉挛和肠胃。`, sym: '子宫痉挛痛、胃灼热、腹泻' });
  if (h.hotTea > 0) today.push({ lv: 'info', t: '今日热奶茶提醒', d: `今天已记录 ${h.hotTea} 杯热奶茶。咖啡因 + 高糖可能导致入睡困难、情绪波动。`, sym: '失眠、烦躁、乳房胀痛' });
  if (h.icedTea > 0 && h.spicy > 0) today.push({ lv: 'warn', t: '今日双重刺激', d: '冰奶茶 + 辣同时摄入，生冷与辛辣叠加，是经期不适的高风险组合。建议今晚喝温水、避免再进食生冷辛辣。', sym: '腹痛、腹泻、痛经加重' });
  if (h.icedCoffee > 0) today.push({ lv: 'warn', t: '今日冰咖啡提醒', d: `今天已记录 ${h.icedCoffee} 杯冰咖啡。冰镇 + 咖啡因叠加，寒冷刺激血管收缩、咖啡因兴奋神经，敏感人群容易出现小腹冷痛、头痛或痛经加重。`, sym: '小腹冷痛、头痛、痛经加重' });
  if (h.hotCoffee > 0) today.push({ lv: 'info', t: '今日热咖啡提醒', d: `今天已记录 ${h.hotCoffee} 杯热咖啡。咖啡因可能刺激胃酸分泌、影响夜间睡眠、加重焦虑或乳房胀痛。`, sym: '失眠、心悸、焦虑、乳房胀痛' });
  if (h.icedCoffee > 0 && h.spicy > 0) today.push({ lv: 'warn', t: '今日双重刺激', d: '冰咖啡 + 辣同时摄入，寒冷与辛辣叠加是经期不适的高风险组合。建议今晚喝温水、避免再进食生冷辛辣。', sym: '腹痛、腹泻、痛经加重' });
  if (h.exercised && (h.exerciseMin || 0) > 0) {
    const min = h.exerciseMin;
    if (min >= 45 && min <= 90) today.push({ lv: 'good', t: '今日运动适量', d: `已记录 ${min} 分钟运动，这个时长对缓解经期不适比较理想。`, sym: '' });
    else if (min > 90) today.push({ lv: 'info', t: '今日运动偏长', d: `已记录 ${min} 分钟运动，经期不建议过度疲劳，注意补充水分和休息。`, sym: '疲劳、经量增多' });
    else today.push({ lv: 'good', t: '今日已运动', d: `已记录 ${min} 分钟运动，适度活动有助于缓解经期不适。`, sym: '' });
  } else if (!ended) {
    today.push({ lv: 'info', t: '今日尚未记录运动', d: '经期适度运动（散步、瑜伽、拉伸）有助于缓解不适。', sym: '' });
  }

  /* ---------- 阶段性累计建议（经期开始至今） ---------- */
  if (stats.icedTea >= 3) stage.push({ lv: 'warn', t: '冰奶茶摄入偏高', d: `本经期已喝 ${stats.icedTea} 杯冰奶茶（${avgDays} 天），处于较高水平，建议明显减少。`, sym: '小腹冷痛、腹泻、痛经加重' });
  else if (stats.icedTea >= 2) stage.push({ lv: 'warn', t: '冰奶茶偏多', d: `本经期已喝 ${stats.icedTea} 杯冰奶茶。敏感体质建议减量。`, sym: '小腹不适、痛经' });

  if (stats.icedCoffee >= 3) stage.push({ lv: 'warn', t: '冰咖啡摄入偏高', d: `本经期已喝 ${stats.icedCoffee} 杯冰咖啡（${avgDays} 天）。冰冷刺激血管收缩、咖啡因兴奋神经，易诱发小腹冷痛与痛经。`, sym: '小腹冷痛、头痛、痛经加重' });
  else if (stats.icedCoffee >= 2) stage.push({ lv: 'warn', t: '冰咖啡偏多', d: `本经期已喝 ${stats.icedCoffee} 杯冰咖啡。敏感体质建议减量。`, sym: '小腹不适、痛经' });

  if (stats.hotTea >= 3) stage.push({ lv: 'warn', t: '热奶茶摄入偏高', d: `本经期已喝 ${stats.hotTea} 杯热奶茶。咖啡因与糖分较高，可能影响睡眠与情绪。`, sym: '失眠、情绪波动、乳房胀痛' });

  if (stats.hotCoffee >= 3) stage.push({ lv: 'warn', t: '热咖啡摄入偏高', d: `本经期已喝 ${stats.hotCoffee} 杯热咖啡。咖啡因偏高，易影响睡眠、加重焦虑与乳房胀痛。`, sym: '失眠、心悸、焦虑、乳房胀痛' });

  if (stats.spicy >= 3) stage.push({ lv: 'warn', t: '吃辣偏多', d: `本经期已吃 ${stats.spicy} 份辣。辛辣促进盆腔充血和前列腺素分泌。`, sym: '子宫痉挛痛、胃痛、腹泻' });

  if (totalCaffeine >= 5) stage.push({ lv: 'warn', t: '咖啡因摄入较高', d: `奶茶与咖啡合计 ${totalCaffeine} 杯，咖啡因总量较高，易影响睡眠、加重焦虑与心悸。`, sym: '失眠、心悸、烦躁、焦虑' });

  if ((stats.icedTea >= 2 || stats.icedCoffee >= 2) && stats.spicy >= 3) stage.push({ lv: 'warn', t: '高风险组合', d: '冰饮（冰奶茶/冰咖啡）和辣都偏多，容易加重经期炎症反应和子宫痉挛，建议后续几天清淡饮食。', sym: '严重痛经、腹泻、肠胃不适' });

  if (stats.exDays >= 3) stage.push({ lv: 'good', t: '运动达标', d: `本经期已运动 ${stats.exDays} 天（共 ${stats.exMin} 分钟）。规律运动可显著降低经期疼痛（Cochrane 2019 系统综述）。`, sym: '' });
  else if (stats.exDays > 0) stage.push({ lv: 'info', t: '运动偏少', d: `本经期仅运动 ${stats.exDays} 天。建议再安排 1–2 次温和运动（散步、瑜伽、拉伸）。`, sym: '小腹坠胀、情绪低落' });
  else stage.push({ lv: 'info', t: '尚未记录运动', d: '适度运动（散步、瑜伽、拉伸）可促进血液循环，帮助缓解痛经和腹胀。', sym: '' });

  if (stats.exDays === 0 && (stats.icedTea > 0 || stats.spicy > 0)) {
    stage.push({ lv: 'warn', t: '刺激饮食且缺乏运动', d: '经期吃了生冷辛辣食物但又没有记录运动，容易加重淤血和不适。建议饭后散步 15–20 分钟。', sym: '腹胀、便秘、痛经' });
  }

  /* 痛经关联 */
  if (cramp && (stats.icedTea >= 1 || stats.spicy >= 2)) stage.push({ lv: 'info', t: '痛经关联提醒', d: '本期已记录腹痛/痛经，且摄入了冰饮或辣，可能与这些习惯相关，可尝试减少观察是否缓解。', sym: '小腹绞痛、腰酸' });

  /* ---------- 经期结束后的下一轮建议 + 本轮风险评估 ---------- */
  if (ended) {
    /* 下一轮经期健康建议 */
    if (stats.icedTea >= 2) next.push({ lv: 'warn', t: '下一轮建议：减少冰饮', d: `本轮喝了 ${stats.icedTea} 杯冰奶茶，下一轮经期建议提前 3–5 天开始减少生冷，可降低痛经发生概率。`, sym: '小腹冷痛、痛经' });
    if (stats.icedCoffee >= 2) next.push({ lv: 'warn', t: '下一轮建议：减少冰饮', d: `本轮喝了 ${stats.icedCoffee} 杯冰咖啡，下一轮经期建议提前 3–5 天开始减少冰冷饮品，可降低痛经发生概率。`, sym: '小腹冷痛、痛经' });
    if (stats.spicy >= 3) next.push({ lv: 'warn', t: '下一轮建议：清淡饮食', d: `本轮吃了 ${stats.spicy} 份辣，下一轮经期前一周建议减少辛辣，避免前列腺素过度分泌。`, sym: '子宫痉挛、胃痛' });
    if (totalCaffeine >= 5) next.push({ lv: 'info', t: '下一轮建议：控制咖啡因', d: `本轮含咖啡因饮品（奶茶/咖啡）合计 ${totalCaffeine} 杯，摄入偏高。下一轮建议每天不超过 1 杯，并优先选温热饮品。`, sym: '失眠、焦虑' });
    if (stats.hotCoffee >= 3) next.push({ lv: 'info', t: '下一轮建议：控制咖啡', d: `本轮喝了 ${stats.hotCoffee} 杯热咖啡，咖啡因偏高。下一轮建议每天不超过 1 杯，午后避免含咖啡因饮品。`, sym: '失眠、焦虑' });
    if (stats.exDays >= 3) next.push({ lv: 'good', t: '下一轮建议：保持运动', d: '本轮运动频率良好，建议在下一轮经期前继续保持每周 3–5 次温和运动。', sym: '' });
    else if (stats.exDays === 0) next.push({ lv: 'info', t: '下一轮建议：增加运动', d: '本轮未记录运动，建议从经期结束后开始逐步建立每周 3 次、每次 30 分钟以上的运动习惯。', sym: '' });

    /* 本轮健康风险总结 */
    if (stats.icedTea >= 3 || stats.spicy >= 3 || stats.icedCoffee >= 3 || stats.hotCoffee >= 3 || totalCaffeine >= 5) {
      risk.push({ lv: 'warn', t: '本轮健康风险', d: '生冷、辛辣或咖啡因摄入偏高，可能导致子宫痉挛、肠胃不适、睡眠紊乱。建议下一轮经期前提前调整饮食。', sym: '痛经加重、腹泻、失眠' });
    }
    if (stats.exDays === 0 && (stats.icedTea >= 2 || stats.spicy >= 2 || stats.icedCoffee >= 2 || stats.hotCoffee >= 2)) {
      risk.push({ lv: 'warn', t: '久坐 + 刺激饮食风险', d: '缺乏运动叠加刺激饮食，容易加重盆腔淤血和经期不适。', sym: '腹胀、便秘、痛经' });
    }
    if (cramp && (stats.icedTea >= 1 || stats.spicy >= 2)) {
      risk.push({ lv: 'info', t: '本轮痛经相关因素', d: '已记录痛经/腹痛，且本经期有冰饮或辛辣摄入，两者可能存在关联。下一轮可减少观察效果。', sym: '小腹绞痛、腰酸' });
    }
    if (risk.length === 0 && next.length === 0) {
      next.push({ lv: 'good', t: '本轮习惯良好', d: '饮食与运动控制得不错，下一轮经期继续保持即可。', sym: '' });
    }
  }

  const rank = { warn: 0, info: 1, good: 2 };
  const all = [...today, ...stage, ...next, ...risk];
  const syms = [...new Set(all.filter(t => t.sym).reduce((a, t) => a.concat(t.sym.split('、')), []))].slice(0, 12);
  return {
    today: today.sort((a, b) => rank[a.lv] - rank[b.lv]).slice(0, 4),
    stage: stage.sort((a, b) => rank[a.lv] - rank[b.lv]).slice(0, 4),
    next: next.sort((a, b) => rank[a.lv] - rank[b.lv]).slice(0, 3),
    risk: risk.sort((a, b) => rank[a.lv] - rank[b.lv]).slice(0, 2),
    syms
  };
}
function renderHealth() {
  const t = todayKey();
  const h = S.habits.find(x => x.date === t) || { date: t, spicy: 0, hotTea: 0, icedTea: 0, hotCoffee: 0, icedCoffee: 0, exercised: false, exerciseMin: 0 };
  const p = periodAt(t) || latestPeriod();
  const stats = p ? periodHabitStats(p) : null;
  const adv = stats ? healthAdvice(stats, p, h) : null;
  const ended = p && p.end && p.end < t;

  const step = (k, unit, val) => {
    const display = k === 'exerciseMin'
      ? `<input type="number" class="h-input" inputmode="numeric" min="0" max="300" value="${val}" data-action="habit-set" data-k="${k}"><span class="h-unit">${unit}</span>`
      : `<span class="h-val">${val} ${unit}</span>`;
    return `<div class="h-step"><button class="h-btn" data-action="habit-dec" data-k="${k}" data-step="1">−</button>${display}<button class="h-btn" data-action="habit-inc" data-k="${k}" data-step="1">+</button></div>`;
  };
  let rows = `<div class="h-row"><div class="h-name">运动</div><div class="h-ctrl">
      <button class="h-toggle${h.exercised ? ' on' : ''}" data-action="habit-toggle" data-k="exercised">${h.exercised ? '已运动' : '未运动'}</button>
      ${step('exerciseMin', '分钟', h.exerciseMin)}</div></div>`;
  rows += `<div class="h-row"><div class="h-name">吃辣</div>${step('spicy', '份', h.spicy)}</div>`;
  rows += `<div class="h-row"><div class="h-name">热奶茶</div>${step('hotTea', '杯', h.hotTea)}</div>`;
  rows += `<div class="h-row"><div class="h-name">冰奶茶</div>${step('icedTea', '杯', h.icedTea)}</div>`;
  rows += `<div class="h-row"><div class="h-name">热咖啡</div>${step('hotCoffee', '杯', h.hotCoffee)}</div>`;
  rows += `<div class="h-row"><div class="h-name">冰咖啡</div>${step('icedCoffee', '杯', h.icedCoffee)}</div>`;

  /* 今日打卡区域 */
  const todayHtml = `<div class="h-section"><div class="h-section-title">今日打卡</div><div class="h-rows">${rows}</div></div>`;

  /* 本轮累计区域 */
  let totalHtml = '';
  if (stats) {
    totalHtml = `<div class="h-section"><div class="h-section-title">本轮经期累计 <span class="h-section-sub">${stats.start.slice(5).replace('-', '/')} 至 ${stats.end.slice(5).replace('-', '/')} · 共 ${stats.days} 天</span></div>
      <div class="h-totals">
        <div class="h-total${stats.exDays >= 3 ? ' good' : ''}"><div class="h-total-n">${stats.exDays}</div><div class="h-total-l">运动天</div></div>
        <div class="h-total"><div class="h-total-n">${stats.exMin}</div><div class="h-total-l">运动分钟</div></div>
        <div class="h-total${stats.spicy >= 3 ? ' warn' : ''}"><div class="h-total-n">${stats.spicy}</div><div class="h-total-l">吃辣份</div></div>
        <div class="h-total${stats.hotTea >= 3 ? ' warn' : ''}"><div class="h-total-n">${stats.hotTea}</div><div class="h-total-l">热奶茶杯</div></div>
        <div class="h-total${stats.icedTea >= 2 ? ' warn' : ''}"><div class="h-total-n">${stats.icedTea}</div><div class="h-total-l">冰奶茶杯</div></div>
        <div class="h-total${stats.hotCoffee >= 3 ? ' warn' : ''}"><div class="h-total-n">${stats.hotCoffee}</div><div class="h-total-l">热咖啡杯</div></div>
        <div class="h-total${stats.icedCoffee >= 2 ? ' warn' : ''}"><div class="h-total-n">${stats.icedCoffee}</div><div class="h-total-l">冰咖啡杯</div></div>
      </div></div>`;
  }

  /* 健康建议区域 */
  let adviceHtml = '';
  if (!stats) {
    adviceHtml = `<div class="h-section"><div class="h-section-title">健康建议</div><div class="h-tip info"><div class="h-tip-t">记录经期后展示分析</div><div class="h-tip-d">打卡数据已保存；记录经期后，这里会实时汇总本期饮食与运动，并给出今日建议、阶段性建议与不适风险提示。</div></div></div>`;
  } else {
    const tipBlock = (title, list) => {
      if (!list.length) return '';
      return `<div class="h-advice-group"><div class="h-advice-group-title">${title}</div>` +
        list.map(t => `<div class="h-tip ${t.lv}"><div class="h-tip-t">${t.t}</div><div class="h-tip-d">${t.d}</div></div>`).join('') + `</div>`;
    };
    const nextTitle = ended ? '下一轮经期建议（基于本轮记录）' : '当前阶段预测';
    const nextList = ended ? adv.next : adv.next.slice(0, 0); // 未结束时不显示下一轮
    const foodRecorded = (h.spicy > 0 || h.hotTea > 0 || h.icedTea > 0 || h.hotCoffee > 0 || h.icedCoffee > 0) || (stats && (stats.spicy > 0 || stats.hotTea > 0 || stats.icedTea > 0 || stats.hotCoffee > 0 || stats.icedCoffee > 0));
    let symHtml = '';
    if (foodRecorded) {
      if (adv.syms.length) symHtml = `<div class="h-sym"><div class="h-sym-title">可能出现的不适</div><div class="h-sym-list">${adv.syms.join(' · ')}</div><div class="h-sym-note">以上为基于记录的习惯推测，个体差异大，如有严重不适请及时就医。</div></div>`;
    } else {
      symHtml = `<div class="h-sym"><div class="h-sym-title">可能出现的不适</div><div class="h-sym-empty">尚未记录，无法推断（吃辣、喝奶茶）可能导致的不适。</div></div>`;
    }
    adviceHtml = `<div class="h-section"><div class="h-section-title">健康建议</div>
      ${tipBlock('今日建议', adv.today)}
      ${tipBlock('阶段性建议（经期开始至今）', adv.stage)}
      ${tipBlock(nextTitle, nextList)}
      ${tipBlock('本轮健康风险', adv.risk)}
      ${symHtml}
      <div class="h-src">数据来源：Cochrane 2019 / ACOG / 科普中国 / 中华医学会 / 《中华妇产科学》。仅供参考，非医学诊断。</div>
    </div>`;
  }

  return `<div class="card health">
    <div class="h-header"><h3>经期健康记录</h3><button class="h-close" data-action="toggle-health">收起</button></div>
    ${todayHtml}${totalHtml}${adviceHtml}
  </div>`;
}

/* ---------- 渲染 ---------- */
let currentTab = 'today';
let calMonth = new Date();
let currentLocked = false;
let healthExpanded = false;
let deferredPrompt = null;   /* 浏览器 deferred 安装事件（安卓/桌面可触发原生弹窗） */
let appInstalled = false;    /* 是否已安装为 PWA */

/* 展示某天的过程记录卡片（今天页用） */
function buildDailyCard(p, t) {
  if (!Array.isArray(p.daily)) return '';
  const todayRec = p.daily.find(r => r.date === t);
  if (!todayRec) return '';
  const dsym = todayRec.symptoms && todayRec.symptoms.length ? todayRec.symptoms.join(' ') : '';
  return `<div class="today-daily">
    <span class="td-flow">${todayRec.flow || ''}</span>
    ${dsym ? `<span class="td-sym">${esc(dsym)}</span>` : ''}
    ${todayRec.mood ? `<span class="td-mood">· ${todayRec.mood}</span>` : ''}
  </div>`;
}

function renderToday() {
  const t = todayKey();
  const p = periodAt(t);
  let phase, countHtml, sub, dailyHtml = '';
  if (p) {
    const start = p.start;
    const d = diffDays(start, t) + 1;
    if (p.end) {
      /* 经期已结束（今天为结束日）：显示本经期天数 + 距下次预测经期 */
      const dur = diffDays(start, p.end) + 1;
      const next = predictNextStart();
      const toNext = diffDays(t, next);
      phase = '月经期';
      countHtml = `<div class="count">${dur}<small> 天</small></div>`;
      sub = `本经期 ${dur} 天 · 距离下次预测经期开始还有 ${toNext} 天`;
      dailyHtml = buildDailyCard(p, t);
    } else {
      const endEst = periodEndEst(p);
      const toEnd = diffDays(t, endEst);
      const endMsg = toEnd > 0 ? `距离经期结束还有 ${toEnd} 天`
        : toEnd === 0 ? '今天是经期最后一天'
        : `经期已结束 ${-toEnd} 天，记得记录结束日`;
      phase = '月经期';
      countHtml = `<div class="count">${d}<small> 天</small></div>`;
      sub = `${endMsg} · 当前第 ${d} 天`;
      dailyHtml = buildDailyCard(p, t);
    }
    /* 已记录天数提示：开始日、结束日、过程记录日均算有记录 */
    const spanEnd = p.end || t;
    const recDates = new Set([p.start]);
    if (p.end) recDates.add(p.end);
    (p.daily || []).forEach(r => { if (r.date >= p.start && r.date <= spanEnd) recDates.add(r.date); });
    const recordedCount = recDates.size;
    if (recordedCount > 0) {
      sub += ` <small class="daily-badge">已记录 ${recordedCount}/${d} 天</small>`;
    }
  } else {
    const lp = latestPeriod();
    if (lp && lp.end && t > lp.end) {
      /* 本段经期刚结束（今天在结束日之后）：展示经期天数 + 距下次预测经期开始 */
      const dur = diffDays(lp.start, lp.end) + 1;
      const next = predictNextStart();
      const toNext = diffDays(t, next);
      phase = '月经期';
      countHtml = `<div class="count">${dur}<small> 天</small></div>`;
      sub = `本经期 ${dur} 天 · 距离下次预测经期开始还有 ${toNext} 天`;
    } else if (!lp) {
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
  const mini = last ? `上次经期：${fmtMD(last.start)}` : '';
  const healthHtml = healthExpanded
    ? renderHealth()
    : `<div class="btn-row"><button class="btn health" data-action="toggle-health">健康打卡</button></div>`;
  return `<div class="card status">
      <div class="phase">${phase}</div>
      ${countHtml}
      <div class="sub">${sub}</div>
      ${dailyHtml}
    </div>
    ${mini ? `<div class="mini">${mini}</div>` : ''}
    <div class="btn-row">
      <button class="btn period" data-action="open-period">记经期</button>
    </div>
    ${healthHtml}`;
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
  /* 收集「有过程记录（每日记录）」的日期，用于在日历上做标记 */
  const procSet = new Set();
  S.periods.forEach(p => { if (Array.isArray(p.daily)) p.daily.forEach(r => procSet.add(r.date)); });
  /* 开始日 / 结束日集合，用于左上角统一徽章 */
  const startSet = new Set(), endSet = new Set();
  S.periods.forEach(p => { startSet.add(p.start); if (p.end) endSet.add(p.end); });
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div></div>`;
  for (let d = 1; d <= daysInMon; d++) {
    const ds = dayKey(new Date(y, m, d));
    let cls = 'day';
    if (set.has(ds)) cls += ' period';
    else if (lp && !lp.end && ds > lp.start && ds <= lpEndEst) cls += ' period-pred';
    else if (ds >= fw[0] && ds <= fw[1]) cls += ' fertile';
    if (ds === ovu) cls += ' ovu';
    if (ds === t) cls += ' today';
    const hasProc = procSet.has(ds);
    const isStart = startSet.has(ds);
    const isEnd = endSet.has(ds);
    let badges = '';
    if (isStart && isEnd) badges += '<span class="se-badge start-end" title="经期起止日">起止</span>';
    else if (isStart) badges += '<span class="se-badge start" title="经期开始">始</span>';
    else if (isEnd) badges += '<span class="se-badge end" title="经期结束">止</span>';
    if (hasProc) badges += '<span class="record-badge" title="有过程记录">记</span>';
    cells += `<div class="${cls}" data-action="day-open" data-date="${ds}">${d}${badges}</div>`;
  }
  const ongoingPrompt = (lp && !lp.end)
    ? `<div class="cal-prompt">当前经期自 ${fmtMD(lp.start)} 开始，尚未记录结束日。可在正确日期点「记经期」→「结束本次」。</div>`
    : '';
  return `<div class="cal-head"><button data-action="cal-prev">‹</button><div class="m">${y}年${m + 1}月</div><button data-action="cal-next">›</button></div>
   <div class="cal-grid"><div class="cal-dow">一</div><div class="cal-dow">二</div><div class="cal-dow">三</div><div class="cal-dow">四</div><div class="cal-dow">五</div><div class="cal-dow">六</div><div class="cal-dow">日</div>${cells}</div>
   <div class="legend"><span><i style="background:var(--pink)"></i>经期</span><span><i style="background:rgba(244,143,177,.28);border:1px dashed rgba(236,106,152,.6)"></i>经期(推算)</span><span><i style="background:rgba(179,157,219,.35);border:1px solid rgba(179,157,219,.5)"></i>易孕窗口</span><span><i style="background:rgba(246,193,119,.42);border:1px solid rgba(246,193,119,.6);color:#8a6d2b"></i>排卵日</span><span><i class="legend-record">记</i>过程记录</span><span><i class="legend-start">始</i>经期开始</span><span><i class="legend-end">止</i>经期结束</span></div>
   ${ongoingPrompt}`;
}

/* 健康打卡趋势：近 30 天「刺激性饮食」与「运动分钟」双线 SVG 折线图 */
function renderHabitTrend() {
  const N = 30;
  const t = todayKey();
  const days = [];
  for (let i = N - 1; i >= 0; i--) days.push(addDays(t, -i));
  const map = {};
  S.habits.forEach(h => { map[h.date] = h; });
  const stim = days.map(d => { const h = map[d]; return h ? ((h.spicy || 0) + (h.hotTea || 0) + (h.icedTea || 0) + (h.hotCoffee || 0) + (h.icedCoffee || 0)) : 0; });
  const ex = days.map(d => { const h = map[d]; return h && h.exercised ? (h.exerciseMin || 0) : 0; });
  if (!stim.some(v => v > 0) && !ex.some(v => v > 0)) {
    return `<div class="card chart-card"><h3>健康打卡趋势 <span class="h-section-sub">近 30 天</span></h3><div class="chart-empty">还没有健康打卡记录，去「今天」打卡后这里会显示趋势曲线。</div></div>`;
  }
  const W = 340, H = 150, padL = 24, padR = 8, padT = 12, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(1, ...stim, ...ex);
  const x = i => padL + (N === 1 ? plotW / 2 : i * plotW / (N - 1));
  const y = v => padT + plotH * (1 - v / maxV);
  const stimPts = stim.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const exPts = ex.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const gridY = [0, maxV / 2, maxV];
  const gridLines = gridY.map(v => { const yy = y(v).toFixed(1); return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" class="chart-grid"/>`; }).join('');
  const yLabels = gridY.map(v => `<text x="${padL - 4}" y="${(y(v) + 3).toFixed(1)}" class="chart-yl">${Math.round(v)}</text>`).join('');
  const step = Math.ceil(N / 6);
  let xLabels = '';
  for (let i = 0; i < N; i += step) {
    const d = parseKey(days[i]);
    xLabels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="chart-xl">${d.getMonth() + 1}/${d.getDate()}</text>`;
  }
  const stimDots = stim.map((v, i) => v > 0 ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" class="dot-stim"/>` : '').join('');
  const exDots = ex.map((v, i) => v > 0 ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" class="dot-ex"/>` : '').join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">
    ${gridLines}${yLabels}
    <polyline points="${stimPts}" class="line-stim"/>
    <polyline points="${exPts}" class="line-ex"/>
    ${stimDots}${exDots}
    ${xLabels}
  </svg>`;
  return `<div class="card chart-card"><h3>健康打卡趋势 <span class="h-section-sub">近 30 天</span></h3>
    <div class="chart-legend"><span class="lg lg-stim">刺激性饮食(辣/奶茶/咖啡)</span><span class="lg lg-ex">运动分钟</span></div>
    ${svg}
    <div class="chart-note">数值为每日辣/奶茶/咖啡合计（杯/份）与运动分钟，便于回顾饮食与运动节奏。</div>
  </div>`;
}

function renderStats() {
  const reg = regularity();
  const next = predictNextStart(), ovu = ovulation(), fw = fertileWindow();
  let html = `<div class="grid2">
    <div class="stat"><div class="k">平均周期</div><div class="v">${avgCycle()}<small> 天</small></div></div>
    <div class="stat"><div class="k">规律度</div><div class="v">${reg.label}</div></div>
    <div class="stat"><div class="k">下次经期(预测)</div><div class="v" style="font-size:15px">${fmtMD(next)}</div></div>
    <div class="stat"><div class="k">排卵日(预测)</div><div class="v" style="font-size:15px">${fmtMD(ovu)}</div></div>
    <div class="stat"><div class="k">易孕窗口</div><div class="v" style="font-size:13px">${fmtMD(fw[0])} ~ ${fmtMD(fw[1])}</div></div>
    <div class="stat"><div class="k">平均经期长度</div><div class="v">${avgPeriodLen() || S.settings.periodLen}<small> 天</small></div></div>
  </div>`;
  html += renderHabitTrend();
  const ps = sortedPeriods();
  if (ps.length) {
    html += `<div class="card"><h3>历史周期</h3>`;
    [...ps].reverse().slice(0, 12).forEach(p => {
      const len = p.end ? diffDays(p.start, p.end) + 1 : null;
      const sym = (p.symptoms && p.symptoms.length) ? ' · ' + esc(p.symptoms.join('/')) : '';
      /* 每日过程记录：先以「开始日」合成第 1 天，再并入手动补的过程记录，按日期排序，避免首日缺失 */
      const dmap = new Map();
      if (Array.isArray(p.daily)) p.daily.forEach(d => dmap.set(d.date, d));
      if (!dmap.has(p.start)) dmap.set(p.start, { date: p.start, flow: p.flow, symptoms: p.symptoms, mood: p.mood, abnormal: p.abnormal, note: p.note, synthetic: true });
      const dailyList = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date));
      const dailyTag = dailyList.length ? ` <small style="color:var(--purple)">(${dailyList.length}天过程)</small>` : '';
      html += `<div class="row"><span class="label">${fmtMD(p.start)}${p.end ? ' ~ ' + fmtMD(p.end) : '（进行中）'}</span><span class="val">${p.flow || ''}${sym} ${len ? len + '天' : ''}${dailyTag}</span></div>`;
      /* 每日过程记录摘要：始终先列出「第 1 天（开始日）」，便于单独回顾首日情况 */
      html += `<div class="daily-summary">`;
      dailyList.forEach(dr => {
        const dn = diffDays(p.start, dr.date) + 1;
        const dsym = dr.symptoms && dr.symptoms.length ? ' · ' + esc(dr.symptoms.join('/')) : '';
        const dmood = dr.mood ? ' · ' + esc(dr.mood) : '';
        const dabn = dr.abnormal ? ' · ' + esc(dr.abnormal) : '';
        const tag = (dn === 1) ? ' <small class="day1-tag">首日</small>' : '';
        html += `<div class="row sub-row"><span class="label">第${dn}天 ${fmtMD(dr.date)}${tag}</span><span class="val">${dr.flow || ''}${dsym}${dmood}${dabn}</span></div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="empty">还没有经期记录，去「今天」记一笔吧</div>`;
  }
  return html;
}

function installCardHtml() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isStandalone = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  let inner;
  if (isStandalone) {
    inner = `<div class="install-done">✓ 已添加到主屏幕</div>`;
  } else if (isIOS) {
    inner = `<div class="disclaimer">iOS 暂不支持自动添加到主屏幕，请按以下步骤手动添加：</div>
      <div class="install-steps">
        <div class="step"><span class="step-n">1</span>点击底部工具栏的 <b>分享</b> 图标 <span class="ico-share">⤴</span></div>
        <div class="step"><span class="step-n">2</span>在菜单中找到并点击 <b>“添加到主屏幕”</b></div>
        <div class="step"><span class="step-n">3</span>点击右上角 <b>“添加”</b>，即可在桌面打开</div>
      </div>`;
  } else if (deferredPrompt) {
    inner = `<div class="disclaimer">点击下方按钮，按提示将其安装为桌面应用（可离线使用、全屏运行）。</div>
      <div class="actions"><button class="btn primary" data-action="install-app">安装到桌面</button></div>`;
  } else {
    inner = `<div class="disclaimer">当前浏览器可点击菜单中的「安装」或「添加到主屏幕」来添加到桌面。</div>`;
  }
  return `<div class="card install-card"><h3>安装到手机桌面</h3>${inner}</div>`;
}

function renderMe() {
  const st = S.settings;
  const li = Math.round((st.lightIntensity != null ? st.lightIntensity : 0.55) * 100);
  return `<div class="me-hero">
    <div class="avatar">🌸</div>
    <div class="me-name">肚小肚·经期小记</div>
    <div class="me-sub">Yyy 设计开发 · 纯净私密本地记录</div>
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
  ${installCardHtml()}
  <div class="card about-card">
    <h3>关于本 Web 应用</h3>
    <div class="about-dev">
      <div class="about-avatar"><img src="https://avatars.githubusercontent.com/u/149399680?v=4" alt="开发者头像" onerror="this.replaceWith(document.createTextNode('🌸'))"></div>
      <div class="about-info">
        <div class="about-name">YangZK</div>
        <div class="about-login">@sunoyyang</div>
        <a class="about-link" href="https://github.com/sunoyyang" target="_blank" rel="noopener">前往 GitHub 主页 ↗</a>
      </div>
    </div>
    <div class="about-desc">肚小肚·经期小记 · 一款纯净私密的本地经期记录工具，数据仅保存在你的本机浏览器，不上传任何服务器。</div>
  </div>
  <div class="me-foot">肚小肚·经期小记 v1.2 · 所有预测均为参考值，如有健康疑问请咨询医生。</div>`;
}

function render() {
  const v = document.getElementById('view');
  if (currentTab === 'today') v.innerHTML = renderToday();
  else if (currentTab === 'calendar') v.innerHTML = renderCalendar();
  else if (currentTab === 'stats') v.innerHTML = renderStats();
  else v.innerHTML = renderMe();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  const sub = { today: '今天', calendar: '日历', stats: '统计', me: '我的' }[currentTab];
  document.getElementById('headerSub').textContent = 'Yyy 设计开发 · ' + sub;
  // 「我的」页隐藏顶部栏（页内已有 hero 卡片展示标题，避免重复）
  const hdr = document.querySelector('.app-header');
  if (hdr) hdr.classList.toggle('force-hide', currentTab === 'me');
}

/* ---------- 弹窗 ---------- */
function modal(html, locked) {
  currentLocked = !!locked;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
}
function closeModal() { if (currentLocked) return; editingPeriodId = null; document.getElementById('modalRoot').innerHTML = ''; }
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

function openPeriodModal(prefill, editId) {
  editingPeriodId = editId || null;
  const editing = !!editId;
  const ep = editing ? S.periods.find(p => p.id === editId) : null;
  const d = editing ? ep.start : (prefill || todayKey());
  const flowOpts = ['少', '中', '多'];
  const symOpts = ['腰酸', '乳房胀痛', '腹痛', '头痛', '乏力', '情绪波动'];
  const moodOpts = ['开心', '平静', '焦虑', '低落', '易怒'];
  /* 进行中的经期（编辑自身时排除自己） */
  const active = [...S.periods].reverse().find(p => !p.end && p.id !== editId);
  const defaultType = editing ? 'start' : (active ? 'daily' : 'start');
  const dayHint = (!editing && active) ? `<div class="day-hint" id="pDayHint">本轮经期第 <strong>${diffDays(active.start, d) + 1}</strong> 天（从 ${fmtMD(active.start)} 起算）</div>` : '';
  const title = editing ? '修改经期' : '记录经期';
  const initDateLabel = editing ? '开始日期' : (defaultType === 'end' ? '结束日期' : (defaultType === 'daily' ? '过程中日期' : '开始日期'));
  let typeSeg;
  if (editing) {
    typeSeg = `<div class="seg" id="pType"><div class="chip on" data-v="start">修改开始日</div></div>`;
  } else {
    const startLabel = active ? '修改开始日' : '开始';
    typeSeg = `<div class="seg" id="pType">
      <div class="chip${defaultType === 'start' ? ' on' : ''}" data-v="start">${startLabel}</div><div class="chip${defaultType === 'daily' ? ' on' : ''}" data-v="daily">过程记录</div><div class="chip" data-v="end">结束本次</div></div>`;
  }
  let note = '';
  if (editing) note = `<div class="field-note">正在修改从 ${fmtMD(ep.start)} 开始的这段经期，可调整开始日与经量/症状/心情。</div>`;
  else if (active) note = `<div class="field-note">已有进行中的经期（${fmtMD(active.start)} 起）。点「修改开始日」可更正本轮的开始日；或用「过程记录」补充每日、「结束本次」收尾。</div>`;
  const flowOn = (v) => (ep && ep.flow === v) || (!ep && v === '中') ? ' on' : '';
  const symOn = (s) => (ep && ep.symptoms && ep.symptoms.includes(s)) ? ' on' : '';
  const moodOn = (mm) => (ep && ep.mood === mm) ? ' on' : '';
  modal(`<h2>${title}</h2>
   <div class="field"><label>类型</label>${typeSeg}</div>
   ${note}
   <div class="field date-field" id="pDateWrap"><label id="pDateLabel">${initDateLabel}</label><input type="date" id="pDate" value="${d}"></div>
   ${dayHint}
   <div class="field" id="pFlowWrap"><label>经量</label><div class="chips" id="pFlow">
     ${flowOpts.map(f => `<div class="chip${flowOn(f)}" data-v="${f}">${f}</div>`).join('')}</div></div>
   <div class="field"><label>症状（可多选）</label><div class="chips" id="pSym">
     ${symOpts.map(s => `<div class="chip${symOn(s)}" data-v="${s}">${s}</div>`).join('')}</div></div>
   <div class="field"><label>心情</label><div class="chips" id="pMood">
     ${moodOpts.map(mm => `<div class="chip${moodOn(mm)}" data-v="${mm}">${mm}</div>`).join('')}</div></div>
   <div class="field"><label>异常备注（如白带异常/血块）</label><input id="pAbn" value="${ep && ep.abnormal ? esc(ep.abnormal) : ''}" placeholder="选填"></div>
   <div class="field"><label>备注</label><textarea id="pNote" placeholder="选填">${ep && ep.note ? esc(ep.note) : ''}</textarea></div>
   <div class="actions"><button class="btn ghost" data-action="close-modal">取消</button><button class="btn primary" data-action="save-period">保存</button></div>`);
  bindChips('#pFlow', true); bindChips('#pSym'); bindChips('#pMood', true);
  const pType = document.getElementById('pType');
  if (pType && !editing) {
    pType.addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      const t = c.dataset.v;
      if (t === 'start' && active) {
        /* 已有进行中经期时点「修改开始日」→ 进入编辑当前经期模式 */
        openPeriodModal(todayKey(), active.id);
        return;
      }
      [...e.currentTarget.children].forEach(x => x.classList.remove('on')); c.classList.add('on');
      const isEnd = t === 'end';
      const isDaily = t === 'daily';
      /* 结束本次：显示结束日期（默认取弹出时的日期），隐藏经量 */
      document.getElementById('pDateWrap').style.display = '';
      let dateLabel = '开始日期';
      if (isEnd) dateLabel = '结束日期';
      else if (isDaily) dateLabel = '过程中日期';
      document.getElementById('pDateLabel').textContent = dateLabel;
      document.getElementById('pFlowWrap').style.display = isEnd ? 'none' : '';
      const hint = document.getElementById('pDayHint');
      if (hint) hint.style.display = isDaily ? '' : 'none';
    });
  }
  const hint0 = document.getElementById('pDayHint');
  if (hint0) hint0.style.display = (!editing && defaultType === 'daily') ? '' : 'none';
}

function savePeriod() {
  const type = document.querySelector('#pType .chip.on').dataset.v;
  if (type === 'end') {
    const end = document.getElementById('pDate').value;
    if (!end) { toast('请选择结束日期'); return; }
    /* 优先进行中的经期；否则取最近一条（用于修正已结束但记错结束日的经期） */
    let target = [...S.periods].reverse().find(p => !p.end);
    if (!target) target = [...S.periods].reverse()[0];
    if (!target) { toast('还没有经期记录，请先记录「开始」'); return; }
    if (end < target.start) { toast('结束日不能早于开始日（' + fmtMD(target.start) + '）'); return; }
    /* 不能晚于下一段经期的开始日，避免两段重叠 */
    const next = S.periods.find(x => x.start > target.start);
    if (next && end >= next.start) { toast('结束日不能晚于下一段经期开始日（' + fmtMD(next.start) + '）'); return; }
    target.end = end;
    /* 若新的结束日早于原结束日，移除超出范围的每日过程记录，保持数据一致 */
    if (Array.isArray(target.daily)) target.daily = target.daily.filter(r => r.date <= end);
    save(); closeModal(); render(); toast('已记录经期结束（' + fmtMD(end) + '）');
    return;
  }
  if (type === 'daily') {
    /* 进行中经期优先；否则取最近一条（支持给已结束经期补过程记录） */
    const active = [...S.periods].reverse().find(p => !p.end) || [...S.periods].reverse()[0];
    if (!active) { toast('没有经期记录，请先记录「开始」'); return; }
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
  if (editingPeriodId) {
    /* 编辑已有经期的开始日 */
    const ep = S.periods.find(p => p.id === editingPeriodId);
    if (!ep) { editingPeriodId = null; return; }
    const date = document.getElementById('pDate').value;
    if (!date) { toast('请选择日期'); return; }
    if (S.periods.some(p => p.id !== editingPeriodId && p.start === date)) { toast('该日已有其它经期记录'); return; }
    const overlap = S.periods.find(p => p.id !== editingPeriodId && date >= p.start && date <= (p.end || date));
    if (overlap) { toast('该日期在其它经期（' + fmtMD(overlap.start) + (overlap.end ? ' ~ ' + fmtMD(overlap.end) : '') + '）范围内'); return; }
    if (ep.end && date > ep.end) { toast('开始日不能晚于结束日'); return; }
    const flow = getChips('#pFlow')[0] || '中';
    const sym = getChips('#pSym');
    const mood = getChips('#pMood')[0] || '';
    const abn = document.getElementById('pAbn').value.trim();
    const note = document.getElementById('pNote').value.trim();
    ep.start = date; ep.flow = flow; ep.symptoms = sym; ep.mood = mood; ep.abnormal = abn; ep.note = note;
    /* 开始日改动后，移除早于新开始日的过程记录，保持数据一致 */
    if (Array.isArray(ep.daily)) ep.daily = ep.daily.filter(r => r.date >= date);
    editingPeriodId = null;
    save(); closeModal(); render(); toast('已修改经期开始日');
    return;
  }
  /* 非编辑：已有进行中的经期时，禁止再新建一条，避免重复覆盖今天统计 */
  const openExisting = S.periods.find(p => !p.end);
  if (openExisting) {
    toast('已有进行中的经期（从 ' + fmtMD(openExisting.start) + ' 起），请用「修改开始日」或「过程记录」');
    return;
  }
  const date = document.getElementById('pDate').value;
  const flow = getChips('#pFlow')[0] || '中';
  const sym = getChips('#pSym');
  const mood = getChips('#pMood')[0] || '';
  const abn = document.getElementById('pAbn').value.trim();
  const note = document.getElementById('pNote').value.trim();
  if (S.periods.some(p => p.start === date)) { toast('该日已有经期记录'); return; }
  const overlap = S.periods.find(p => date >= p.start && date <= (p.end || date));
  if (overlap) { toast('该日期在已有经期（' + fmtMD(overlap.start) + (overlap.end ? ' ~ ' + fmtMD(overlap.end) : '') + '）范围内，不能重复开始'); return; }
  S.periods.push({ id: uid(), start: date, end: null, flow, symptoms: sym, abnormal: abn, mood, note, daily: [] });
  save(); closeModal(); render(); toast('已保存');
}

function openDaySheet(dateStr) {
  const p = periodAt(dateStr); // 覆盖该日期的经期（重叠时取最早开始的）
  let html = `<h2>${fmtFull(dateStr)}</h2>`;
  const rows = [];
  if (p) {
    const dayNum = diffDays(p.start, dateStr) + 1;
    const isStart = p.start === dateStr;
    const isEnd = p.end === dateStr;
    const daily = Array.isArray(p.daily) ? p.daily.filter(r => r.date === dateStr) : [];
    if (isStart) {
      /* 经期开始日：展示主记录 */
      let tag = '🌸 经期开始';
      rows.push(`<div class="row"><span class="label"><b>${tag}</b> · 第 ${dayNum} 天</span><span class="val">${p.flow || ''} ${p.symptoms && p.symptoms.length ? '· ' + p.symptoms.join('/') : ''}</span></div>`);
      if (p.mood) rows.push(`<div class="row"><span class="label">心情</span><span class="val">${p.mood}</span></div>`);
      if (p.abnormal) rows.push(`<div class="row"><span class="label">异常</span><span class="val">${esc(p.abnormal)}</span></div>`);
      if (p.note) rows.push(`<div class="row"><span class="label">备注</span><span class="val">${esc(p.note)}</span></div>`);
    } else if (isEnd) {
      rows.push(`<div class="row"><span class="label"><b>✅ 经期结束</b> · 第 ${dayNum} 天</span><span class="val"></span></div>`);
    } else {
      /* 经期过程日 */
      if (daily.length) {
        daily.forEach(dr => {
          rows.push(`<div class="row"><span class="label"><b>📝 经期过程</b> · 第 ${dayNum} 天</span><span class="val">${dr.flow || ''} ${dr.symptoms && dr.symptoms.length ? '· ' + dr.symptoms.join('/') : ''}</span></div>`);
          if (dr.mood) rows.push(`<div class="row"><span class="label">心情</span><span class="val">${dr.mood}</span></div>`);
          if (dr.abnormal) rows.push(`<div class="row"><span class="label">异常</span><span class="val">${esc(dr.abnormal)}</span></div>`);
          if (dr.note) rows.push(`<div class="row"><span class="label">备注</span><span class="val">${esc(dr.note)}</span></div>`);
        });
      } else {
        rows.push(`<div class="row"><span class="label"><b>📝 经期过程</b> · 第 ${dayNum} 天</span><span class="val" style="color:var(--ink-2)">暂无过程记录，点下方「记经期」补充</span></div>`);
      }
    }
  }
  if (rows.length) {
    html += `<div class="card" style="box-shadow:none;margin-bottom:12px">${rows.join('')}</div>`;
  } else {
    html += `<div class="empty">这一天还没有记录</div>`;
  }
  /* 若该日是某条经期的「开始日」，或该日期落在某条「已结束」经期内，
     允许修改本段经期 / 修改结束日 / 删除整条（用于修正误记的结束日等） */
  const startP = S.periods.find(pp => pp.start === dateStr);
  const endedP = (p && p.end) ? p : null;
  const editTarget = startP || endedP;
  html += `<div class="actions"><button class="btn primary" data-action="open-period" data-date="${dateStr}">记经期(此日)</button></div>`;
  if (editTarget) {
    html += `<div class="actions"><button class="btn" data-action="edit-period" data-date="${dateStr}" data-id="${editTarget.id}">✏️ 修改本段经期</button>`;
    if (endedP) {
      html += `<button class="btn" data-action="edit-period-end" data-id="${endedP.id}">✏️ 修改结束日</button>`;
      html += `<button class="btn" data-action="clear-end" data-id="${endedP.id}">↩️ 清除结束日</button>`;
    }
    html += `</div>`;
    html += `<div class="actions"><button class="btn danger" data-action="delete-period" data-id="${editTarget.id}">🗑 删除这条经期记录</button></div>`;
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

/* 修改已结束（或进行中）经期的结束日 */
function openEndEditModal(id) {
  const p = S.periods.find(x => x.id === id);
  if (!p) return;
  const d = p.end || todayKey();
  const dur = diffDays(p.start, d) + 1;
  modal(`<h2>修改结束日</h2>
   <div class="field-note">正在修改从 ${fmtMD(p.start)} 开始的这段经期的结束日（当前共 ${dur} 天）。</div>
   <div class="field date-field"><label>结束日期</label><input type="date" id="eDate" value="${d}"></div>
   <div class="actions"><button class="btn ghost" data-action="close-modal">取消</button><button class="btn primary" data-action="save-end-edit" data-id="${p.id}">保存</button></div>`);
}
function saveEndEdit(id) {
  const p = S.periods.find(x => x.id === id);
  if (!p) return;
  const d = document.getElementById('eDate').value;
  if (!d) { toast('请选择日期'); return; }
  if (d < p.start) { toast('结束日不能早于开始日（' + fmtMD(p.start) + '）'); return; }
  /* 不能晚于下一段经期的开始日，避免两段重叠 */
  const next = S.periods.find(x => x.start > p.start);
  if (next && d >= next.start) { toast('结束日不能晚于下一段经期开始日（' + fmtMD(next.start) + '）'); return; }
  p.end = d;
  save(); closeModal(); render(); toast('已修改结束日为 ' + fmtMD(d));
}

/* 清除已结束经期的结束日，使其恢复为「进行中」（便于在正确日期重新结束本次） */
function clearEnd(id) {
  const p = S.periods.find(x => x.id === id);
  if (!p) return;
  if (!confirm('清除这条经期的结束日吗？\n清除后该经期会恢复为「进行中」，你可以在正确的日期再点「结束本次」。')) return;
  p.end = null;
  save(); closeModal(); render(); toast('已清除结束日，经期恢复进行中');
}

/* ---------- 动作分发 ---------- */
function doAction(a, el) {
  switch (a) {
    case 'open-period': openPeriodModal(el && el.dataset.date); break;
    case 'edit-period': openPeriodModal(el && el.dataset.date, el.dataset.id); break;
    case 'edit-period-end': openEndEditModal(el.dataset.id); break;
    case 'save-end-edit': saveEndEdit(el.dataset.id); break;
    case 'save-period': savePeriod(); break;
    case 'habit-inc': bumpHabit(el.dataset.k, +(el.dataset.step || 1)); break;
    case 'habit-dec': bumpHabit(el.dataset.k, -(+(el.dataset.step || 1))); break;
    case 'habit-toggle': toggleHabit(el.dataset.k); break;
    case 'habit-set': setHabitNum(el.dataset.k, el.value); break;
    case 'toggle-health': healthExpanded = !healthExpanded; render(); break;
    case 'delete-period': deletePeriod(el.dataset.id); break;
    case 'clear-end': clearEnd(el.dataset.id); break;
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
        rd.onload = () => { try { const o = JSON.parse(rd.result); const d = defaults(); d.periods = o.periods || []; if (o.settings) d.settings = Object.assign(d.settings, o.settings); S = d; save(); render(); toast('导入成功'); } catch (e) { toast('文件格式错误'); } };
        rd.readAsText(f);
      };
      inp.click(); break;
    }
    case 'clear-data':
      if (confirm('确定清空所有数据？不可恢复')) { S = defaults(); save(); render(); toast('已清空'); }
      break;
    case 'close-modal': closeModal(); break;
    case 'install-app': installApp(); break;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-mask')) { closeModal(); return; }
  const tab = e.target.closest('.tab');
  if (tab) { currentTab = tab.dataset.tab; render(); return; }
  const th = e.target.closest('#pTheme .chip');
  if (th) { S.settings.theme = th.dataset.v; save(); applyTheme(); render(); toast('外观已更新'); return; }
  const el = e.target.closest('[data-action]');
  if (el && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) doAction(el.dataset.action, el);
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
  if (e.target.id === 'lightIntensity') {
    S.settings.lightIntensity = +e.target.value / 100;
    save();
    return;
  }
  const hel = e.target.closest('[data-action="habit-set"]');
  if (hel) doAction('habit-set', hel);
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

/* ---------- 安装到桌面（PWA） ---------- */
async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try {
    const choice = await deferredPrompt.userChoice;
    if (choice && choice.outcome === 'accepted') toast('已安装到桌面');
  } catch (e) { /* 用户取消或浏览器拦截 */ }
  deferredPrompt = null;
  render();
}

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = (S.settings && S.settings.theme) || 'light';
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

/* 捕获浏览器 deferred 安装事件，用于「安装到桌面」按钮（安卓/桌面 Chrome、Edge 等） */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (currentTab === 'me') render();
});
window.addEventListener('appinstalled', () => {
  appInstalled = true;
  deferredPrompt = null;
  if (currentTab === 'me') render();
});

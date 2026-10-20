"use strict";

/* ================= утилиты ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const KEY = "capsula.";
const store = {
  get(k, def) { try { const v = localStorage.getItem(KEY + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
};

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => iso(new Date());
const toDate = s => new Date(s + "T12:00:00");
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const fmtDate = (s, opts) => toDate(s).toLocaleDateString("ru-RU", opts);
const fmtNum = n => String(Math.round(n * 10) / 10).replace(".", ",");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};

/* ================= данные ================= */
const DEFAULT_PROFILE = { age: 20, height: 167, weight: 46.6, startWeight: 46.6, goalWeight: 50, activity: 1.4, surplus: 350, ramp: true };

// Слоты дня: 3 основных приёма + перекусы. share — доля дневной нормы.
const SLOTS = [
  { key: "breakfast", name: "Завтрак",          short: "Завтрак",   ic: "🌅", share: .23, cats: ["завтрак"] },
  { key: "snack1",    name: "Перекус",          short: "Перекус 1", ic: "🫖", share: .12, cats: ["перекус", "бустер"] },
  { key: "lunch",     name: "Обед",             short: "Обед",      ic: "☀️", share: .23, cats: ["обед", "ужин"] },
  { key: "snack2",    name: "Перекус",          short: "Перекус 2", ic: "🍎", share: .12, cats: ["перекус", "бустер"] },
  { key: "dinner",    name: "Ужин",             short: "Ужин",      ic: "🌙", share: .20, cats: ["ужин", "обед"] },
  { key: "snack3",    name: "Вечерний перекус", short: "Вечером",   ic: "🌿", share: .10, cats: ["перекус", "бустер"] },
];
const SLOT = Object.fromEntries(SLOTS.map(s => [s.key, s]));
const RECIPE = Object.fromEntries(RECIPES.map(r => [r.id, r]));

const state = {
  profile: store.get("profile", null),
  log: store.get("log", {}),          // { "2026-10-20": [{ uid, id, slot, portions }] }
  weights: store.get("weights", []),  // [{ date, kg }]
  favs: store.get("favs", []),
  celebrated: store.get("celebrated", ""),
  theme: store.get("theme", "auto"),
};
const save = k => store.set(k, state[k]);

if (!state.profile) {
  state.profile = { ...DEFAULT_PROFILE, rampStart: today() };
  state.weights = [{ date: today(), kg: DEFAULT_PROFILE.weight }];
  save("profile"); save("weights");
}

/* ================= норма КБЖУ ================= */
const RAMP_START = 1800, RAMP_STEP = 125, RAMP_FIRST_WEEK = 7, RAMP_EVERY = 3;

function fullTarget() {
  const { weight, height, age, activity, surplus } = state.profile;
  const bmr = 10 * weight + 6.25 * height - 5 * age - 161;   // Миффлин–Сан Жеор, женщины
  const tdee = bmr * activity;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal: Math.round((tdee + surplus) / 10) * 10 };
}

// Плавный старт: неделя на 1800, потом +125 ккал каждые 3 дня до полной нормы.
function rampInfo(date) {
  const p = state.profile, full = fullTarget().kcal;
  if (!p.ramp || !p.rampStart) return null;
  const start = Math.min(RAMP_START, full);
  const steps = Math.ceil((full - start) / RAMP_STEP);
  if (steps <= 0) return null;
  const total = RAMP_FIRST_WEEK + (steps - 1) * RAMP_EVERY;
  const d = daysBetween(p.rampStart, date);
  if (d < 0 || d >= total) return null;
  const kcal = d < RAMP_FIRST_WEEK ? start
    : Math.min(full, start + RAMP_STEP * (Math.floor((d - RAMP_FIRST_WEEK) / RAMP_EVERY) + 1));
  return { day: d + 1, total, kcal };
}

function norms(kcal) {
  const w = state.profile.weight;
  const p = Math.round(1.8 * w);
  const f = Math.round(Math.max(1.1 * w, kcal * .25 / 9));
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, c };
}

const targetFor = date => { const r = rampInfo(date); return norms(r ? r.kcal : fullTarget().kcal); };
const slotAim = (t, sl) => Math.round(t.kcal * sl.share / 10) * 10;

/* ================= дневник ================= */
const entries = date => (state.log[date] || []).filter(e => RECIPE[e.id]);

function sumOf(list) {
  const s = list.reduce((s, e) => {
    const r = RECIPE[e.id], k = e.portions;
    s.kcal += r.kcal * k; s.p += r.protein * k; s.f += r.fat * k; s.c += r.carbs * k;
    return s;
  }, { kcal: 0, p: 0, f: 0, c: 0 });
  return { kcal: Math.round(s.kcal), p: Math.round(s.p), f: Math.round(s.f), c: Math.round(s.c) };
}
const totals = date => sumOf(entries(date));

function addEntry(id, slot, portions = 1) {
  (state.log[today()] ||= []).push({ uid: uid(), id, slot, portions });
  save("log");
}
const findEntry = id => (state.log[today()] || []).find(e => e.uid === id);

function snackSlot() {
  const used = new Set(entries(today()).map(e => e.slot));
  return ["snack1", "snack2", "snack3"].find(s => !used.has(s)) || "snack3";
}
function suggestSlot(r) {
  if (r.category === "завтрак") return "breakfast";
  if (r.category === "обед") return "lunch";
  if (r.category === "ужин") return "dinner";
  return snackSlot();
}

function autoPlan() {
  const t = targetFor(today()), list = entries(today());
  const used = new Set(list.map(e => e.id));
  const empty = SLOTS.filter(sl => !list.some(e => e.slot === sl.key));
  // остаток нормы делим между пустыми слотами пропорционально их долям
  let left = t.kcal - sumOf(list).kcal, shareLeft = empty.reduce((s, sl) => s + sl.share, 0);
  let added = 0, kcal = 0;
  for (const sl of empty) {
    const aim = Math.max(0, left) * sl.share / shareLeft;
    shareLeft -= sl.share;
    if (aim < 120) continue;
    const pool = RECIPES
      .filter(r => sl.cats.includes(r.category) && !used.has(r.id))
      .sort((a, b) => Math.abs(a.kcal - aim) - Math.abs(b.kcal - aim))
      .slice(0, 2);
    if (!pool.length) continue;
    const r = pool[Math.floor(Math.random() * pool.length)];
    used.add(r.id); addEntry(r.id, sl.key); added++; kcal += r.kcal; left -= r.kcal;
  }
  toast(added ? `✨ Собрала день: +${kcal} ккал` : empty.length ? "Норма уже почти добрана 💛" : "Все приёмы уже заполнены 💛");
}

function repeatYesterday() {
  state.log[today()] = entries(addDays(today(), -1)).map(e => ({ ...e, uid: uid() }));
  save("log");
  toast("↻ Повторила вчерашний день");
}

/* ================= серии и ачивки ================= */
const hit = date => { const k = totals(date).kcal; return k > 0 && k >= .9 * targetFor(date).kcal; };

function currentStreak() {
  let d = today(), n = 0;
  if (!hit(d)) d = addDays(d, -1);
  while (hit(d)) { n++; d = addDays(d, -1); }
  return n;
}
function bestStreak() {
  const dates = Object.keys(state.log).filter(d => entries(d).length).sort();
  let best = 0, run = 0;
  if (dates.length) for (let d = dates[0]; d <= today(); d = addDays(d, 1)) { run = hit(d) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

/* ================= вес ================= */
const sortedWeights = () => [...state.weights].sort((a, b) => a.date < b.date ? -1 : 1);

function upsertWeight(kg) {
  state.weights = state.weights.filter(w => w.date !== today());
  state.weights.push({ date: today(), kg });
  save("weights");
  syncWeight();
}
function syncWeight() {
  const last = sortedWeights().at(-1);
  if (last) { state.profile.weight = last.kg; save("profile"); }
}

/* ================= экран «Сегодня» ================= */
const RING = 2 * Math.PI * 88;
$("#ringBar").style.strokeDasharray = RING;
$("#ringBar").style.strokeDashoffset = RING;

function animateNumber(el, to) {
  const from = parseInt(el.textContent) || 0, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderToday() {
  const date = today(), t = targetFor(date), s = totals(date), left = t.kcal - s.kcal, ramp = rampInfo(date);
  const h = new Date().getHours();

  $("#tDate").textContent = fmtDate(date, { weekday: "long", day: "numeric", month: "long" });
  $("#tHello").innerHTML = (h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер")
    + ` <em>${h >= 18 || h < 5 ? "☾" : "☀︎"}</em>`;
  const streak = currentStreak();
  $("#tStreak").textContent = streak ? `🔥 ${streak} ${plural(streak, "день", "дня", "дней")}` : "🌱 начало";

  $("#tRamp").hidden = !ramp;
  if (ramp) $("#tRamp").textContent = `🌱 Плавный старт · день ${ramp.day} из ${ramp.total}`;

  animateNumber($("#tEaten"), s.kcal);
  $("#tGoal").textContent = t.kcal;
  $("#ringBar").style.strokeDashoffset = RING * (1 - Math.min(1, s.kcal / t.kcal));

  const share = s.kcal / t.kcal;
  $("#tLeft").innerHTML = s.kcal === 0 ? "Начнём день с вкусного завтрака 🌿"
    : left > 0 ? `Осталось добрать <b>${left} ккал</b> — ${share < .5 ? "всё впереди" : share < .8 ? "ты отлично справляешься" : "совсем чуть-чуть!"}`
    : "Норма добрана! <b>Ты умничка</b> 💛";

  for (const k of ["p", "f", "c"]) {
    $(`#${k}V`).innerHTML = `${s[k]} <span>/ ${t[k]} г</span>`;
    $(`#${k}B`).style.width = Math.min(100, s[k] / t[k] * 100) + "%";
  }

  if (left <= 0 && s.kcal > 0 && state.celebrated !== date) {
    state.celebrated = date; save("celebrated");
    setTimeout(confetti, 500);
  }

  renderWeek();
  renderBoosts(left);
  renderSlots(t);
}

function renderWeek() {
  const C = 2 * Math.PI * 14;
  $("#tWeek").innerHTML = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6)).map(d => {
    const pct = Math.min(1, totals(d).kcal / targetFor(d).kcal);
    return `<div class="wd ${d === today() ? "now" : ""}">
      <svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="14"/>
      <circle class="bar" cx="18" cy="18" r="14" transform="rotate(-90 18 18)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" ${pct === 0 ? 'stroke-opacity="0"' : ""}/>
      ${pct >= .9 ? '<text x="18" y="22.5">✓</text>' : ""}</svg>
      <span>${fmtDate(d, { weekday: "short" })}</span></div>`;
  }).join("");
}

function renderBoosts(left) {
  const aim = clamp(left, 150, 450);
  const list = RECIPES.filter(r => r.category === "бустер" || r.tags.includes("бустер"))
    .sort((a, b) => Math.abs(a.kcal - aim) - Math.abs(b.kcal - aim));
  $("#boostHint").textContent = left > 0 ? "маленькие и сытные" : "если хочется ещё";
  $("#tBoosts").innerHTML = list.map(r => `
    <div class="boost" data-recipe="${r.id}">
      <div class="emoji">${r.emoji}</div>
      <div class="t">${r.name}</div>
      <div class="k">${r.kcal} ккал · ${r.protein} г белка</div>
      <button class="plus" data-quick="${r.id}" aria-label="Добавить">+</button>
    </div>`).join("");
}

function renderSlots(t) {
  const list = entries(today());
  $("#tSlots").innerHTML = SLOTS.map(sl => {
    const items = list.filter(e => e.slot === sl.key), aim = slotAim(t, sl);
    if (!items.length) return `
      <div class="slot empty" data-pick="${sl.key}">
        <div class="ic">${sl.ic}</div>
        <div class="info"><div class="label">${sl.name}</div><div class="dish">+ добавить блюдо</div></div>
        <div class="kc">~${aim}</div>
      </div>`;
    return `
      <div class="slot-group">
        <div class="slot-head"><span class="label">${sl.name}</span><span class="hint">${sumOf(items).kcal} / ~${aim} ккал</span>
          <button class="mini-add" data-pick="${sl.key}" aria-label="Добавить">+</button></div>
        ${items.map(e => { const r = RECIPE[e.id]; return `
          <div class="slot" data-entry="${e.uid}">
            <div class="ic">${r.emoji}</div>
            <div class="info"><div class="dish">${r.name}</div>
              <div class="sub">${e.portions !== 1 ? `× ${fmtNum(e.portions)} · ` : ""}${Math.round(r.protein * e.portions)} г белка</div></div>
            <div class="kc">${Math.round(r.kcal * e.portions)}</div>
            <div class="check">✓</div>
          </div>`; }).join("")}
      </div>`;
  }).join("");

  const btns = [];
  if (!list.length && entries(addDays(today(), -1)).length) btns.push(`<button class="pill" data-action="repeat">↻ Как вчера</button>`);
  if (SLOTS.some(sl => !list.some(e => e.slot === sl.key))) btns.push(`<button class="pill" data-action="autoplan">✨ Собрать</button>`);
  $("#dayActions").innerHTML = btns.join("");
}

/* ================= экран «Капсула» ================= */
const filter = { cat: "all", q: "" };
const CATS = [["all", "Все"], ["fav", "♥ Избранное"], ["моё", "💛 Мои"], ["база", "База"], ["тренд", "Тренды"], ["завтрак", "Завтраки"],
  ["обед", "Обеды"], ["ужин", "Ужины"], ["перекус", "Перекусы"], ["бустер", "Бустеры"], ["впрок", "Впрок"]];

function renderCapsule() {
  $("#cCount").textContent = `${RECIPES.length} ${plural(RECIPES.length, "блюдо", "блюда", "блюд")} в капсуле`;
  $("#cCats").innerHTML = CATS.map(([k, n]) => `<button class="chip ${filter.cat === k ? "on" : ""}" data-cat="${k}">${n}</button>`).join("");
  const q = filter.q.trim().toLowerCase(), c = filter.cat;
  const list = RECIPES.filter(r =>
    (c === "all" || (c === "fav" ? state.favs.includes(r.id) : r.category === c || r.tags.includes(c))) &&
    (!q || (r.name + " " + r.ingredients.join(" ")).toLowerCase().includes(q)));
  $("#cGrid").innerHTML = list.length ? list.map(r => `
    <div class="card" data-recipe="${r.id}">
      <div class="card-emoji">${r.emoji}${state.favs.includes(r.id) ? '<i class="heart">♥</i>' : ""}</div>
      <div class="card-name">${r.name}</div>
      <div class="card-meta"><b>${r.kcal}</b> ккал · ${r.protein} г белка</div>
      <div class="card-meta">⏱ ${r.timeMin || "<1"} мин</div>
    </div>`).join("")
    : `<p class="empty-note">${c === "fav" && !q ? "Нажми ♡ на блюде — и оно появится здесь" : "Ничего не нашлось 🌾"}</p>`;
}

/* ================= экран «Прогресс» ================= */
function renderProgress() {
  const p = state.profile, ws = sortedWeights();
  const last = ws.at(-1)?.kg ?? p.weight, start = p.startWeight;
  const gained = last - start, toGo = Math.max(0, p.goalWeight - last);
  const pct = clamp(gained / (p.goalWeight - start), 0, 1);
  const streak = currentStreak(), best = bestStreak();

  let tip = "";
  const old = [...ws].reverse().find(w => daysBetween(w.date, ws.at(-1).date) >= 14);
  if (old && last <= old.kg && toGo > 0)
    tip = `<div class="tip">Вес стоит уже 2 недели — это нормально, организм привыкает. Давай мягко добавим <b>+150 ккал</b> в день?
      <button class="btn" data-action="bump">Добавить +150 ккал</button></div>`;

  const allDishes = new Set(Object.values(state.log).flat().map(e => e.id));
  const daysHit = Object.keys(state.log).filter(hit).length;
  const ACH = [
    ["🌱", "Первый шаг", Object.values(state.log).some(a => a.length)],
    ["🎯", "Норма добрана", daysHit >= 1],
    ["🔥", "3 дня подряд", best >= 3],
    ["💫", "Неделя заботы", best >= 7],
    ["👑", "Месяц заботы", best >= 30],
    ["🍽", "10 разных блюд", allDishes.size >= 10],
    ["🎈", "+1 кг", gained >= 1],
    ["🌷", "+2 кг", gained >= 2],
    ["🏆", "Цель!", toGo === 0],
  ];

  $("#pRoot").innerHTML = `
    <div class="tiles">
      <div class="tile"><span>Сейчас</span><b>${fmtNum(last)}</b> <small>кг</small></div>
      <div class="tile"><span>Набрано</span><b>${gained >= 0 ? "+" : ""}${fmtNum(gained)}</b> <small>кг</small></div>
      <div class="tile"><span>До цели</span><b>${fmtNum(toGo)}</b> <small>кг</small></div>
      <div class="tile"><span>Серия</span><b>${streak}</b> <small>${plural(streak, "день", "дня", "дней")}</small></div>
    </div>

    <div class="box">
      <h2>Путь к ${fmtNum(p.goalWeight)} кг</h2>
      <div class="goalbar"><i style="width:${pct * 100}%"></i></div>
      <div class="hint">${Math.round(pct * 100)}% пути · старт ${fmtNum(start)} кг</div>
    </div>

    ${tip}

    <div class="box">
      <h2>Взвешивание</h2>
      <div class="weigh">
        <input id="wInput" type="number" inputmode="decimal" step="0.1" value="${last}">
        <button class="btn" data-action="save-weight">Записать</button>
      </div>
      <p class="hint">Раз в неделю, утром, до еды — так цифры честнее. Норма пересчитается сама.</p>
      ${chart(ws, p.goalWeight)}
    </div>

    ${ws.length ? `<div class="box"><h2>История</h2><ul class="history">
      ${[...ws].reverse().slice(0, 10).map((w, i, arr) => {
        const prev = arr[i + 1], diff = prev ? w.kg - prev.kg : 0;
        return `<li><span class="d">${fmtDate(w.date, { day: "numeric", month: "long" })}</span>
          ${diff > 0 ? `<span class="plus-kg">+${fmtNum(diff)}</span>` : ""}${fmtNum(w.kg)} кг
          <button class="del" data-action="del-weight" data-date="${w.date}" aria-label="Удалить">×</button></li>`;
      }).join("")}</ul></div>` : ""}

    <div class="box">
      <h2>Достижения</h2>
      <div class="ach">${ACH.map(([e, n, ok]) => `<div class="${ok ? "" : "locked"}"><span class="e">${e}</span><b>${n}</b></div>`).join("")}</div>
    </div>`;
}

function chart(ws, goal) {
  if (ws.length < 2) return `<p class="empty-note">График появится после второго взвешивания 📈</p>`;
  const W = 340, H = 180, P = { l: 30, r: 10, t: 16, b: 24 };
  const first = ws[0].date, lastD = ws.at(-1).date, span = Math.max(7, daysBetween(first, lastD));
  const kgs = ws.map(w => w.kg);
  const lo = Math.floor(Math.min(...kgs) - .5), hi = Math.ceil(Math.max(goal, ...kgs) + .3);
  const x = d => P.l + daysBetween(first, d) / span * (W - P.l - P.r);
  const y = kg => P.t + (hi - kg) / (hi - lo) * (H - P.t - P.b);
  const stepKg = hi - lo > 6 ? 2 : 1;
  const ticks = []; for (let k = lo; k <= hi; k += stepKg) ticks.push(k);
  const pts = ws.map(w => [x(w.date), y(w.kg)]);
  const line = pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
  const area = `${pts[0][0].toFixed(1)},${H - P.b} ${line} ${pts.at(-1)[0].toFixed(1)},${H - P.b}`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График веса">
    ${ticks.map(k => `<line class="grid-l" x1="${P.l}" x2="${W - P.r}" y1="${y(k)}" y2="${y(k)}"/>
      <text class="axis" x="${P.l - 6}" y="${y(k) + 3.5}" text-anchor="end">${k}</text>`).join("")}
    <line class="goal" x1="${P.l}" x2="${W - P.r}" y1="${y(goal)}" y2="${y(goal)}"/>
    <text class="goal-label" x="${W - P.r}" y="${y(goal) - 6}" text-anchor="end">цель ${fmtNum(goal)}</text>
    <polygon class="area" points="${area}"/>
    <polyline class="line" points="${line}"/>
    ${pts.map(([cx, cy]) => `<circle class="dot" cx="${cx}" cy="${cy}" r="4"/>`).join("")}
    <text class="axis" x="${P.l}" y="${H - 6}">${fmtDate(first, { day: "numeric", month: "short" })}</text>
    <text class="axis" x="${W - P.r}" y="${H - 6}" text-anchor="end">${fmtDate(lastD, { day: "numeric", month: "short" })}</text>
  </svg>`;
}

/* ================= экран «Профиль» ================= */
function renderProfile() {
  for (const el of $$("[data-field]")) {
    const v = state.profile[el.dataset.field];
    if (el.type === "checkbox") el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
  }
  renderNorms();
  $("#themeChips").innerHTML = [["auto", "Как в системе"], ["light", "☀︎ Светлая"], ["dark", "☾ Тёмная"]]
    .map(([k, n]) => `<button class="chip ${state.theme === k ? "on" : ""}" data-theme-set="${k}">${n}</button>`).join("");
}

function renderNorms() {
  const f = fullTarget(), n = norms(f.kcal), ramp = rampInfo(today());
  $("#normBox").innerHTML = `
    <h2>Моя норма</h2>
    <div class="norm-grid">
      <div class="big"><span>Цель на набор</span><b>${n.kcal} ккал</b></div>
      <div><span>Белки</span><b>${n.p} г</b></div>
      <div><span>Жиры</span><b>${n.f} г</b></div>
      <div><span>Углеводы</span><b>${n.c} г</b></div>
      <div><span>Обмен в покое</span><b>${f.bmr}</b></div>
    </div>
    <p class="hint">Расход за день с активностью ≈ ${f.tdee} ккал, плюс ${state.profile.surplus} ккал на набор.</p>`;
  $("#rampText").textContent = ramp
    ? `Сейчас день ${ramp.day} из ${ramp.total}: норма ${ramp.kcal} ккал. Первая неделя — ${Math.min(RAMP_START, f.kcal)} ккал, дальше +${RAMP_STEP} ккал каждые ${RAMP_EVERY} дня.`
    : state.profile.ramp ? "Разгон завершён — ты на полной норме 💛" : "Выключено: сразу полная норма.";
}

function applyTheme() {
  if (state.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  $('meta[name="theme-color"]').setAttribute("content", bg);
}

/* ================= шторка ================= */
let sheet = null;

function openSheet(ctx) { sheet = ctx; renderSheet(); document.body.classList.add("open"); $("#sheet").scrollTop = 0; }
function closeSheet() { document.body.classList.remove("open"); sheet = null; }
function renderSheet() {
  if (!sheet) return;
  const html = { recipe: sheetRecipe, entry: sheetEntry, picker: sheetPicker }[sheet.type]();
  if (html == null) return closeSheet();
  $("#sheet").innerHTML = '<div class="grab"></div>' + html;
}

const kbju = (r, k = 1) => `<div class="kbju">
  <div><b>${Math.round(r.kcal * k)}</b><span>ккал</span></div>
  <div><b style="color:var(--protein)">${Math.round(r.protein * k)}</b><span>белки</span></div>
  <div><b style="color:var(--fat)">${Math.round(r.fat * k)}</b><span>жиры</span></div>
  <div><b style="color:var(--carbs)">${Math.round(r.carbs * k)}</b><span>углеводы</span></div></div>`;

const recipeText = r => `
  <h4>Что нужно</h4><ul>${r.ingredients.map(x => `<li>${x}</li>`).join("")}</ul>
  <h4>Как готовить</h4><ol>${r.steps.map(x => `<li>${x}</li>`).join("")}</ol>`;

function sheetRecipe() {
  const { id, slot, portions } = sheet, r = RECIPE[id], fav = state.favs.includes(id);
  return `
    <div class="sheet-hero">${r.emoji}<button class="fav" data-action="fav" data-id="${id}" aria-label="В избранное">${fav ? "♥" : "♡"}</button></div>
    <h3>${r.name}</h3>
    <div class="tags">${r.tags.map(t => `<span class="tag">${t}</span>`).join("")}<span class="tag">⏱ ${r.timeMin || "<1"} мин</span><span class="tag">${r.portionGrams} г</span></div>
    ${kbju(r, portions)}
    <h4>Куда добавить</h4>
    <div class="chips wrap">${SLOTS.map(s => `<button class="chip ${s.key === slot ? "on" : ""}" data-setslot="${s.key}">${s.short}</button>`).join("")}</div>
    <h4>Порция</h4>
    <div class="chips wrap">${[.5, 1, 1.5, 2].map(k => `<button class="chip ${k === portions ? "on" : ""}" data-setportion="${k}">${k === 1 ? "1 порция" : "× " + fmtNum(k)}</button>`).join("")}</div>
    <button class="btn" data-action="add-from-sheet">Добавить · ${Math.round(r.kcal * portions)} ккал</button>
    ${recipeText(r)}`;
}

function sheetEntry() {
  const e = findEntry(sheet.uid);
  if (!e) return null;
  const r = RECIPE[e.id];
  return `
    <div class="sheet-hero small">${r.emoji}</div>
    <h3>${r.name}</h3>
    ${kbju(r, e.portions)}
    <h4>Порция</h4>
    <div class="stepper">
      <button data-action="portion" data-d="-0.5" aria-label="Меньше">−</button>
      <span>${fmtNum(e.portions)} ${e.portions === 1 ? "порция" : "порц."}<small>≈ ${Math.round(r.portionGrams * e.portions)} г</small></span>
      <button data-action="portion" data-d="0.5" aria-label="Больше">+</button>
    </div>
    <h4>Приём пищи</h4>
    <div class="chips wrap">${SLOTS.map(s => `<button class="chip ${s.key === e.slot ? "on" : ""}" data-moveslot="${s.key}">${s.short}</button>`).join("")}</div>
    <div class="row-btns">
      <button class="btn ghost" data-action="del-entry">Удалить</button>
      <button class="btn" data-action="close">Готово</button>
    </div>
    <details><summary>Рецепт</summary>${recipeText(r)}</details>`;
}

function sheetPicker() {
  const sl = SLOT[sheet.slot], aim = slotAim(targetFor(today()), sl);
  const isFav = r => state.favs.includes(r.id) ? 1 : 0;
  const list = RECIPES.filter(r => sheet.all || sl.cats.includes(r.category))
    .sort((a, b) => isFav(b) - isFav(a) || Math.abs(a.kcal - aim) - Math.abs(b.kcal - aim));
  return `
    <h3>${sl.name} <span class="muted">· около ${aim} ккал</span></h3>
    <div class="list">${list.map(r => `
      <div class="row" data-recipe="${r.id}" data-slot="${sl.key}">
        <div class="ic">${r.emoji}</div>
        <div class="info"><div class="dish">${isFav(r) ? "♥ " : ""}${r.name}</div>
          <div class="sub">${r.kcal} ккал · ${r.protein} г белка · ${r.timeMin || "<1"} мин</div></div>
        <button class="plus" data-quick="${r.id}" data-slot="${sl.key}" aria-label="Добавить">+</button>
      </div>`).join("")}</div>
    ${sheet.all ? "" : `<button class="btn ghost" data-action="picker-all">Показать все блюда</button>`}`;
}

/* ================= навигация ================= */
let tab = "today";
function showTab(name) {
  tab = name;
  $$(".tab-page").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  window.scrollTo(0, 0);
  refresh();
}
function refresh() { ({ today: renderToday, capsule: renderCapsule, progress: renderProgress, profile: renderProfile })[tab](); }

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function confetti() {
  const colors = ["#E8846B", "#F2A7A0", "#E9B65C", "#8FB39A", "#D9778C"];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
    c.style.animationDelay = Math.random() * .4 + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

/* ================= действия ================= */
const ACTIONS = {
  close: closeSheet,
  autoplan() { autoPlan(); closeSheet(); showTab("today"); },
  repeat() { repeatYesterday(); refresh(); },
  fav({ id }) {
    const i = state.favs.indexOf(id);
    i >= 0 ? state.favs.splice(i, 1) : state.favs.push(id);
    save("favs"); renderSheet(); refresh();
  },
  "add-from-sheet"() {
    const r = RECIPE[sheet.id];
    addEntry(sheet.id, sheet.slot, sheet.portions);
    toast(`${r.emoji} Добавлено · +${Math.round(r.kcal * sheet.portions)} ккал`);
    closeSheet(); refresh();
  },
  portion({ d }) {
    const e = findEntry(sheet.uid);
    e.portions = clamp(e.portions + parseFloat(d), .5, 5);
    save("log"); renderSheet(); refresh();
  },
  "del-entry"() {
    state.log[today()] = state.log[today()].filter(e => e.uid !== sheet.uid);
    save("log"); closeSheet(); refresh(); toast("Убрала из сегодня");
  },
  "picker-all"() { sheet.all = true; renderSheet(); },
  "save-weight"() {
    const kg = parseFloat(String($("#wInput").value).replace(",", "."));
    if (!(kg >= 30 && kg <= 150)) return toast("Проверь вес 🙂");
    upsertWeight(kg);
    toast(`Записала ${fmtNum(kg)} кг · норма ${fullTarget().kcal} ккал`);
    refresh();
  },
  "del-weight"({ date }) {
    state.weights = state.weights.filter(w => w.date !== date);
    save("weights"); syncWeight(); refresh();
  },
  bump() {
    state.profile.surplus += 150; save("profile");
    toast(`Новая норма: ${fullTarget().kcal} ккал 💪`); refresh();
  },
  "restart-ramp"() {
    state.profile.ramp = true; state.profile.rampStart = today(); save("profile");
    toast("Разгон начат заново 🌱"); refresh();
  },
  export() {
    const data = { app: "capsula", exportedAt: new Date().toISOString(), profile: state.profile, log: state.log, weights: state.weights, favs: state.favs };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `capsula-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() { $("#importFile").click(); },
  reset() {
    if (!confirm("Точно стереть все данные? Это нельзя отменить.")) return;
    try { Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k)); } catch {}
    location.reload();
  },
};

document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-tab],[data-action],[data-quick],[data-pick],[data-entry],[data-recipe],[data-setslot],[data-setportion],[data-moveslot],[data-cat],[data-theme-set]");
  if (!el) return;
  const d = el.dataset;

  if (d.tab) return showTab(d.tab);
  if (d.action) return ACTIONS[d.action]?.(d);
  if (d.quick) {
    const r = RECIPE[d.quick];
    addEntry(r.id, d.slot || snackSlot());
    toast(`${r.emoji} Добавлено · +${r.kcal} ккал`);
    closeSheet(); return refresh();
  }
  if (d.pick) return openSheet({ type: "picker", slot: d.pick });
  if (d.entry) return openSheet({ type: "entry", uid: d.entry });
  if (d.recipe) return openSheet({ type: "recipe", id: d.recipe, slot: d.slot || suggestSlot(RECIPE[d.recipe]), portions: 1 });
  if (d.setslot) { sheet.slot = d.setslot; return renderSheet(); }
  if (d.setportion) { sheet.portions = parseFloat(d.setportion); return renderSheet(); }
  if (d.moveslot) { findEntry(sheet.uid).slot = d.moveslot; save("log"); renderSheet(); return refresh(); }
  if (d.cat) { filter.cat = d.cat; return renderCapsule(); }
  if (d.themeSet) { state.theme = d.themeSet; save("theme"); applyTheme(); return renderProfile(); }
});

$("#cSearch").addEventListener("input", e => { filter.q = e.target.value; renderCapsule(); });

// поля профиля сохраняются при изменении
document.addEventListener("change", e => {
  const el = e.target, f = el.dataset.field;
  if (!f) return;
  if (el.type === "checkbox") {
    state.profile[f] = el.checked;
    if (f === "ramp" && el.checked && !state.profile.rampStart) state.profile.rampStart = today();
  } else {
    const v = parseFloat(String(el.value).replace(",", "."));
    if (!(v >= 0)) return renderProfile();
    state.profile[f] = v;
    if (f === "weight") upsertWeight(v);
  }
  save("profile"); renderNorms(); toast("Сохранено");
});

$("#importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.profile || !data.log) throw new Error();
    for (const k of ["profile", "log", "weights", "favs"]) { state[k] = data[k] ?? state[k]; save(k); }
    toast("Данные загружены 💛"); refresh();
  } catch { toast("Не получилось прочитать файл"); }
});

document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

applyTheme();
renderToday();

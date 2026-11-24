// Money HQ: personal finance planner.
// No API, no server. Everything is saved in this browser with localStorage.
//
// Sections:
//   1. Data: defaults, loading, saving
//   2. Small helpers (dates, money, SVG)
//   3. Maths: totals, this week's budget, planner
//   4. Overview: money map + detail panel
//   5. This week
//   6. Planner (v3)
//   7. Add drawer: forms and lists
//   8. Sections (tabs), backup, start-up

// ================= 1. Data =================

const STORAGE_KEY = "moneyhq-v1";

const DEFAULT_STATE = {
  settings: {
    goal: 2000,
    rate: 0,          // hourly rate before deductions
    takeHome: 90,     // % of pay you keep after CPP, EI and tax
    hoursPerWeek: 12,
    startingSaved: 0, // money you had before you started logging
    savePercent: 50,  // % of each week's pay that goes to the goal before spending
  },
  entries: [],    // income:   { id, date, kind: "shift" | "lump", hours, amount, note }
  expenses: [],   // spending: { id, date, amount, category, note }
  fixedCosts: [], // monthly:  { id, name, monthly }
  plan: { date: "", hours: null, spend: null, floor: 500, locked: 0 },
  lastBackup: null,
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? cleanState(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

// Makes sure loaded data (from storage or a backup file) has the right shape.
function cleanState(data) {
  const d = data || {};
  const list = (arr, ok) => (Array.isArray(arr) ? arr.filter((x) => x && ok(x)) : []);
  return {
    settings: { ...DEFAULT_STATE.settings, ...d.settings },
    entries: list(d.entries, (e) => typeof e.amount === "number" && e.date),
    expenses: list(d.expenses, (e) => typeof e.amount === "number" && e.date),
    fixedCosts: list(d.fixedCosts, (f) => typeof f.monthly === "number" && f.name),
    plan: { ...DEFAULT_STATE.plan, ...d.plan },
    lastBackup: typeof d.lastBackup === "string" ? d.lastBackup : null,
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    $("notice").textContent = "Couldn't save in this browser. Download a backup so you don't lose it.";
  }
}

// ================= 2. Helpers =================

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const fmt = (n) => money.format(n);

// Escape text before putting it inside HTML, so a note can never inject code.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Local date as YYYY-MM-DD (toISOString would use UTC and can be a day off).
function toDateStr(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const today = () => toDateStr(new Date());
const parse = (s) => new Date(`${s}T00:00:00`);

function addDays(dateStr, n) {
  const d = parse(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

// Monday of the week that dateStr is in.
function weekStart(dateStr) {
  const d = parse(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay: Sunday = 0
  return toDateStr(d);
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

function shortDate(dateStr) {
  return parse(dateStr).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// Make an SVG element, e.g. svg("circle", { cx: 5, r: 2 })
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// One list row: [date] what  amount  ×   (built with textContent, so it's safe)
function listRow({ date, what, amount, isIn, onDelete }) {
  const li = document.createElement("li");
  if (date) {
    const d = document.createElement("span");
    d.className = "date";
    d.textContent = date;
    li.append(d);
  }
  const w = document.createElement("span");
  w.className = "what";
  w.textContent = what;
  const a = document.createElement("span");
  a.className = isIn ? "amt in" : "amt out";
  a.textContent = amount;
  li.append(w, a);
  if (onDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete ${what}`);
    del.addEventListener("click", () => {
      if (!confirm("Delete this?")) return;
      onDelete();
      saveState();
      render();
    });
    li.append(del);
  }
  return li;
}

// ================= 3. Maths =================

// What one hour of work actually puts in your pocket.
function takeHomePerHour() {
  const { rate, takeHome } = state.settings;
  return rate * (takeHome / 100);
}

const sum = (arr) => arr.reduce((s, e) => s + e.amount, 0);

function totals() {
  const { goal, startingSaved, hoursPerWeek } = state.settings;
  // "Saved" is your real balance: what you had + money in − money out.
  const saved = startingSaved + sum(state.entries) - sum(state.expenses);
  const left = Math.max(goal - saved, 0);
  const perHour = takeHomePerHour();
  const hoursLeft = perHour > 0 ? Math.ceil(left / perHour) : null;
  const weeksLeft = hoursLeft !== null && hoursPerWeek > 0 ? Math.ceil(hoursLeft / hoursPerWeek) : null;
  const percent = goal > 0 ? Math.min(Math.max(saved / goal, 0), 1) : 0;
  return { saved, left, hoursLeft, weeksLeft, percent };
}

function fixedPerWeek() {
  const monthly = state.fixedCosts.reduce((s, f) => s + f.monthly, 0);
  return (monthly * 12) / 52; // a month's bills spread over 52 weeks
}

// This week (Monday to Sunday): pay − fixed − savings − spent = safe to spend
function weekBudget() {
  const { hoursPerWeek, savePercent } = state.settings;
  const start = weekStart(today());
  const end = addDays(start, 6);
  const inWeek = (e) => e.date >= start && e.date <= end;

  const income = hoursPerWeek * takeHomePerHour();
  const fixed = fixedPerWeek();
  const save = income * (savePercent / 100);
  const budget = income - fixed - save;

  const thisWeek = state.expenses.filter(inWeek);
  // Bills are already covered by fixed costs, so they don't use up spending money.
  const spent = sum(thisWeek.filter((e) => e.category !== "Bills"));
  const byCategory = {};
  for (const e of thisWeek) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const net = sum(state.entries.filter(inWeek)) - sum(thisWeek);

  return { start, end, income, fixed, save, budget, spent, left: budget - spent, byCategory, thisWeek, net };
}

// Average non-bill spending per week over the last 4 weeks
function avgWeeklySpend() {
  const from = addDays(today(), -27);
  return sum(state.expenses.filter((e) => e.date >= from && e.date <= today() && e.category !== "Bills")) / 4;
}

// ================= 4. Overview: money map + detail panel =================
// Left: an orb for your balance. Middle: one card per group (Shifts, Food...).
// Click a card and its entries fan out to the right; the panel shows its numbers.
// Click the orb to go back to the overall summary.

let mapPeriod = "all";      // "all" or a month like "2026-11"
let mapSelected = "balance"; // "balance" or a group key like "out:Food"

function renderPeriods() {
  const months = new Set([...state.entries, ...state.expenses].map((e) => e.date.slice(0, 7)));
  const list = ["all", ...[...months].sort().reverse()];
  if (!list.includes(mapPeriod)) mapPeriod = "all";
  const box = $("periods");
  box.innerHTML = "";
  for (const p of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p === "all" ? "All time" : monthLabel(p);
    b.classList.toggle("on", p === mapPeriod);
    b.addEventListener("click", () => { mapPeriod = p; renderOverview(); });
    box.append(b);
  }
}

// Group entries: [{ key, name, side: "in"|"out", total, items }], biggest first
function mapGroups() {
  const inPeriod = (e) => mapPeriod === "all" || e.date.startsWith(mapPeriod);
  const groups = new Map();
  const add = (side, name, item) => {
    const key = `${side}:${name}`;
    if (!groups.has(key)) groups.set(key, { key, name, side, total: 0, items: [] });
    const g = groups.get(key);
    g.total += item.amount;
    g.items.push(item);
  };
  for (const e of state.entries.filter(inPeriod)) {
    const label = e.kind === "shift" ? `${e.hours} h shift` : "Lump sum";
    add("in", e.kind === "shift" ? "Shifts" : "Lump sums", { amount: e.amount, date: e.date, hours: e.hours, label: e.note || label });
  }
  for (const e of state.expenses.filter(inPeriod)) {
    add("out", e.category, { amount: e.amount, date: e.date, label: e.note || e.category });
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function renderOverview() {
  renderPeriods();
  const groups = mapGroups();
  if (mapSelected !== "balance" && !groups.some((g) => g.key === mapSelected)) mapSelected = "balance";
  drawMap(groups);
  const sel = groups.find((g) => g.key === mapSelected);
  if (sel) renderGroupDetail(sel, groups);
  else renderSummaryDetail();
}

function drawMap(groups) {
  const map = $("map");
  map.innerHTML = "";
  $("mapEmpty").hidden = groups.length > 0;

  // Shared effects: a soft glow, and the orb's colour gradient
  const defs = svg("defs");
  const glow = svg("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  glow.append(svg("feGaussianBlur", { stdDeviation: "1.5", result: "b" }));
  const merge = svg("feMerge");
  merge.append(svg("feMergeNode", { in: "b" }), svg("feMergeNode", { in: "SourceGraphic" }));
  glow.append(merge);
  const grad = svg("radialGradient", { id: "orbGrad", cx: "40%", cy: "35%", r: "65%" });
  grad.append(
    svg("stop", { offset: "0%", style: "stop-color:#ffffff;stop-opacity:1" }),
    svg("stop", { offset: "40%", style: "stop-color:#3a3d44" }), // CSS variables only work in style
    svg("stop", { offset: "100%", style: "stop-color:#000000" }),
  );
  defs.append(glow, grad);
  const back = svg("g");
  const front = svg("g");
  map.append(defs, back, front);

  // ----- Orb: your balance -----
  const OX = 165;
  const OY = 370;
  back.append(svg("circle", { cx: OX, cy: OY, r: 160, class: "halo-fill" }));
  back.append(svg("circle", { cx: OX, cy: OY, r: 115, class: "halo" }));
  const orb = svg("g", { class: mapSelected === "balance" ? "orb sel" : "orb", tabindex: "0", role: "button", "aria-label": "Show overall summary" });
  orb.append(
    svg("circle", { cx: OX, cy: OY, r: 64, class: "fringe" }),
    svg("circle", { cx: OX, cy: OY, r: 55, class: "fringe2" }),
    svg("circle", { cx: OX, cy: OY, r: 42, fill: "url(#orbGrad)", filter: "url(#glow)" }),
  );
  const toSummary = () => { mapSelected = "balance"; renderOverview(); };
  orb.addEventListener("click", toSummary);
  orb.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toSummary(); } });
  front.append(orb);
  front.append(svg("text", { x: OX, y: OY - 112, "text-anchor": "middle", class: "lbl-sub" }, "BALANCE"));
  front.append(svg("text", { x: OX, y: OY - 84, "text-anchor": "middle", class: "lbl-core" }, fmt(totals().saved)));
  front.append(svg("text", { x: OX, y: OY + 104, "text-anchor": "middle", class: "lbl-sub" },
    mapPeriod === "all" ? "ALL TIME" : monthLabel(mapPeriod).toUpperCase()));

  if (groups.length === 0) return;

  // ----- Cards, stacked in the middle -----
  const CARD_X = 330;
  const CARD_W = 200;
  const GAP = 14;
  const n = groups.length;
  const cardH = Math.min(68, (640 - GAP * (n - 1)) / n);
  const top = OY - (n * cardH + (n - 1) * GAP) / 2;
  let selY = OY;

  groups.forEach((g, i) => {
    const y = top + i * (cardH + GAP);
    const cy = y + cardH / 2;
    const isSel = g.key === mapSelected;
    if (isSel) selY = cy;

    back.append(svg("path", {
      d: `M ${OX + 66} ${OY} C ${OX + 140} ${OY}, ${CARD_X - 80} ${cy}, ${CARD_X} ${cy}`,
      class: isSel ? "link sel" : "link",
    }));

    const sign = g.side === "in" ? "+" : "−";
    const card = svg("g", { class: isSel ? "card sel" : "card", tabindex: "0", role: "button", "aria-label": `${g.name}, ${g.items.length} ${g.items.length === 1 ? "entry" : "entries"}, ${fmt(g.total)}` });
    card.append(svg("rect", { x: CARD_X, y, width: CARD_W, height: cardH, rx: 10, class: "bg" }));
    card.append(svg("circle", { cx: CARD_X + 18, cy: cardH >= 50 ? cy - 9 : cy, r: 4.5, class: `icon ${g.side}` }));
    if (cardH >= 50) {
      card.append(svg("text", { x: CARD_X + 32, y: cy + 1, class: "count" }, g.items.length));
      card.append(svg("text", { x: CARD_X + 18, y: cy + 22, class: "cname" }, g.name));
      card.append(svg("text", { x: CARD_X + CARD_W - 14, y: cy + 1, "text-anchor": "end", class: `ctotal ${g.side}` }, `${sign}${fmt(g.total)}`));
    } else {
      card.append(svg("text", { x: CARD_X + 32, y: cy + 5, class: "cname" }, `${g.items.length} · ${g.name}`));
      card.append(svg("text", { x: CARD_X + CARD_W - 14, y: cy + 5, "text-anchor": "end", class: `ctotal ${g.side}` }, `${sign}${fmt(g.total)}`));
    }
    const open = () => { mapSelected = g.key; renderOverview(); };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    front.append(card);
  });

  // ----- Fan out entries: the selected group's, or your latest activity when the orb is selected -----
  const sel = groups.find((g) => g.key === mapSelected);
  const pool = sel
    ? sel.items.map((it) => ({ ...it, side: sel.side }))
    : groups.flatMap((g) => g.items.map((it) => ({ ...it, side: g.side })));
  const items = [...pool].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16);
  const maxAmt = Math.max(...items.map((it) => it.amount));
  const ARC_X = 500;   // leaves sit on a circle arc around this point
  const ARC_R = 330;
  // Leaves are spaced evenly top to bottom (so labels never overlap) and pushed right onto the arc.
  const rowGap = items.length > 1 ? Math.min(62, 600 / (items.length - 1)) : 0;
  const half = ((items.length - 1) / 2) * rowGap;
  const fromX = sel ? CARD_X + CARD_W : OX + 66;
  if (!sel) selY = OY;

  items.forEach((it, i) => {
    const dy = -half + i * rowGap;
    const ly = OY + dy;
    const lx = ARC_X + Math.sqrt(ARC_R * ARC_R - dy * dy); // x on the circle for this height
    const fade = 1 - (Math.abs(dy) / ARC_R) * 0.6; // outer leaves fade, like the design

    back.append(svg("path", {
      d: `M ${fromX} ${selY} C ${fromX + 90} ${selY}, ${lx - 110} ${ly}, ${lx} ${ly}`,
      class: `fan ${it.side}`, opacity: (sel ? 0.3 : 0.12) + 0.45 * fade,
    }));

    const leaf = svg("g", { opacity: fade });
    leaf.append(svg("circle", { cx: lx, cy: ly, r: 4.5, class: `dot ${it.side}`, filter: "url(#glow)" }));
    const name = it.label.length > 20 ? `${it.label.slice(0, 19)}…` : it.label;
    leaf.append(svg("text", { x: lx + 14, y: ly - 3, class: "leaf-name" }, name));

    // 3 little blocks: how big this entry is next to the biggest in the group.
    // Spending turns amber/red when it's one of the bigger ones.
    const level = Math.max(1, Math.round((it.amount / maxAmt) * 3));
    const tone = it.side === "out" ? (level === 3 ? " hot" : level === 2 ? " warm" : "") : "";
    for (let k = 0; k < 3; k++) {
      leaf.append(svg("rect", { x: lx + 14 + k * 9, y: ly + 5, width: 7, height: 6, rx: 1.5, class: k < level ? `pip on${tone}` : "pip" }));
    }
    leaf.append(svg("text", { x: lx + 48, y: ly + 12, class: `leaf-sub ${it.side}` },
      `${shortDate(it.date)} · ${it.side === "in" ? "+" : "−"}${fmt(it.amount)}`));
    leaf.append(svg("title", {}, `${it.date} · ${it.label} · ${fmt(it.amount)}`)); // hover tooltip
    front.append(leaf);
  });

  if (pool.length > items.length) {
    front.append(svg("text", { x: ARC_X + ARC_R * 0.55, y: 712, "text-anchor": "middle", class: "lbl-more" },
      `+${pool.length - items.length} older${sel ? "" : " · latest activity shown"}`));
  }
}

// Rule-based messages ("Jarvis"). Each rule adds a line or doesn't.
function insights(t, wb) {
  const { rate, goal, takeHome, hoursPerWeek } = state.settings;
  const out = [];
  if (t.left === 0) {
    out.push({ title: "Goal reached", text: `${fmt(t.saved)} saved of ${fmt(goal)}.`, tone: "good" });
  } else if (rate <= 0) {
    out.push({ title: "Set your hourly rate", text: "Open the left panel → Settings, and I'll work out the hours left.", tone: "warn" });
  } else {
    const weeks = t.weeksLeft ? ` At ${hoursPerWeek} hrs/week, about ${t.weeksLeft} week${t.weeksLeft === 1 ? "" : "s"}.` : "";
    out.push({ title: "Goal", text: `${t.hoursLeft} more hours of work to reach ${fmt(goal)}.${weeks}` });
  }
  if (rate > 0) {
    if (wb.budget <= 0) out.push({ title: "No spending money", text: "Fixed costs and savings take all of this week's pay. Lower Save % or work more hours.", tone: "warn" });
    else if (wb.left < 0) out.push({ title: "Over budget", text: `${fmt(-wb.left)} over this week. That comes out of your goal.`, tone: "warn" });
    else out.push({ title: "This week", text: `${fmt(wb.left)} safe to spend until Sunday.` });
  }
  if (rate > 0 && takeHome === 90) {
    out.push({ title: "Take-home is a guess", text: "It's still the 90% estimate. Update it from your first pay stub." });
  }
  const count = state.entries.length + state.expenses.length;
  if (count > 0 && (!state.lastBackup || daysBetween(state.lastBackup, today()) >= 14)) {
    out.push({ title: "Back up", text: state.lastBackup ? `Last backup was ${daysBetween(state.lastBackup, today())} days ago.` : "No backup yet. One download keeps this safe if the browser is cleared.", tone: "warn" });
  }
  return out;
}

function analysisHtml(list) {
  return list.map((l) => `<li class="${l.tone || ""}"><b>${esc(l.title)}</b>${esc(l.text)}</li>`).join("");
}

// Balance at the end of each of the last 30 days, for the mini chart
function balanceHistory() {
  const start = state.settings.startingSaved;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today(), -i);
    const inn = sum(state.entries.filter((e) => e.date <= d));
    const out = sum(state.expenses.filter((e) => e.date <= d));
    days.push(start + inn - out);
  }
  return days;
}

function sparkHtml(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => {
    const h = hi === lo ? 40 : 12 + ((v - lo) / (hi - lo)) * 88;
    return `<i style="height:${h.toFixed(0)}%"></i>`;
  }).join("");
}

function renderSummaryDetail() {
  const t = totals();
  const wb = weekBudget();
  const { goal, rate } = state.settings;
  const latest = [...state.entries, ...state.expenses].reduce((m, e) => (e.date > m ? e.date : m), "");
  const month = today().slice(0, 7);
  const spentMonth = sum(state.expenses.filter((e) => e.date.startsWith(month)));

  let pill = ["On track", ""];
  if (t.left === 0) pill = ["Goal reached", ""];
  else if (rate <= 0) pill = ["Needs setup", "warn"];
  else if (wb.left < 0) pill = ["Over budget", "bad"];

  const pct = Math.round(t.percent * 100);
  const deltaCls = wb.net >= 0 ? "down" : "up";

  $("detail").innerHTML = `
    <span class="kicker"><i>◈</i>Overview</span>
    <h2 class="title">${fmt(t.saved)} saved<br><span class="muted">of your ${fmt(goal)} goal</span></h2>
    <div class="status">
      <div>
        <span class="pill ${pill[1]}">${pill[0]}</span>
        <p>${latest ? `Last entry on <b>${shortDate(latest)}</b>` : "Nothing logged yet"}</p>
      </div>
      <button type="button" class="btn-outline" data-open="income">Add entry ›</button>
    </div>
    <div class="metric">
      <div class="metric-head"><span>Goal progress</span><span class="pill ${pct >= 50 ? "" : "warn"}">${pct >= 100 ? "Done" : pct >= 50 ? "Halfway+" : "Building"}</span></div>
      <div class="metric-row">
        <b>${pct}%</b>
        <span class="delta ${deltaCls}">${wb.net >= 0 ? "+" : "−"}${fmt(Math.abs(wb.net))}<br>this week</span>
        <div class="spark" aria-hidden="true">${sparkHtml(balanceHistory())}</div>
      </div>
    </div>
    <div class="tiles two">
      <div class="tile"><b class="${rate > 0 ? (wb.left < 0 ? "neg" : "pos") : ""}">${rate > 0 ? fmt(wb.left) : "–"}</b><span>Safe to spend this week</span></div>
      <div class="tile"><b>${t.hoursLeft ?? "–"}</b><span>Work hours left to goal</span></div>
      <div class="tile"><b>${t.weeksLeft ?? "–"}</b><span>Weeks left at your pace</span></div>
      <div class="tile"><b>${fmt(spentMonth)}</b><span>Spent this month</span></div>
    </div>
    <span class="kicker gap">✦ Analysis</span>
    <ul class="analysis">${analysisHtml(insights(t, wb))}</ul>`;
}

function renderGroupDetail(g, groups) {
  const isIn = g.side === "in";
  const sideTotal = groups.filter((x) => x.side === g.side).reduce((s, x) => s + x.total, 0);
  const share = sideTotal > 0 ? Math.round((g.total / sideTotal) * 100) : 0;
  const count = g.items.length;
  const avg = g.total / count;
  const biggest = g.items.reduce((m, it) => (it.amount > m.amount ? it : m), g.items[0]);
  const latest = g.items.reduce((m, it) => (it.date > m ? it.date : m), "");
  const level = share >= 40 ? ["High", isIn ? "" : "bad"] : share >= 20 ? ["Moderate", "warn"] : ["Low", ""];

  // Change vs the month before (only when one month is picked)
  let delta = "";
  if (mapPeriod !== "all") {
    const [y, m] = mapPeriod.split("-").map(Number);
    const prev = toDateStr(new Date(y, m - 2, 1)).slice(0, 7);
    const list = isIn ? state.entries : state.expenses;
    const same = (e) => (isIn ? (e.kind === "shift" ? "Shifts" : "Lump sums") : e.category) === g.name;
    const prevTotal = sum(list.filter((e) => e.date.startsWith(prev) && same(e)));
    if (prevTotal > 0) {
      const pct = Math.round(((g.total - prevTotal) / prevTotal) * 100);
      const bad = isIn ? pct < 0 : pct > 0; // more spending or less income = red
      delta = `<span class="delta ${bad ? "up" : "down"}">${pct >= 0 ? "+" : ""}${pct}%<br>vs ${monthLabel(prev).split(" ")[0]}</span>`;
    }
  }

  // Analysis: a few rules that turn the numbers into sentences
  const when = mapPeriod === "all" ? "overall" : `in ${monthLabel(mapPeriod)}`;
  const notes = [];
  if (isIn && g.name === "Shifts") {
    const hours = g.items.reduce((s, it) => s + (it.hours || 0), 0);
    notes.push({ title: "Work", text: `${hours} hours worked ${when}, ${fmt(g.total)} after deductions. That's ${share}% of your income. Average shift: ${fmt(avg)}.` });
  } else if (isIn) {
    notes.push({ title: "Extra money", text: `${count} lump sum${count === 1 ? "" : "s"} ${when}, ${fmt(g.total)} in total (${share}% of income). Biggest: ${biggest.label}, ${fmt(biggest.amount)}.` });
  } else {
    notes.push({ title: "Where it goes", text: `${g.name} is ${share}% of your spending ${when}. Average ${fmt(avg)} each time. Biggest: ${biggest.label}, ${fmt(biggest.amount)}.` });
    if (g.name === "Bills") notes.push({ title: "Fixed", text: "Bills are hard to cut. Look at other groups first." });
    else if (share >= 30) notes.push({ title: "Biggest drain", text: `Cutting it by a quarter keeps about ${fmt(g.total * 0.25)} for your goal.`, tone: "warn" });
  }

  const amounts = [...g.items].sort((a, b) => a.date.localeCompare(b.date)).map((it) => it.amount).slice(-40);

  $("detail").innerHTML = `
    <span class="kicker"><i>${isIn ? "↘" : "↗"}</i>${isIn ? "Money in" : "Spending"}</span>
    <h2 class="title">${esc(g.name)}</h2>
    <div class="status">
      <div>
        <span class="pill">${mapPeriod === "all" ? "All time" : monthLabel(mapPeriod)}</span>
        <p>Last entry on <b>${shortDate(latest)}</b></p>
      </div>
      <button type="button" class="btn-outline" data-select="balance">‹ Overview</button>
    </div>
    <div class="metric">
      <div class="metric-head"><span>Share of money ${isIn ? "in" : "out"}</span><span class="pill ${level[1]}">${level[0]}</span></div>
      <div class="metric-row"><b>${share}%</b>${delta}<div class="spark" aria-hidden="true">${sparkHtml(amounts)}</div></div>
    </div>
    <div class="tiles two">
      <div class="tile"><b>${count}</b><span>Entries</span></div>
      <div class="tile"><b>${fmt(g.total)}</b><span>Total</span></div>
      <div class="tile"><b>${fmt(avg)}</b><span>Average</span></div>
      <div class="tile"><b>${fmt(biggest.amount)}</b><span>Biggest</span></div>
    </div>
    <span class="kicker gap">✦ Analysis</span>
    <ul class="analysis">${analysisHtml(notes)}</ul>`;
}

// Buttons inside the detail panel (it's rebuilt each time, so listen on the panel itself)
$("detail").addEventListener("click", (e) => {
  const openBtn = e.target.closest("[data-open]");
  if (openBtn) openDrawer(openBtn.dataset.open);
  const selBtn = e.target.closest("[data-select]");
  if (selBtn) { mapSelected = selBtn.dataset.select; renderOverview(); }
});

// ================= 5. This week =================

function renderWeek() {
  const wb = weekBudget();
  const hasRate = state.settings.rate > 0;
  $("wRange").textContent = `${shortDate(wb.start)} – ${shortDate(wb.end)}`;
  $("wLeft").textContent = hasRate ? fmt(wb.left) : "–";
  $("wLeft").classList.toggle("neg", hasRate && wb.left < 0);
  $("wLeft").classList.toggle("pos", hasRate && wb.left >= 0); // green when you still have money, red when over
  $("wOf").textContent = hasRate ? `of ${fmt(Math.max(wb.budget, 0))}` : "";
  const used = wb.budget > 0 ? Math.min(wb.spent / wb.budget, 1) : wb.spent > 0 ? 1 : 0;
  $("wBar").style.width = `${used * 100}%`;
  $("wBar").parentElement.classList.toggle("over", wb.left < 0);

  if (!hasRate) $("wLine").textContent = "Set your hourly rate in the left panel → Settings. Your weekly pay comes from it.";
  else if (wb.budget <= 0) $("wLine").textContent = "Fixed costs and savings take all your weekly pay.";
  else if (wb.left < 0) $("wLine").textContent = `You're ${fmt(-wb.left)} over for this week.`;
  else {
    const daysLeft = 7 - daysBetween(wb.start, today()); // including today
    $("wLine").textContent = `About ${fmt(wb.left / daysLeft)} a day until Sunday.`;
  }

  $("wPay").textContent = fmt(wb.income);
  $("wFixed").textContent = fmt(wb.fixed);
  $("wSave").textContent = fmt(wb.save);
  $("wSpent").textContent = fmt(wb.spent);

  // category bars
  const bars = $("wCats");
  bars.innerHTML = "";
  const rows = Object.entries(wb.byCategory).sort((a, b) => b[1] - a[1]);
  $("wCatsEmpty").hidden = rows.length > 0;
  const max = rows.length ? rows[0][1] : 1;
  for (const [name, amount] of rows) {
    const li = document.createElement("li");
    if (name === "Bills") li.className = "bills";
    li.innerHTML = `<span class="name">${esc(name)}</span><span class="track"><span class="bar" style="width:${(amount / max) * 100}%"></span></span><span class="val">${fmt(amount)}</span>`;
    bars.append(li);
  }

  // this week's spending list
  const list = $("wList");
  list.innerHTML = "";
  const items = [...wb.thisWeek].sort((a, b) => b.date.localeCompare(a.date));
  $("wListEmpty").hidden = items.length > 0;
  for (const e of items) {
    list.append(listRow({
      date: shortDate(e.date), what: e.note ? `${e.category} · ${e.note}` : e.category, amount: `−${fmt(e.amount)}`,
      onDelete: () => { state.expenses = state.expenses.filter((x) => x.id !== e.id); },
    }));
  }
}

// ================= 6. Planner (v3) =================
// How much money you'll have on a date, and how much of it you could lose.

function planInputs() {
  const p = state.plan;
  return {
    date: p.date || addDays(today(), 70),
    hours: p.hours ?? state.settings.hoursPerWeek,
    spend: p.spend ?? Math.round(avgWeeklySpend()),
    floor: p.floor ?? 0,
    locked: p.locked ?? 0,
  };
}

function planResult() {
  const p = planInputs();
  const weeks = Math.max(daysBetween(today(), p.date), 0) / 7;
  const perHour = takeHomePerHour();
  const fixed = fixedPerWeek();
  const now = totals().saved;
  const jobIncome = p.hours * perHour * weeks;
  const out = (p.spend + fixed) * weeks;
  const then = now + jobIncome - out;
  const maxLoss = then - p.floor - p.locked;
  const weeklyNet = p.hours * perHour - p.spend - fixed;
  return { ...p, weeks, perHour, fixed, now, jobIncome, out, then, maxLoss, weeklyNet };
}

function fillPlanForm() {
  const p = state.plan;
  $("pDate").value = p.date || addDays(today(), 70);
  $("pDate").min = today();
  $("pHours").value = p.hours ?? "";
  $("pHours").placeholder = state.settings.hoursPerWeek;
  $("pSpend").value = p.spend ?? "";
  $("pSpend").placeholder = Math.round(avgWeeklySpend());
  $("pFloor").value = p.floor;
  $("pLocked").value = p.locked;
}

// Read the form into state on every keystroke. Empty boxes fall back to defaults.
$("planForm").addEventListener("input", () => {
  const num = (id) => ($(id).value === "" ? null : Math.max(Number($(id).value) || 0, 0));
  state.plan = { date: $("pDate").value, hours: num("pHours"), spend: num("pSpend"), floor: num("pFloor") ?? 0, locked: num("pLocked") ?? 0 };
  saveState();
  renderPlanner();
});

function renderPlanner() {
  const r = planResult();
  $("pHint").textContent = `Empty boxes use your settings: ${state.settings.hoursPerWeek} hrs/week, and ${fmt(avgWeeklySpend())}/week spending (your last 4 weeks, without bills).`;
  $("pKicker").textContent = `By ${parse(r.date).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`;
  $("pMax").textContent = fmt(Math.max(r.maxLoss, 0));
  $("pMax").classList.toggle("neg", r.maxLoss <= 0);
  $("pMax").classList.toggle("pos", r.maxLoss > 0);
  $("pWeeks").textContent = r.weeks.toFixed(1);
  $("pIncome").textContent = fmt(r.jobIncome);
  $("pOut").textContent = fmt(r.out);
  $("pThen").textContent = fmt(r.then);
  $("pThen").classList.toggle("neg", r.then < 0);
  drawPlanChart(r);

  const notes = [];
  if (r.perHour <= 0) notes.push({ title: "No job pay yet", text: "Set your hourly rate in the left panel → Settings. Until then, job pay counts as $0.", tone: "warn" });
  if (r.maxLoss > 0) {
    notes.push({ title: "Risk budget", text: `You can lose up to ${fmt(r.maxLoss)} on ecom by ${shortDate(r.date)} and still keep your ${fmt(r.floor)} floor${r.locked ? ` and ${fmt(r.locked)} locked` : ""}.`, tone: "good" });
  } else {
    notes.push({ title: "Nothing to risk yet", text: `By ${shortDate(r.date)} you'd be ${fmt(-r.maxLoss)} short of your floor${r.locked ? " and locked money" : ""}. Work more hours, spend less, or pick a later date.`, tone: "warn" });
  }
  if (r.weeklyNet < 0) notes.push({ title: "Shrinking", text: `You spend ${fmt(-r.weeklyNet)} more than you earn each week, so your balance goes down.`, tone: "warn" });
  if (r.perHour > 0 && r.weeks > 0) notes.push({ title: "One more hour", text: `Each extra hour a week adds ${fmt(r.perHour * r.weeks)} by then.` });
  $("pAnalysis").innerHTML = analysisHtml(notes);
}

// Line chart: balance week by week from now to the date, with the floor as a red dashed line
function drawPlanChart(r) {
  const chart = $("pChart");
  chart.innerHTML = "";
  const W = 600, H = 220, L = 10, R = 590, T = 24, B = 186;
  const steps = Math.max(Math.ceil(r.weeks), 1);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const w = Math.min(i, r.weeks);
    pts.push({ w, v: r.now + r.weeklyNet * w });
  }
  const values = [...pts.map((p) => p.v), r.floor, 0];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (w) => L + ((R - L) * w) / Math.max(r.weeks, 1e-9);
  const y = (v) => B - ((B - T) * (v - lo)) / (hi - lo);

  chart.append(svg("line", { x1: L, x2: R, y1: B, y2: B, class: "grid" }));
  if (r.weeks <= 0) {
    chart.append(svg("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, "Pick a date after today."));
    return;
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(p.w).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  chart.append(svg("path", { d: `${line} L ${x(r.weeks)} ${B} L ${L} ${B} Z`, class: "area" }));
  chart.append(svg("path", { d: line, class: "line" }));
  chart.append(svg("line", { x1: L, x2: R, y1: y(r.floor), y2: y(r.floor), class: "floor" }));
  chart.append(svg("text", { x: R, y: y(r.floor) - 6, "text-anchor": "end" }, `Floor ${fmt(r.floor)}`));
  const end = pts[pts.length - 1];
  chart.append(svg("circle", { cx: x(end.w), cy: y(end.v), r: 5, class: "end" }));
  chart.append(svg("text", { x: x(end.w) - 8, y: y(end.v) - 10, "text-anchor": "end" }, fmt(end.v)));
  chart.append(svg("text", { x: L, y: y(r.now) - 10 }, `Now ${fmt(r.now)}`));
  chart.append(svg("text", { x: L, y: H - 8 }, "Today"));
  chart.append(svg("text", { x: R, y: H - 8, "text-anchor": "end" }, shortDate(r.date)));
}


// ================= 7. Add drawer =================

function openDrawer(pane = "income") {
  showPane(pane);
  $("drawer").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
  $("scrim").hidden = false;
  const first = document.querySelector(`[data-pane-body="${pane}"] input:not([type=radio]), [data-pane-body="${pane}"] button`);
  if (first) first.focus();
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("scrim").hidden = true;
}

function showPane(name) {
  document.querySelectorAll("[data-pane]").forEach((b) => {
    b.classList.toggle("on", b.dataset.pane === name);
    b.setAttribute("aria-selected", b.dataset.pane === name);
  });
  document.querySelectorAll("[data-pane-body]").forEach((p) => { p.hidden = p.dataset.paneBody !== name; });
}

$("menuBtn").addEventListener("click", () => openDrawer("income"));
$("addBtn").addEventListener("click", () => openDrawer("income"));
$("closeDrawer").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
document.querySelectorAll("[data-pane]").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));

function renderDrawerLists() {
  const inc = $("incomeList");
  inc.innerHTML = "";
  for (const e of [...state.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)) {
    const label = e.kind === "shift" ? `${e.hours} h shift` : "Lump sum";
    inc.append(listRow({
      date: shortDate(e.date), what: e.note ? `${label} · ${e.note}` : label, amount: `+${fmt(e.amount)}`, isIn: true,
      onDelete: () => { state.entries = state.entries.filter((x) => x.id !== e.id); },
    }));
  }
  const exp = $("expList");
  exp.innerHTML = "";
  for (const e of [...state.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)) {
    exp.append(listRow({
      date: shortDate(e.date), what: e.note ? `${e.category} · ${e.note}` : e.category, amount: `−${fmt(e.amount)}`,
      onDelete: () => { state.expenses = state.expenses.filter((x) => x.id !== e.id); },
    }));
  }
  const fix = $("fixedList");
  fix.innerHTML = "";
  for (const f of state.fixedCosts) {
    fix.append(listRow({
      what: f.name, amount: `${fmt(f.monthly)}/mo`,
      onDelete: () => { state.fixedCosts = state.fixedCosts.filter((x) => x.id !== f.id); },
    }));
  }
}

function fillSettingsForm() {
  const s = state.settings;
  $("goal").value = s.goal;
  $("rate").value = s.rate || "";
  $("takeHome").value = s.takeHome;
  $("hoursPerWeek").value = s.hoursPerWeek;
  $("startingSaved").value = s.startingSaved;
  $("savePercent").value = s.savePercent;
}

// Income: show Hours for shifts, Amount for lump sums
document.querySelectorAll('input[name="kind"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const shift = selectedKind() === "shift";
    $("hoursField").hidden = !shift;
    $("amountField").hidden = shift;
  });
});
const selectedKind = () => document.querySelector('input[name="kind"]:checked').value;

$("incomeForm").addEventListener("submit", (event) => {
  event.preventDefault(); // stop the browser reloading the page
  $("formError").textContent = "";
  const kind = selectedKind();
  let hours = 0;
  let amount = 0;
  if (kind === "shift") {
    hours = Number($("hours").value);
    if (!(hours > 0)) return ($("formError").textContent = "Enter the hours you worked.");
    if (takeHomePerHour() <= 0) return ($("formError").textContent = "Set your hourly rate in Settings first.");
    // Fixed at today's rate, so changing your rate later doesn't rewrite old shifts.
    amount = Math.round(hours * takeHomePerHour() * 100) / 100;
  } else {
    amount = Number($("amount").value);
    if (!(amount > 0)) return ($("formError").textContent = "Enter an amount above $0.");
  }
  state.entries.push({ id: newId(), date: $("date").value, kind, hours, amount, note: $("note").value.trim() });
  saveState();
  $("hours").value = "";
  $("amount").value = "";
  $("note").value = "";
  render();
});

$("expenseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("expError").textContent = "";
  const amount = Number($("expAmount").value);
  if (!(amount > 0)) return ($("expError").textContent = "Enter an amount above $0.");
  state.expenses.push({
    id: newId(), date: $("expDate").value, amount: Math.round(amount * 100) / 100,
    category: $("expCategory").value, note: $("expNote").value.trim(),
  });
  saveState();
  $("expAmount").value = "";
  $("expNote").value = "";
  render();
});

$("fixedForm").addEventListener("submit", (event) => {
  event.preventDefault();
  $("fixedError").textContent = "";
  const name = $("fixedName").value.trim();
  const monthly = Number($("fixedAmount").value);
  if (!name) return ($("fixedError").textContent = "Give it a name.");
  if (!(monthly > 0)) return ($("fixedError").textContent = "Enter the monthly amount.");
  state.fixedCosts.push({ id: newId(), name, monthly: Math.round(monthly * 100) / 100 });
  saveState();
  $("fixedName").value = "";
  $("fixedAmount").value = "";
  render();
});

$("settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const s = state.settings;
  const num = (id, fallback) => {
    const n = Number($(id).value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  state.settings = {
    goal: num("goal", s.goal) || s.goal,
    rate: num("rate", 0),
    takeHome: Math.min(Math.max(num("takeHome", s.takeHome), 1), 100),
    hoursPerWeek: num("hoursPerWeek", s.hoursPerWeek),
    startingSaved: num("startingSaved", s.startingSaved),
    savePercent: Math.min(num("savePercent", s.savePercent), 100),
  };
  saveState();
  fillPlanForm(); // planner placeholders come from settings
  render();
  $("settingsNotice").textContent = "Settings saved.";
});

// ================= 8. Sections, backup, start-up =================

const VIEWS = ["overview", "week", "planner"];

function showView() {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  document.querySelectorAll("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll("[data-tab]").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", showView);

$("exportBtn").addEventListener("click", () => {
  state.lastBackup = today();
  saveState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `money-hq-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  $("notice").textContent = "Backup downloaded.";
  render();
});

$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm("Replace everything here with this backup?")) return;
    state = cleanState(data);
    saveState();
    fillPlanForm();
    render();
    $("notice").textContent = "Backup restored.";
  } catch {
    $("notice").textContent = "That file isn't a Money HQ backup.";
  } finally {
    event.target.value = "";
  }
});

// ----- Sync code -----
// Your data is locked (encrypted) with your key right here in the browser, using the
// browser's built-in Web Crypto. Nothing is sent anywhere. The code looks like "MHQ1.xxxx…".
//   key → PBKDF2 (250,000 rounds, random salt) → AES-GCM 256-bit lock
// AES-GCM also detects a wrong key or a damaged code, so it can't load garbage.

const SYNC_PREFIX = "MHQ1.";

async function lockKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

// gzip makes the code about 3–5× shorter (if the browser supports it)
async function squeeze(bytes, how) {
  const stream = new Blob([bytes]).stream().pipeThrough(how === "zip" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function joinBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// bytes ↔ text that's safe to paste anywhere (base64url)
function toText(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromText(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function makeSyncCode(pass) {
  const raw = new TextEncoder().encode(JSON.stringify(state));
  const canZip = "CompressionStream" in window;
  const body = canZip ? joinBytes([1], await squeeze(raw, "zip")) : joinBytes([0], raw); // first byte: 1 = zipped
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const locked = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(pass, salt), body));
  return SYNC_PREFIX + toText(joinBytes(salt, iv, locked));
}

async function readSyncCode(code, pass) {
  const clean = code.replace(/\s+/g, "");
  if (!clean.startsWith(SYNC_PREFIX)) throw new Error("format");
  const bytes = fromText(clean.slice(SYNC_PREFIX.length));
  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 28);
  const body = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await lockKey(pass, salt), bytes.slice(28)));
  const raw = body[0] === 1 ? await squeeze(body.slice(1), "unzip") : body.slice(1);
  return cleanState(JSON.parse(new TextDecoder().decode(raw)));
}

const syncSay = (text) => { $("syncNotice").textContent = text; };

$("makeCode").addEventListener("click", async () => {
  const pass = $("syncKey").value;
  if (!window.crypto || !crypto.subtle) return syncSay("This browser can't lock data here. Open Money HQ from its https:// link.");
  if (pass.length < 8) return syncSay("Use a key with at least 8 characters. Longer is safer.");
  syncSay("Locking…");
  try {
    const code = await makeSyncCode(pass);
    $("syncOut").value = code;
    $("syncOut").hidden = false;
    state.lastBackup = today();
    saveState();
    render();
    try {
      await navigator.clipboard.writeText(code);
      syncSay(`Copied (${code.length.toLocaleString()} characters). Paste it in the other browser and use the same key.`);
    } catch {
      $("syncOut").select();
      syncSay("Couldn't copy by itself. The code is selected below: press Cmd+C (or Ctrl+C) to copy it.");
    }
  } catch {
    syncSay("Something went wrong making the code. Try again.");
  }
});

$("loadCode").addEventListener("click", async () => {
  const code = $("syncIn").value;
  const pass = $("syncKeyIn").value;
  if (!window.crypto || !crypto.subtle) return syncSay("This browser can't unlock data here. Open Money HQ from its https:// link.");
  if (!code.trim() || !pass) return syncSay("Paste the code and type the key first.");
  syncSay("Unlocking…");
  let data;
  try {
    data = await readSyncCode(code, pass);
  } catch (e) {
    return syncSay(e.message === "format" ? "That doesn't look like a Money HQ sync code (it should start with MHQ1.)." : "Wrong key, or the code got cut off when copying.");
  }
  if (!confirm(`Replace everything in this browser with the data from the code? (${data.entries.length} income, ${data.expenses.length} spending entries)`)) return syncSay("Cancelled. Nothing changed.");
  state = data;
  saveState();
  fillPlanForm();
  render();
  $("syncIn").value = "";
  $("syncKeyIn").value = "";
  syncSay(`Loaded: ${data.entries.length} income and ${data.expenses.length} spending entries.`);
});

function tickClock() {
  const now = new Date();
  const day = now.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  $("clock").textContent = `${day} · ${now.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}`;
}

// Redraw everything that shows data
function render() {
  renderOverview();
  renderWeek();
  renderPlanner();
  renderDrawerLists();
  fillSettingsForm();
}

$("date").value = today();
$("expDate").value = today();
showPane("income");
fillPlanForm();
showView();
tickClock();
setInterval(tickClock, 30000);
render();

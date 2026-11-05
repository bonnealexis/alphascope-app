// Les graphiques interactifs de l'appli (docs/APPLI.md §1.3).
//
// Chaque image du mail est redessinée en SVG à partir du bloc `charts` de
// donnees.json, indexé par le nom de fichier de l'image. Les nombres sont ceux
// que trace le mail (engines/chart_engine.py) : ici on ne fait que les dessiner,
// et les lire au doigt. Une entrée absente ou un dessin raté : l'image reste.
//
// Les couleurs sont des rôles (variables --c-* de style.css), jamais des valeurs
// en dur : le thème sombre les redéfinit. Palette validée par le validateur du
// skill dataviz, en clair et en sombre : bleu = ta valeur, au-dessus, gain ;
// rouge = perte, en dessous ; vert pointillé = ton prix d'achat ; gris = le
// contexte (marché, tendance). Le texte reste à l'encre, jamais en couleur de donnée.

import { currencySymbol, esc, pill, store } from "./outils.js";

const NBSP = " ";
const MINUS = "−";
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const DEFAULT_WIDTH = 311; // une carte sur un iPhone de 375 px, avant la vraie mesure
const PERIOD_KEY = "alphascope.periode-portefeuille";

const specs = new WeakMap();    // élément monté → sa spécification (pour redessiner)
const animated = new WeakSet(); // spécifications déjà animées : une seule fois par calcul
const opened = new Set();       // lignes ouvertes, retrouvées après un nouveau rendu
let period = store.get(PERIOD_KEY, "mail") || "mail";
let measure = null;

// ====================================================================== nombres

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fr(value, decimals) {
  return Math.abs(Number(value)).toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .replace(/[\s  ]/g, NBSP);
}

function sign(n, signed) {
  return n < 0 ? MINUS : signed && n > 0 ? "+" : "";
}

// « 101 481 € », « +212 € », « −9,50 € » : les centimes seulement sous 100.
export function moneyText(value, currency, { signed = false, decimals = null } = {}) {
  const n = num(value);
  if (n === null) return "—";
  const d = decimals ?? (Math.abs(n) >= 100 ? 0 : 2);
  let text = fr(n, d);
  if (d === 2 && text.endsWith(",00")) text = text.slice(0, -3);
  const rounded = Number(n.toFixed(d));
  return `${sign(rounded, signed)}${text}${NBSP}${currencySymbol(currency)}`;
}

function priceText(value, currency) {
  const n = num(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  return `${sign(n, false)}${fr(n, d)}${NBSP}${currencySymbol(currency)}`;
}

export function pctText(value, { decimals = 1, signed = true } = {}) {
  const n = num(value);
  if (n === null) return "—";
  const rounded = Number(n.toFixed(decimals));
  return `${sign(rounded, signed)}${fr(rounded, decimals)}${NBSP}%`;
}

function parseDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function shortDay(iso) {
  const day = parseDay(iso);
  return day ? `${day.getDate() === 1 ? "1er" : day.getDate()}${NBSP}${MONTHS[day.getMonth()]}` : "";
}

function longDay(iso) {
  const day = parseDay(iso);
  if (!day) return "";
  const year = day.getFullYear() === new Date().getFullYear() ? "" : ` ${day.getFullYear()}`;
  return `${DAYS[day.getDay()]} ${day.getDate() === 1 ? "1er" : day.getDate()}${NBSP}${MONTHS[day.getMonth()]}${year}`;
}

function textWidth(text, size = 12, weight = 400) {
  try {
    measure = measure || document.createElement("canvas").getContext("2d");
    measure.font = `${weight} ${size}px ${FONT}`;
    return measure.measureText(String(text)).width;
  } catch {
    return String(text).length * size * 0.56;
  }
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.classList.contains("sans-transition");
  } catch {
    return false;
  }
}

// ====================================================================== échelles et tracés

function scale(d0, d1, r0, r1) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => (k ? r0 + (v - d0) * k : (r0 + r1) / 2);
  f.invert = (p) => (k ? d0 + (p - r0) / k : d0);
  return f;
}

// Des graduations rondes : 1, 2 ou 5 fois une puissance de dix.
function ticks(low, high, count = 4) {
  if (!(high > low)) return [low];
  const raw = (high - low) / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const out = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  out.step = step;
  return out;
}

function axisMoney(value, currency, step) {
  const symbol = currencySymbol(currency);
  if (step >= 1000) {
    const k = value / 1000;
    return `${sign(k, false)}${fr(k, Number.isInteger(Number(k.toFixed(6))) ? 0 : 1)}${NBSP}k${symbol}`;
  }
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${sign(value, false)}${fr(value, d)}${NBSP}${symbol}`;
}

// Une ligne, interrompue là où une valeur manque.
function linePath(values, x, y, from = 0, to = values.length - 1) {
  let d = "";
  let pen = false;
  for (let i = from; i <= to; i += 1) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

// La zone entre deux lignes (ou une ligne et un niveau), par morceaux continus.
function bandPath(upper, lower, x, y, from, to) {
  let d = "";
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      d += run.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(upper[i]).toFixed(1)}`).join("");
      d += run.slice().reverse().map((i) => `L${x(i).toFixed(1)},${y(lower(i)).toFixed(1)}`).join("") + "Z";
    }
    run = [];
  };
  for (let i = from; i <= to; i += 1) {
    if (upper[i] === null || upper[i] === undefined || lower(i) === null) flush();
    else run.push(i);
  }
  flush();
  return d;
}

// La zone sous une ligne, jusqu'à un niveau en pixels.
function areaPath(values, x, y, floor, from = 0, to = values.length - 1) {
  let d = "";
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      d += run.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join("");
      d += `L${x(run[run.length - 1]).toFixed(1)},${floor.toFixed(1)}L${x(run[0]).toFixed(1)},${floor.toFixed(1)}Z`;
    }
    run = [];
  };
  for (let i = from; i <= to; i += 1) {
    if (values[i] === null || values[i] === undefined) flush();
    else run.push(i);
  }
  flush();
  return d;
}

function lastIndex(values, from = 0) {
  for (let i = values.length - 1; i >= from; i -= 1) if (values[i] !== null && values[i] !== undefined) return i;
  return -1;
}

function firstIndex(values, from = 0) {
  for (let i = from; i < values.length; i += 1) if (values[i] !== null && values[i] !== undefined) return i;
  return -1;
}

function svgText(x, y, text, { cls = "g-axis", anchor = "start", baseline = "auto", halo = false } = {}) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}${halo ? " g-halo" : ""}" text-anchor="${anchor}"`
    + (baseline !== "auto" ? ` dominant-baseline="${baseline}"` : "") + `>${esc(text)}</text>`;
}

function dot(x, y, cls, r = 4) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="g-dot ${cls}"/>`;
}

// Quelques dates sous l'axe, sans chevauchement : la première, la dernière et
// une ou deux entre les deux.
function dateLabels(dates, x, from, to, y, width) {
  const candidates = [];
  const count = to - from;
  const parts = count > 40 ? 3 : 2;
  for (let k = 0; k <= parts; k += 1) candidates.push(Math.round(from + (count * k) / parts));
  let out = "";
  let right = -Infinity;
  candidates.forEach((i, k) => {
    const text = shortDay(dates[i]);
    if (!text) return;
    const w = textWidth(text, 12);
    const anchor = k === 0 ? "start" : k === candidates.length - 1 ? "end" : "middle";
    const px = clamp(x(i), 0, width);
    const left = anchor === "start" ? px : anchor === "end" ? px - w : px - w / 2;
    if (left < right + 10) return;
    right = left + w;
    out += svgText(px, y, text, { anchor });
  });
  return out;
}

// ====================================================================== curseur au doigt

// Glisser le doigt (ou la souris) sur `plot` : le curseur se cale sur la séance
// la plus proche et le graphique dit les valeurs. Le doigt ne lit la courbe que s'il
// part à l'horizontale, ou s'il reste posé un instant : un geste vertical fait
// défiler la page (touch-action: pan-y), sans curseur. Flèches du clavier : séance par séance.
const HOLD_MS = 260;   // un doigt tenu sans bouger lit aussi la courbe
const SLOP_PX = 7;     // en dessous, le geste n'est pas encore décidé

function scrubber(plot, { count, indexAt, show, hide, initial = null }) {
  let active = false;
  let current = null;
  let pressing = null; // doigt posé, geste pas encore décidé
  const svg = plot.querySelector("svg");
  const at = (event) => {
    const rect = svg.getBoundingClientRect();
    const width = Number(svg.getAttribute("width")) || rect.width;
    return clamp(Math.round(indexAt(((event.clientX - rect.left) * width) / rect.width)), 0, count - 1);
  };
  const go = (index) => {
    if (index === null || index === undefined || index < 0) return;
    current = clamp(index, 0, count - 1);
    plot.classList.add("g-scrubbing");
    show(current);
  };
  const stop = () => {
    active = false;
    current = null;
    plot.classList.remove("g-scrubbing");
    hide();
  };
  const begin = (event) => {
    if (pressing) clearTimeout(pressing.timer);
    pressing = null;
    active = true;
    try {
      plot.setPointerCapture(event.pointerId);
    } catch {
      /* rien */
    }
    go(at(event));
  };
  const forget = () => {
    if (pressing) clearTimeout(pressing.timer);
    pressing = null;
  };
  plot.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") {
      if (event.button === 0) begin(event);
      return;
    }
    forget();
    pressing = { id: event.pointerId, x: event.clientX, y: event.clientY, last: event };
    pressing.timer = setTimeout(() => {
      if (pressing) begin(pressing.last);
    }, HOLD_MS);
  });
  plot.addEventListener("pointermove", (event) => {
    if (pressing && event.pointerId === pressing.id) {
      const dx = Math.abs(event.clientX - pressing.x);
      const dy = Math.abs(event.clientY - pressing.y);
      pressing.last = event;
      if (dy > SLOP_PX && dy >= dx) forget();        // vertical : c'est la page qui défile
      else if (dx > SLOP_PX && dx > dy) begin(event); // horizontal : on lit la courbe
      return;
    }
    if (active || event.pointerType === "mouse") go(at(event));
  });
  plot.addEventListener("pointerup", (event) => {
    forget();
    if (event.pointerType !== "mouse") stop();
    else active = false;
  });
  plot.addEventListener("pointercancel", () => {
    forget();
    stop();
  });
  plot.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") stop();
  });
  plot.addEventListener("keydown", (event) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in keys) {
      event.preventDefault();
      go((current ?? initial ?? count - 1) + keys[event.key]);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(count - 1);
    } else if (event.key === "Escape") {
      stop();
    }
  });
  plot.addEventListener("blur", stop);
}

// La bulle : la valeur d'abord, en gras, puis ce qu'elle est (texte sûr : textContent).
function showTip(plot, x, title, rows, { inside = false } = {}) {
  let tip = plot.querySelector(".g-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "g-tip";
    tip.setAttribute("aria-hidden", "true");
    plot.append(tip);
  }
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "g-tip-title";
  head.textContent = title;
  tip.append(head);
  for (const row of rows) {
    if (row.note) {
      const note = document.createElement("div");
      note.className = "g-tip-note";
      note.textContent = row.note;
      tip.append(note);
      continue;
    }
    const line = document.createElement("div");
    line.className = "g-tip-row";
    if (row.key) {
      const key = document.createElement("span");
      key.className = `g-key g-tip-key ${row.key}`;
      line.append(key);
    }
    const value = document.createElement("strong");
    value.textContent = row.value;
    line.append(value);
    if (row.label) {
      const label = document.createElement("span");
      label.className = "g-tip-label";
      label.textContent = row.label;
      line.append(label);
    }
    tip.append(line);
  }
  tip.hidden = false;
  tip.classList.toggle("g-tip-inside", inside);
  const width = tip.offsetWidth;
  const room = plot.clientWidth;
  tip.style.left = inside
    ? `${x > room / 2 ? 6 : Math.max(room - width - 6, 0)}px`
    : `${clamp(x - width / 2, 0, Math.max(room - width, 0))}px`;
  // Le message lu par les lecteurs d'écran.
  const live = plot.querySelector(".g-live");
  if (live) live.textContent = `${title} : ${rows.map((row) => row.note || `${row.label || ""} ${row.value}`.trim()).join(", ")}`;
}

function hideTip(plot) {
  const tip = plot.querySelector(".g-tip");
  if (tip) tip.hidden = true;
  hideCursor(plot);
}

function hideCursor(plot) {
  const cursor = plot.querySelector(".g-cursor");
  if (cursor) cursor.setAttribute("visibility", "hidden");
}

function announce(plot, text) {
  const live = plot && plot.querySelector(".g-live");
  if (live) live.textContent = text;
}

// Pendant la lecture, le titre du graphique devient les valeurs du point touché
// (comme dans les applis boursières) : rien ne recouvre le texte ; à hauteur fixe,
// rien ne saute. Le doigt levé, le résumé revient tel quel.
function readout(summary, html, spoken, plot) {
  if (!summary) return;
  if (!summary.classList.contains("is-reading")) {
    summary.savedHtml = summary.innerHTML;
    summary.style.minHeight = `${summary.offsetHeight}px`;
    summary.classList.add("is-reading");
  }
  summary.innerHTML = html;
  announce(plot, spoken);
}

function restore(summary) {
  if (!summary || !summary.classList.contains("is-reading")) return;
  summary.innerHTML = summary.savedHtml || "";
  summary.savedHtml = null;
  summary.style.minHeight = "";
  summary.classList.remove("is-reading");
}

function placeCursor(plot, x, points, top, bottom) {
  const cursor = plot.querySelector(".g-cursor");
  if (!cursor) return;
  cursor.setAttribute("visibility", "visible");
  const line = cursor.querySelector("line");
  line.setAttribute("x1", x.toFixed(1));
  line.setAttribute("x2", x.toFixed(1));
  line.setAttribute("y1", top.toFixed(1));
  line.setAttribute("y2", bottom.toFixed(1));
  const circles = cursor.querySelectorAll("circle");
  circles.forEach((circle, k) => {
    const point = points[k];
    if (!point || point.y === null || !Number.isFinite(point.y)) {
      circle.setAttribute("visibility", "hidden");
      return;
    }
    circle.setAttribute("visibility", "visible");
    circle.setAttribute("cx", x.toFixed(1));
    circle.setAttribute("cy", point.y.toFixed(1));
  });
}

function cursorLayer(classes) {
  return `<g class="g-cursor" visibility="hidden"><line class="g-cursor-line"/>`
    + classes.map((cls) => `<circle r="4.5" class="g-dot ${cls}"/>`).join("") + `</g>`;
}

function plotFrame(svg, label, extraClass = "") {
  return `<div class="g-plot${extraClass}" tabindex="0" role="img" aria-label="${esc(label)}">${svg}`
    + `<div class="g-tip" hidden></div><span class="g-live visually-hidden" aria-live="polite"></span></div>`;
}

function freshPlot(old, svg, label) {
  const holder = document.createElement("div");
  holder.innerHTML = plotFrame(svg, label || "");
  const next = holder.firstElementChild;
  old.replaceWith(next);
  return next;
}

function svgOpen(width, height, extra = "") {
  return `<svg class="g-svg${extra}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`;
}

// « Voir les chiffres » : le tableau, construit seulement à l'ouverture.
function tableBlock(kind) {
  return `<details class="g-table" data-table="${kind}"><summary>Voir les chiffres</summary><div class="g-table-body"></div></details>`;
}

function fillTable(details, head, rows) {
  const body = details.querySelector(".g-table-body");
  if (!body || body.childElementCount) return;
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const cell of head) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = cell;
    tr.append(th);
  }
  thead.append(tr);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const line = document.createElement("tr");
    row.forEach((cell, k) => {
      const td = document.createElement(k === 0 ? "th" : "td");
      if (k === 0) td.scope = "row";
      td.textContent = cell;
      line.append(td);
    });
    tbody.append(line);
  }
  table.append(thead, tbody);
  body.append(table);
}

function wireTable(element, build) {
  const details = element.querySelector(".g-table");
  if (!details || details.dataset.wired) return;
  details.dataset.wired = "1";
  details.addEventListener("toggle", () => {
    if (details.open) {
      const { head, rows } = build();
      fillTable(details, head, rows);
    }
  });
}

function animateOnce(element, spec) {
  if (animated.has(spec) || reducedMotion()) return;
  animated.add(spec);
  element.classList.add("g-animate");
  setTimeout(() => element.classList.remove("g-animate"), 1200);
}

// ====================================================================== portefeuille

function portfolioPeriods(spec) {
  const n = spec.dates.length;
  const mailCount = Math.min(n, spec.default_sessions || 30);
  const last = parseDay(spec.dates[n - 1]);
  const out = [];
  if (last) {
    const cut = new Date(last);
    cut.setMonth(cut.getMonth() - 1);
    const from = spec.dates.findIndex((d) => parseDay(d) >= cut);
    if (from > 0 && n - from < mailCount - 3) out.push({ id: "mois", label: "1 mois" });
  }
  out.push({ id: "mail", label: `${mailCount} séances` });
  if (n > mailCount + 5) {
    const first = parseDay(spec.dates[0]);
    const days = first && last ? (last - first) / 86_400_000 : 0;
    out.push({ id: "tout", label: days >= 80 ? `${Math.round(days / 30.4)} mois` : "Tout" });
  }
  return out;
}

function portfolioWindow(spec, chosen) {
  const n = spec.dates.length;
  const own = spec.own.map(num);
  const bench = spec.benchmark ? spec.benchmark.values.map(num) : new Array(n).fill(null);
  const mail = spec.mail || {};
  let from = 0;
  if (chosen === "mail") from = Math.max(0, n - (spec.default_sessions || 30));
  else if (chosen === "mois") {
    const cut = parseDay(spec.dates[n - 1]);
    cut.setMonth(cut.getMonth() - 1);
    from = Math.max(0, spec.dates.findIndex((d) => parseDay(d) >= cut));
  }
  const first = firstIndex(own, from);
  const last = lastIndex(own, from);
  const out = { from, to: n - 1, own, first, last, money: new Array(n).fill(null), change: null, benchChange: null, start: null };
  if (first < 0 || last <= first) return null;
  out.firstValue = own[first];
  out.lastValue = own[last];
  if (chosen === "mail" && Array.isArray(mail.benchmark_money) && mail.benchmark_money.length === n) {
    // La vue du mail : ses nombres exacts.
    out.money = mail.benchmark_money.map(num);
    out.start = num(mail.start);
    out.change = num(mail.change_percent);
    out.benchChange = num(mail.benchmark_change_percent);
    if (num(mail.first) !== null) out.firstValue = num(mail.first);
    if (num(mail.last) !== null) out.lastValue = num(mail.last);
    return out;
  }
  // Ailleurs, le même rebasage que le mail (chart_engine.portfolio_chart_data) :
  // le marché en argent à partir de la première séance où les deux lignes existent,
  // la part sans cours quotidien gardée à part.
  out.change = out.firstValue > 0 ? (out.lastValue / out.firstValue - 1) * 100 : null;
  let start = -1;
  for (let i = first; i < n; i += 1) {
    if (own[i] !== null && bench[i] !== null && bench[i] > 0) {
      start = i;
      break;
    }
  }
  if (start >= 0) {
    const declared = num(spec.fixed_value) || 0;
    const fixed = declared > 0 && declared < own[start] ? declared : 0;
    const factor = (own[start] - fixed) / bench[start];
    for (let i = start; i < n; i += 1) out.money[i] = bench[i] === null ? null : fixed + bench[i] * factor;
    const end = lastIndex(out.money, start);
    if (end > start && out.money[start] > 0) {
      out.start = start;
      out.benchChange = (out.money[end] / out.money[start] - 1) * 100;
    }
  }
  return out;
}

function drawPortfolio(spec, view, width) {
  const height = 196;
  const top = 10;
  const bottom = height - 24;
  const currency = spec.currency;
  const values = [];
  for (let i = view.from; i <= view.to; i += 1) {
    if (view.own[i] !== null) values.push(view.own[i]);
    if (view.money[i] !== null) values.push(view.money[i]);
  }
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low || Math.abs(high) * 0.02 || 1) * 0.12;
  low -= pad;
  high += pad;
  const marks = ticks(low, high, 4);
  const labels = marks.map((v) => axisMoney(v, currency, marks.step || 1));
  const labelWidth = Math.max(...labels.map((t) => textWidth(t, 12))) + 8;
  const right = width - labelWidth;
  const x = scale(view.from, view.to, 4, right - 6);
  const y = scale(low, high, bottom, top);
  let svg = svgOpen(width, height);
  marks.forEach((v, k) => {
    if (y(v) < top - 2 || y(v) > bottom + 2) return;
    svg += `<line x1="0" x2="${right.toFixed(1)}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="g-grid"/>`;
    svg += svgText(width, y(v) + 4, labels[k], { anchor: "end" });
  });
  // Le niveau de départ : au-dessus, tu gagnes sur la période ; en dessous, tu perds.
  svg += `<line x1="0" x2="${right.toFixed(1)}" y1="${y(view.firstValue).toFixed(1)}" y2="${y(view.firstValue).toFixed(1)}" class="g-baseline"/>`;
  svg += dateLabels(spec.dates, x, view.from, view.to, height - 6, right);
  if (view.start !== null) {
    svg += `<path d="${linePath(view.money, x, y, Math.max(view.start, view.from), view.to)}" class="g-line g-bench g-draw" pathLength="1"/>`;
    const end = lastIndex(view.money, view.from);
    if (end >= 0) svg += dot(x(end), y(view.money[end]), "g-fill-bench", 3.5);
  }
  svg += `<path d="${linePath(view.own, x, y, view.from, view.to)}" class="g-line g-own g-draw" pathLength="1"/>`;
  svg += dot(x(view.last), y(view.own[view.last]), "g-fill-own", 4.5);
  svg += cursorLayer(["g-fill-bench", "g-fill-own"]);
  svg += "</svg>";
  return { svg, x, y, top, bottom };
}

function portfolioHead(spec, view, periods) {
  const currency = spec.currency;
  const amount = view.lastValue - view.firstValue;
  const tone = amount > 0.005 ? "up" : amount < -0.005 ? "down" : "flat";
  const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "";
  const count = view.last - view.first + 1;
  const bench = view.benchChange === null ? "" : ` · ${spec.benchmark ? esc(spec.benchmark.label || "Marché") : "Marché"} ${esc(pctText(view.benchChange))}`;
  return `<div class="g-seg" role="group" aria-label="Période">`
    + periods.map((p) => `<button type="button" class="g-seg-button" data-period="${p.id}" aria-pressed="${p.id === view.period}">${esc(p.label)}</button>`).join("")
    + `</div>`
    + `<div class="g-summary"><div class="g-big"><span class="g-delta g-delta-${tone}">${arrow ? `<span class="g-arrow" aria-hidden="true">${arrow}</span>` : ""}`
    + `${esc(moneyText(amount, currency, { signed: true }))}</span> <span class="g-big-pct">${esc(pctText(view.change))}</span></div>`
    + `<p class="g-sub">sur ${count} séances, du ${esc(shortDay(spec.dates[view.first]))} au ${esc(shortDay(spec.dates[view.last]))}${bench}</p></div>`
    + `<div class="g-legend"><span class="g-legend-item"><span class="g-key g-key-own"></span>Ton portefeuille</span>`
    + (view.start !== null ? `<span class="g-legend-item"><span class="g-key g-key-bench"></span>${esc(spec.benchmark?.label || "Marché")}</span>` : "")
    + `</div>`;
}

function portfolioSummary(spec, view) {
  const currency = spec.currency;
  let text = `Ton portefeuille du ${shortDay(spec.dates[view.first])} au ${shortDay(spec.dates[view.last])} : `
    + `de ${moneyText(view.firstValue, currency)} à ${moneyText(view.lastValue, currency)} (${pctText(view.change)})`;
  if (view.benchChange !== null) text += ` ; ${spec.benchmark?.label || "le marché"} ${pctText(view.benchChange)}`;
  return `${text}. Glisse le doigt sur la courbe pour lire une séance.`;
}

function renderPortfolio(spec, ctx = {}) {
  // La légende de l'image du mail (« Trente séances… ») ne vaut plus quand on choisit
  // la période : le graphique dit lui-même ce qu'il montre.
  ctx.ownCaption = true;
  const periods = portfolioPeriods(spec);
  const chosen = periods.some((p) => p.id === period) ? period : "mail";
  const view = portfolioWindow(spec, chosen);
  if (!view) return "";
  view.period = chosen;
  const drawn = drawPortfolio(spec, view, DEFAULT_WIDTH);
  return `<div class="g g-portfolio"><div class="g-head">${portfolioHead(spec, view, periods)}</div>`
    + plotFrame(drawn.svg, portfolioSummary(spec, view)) + tableBlock("portfolio") + `</div>`;
}

function mountPortfolio(element, spec) {
  const root = element.querySelector(".g-portfolio");
  if (!root) return;
  const periods = portfolioPeriods(spec);
  const draw = (animate) => {
    const chosen = periods.some((p) => p.id === period) ? period : "mail";
    const view = portfolioWindow(spec, chosen);
    if (!view) return;
    view.period = chosen;
    const width = Math.max(Math.round(root.clientWidth), 200);
    const drawn = drawPortfolio(spec, view, width);
    root.querySelector(".g-head").innerHTML = portfolioHead(spec, view, periods);
    const plot = root.querySelector(".g-plot");
    const fresh = document.createElement("div");
    fresh.innerHTML = plotFrame(drawn.svg, portfolioSummary(spec, view));
    const next = fresh.firstElementChild;
    plot.replaceWith(next);
    if (animate) {
      next.classList.add("g-animate");
      setTimeout(() => next.classList.remove("g-animate"), 1200);
    }
    const label = spec.benchmark?.label || "Marché";
    scrubber(next, {
      count: spec.dates.length,
      initial: view.last,
      indexAt: (px) => clamp(drawn.x.invert(px), view.from, view.to),
      show: (index) => {
        const i = clamp(index, view.from, view.to);
        const own = view.own[i];
        const market = view.money[i];
        placeCursor(next, drawn.x(i), [
          { y: market === null ? null : drawn.y(market) }, { y: own === null ? null : drawn.y(own) },
        ], drawn.top, drawn.bottom);
        const day = longDay(spec.dates[i]);
        let sub = `<strong>${esc(day)}</strong>`;
        if (market !== null) sub += ` · <span class="g-key g-key-bench" aria-hidden="true"></span>${esc(label)} ${esc(moneyText(market, spec.currency))}`;
        if (own !== null && market !== null) sub += ` · écart ${esc(moneyText(own - market, spec.currency, { signed: true }))}`;
        readout(root.querySelector(".g-summary"),
          `<div class="g-big g-reading"><span class="g-key g-key-own" aria-hidden="true"></span>${esc(own === null ? "—" : moneyText(own, spec.currency))}</div>`
          + `<p class="g-sub">${sub}</p>`,
          `${day} : ton portefeuille ${moneyText(own, spec.currency)}${market !== null ? `, ${label} ${moneyText(market, spec.currency)}` : ""}`, next);
      },
      hide: () => {
        hideCursor(next);
        restore(root.querySelector(".g-summary"));
      },
    });
    root.querySelectorAll(".g-seg-button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.period === period) return;
        period = button.dataset.period;
        store.set(PERIOD_KEY, period);
        draw(!reducedMotion());
      });
    });
    root.dataset.view = JSON.stringify([view.from, view.to]);
  };
  draw(false);
  animateOnce(root.querySelector(".g-plot"), spec);
  wireTable(root, () => {
    const [from, to] = JSON.parse(root.dataset.view || "[0,0]");
    const view = portfolioWindow(spec, periods.some((p) => p.id === period) ? period : "mail");
    const rows = [];
    for (let i = to; i >= from; i -= 1) {
      rows.push([shortDay(spec.dates[i]), moneyText(view.own[i], spec.currency), moneyText(view.money[i], spec.currency)]);
    }
    return { head: ["Séance", "Toi", spec.benchmark?.label || "Marché"], rows };
  });
  // Le tableau suit la période : on le vide quand elle change.
  if (root.dataset.wired) return;
  root.dataset.wired = "1";
  root.addEventListener("click", (event) => {
    if (!event.target.closest(".g-seg-button")) return;
    const details = root.querySelector(".g-table");
    if (details) {
      details.open = false;
      details.querySelector(".g-table-body").replaceChildren();
    }
  });
}

// La petite courbe de l'en-tête du Portefeuille : les 30 dernières séances.
export function sparkline(spec, { width = 96, height = 36 } = {}) {
  if (!spec || spec.type !== "portfolio" || !Array.isArray(spec.own)) return "";
  const own = spec.own.map(num);
  const n = own.length;
  const from = Math.max(0, n - (spec.default_sessions || 30));
  const values = own.slice(from).filter((v) => v !== null);
  if (values.length < 2) return "";
  const x = scale(from, n - 1, 2, width - 5);
  const y = scale(Math.min(...values), Math.max(...values), height - 4, 4);
  const end = lastIndex(own, from);
  return `<svg class="g-spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`
    + `<path d="${linePath(own, x, y, from, n - 1)}" class="g-line g-spark-line"/>`
    + dot(x(end), y(own[end]), "g-fill-own", 3.5) + `</svg>`;
}

// La variation de la dernière séance : « ▼ 312 € (−0,3 %) depuis hier ».
export function lastMove(spec, reportDate) {
  if (!spec || spec.type !== "portfolio") return null;
  const own = spec.own.map(num);
  const last = lastIndex(own);
  const before = last > 0 ? lastIndex(own.slice(0, last)) : -1;
  if (last < 0 || before < 0 || !(own[before] > 0)) return null;
  const amount = own[last] - own[before];
  const today = String(spec.dates[last] || "") === String(reportDate || "").slice(0, 10);
  return {
    amount,
    percent: (own[last] / own[before] - 1) * 100,
    words: today ? "depuis hier" : `le ${shortDay(spec.dates[last])}`,
    currency: spec.currency,
  };
}

// ====================================================================== positions

function renderPositions(spec) {
  const rows = (spec.rows || []).filter((row) => num(row.percent) !== null);
  if (!rows.length) return "";
  const byAmount = Boolean(spec.by_amount);
  const value = (row) => num(byAmount ? row.amount : row.percent) ?? 0;
  const gains = Math.max(0, ...rows.map(value));
  const losses = Math.max(0, ...rows.map((row) => -value(row)));
  const span = gains + losses || 1;
  const zero = (losses / span) * 100;
  let html = `<div class="g g-positions"><div class="g-bars" role="list">`;
  rows.forEach((row, index) => {
    const v = value(row);
    const share = (Math.abs(v) / span) * 100;
    const gain = v >= 0;
    const amount = byAmount ? moneyText(row.amount, spec.currency, { signed: true }) : "";
    const percent = pctText(row.percent, { decimals: 0 });
    const key = `positions|${row.name || row.label}`;
    const open = opened.has(key);
    const detail = `${row.name || row.label} : ${byAmount ? `${amount} depuis l'achat, soit ${percent}` : `${percent} depuis l'achat`}.`;
    html += `<div class="g-bar-item${open ? " is-open" : ""}" role="listitem">`
      + `<button type="button" class="g-bar-row" data-open="${esc(key)}" aria-expanded="${open}" style="--i:${index}">`
      + `<span class="g-bar-head"><span class="g-bar-name">${esc(row.label)}</span>`
      + `<span class="g-bar-value">${esc(byAmount ? amount : percent)}${byAmount ? ` <span class="g-bar-pct">${esc(percent)}</span>` : ""}</span></span>`
      + `<span class="g-bar-track" aria-hidden="true"><span class="g-bar-zero" style="left:${zero.toFixed(2)}%"></span>`
      + `<span class="g-bar-fill ${gain ? "g-bar-gain" : "g-bar-loss"}" style="${gain ? `left:${zero.toFixed(2)}%` : `right:${(100 - zero).toFixed(2)}%`};width:${Math.max(share, 0.6).toFixed(2)}%"></span></span>`
      + `</button><p class="g-bar-detail">${esc(detail)}</p></div>`;
  });
  html += `</div>`;
  if (byAmount && num(spec.total) !== null) {
    html += `<p class="g-total">Au total : <strong>${esc(moneyText(spec.total, spec.currency, { signed: true }))}</strong> depuis l'achat</p>`;
  }
  html += `<p class="g-legend g-legend-bars"><span class="g-legend-item"><span class="g-key g-key-bar-gain"></span>en gain</span>`
    + `<span class="g-legend-item"><span class="g-key g-key-bar-loss"></span>en perte</span></p>`;
  return html + tableBlock("positions") + `</div>`;
}

function wireToggles(root) {
  root.querySelectorAll("[data-open]").forEach((button) => {
    if (button.dataset.wired) return;
    button.dataset.wired = "1";
    button.addEventListener("click", () => {
      const key = button.dataset.open;
      const item = button.closest(".g-bar-item, .g-range");
      const open = !item.classList.contains("is-open");
      item.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
      if (open) opened.add(key);
      else opened.delete(key);
      if (open && item.classList.contains("g-range")) mountRangeCurve(item);
    });
  });
}

function mountPositions(element, spec) {
  const root = element.querySelector(".g-positions");
  if (!root) return;
  wireToggles(root);
  animateOnce(root, spec);
  wireTable(root, () => ({
    head: ["Position", "Gain ou perte", "En %"],
    rows: (spec.rows || []).map((row) => [row.name || row.label,
      spec.by_amount ? moneyText(row.amount, spec.currency, { signed: true }) : "—", pctText(row.percent)]),
  }));
}

// ====================================================================== pistes (ETF, actions)

function pullbackText(value) {
  const n = num(value);
  if (n === null) return "—";
  return n > -0.5 ? `0${NBSP}%` : pctText(n, { decimals: 0 });
}

function matchPick(row, picks) {
  const norm = (text) => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  return picks.find((pick) => norm(pick.name) === norm(row.label))
    || picks.find((pick) => row.code && new RegExp(`\\(${row.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)\\s*$`, "i").test(String(pick.name || "")))
    || null;
}

function renderRanges(spec, ctx = {}) {
  const rows = spec.rows || [];
  if (!rows.length) return "";
  const picks = Array.isArray(ctx.picks) ? ctx.picks.filter((p) => p && typeof p === "object") : [];
  const matched = rows.map((row) => (picks.length ? matchPick(row, picks) : null));
  if (picks.length && matched.filter(Boolean).length === picks.length) ctx.merged = true;
  const hasYear = rows.some((row) => row.track && row.track.year);
  const excluded = rows.filter((row) => !row.eligible && row.has_data);
  const prefix = ctx.filename || "familles";
  let html = `<div class="g g-ranges">`
    + `<div class="g-ranges-head" aria-hidden="true"><span>${hasYear ? "un an : du plus bas au plus haut" : "six mois : du plus bas au plus haut"}</span>`
    + `<span class="g-col">6 mois</span><span class="g-col">1 an</span></div>`;
  rows.forEach((row, index) => {
    const pick = matched[index];
    const key = `${prefix}|${row.symbol || row.label}`;
    const open = opened.has(key);
    const live = row.eligible && row.has_data;
    const track = row.track || {};
    const marker = num(track.marker);
    const band = Array.isArray(track.band) ? track.band.map(num) : null;
    const extra = pick && String(pick.text || "").includes(" · ") ? String(pick.text).split(" · ").slice(1).join(" · ") : "";
    let bar = "";
    if (marker === null) {
      bar = `<span class="g-track-missing">cours indisponible</span>`;
    } else {
      const bandCls = row.chosen ? "g-band-chosen" : live ? "g-band" : "g-band-out";
      bar = `<span class="g-track${track.year ? "" : ` ${bandCls}`}">`;
      if (track.year && band && band[0] !== null && band[1] !== null) {
        bar += `<span class="g-track-band ${bandCls}" style="left:${(band[0] * 100).toFixed(2)}%;width:${Math.max((band[1] - band[0]) * 100, 1.5).toFixed(2)}%"></span>`;
      }
      bar += `<span class="g-track-dot ${row.chosen ? "is-chosen" : live ? "" : "is-out"}" style="left:${(marker * 100).toFixed(2)}%"></span></span>`;
    }
    const facts = [];
    if (num(row.last) !== null) facts.push(`cours ${priceText(row.last, row.currency)}`);
    if (num(row.low_12m) !== null && num(row.high_12m) !== null) {
      facts.push(`sur un an : de ${priceText(row.low_12m, row.currency)} à ${priceText(row.high_12m, row.currency)}`);
    }
    if (num(row.perf_12m) !== null) facts.push(`${pctText(row.perf_12m, { decimals: 0 })} sur un an`);
    const reason = !row.eligible && row.reason ? `Écarté : ${row.reason}.` : "";
    html += `<div class="g-range${row.chosen ? " is-chosen" : ""}${live ? "" : " is-out"}${open ? " is-open" : ""}" data-key="${esc(key)}" data-index="${index}">`
      + `<button type="button" class="g-range-row" data-open="${esc(key)}" aria-expanded="${open}" style="--i:${index}">`
      + `<span class="g-range-line"><span class="g-range-label">${esc(row.label)}`
      + (row.previous && !row.chosen ? ` <span class="g-mini-pill">hier</span>` : "")
      + (row.chosen ? ` <span class="g-mini-pill g-mini-pill-accent">cette semaine</span>` : "")
      + `</span><span class="g-col g-num">${esc(pullbackText(row.pullback_6m))}</span>`
      + `<span class="g-col g-num">${esc(pullbackText(row.pullback_12m))}</span></span>`
      + `<span class="g-range-bar" aria-hidden="true">${bar}</span>`
      + (extra ? `<span class="g-range-extra">${esc(extra)}</span>` : "")
      + `</button>`
      + `<div class="g-range-detail">`
      + (pick ? `<p class="g-range-text">${esc(pick.text)}</p>` : "")
      + (facts.length ? `<p class="g-range-facts">${esc(facts.join(" · "))}</p>` : "")
      + (reason ? `<p class="g-range-facts">${esc(reason)}</p>` : "")
      + (Array.isArray(row.closes) && row.closes.length > 1 ? `<div class="g-curve" data-curve></div>` : "")
      + `</div></div>`;
  });
  html += `<div class="g-legend">`
    + (hasYear ? `<span class="g-legend-item"><span class="g-key g-key-band"></span>six derniers mois</span>`
      + `<span class="g-legend-item"><span class="g-key g-key-track"></span>douze derniers mois</span>` : "")
    + `<span class="g-legend-item"><span class="g-key g-key-dot"></span>aujourd'hui</span>`
    + (rows.some((row) => row.chosen) ? `<span class="g-legend-item"><span class="g-key g-key-dot g-key-dot-chosen"></span>la somme de la semaine</span>` : "")
    + (excluded.length ? `<span class="g-legend-item"><span class="g-key g-key-hollow"></span>écarté</span>` : "")
    + `</div>`;
  html += `<p class="g-hint">Touche une ligne pour voir sa dernière année.</p>`;
  return html + tableBlock("ranges") + `</div>`;
}

// La mini-courbe d'un an d'une ligne ouverte : dessinée à l'ouverture seulement.
function drawCurve(row, width) {
  const closes = row.closes.map(num);
  const n = closes.length;
  const height = 150;
  const top = 34;
  const bottom = height - 24;
  const values = closes.filter((v) => v !== null);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low || high * 0.02 || 1) * 0.1;
  low -= pad;
  high += pad;
  const x = scale(0, n - 1, 2, width - 8);
  const y = scale(low, high, bottom, top);
  let svg = svgOpen(width, height);
  // Les six derniers mois, en léger fond : là où se lit la bande foncée de la piste.
  const half = Math.max(0, n - 126);
  svg += `<rect x="${x(half).toFixed(1)}" y="${top - 12}" width="${(x(n - 1) - x(half) + 6).toFixed(1)}" height="${(bottom - top + 12).toFixed(1)}" class="g-half-year" rx="6"/>`;
  svg += svgText(x(half) + 6, 12, "six derniers mois", { cls: "g-note" });
  const hi = values.indexOf(Math.max(...values));
  const lo = values.indexOf(Math.min(...values));
  const hiIndex = closes.findIndex((v) => v === values[hi]);
  const loIndex = closes.findIndex((v) => v === values[lo]);
  svg += `<path d="${areaPath(closes, x, y, bottom)}" class="g-area-own g-area-soft"/>`;
  svg += `<path d="${linePath(closes, x, y)}" class="g-line g-own g-draw" pathLength="1"/>`;
  const end = lastIndex(closes);
  svg += dot(x(end), y(closes[end]), "g-fill-own", 4);
  for (const [i, text] of [[hiIndex, `plus haut ${priceText(closes[hiIndex], row.currency)}`], [loIndex, `plus bas ${priceText(closes[loIndex], row.currency)}`]]) {
    if (i < 0) continue;
    const w = textWidth(text, 11.5);
    const px = clamp(x(i), w / 2 + 2, width - w / 2 - 2);
    // Le plus haut au-dessus de son point, le plus bas en dessous, sinon de l'autre côté.
    const py = i === hiIndex
      ? (y(closes[i]) - 7 >= 26 ? y(closes[i]) - 7 : y(closes[i]) + 15)
      : (y(closes[i]) + 15 <= bottom + 2 ? y(closes[i]) + 15 : y(closes[i]) - 7);
    svg += svgText(px, py, text, { cls: "g-note", anchor: "middle", halo: true });
  }
  svg += dateLabels(row.dates, x, 0, n - 1, height - 4, width);
  svg += cursorLayer(["g-fill-own"]);
  return { svg: svg + "</svg>", x, y, top, bottom };
}

function mountRangeCurve(item) {
  const holder = item.querySelector("[data-curve]");
  const element = item.closest(".chart");
  const spec = element && specs.get(element);
  const row = spec && spec.rows && spec.rows[Number(item.dataset.index)];
  if (!holder || !row || !Array.isArray(row.closes)) return;
  const width = Math.max(Math.round(holder.clientWidth || item.clientWidth), 200);
  const drawn = drawCurve(row, width);
  holder.innerHTML = plotFrame(drawn.svg, `${row.label} sur un an : de ${priceText(row.closes[0], row.currency)} à ${priceText(row.closes[row.closes.length - 1], row.currency)}.`);
  const plot = holder.querySelector(".g-plot");
  if (!reducedMotion()) {
    plot.classList.add("g-animate");
    setTimeout(() => plot.classList.remove("g-animate"), 1200);
  }
  const closes = row.closes.map(num);
  scrubber(plot, {
    count: closes.length,
    indexAt: (px) => drawn.x.invert(px),
    show: (i) => {
      if (closes[i] === null) return;
      placeCursor(plot, drawn.x(i), [{ y: drawn.y(closes[i]) }], drawn.top - 6, drawn.bottom);
      const last = closes[lastIndex(closes)];
      showTip(plot, drawn.x(i), longDay(row.dates[i]), [
        { key: "g-key-own", value: priceText(closes[i], row.currency), label: "cours" },
        { value: pctText((last / closes[i] - 1) * 100, { decimals: 1 }), label: "depuis ce jour" },
      ], { inside: true });
    },
    hide: () => hideTip(plot),
  });
}

function mountRanges(element, spec) {
  const root = element.querySelector(".g-ranges");
  if (!root) return;
  wireToggles(root);
  root.querySelectorAll(".g-range.is-open").forEach((item) => mountRangeCurve(item));
  animateOnce(root, spec);
  wireTable(root, () => ({
    head: ["Ligne", "Cours", "6 mois", "1 an"],
    rows: (spec.rows || []).map((row) => [row.label, priceText(row.last, row.currency),
      pullbackText(row.pullback_6m), pullbackText(row.pullback_12m)]),
  }));
}

// ====================================================================== ordres

function orderWords(spec) {
  const limit = priceText(spec.limit_price, spec.currency);
  if (spec.touched_on) {
    return { big: "Limite touchée", sub: `le ${longDay(spec.touched_on)}, à ${limit}` };
  }
  const distance = num(spec.distance_percent);
  const days = num(spec.days_left);
  const expiry = days === null ? "" : days <= 0 ? " · expire aujourd'hui" : days === 1 ? " · expire demain" : ` · expire dans ${days} jours`;
  if (distance === null) return { big: limit, sub: `ta limite${expiry}` };
  if (Math.abs(distance) < 0.05) return { big: "Sur la limite", sub: `le cours est à ${limit}${expiry}` };
  const direction = distance < 0 ? "baisser" : "monter";
  return { big: pctText(Math.abs(distance), { signed: false }), sub: `à ${direction} pour toucher ta limite de ${limit}${expiry}` };
}

function drawOrder(spec, width) {
  const closes = spec.closes.map(num);
  const n = closes.length;
  const limit = num(spec.limit_price);
  const paid = num(spec.purchase_price);
  const height = 200;
  const top = 18;
  const bottom = height - 24;
  const values = closes.filter((v) => v !== null);
  let low = Math.min(...values, limit);
  let high = Math.max(...values, limit);
  const freeBelow = limit - low <= high - limit;
  if (paid !== null) {
    low = Math.min(low, paid);
    high = Math.max(high, paid);
  }
  const pad = (high - low || Math.abs(limit) * 0.05 || 1) * 0.16;
  low -= pad;
  high += pad;
  const marks = ticks(low, high, 4);
  const labels = marks.map((v) => axisMoney(v, spec.currency, marks.step || 1));
  const labelWidth = Math.max(...labels.map((t) => textWidth(t, 12))) + 8;
  const right = width - labelWidth;
  const x = scale(0, n - 1, 4, right - 8);
  const y = scale(low, high, bottom, top);
  const touched = Boolean(spec.touched_on);
  const tone = touched ? "g-loss" : "g-own";
  let svg = svgOpen(width, height);
  marks.forEach((v, k) => {
    if (y(v) < top - 4 || y(v) > bottom + 2) return;
    svg += `<line x1="0" x2="${right.toFixed(1)}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="g-grid"/>`;
    svg += svgText(width, y(v) + 4, labels[k], { anchor: "end" });
  });
  svg += dateLabels(spec.dates, x, 0, n - 1, height - 6, right);
  const placed = num(spec.placed_index);
  const from = placed !== null && placed >= 0 ? placed : 0;
  // Ce qu'il reste à parcourir depuis la mise en place de l'ordre.
  svg += `<path d="${bandPath(closes, () => limit, x, y, from, n - 1)}" class="${touched ? "g-area-loss" : "g-area-own"}"/>`;
  svg += `<line x1="0" x2="${right.toFixed(1)}" y1="${y(limit).toFixed(1)}" y2="${y(limit).toFixed(1)}" class="g-limit"/>`;
  if (paid !== null) svg += `<line x1="0" x2="${right.toFixed(1)}" y1="${y(paid).toFixed(1)}" y2="${y(paid).toFixed(1)}" class="g-purchase"/>`;
  // Les étiquettes : chacune à la première place libre, sans en recouvrir une autre ni
  // couper la courbe ; sans place, elle se tait (la légende et la bulle la disent).
  const freeDy = freeBelow ? 15 : -7;
  const labels2 = [];
  const boxes = [];
  const curve = [];
  closes.forEach((v, i) => {
    if (v !== null) curve.push([x(i), y(v)]);
  });
  const boxOf = (px, py, text, anchor, size) => {
    const w = textWidth(text, size) + 4;
    const x0 = anchor === "start" ? px - 2 : anchor === "end" ? px - w + 2 : px - w / 2;
    return [x0, py - size + 1, x0 + w, py + 4];
  };
  const free = (b) => b[0] >= -1 && b[2] <= right + 1 && b[1] >= -2 && b[3] <= height - 17
    && !boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])
    && !curve.some(([px, py]) => px >= b[0] - 2 && px <= b[2] + 2 && py >= b[1] - 2 && py <= b[3] + 2);
  const place = (candidates, text, cls, size, forced = false) => {
    for (const [px, py, anchor] of candidates) {
      const box = boxOf(px, py, text, anchor, size);
      if (forced || free(box)) {
        boxes.push(box);
        labels2.push(svgText(px, py, text, { cls, anchor, halo: true }));
        return true;
      }
    }
    return false;
  };
  if (placed !== null && placed > 0) {
    const reachTop = freeBelow ? top - 6 : y(limit);
    const reachBottom = freeBelow ? y(limit) : bottom;
    svg += `<line x1="${x(placed).toFixed(1)}" x2="${x(placed).toFixed(1)}" y1="${reachTop.toFixed(1)}" y2="${reachBottom.toFixed(1)}" class="g-placed"/>`;
    const late = placed > 0.7 * (n - 1);
    const py = freeBelow ? top + 4 : bottom - 6;
    place([[x(placed) + (late ? -5 : 5), py, late ? "end" : "start"]], "ordre placé", "g-note", 11.5, true);
  }
  const closest = num(spec.closest_index);
  const closestDistance = num(spec.closest_distance_percent);
  if (!touched && closest !== null && closest >= 0 && closestDistance !== null && closes[closest] !== null) {
    svg += `<line x1="${x(closest).toFixed(1)}" x2="${x(closest).toFixed(1)}" y1="${y(closes[closest]).toFixed(1)}" y2="${y(limit).toFixed(1)}" class="g-leader"/>`;
    svg += dot(x(closest), y(closes[closest]), "g-fill-muted", 3.5);
    const anchor = closest > 0.75 * (n - 1) ? "end" : closest < 0.25 * (n - 1) ? "start" : "middle";
    place([[x(closest), y(limit) + freeDy, anchor]], `au plus près : ${pctText(Math.abs(closestDistance), { signed: false })}`, "g-note", 11.5, true);
  }
  // La limite : du côté libre, à gauche puis à droite ; sinon de l'autre côté du trait,
  // là où la courbe laisse la place.
  const ly = y(limit) + freeDy;
  const other = y(limit) + (freeBelow ? -7 : 15);
  place([[2, ly, "start"], [right - 2, ly, "end"], [right * 0.5, ly, "middle"], [2, other, "start"], [right - 2, other, "end"]],
    `limite ${priceText(limit, spec.currency)}`, "g-label", 12);
  if (paid !== null) {
    const text = `${spec.purchase_label || "ton prix d'achat"} ${priceText(paid, spec.currency)}`;
    const below = y(paid) + 15;
    const above = y(paid) - 6;
    place([[2, below, "start"], [2, above, "start"], [right - 2, below, "end"], [right - 2, above, "end"]], text, "g-label", 12);
  }
  svg += `<path d="${linePath(closes, x, y)}" class="g-line ${tone} g-draw" pathLength="1"/>`;
  const end = lastIndex(closes);
  svg += dot(x(end), y(closes[end]), touched ? "g-fill-loss" : "g-fill-own", 4.5);
  svg += labels2.join("");
  svg += cursorLayer([touched ? "g-fill-loss" : "g-fill-own"]);
  return { svg: svg + "</svg>", x, y, top, bottom, closes, limit };
}

function orderSummary(spec) {
  const words = orderWords(spec);
  return `Ton ordre de ${spec.side || ""} ${spec.name || ""} : ${words.big}, ${words.sub}. Cours actuel ${priceText(spec.last, spec.currency)}.`;
}

function renderOrder(spec) {
  if (!Array.isArray(spec.closes) || spec.closes.length < 2 || num(spec.limit_price) === null) return "";
  const words = orderWords(spec);
  const drawn = drawOrder(spec, DEFAULT_WIDTH);
  const legend = `<div class="g-legend"><span class="g-legend-item"><span class="g-key ${spec.touched_on ? "g-key-loss" : "g-key-own"}"></span>cours</span>`
    + `<span class="g-legend-item"><span class="g-key g-key-limit"></span>ta limite</span>`
    + (num(spec.purchase_price) !== null ? `<span class="g-legend-item"><span class="g-key g-key-purchase"></span>ton prix d'achat</span>` : "")
    + `</div>`;
  return `<div class="g g-order"><div class="g-head"><div class="g-summary"><div class="g-big g-big-order${spec.touched_on ? " is-touched" : ""}">${esc(words.big)}</div>`
    + `<p class="g-sub">${esc(words.sub)}</p></div></div>`
    + plotFrame(drawn.svg, orderSummary(spec)) + legend + tableBlock("order") + `</div>`;
}

function mountOrder(element, spec) {
  const root = element.querySelector(".g-order");
  if (!root) return;
  const width = Math.max(Math.round(root.clientWidth), 200);
  const drawn = drawOrder(spec, width);
  const plot = freshPlot(root.querySelector(".g-plot"), drawn.svg, orderSummary(spec));
  const buy = String(spec.side || "").toLowerCase().startsWith("achat");
  scrubber(plot, {
    count: drawn.closes.length,
    indexAt: (px) => drawn.x.invert(px),
    show: (i) => {
      const close = drawn.closes[i];
      if (close === null) return;
      placeCursor(plot, drawn.x(i), [{ y: drawn.y(close) }], drawn.top - 6, drawn.bottom);
      const gap = (drawn.limit / close - 1) * 100;
      const reached = (buy && close <= drawn.limit) || (!buy && close >= drawn.limit);
      const words = reached ? "la limite est atteinte ce jour-là"
        : `à ${pctText(Math.abs(gap), { signed: false })} de ta limite (à ${gap < 0 ? "baisser" : "monter"})`;
      const day = longDay(spec.dates[i]);
      readout(root.querySelector(".g-summary"),
        `<div class="g-big g-big-order g-reading"><span class="g-key ${spec.touched_on ? "g-key-loss" : "g-key-own"}" aria-hidden="true"></span>${esc(priceText(close, spec.currency))}</div>`
        + `<p class="g-sub"><strong>${esc(day)}</strong> · ${esc(words)}</p>`,
        `${day} : cours ${priceText(close, spec.currency)}, ${words}`, plot);
    },
    hide: () => {
      hideCursor(plot);
      restore(root.querySelector(".g-summary"));
    },
  });
  animateOnce(plot, spec);
  wireTable(root, () => {
    const rows = [];
    for (let i = drawn.closes.length - 1; i >= 0; i -= 1) rows.push([shortDay(spec.dates[i]), priceText(drawn.closes[i], spec.currency)]);
    return { head: ["Séance", "Cours"], rows };
  });
}

// ====================================================================== crypto

function drawCoin(coin, width, { washed }) {
  const closes = coin.closes.map(num);
  const average = (coin.average || []).map(num);
  const sides = coin.sides || [];
  const n = closes.length;
  const height = 64;
  const top = 6;
  const bottom = height - 6;
  const values = closes.filter((v) => v !== null).concat(average.filter((v) => v !== null));
  let low = Math.min(...values);
  let high = Math.max(...values);
  const paid = num(coin.purchase_price);
  let edge = null;
  if (paid !== null) {
    const reach = (high - low) * 0.3;
    if (paid >= low - reach && paid <= high + reach) {
      low = Math.min(low, paid);
      high = Math.max(high, paid);
    } else {
      edge = paid < low ? "below" : "above";
    }
  }
  const pad = (high - low || high * 0.02 || 1) * 0.08;
  const x = scale(0, n - 1, 2, width - 7);
  const y = scale(low - pad, high + pad, bottom, top);
  let svg = svgOpen(width, height);
  if (washed) {
    // Entre le cours et sa tendance : bleu au-dessus, rouge en dessous.
    for (const side of ["AU_DESSUS", "EN_DESSOUS"]) {
      let d = "";
      let i = 0;
      while (i < n) {
        if (sides[i] !== side) {
          i += 1;
          continue;
        }
        const start = i;
        while (i < n && sides[i] === side) i += 1;
        d += bandPath(closes, (k) => average[k], x, y, Math.max(start - 1, 0), i - 1);
      }
      if (d) svg += `<path d="${d}" class="${side === "AU_DESSUS" ? "g-area-own" : "g-area-loss"}"/>`;
    }
  }
  svg += `<path d="${linePath(average, x, y)}" class="g-line g-trend${washed ? "" : " g-trend-light"}"/>`;
  if (paid !== null && edge === null) {
    svg += `<line x1="0" x2="${width}" y1="${y(paid).toFixed(1)}" y2="${y(paid).toFixed(1)}" class="g-purchase g-purchase-thin"/>`;
  }
  // Le cours, morceau par morceau selon son côté de la règle (comme l'image du mail).
  let i = 0;
  while (i < n) {
    const side = sides[i] || "";
    const start = i;
    while (i < n && (sides[i] || "") === side) i += 1;
    const cls = side === "AU_DESSUS" ? "g-own" : side === "EN_DESSOUS" ? "g-loss" : "g-neutral";
    svg += `<path d="${linePath(closes, x, y, Math.max(start - 1, 0), i - 1)}" class="g-line ${cls} g-line-thin"/>`;
  }
  const end = lastIndex(closes);
  const lastSide = sides[end] || "";
  svg += dot(x(end), y(closes[end]), lastSide === "EN_DESSOUS" ? "g-fill-loss" : lastSide === "AU_DESSUS" ? "g-fill-own" : "g-fill-muted", 3.5);
  if (edge) {
    svg += svgText(4, edge === "below" ? bottom + 2 : top + 8, edge === "below" ? "achat ↓" : "achat ↑", { cls: "g-note g-label-purchase", halo: true });
  }
  svg += cursorLayer(["g-fill-muted"]);
  return { svg: svg + "</svg>", x, y, top, bottom, closes, average };
}

function renderCrypto(spec, ctx = {}) {
  const coins = (spec.coins || []).filter((coin) => coin && coin.name);
  if (!coins.length) return "";
  const days = num(spec.ma_days);
  const trend = days ? `tendance de ${days}${NBSP}jours` : "tendance";
  const who = spec.led ? "bitcoin " : "";
  let html = `<div class="g g-crypto">`;
  if (num(spec.total_value) !== null) {
    html += `<p class="g-sub g-crypto-total"><strong>${esc(moneyText(spec.total_value, "EUR"))}</strong> au total`
      + (num(spec.gain_percent) !== null ? ` · ${esc(pctText(spec.gain_percent, { decimals: 0 }))} depuis l'achat` : "") + `</p>`;
  }
  html += `<div class="g-crypto-head" aria-hidden="true"><span>six derniers mois</span><span>depuis l'achat</span></div>`;
  coins.forEach((coin, index) => {
    const priced = Array.isArray(coin.closes) && coin.closes.length > 1;
    const washed = priced && (!spec.led || coin.leader);
    const drawn = priced ? drawCoin(coin, 170, { washed }) : null;
    const label = priced
      ? `${coin.name} sur six mois : ${priceText(coin.closes[coin.closes.length - 1], coin.currency)}, ${coin.rule_state === "EN_DESSOUS" ? "sous" : "au-dessus de"} sa tendance.`
      : `${coin.name} : cours indisponible.`;
    html += `<div class="g-coin" data-index="${index}" style="--i:${index}">`
      + `<div class="g-coin-plot">${drawn ? plotFrame(drawn.svg, label) : `<p class="g-track-missing">cours indisponible</p>`}</div>`
      + `<div class="g-coin-side"><div class="g-coin-line"><strong class="g-coin-name">${esc(coin.label || coin.name)}</strong>`
      + `<strong class="g-coin-gain">${esc(num(coin.gain_percent) === null ? "—" : pctText(coin.gain_percent, { decimals: 0 }))}</strong></div>`
      + `<div class="g-coin-line">${pill(coin.tag, ctx.styles)}<span class="g-coin-value">${esc(num(coin.value) === null ? "" : moneyText(coin.value, "EUR", { decimals: Math.abs(num(coin.value)) >= 10 ? 0 : 2 }))}</span></div></div>`
      + `</div>`;
  });
  html += `<div class="g-legend"><span class="g-legend-item"><span class="g-key g-key-trend"></span>${esc(trend)}</span>`
    + `<span class="g-legend-item"><span class="g-key g-key-own"></span>${who}au-dessus</span>`
    + `<span class="g-legend-item"><span class="g-key g-key-loss"></span>${who}en dessous</span>`
    + (coins.some((coin) => num(coin.purchase_price) !== null) ? `<span class="g-legend-item"><span class="g-key g-key-purchase"></span>ton prix d'achat</span>` : "")
    + `</div>`;
  return html + tableBlock("crypto") + `</div>`;
}

function mountCrypto(element, spec) {
  const root = element.querySelector(".g-crypto");
  if (!root) return;
  const coins = (spec.coins || []).filter((coin) => coin && coin.name);
  // Toutes les petites courbes ont la même largeur : une seule mesure (pas de mise en page forcée à chaque ligne).
  const first = root.querySelector(".g-coin-plot");
  const width = Math.max(Math.round(first ? first.clientWidth : 0), 120);
  root.querySelectorAll(".g-coin").forEach((row) => {
    const coin = coins[Number(row.dataset.index)];
    const holder = row.querySelector(".g-coin-plot");
    if (!coin || !Array.isArray(coin.closes) || coin.closes.length < 2 || !holder) return;
    const drawn = drawCoin(coin, width, { washed: !spec.led || coin.leader });
    const plot = freshPlot(holder.querySelector(".g-plot"), drawn.svg, holder.querySelector(".g-plot").getAttribute("aria-label"));
    scrubber(plot, {
      count: drawn.closes.length,
      indexAt: (px) => drawn.x.invert(px),
      show: (i) => {
        const close = drawn.closes[i];
        if (close === null) return;
        placeCursor(plot, drawn.x(i), [{ y: drawn.y(close) }], drawn.top, drawn.bottom);
        const side = (coin.sides || [])[i];
        const words = side === "AU_DESSUS" ? "au-dessus" : side === "EN_DESSOUS" ? "en dessous" : "";
        const day = longDay(coin.dates[i]);
        const trend = drawn.average[i] === null ? "" : priceText(drawn.average[i], coin.currency);
        readout(row.querySelector(".g-coin-side"),
          `<div class="g-coin-line"><strong class="g-coin-name">${esc(coin.label || coin.name)}</strong>`
          + `<strong class="g-coin-gain g-reading"><span class="g-key ${side === "EN_DESSOUS" ? "g-key-loss" : "g-key-own"}" aria-hidden="true"></span>`
          + `${esc(priceText(close, coin.currency))}</strong></div>`
          + `<div class="g-coin-line g-coin-reading">${esc(day)}${words ? ` · ${esc(words)}` : ""}</div>`
          + (trend ? `<div class="g-coin-line g-coin-reading"><span class="g-key g-key-trend" aria-hidden="true"></span>tendance ${esc(trend)}</div>` : ""),
          `${coin.name}, ${day} : ${priceText(close, coin.currency)}${trend ? `, tendance ${trend}` : ""}${words ? `, ${spec.led && !coin.leader ? "bitcoin " : ""}${words}` : ""}`,
          plot);
      },
      hide: () => {
        hideCursor(plot);
        restore(row.querySelector(".g-coin-side"));
      },
    });
  });
  animateOnce(root, spec);
  wireTable(root, () => ({
    head: ["Crypto", "Cours", "Tendance", "Gain"],
    rows: coins.map((coin) => {
      const closes = (coin.closes || []).map(num);
      const average = (coin.average || []).map(num);
      const end = lastIndex(closes);
      return [coin.name, end >= 0 ? priceText(closes[end], coin.currency) : "—", end >= 0 ? priceText(average[end], coin.currency) : "—",
        pctText(coin.gain_percent, { decimals: 0 })];
    }),
  }));
}

// ====================================================================== branchement

const RENDERERS = {
  portfolio: [renderPortfolio, mountPortfolio],
  positions: [renderPositions, mountPositions],
  ranges: [renderRanges, mountRanges],
  order: [renderOrder, mountOrder],
  crypto: [renderCrypto, mountCrypto],
};

// render(spec, ctx) -> HTML (ou "" : l'image du mail reste). ctx : { filename, title, styles, picks }.
export function renderChart(spec, ctx = {}) {
  const entry = spec && RENDERERS[spec.type];
  if (!entry) return "";
  return entry[0](spec, ctx);
}

// Une fois dans la page : la vraie largeur, le doigt, les périodes, les tableaux.
export function mountChart(element, spec) {
  const entry = spec && RENDERERS[spec.type];
  if (!entry) return;
  specs.set(element, spec);
  element.dataset.mounted = String(Math.round(element.clientWidth));
  entry[1](element, spec);
}

// Les chiffres qui s'animent à l'ouverture : la valeur du portefeuille arrive en
// glissant depuis un peu plus bas, une fois par ouverture de l'appli.
let numbersDone = false;
export function animateNumbers(root) {
  if (numbersDone || reducedMotion() || !root) return;
  const targets = root.querySelectorAll("[data-count]");
  if (!targets.length) return;
  numbersDone = true;
  for (const target of targets) {
    const final = target.textContent;
    const match = /^(\D*?)(\d[\d   ]*\d|\d)(,\d+)?(.*)$/.exec(final);
    if (!match) continue;
    const whole = Number(match[2].replace(/[\s  ]/g, ""));
    if (!Number.isFinite(whole) || whole < 10) continue;
    const startValue = whole * 0.97;
    const started = performance.now();
    const duration = 700;
    const step = (now) => {
      const t = Math.min((now - started) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      if (t >= 1) {
        target.textContent = final;
        return;
      }
      const value = Math.round(startValue + (whole - startValue) * eased);
      target.textContent = `${match[1]}${fr(value, 0)}${match[3] || ""}${match[4]}`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// Tourner l'iPhone ou changer la taille du texte : chaque graphique se redessine
// à sa nouvelle largeur.
let resizeTimer = null;
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll(".chart[data-chart]").forEach((element) => {
        const spec = specs.get(element);
        if (!spec || Math.abs(Number(element.dataset.mounted || 0) - element.clientWidth) < 2) return;
        try {
          mountChart(element, spec);
        } catch {
          /* le dessin précédent reste */
        }
      });
    }, 150);
  });
}

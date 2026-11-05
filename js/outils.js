// Petits outils partagés : texte sûr, montants et dates en français, stockage.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Texte sûr pour le HTML. Au passage, une espace insécable devant « % », « € », « : »…
// pour que « 10 % » ou « 100 € » ne soient jamais coupés en fin de ligne.
export function esc(value) {
  return String(value ?? "")
    .replace(/ (?=[%€:;?!»]|\$ CA|\$(?!\w)|CHF\b)/g, "\u00a0")
    .replace(/« /g, "«\u00a0")
    .replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Les pastilles du mail (« GARDER », « EN ATTENTE »…) : les couleurs viennent de
// donnees.json (styles.tags), pensées pour un fond clair. En thème sombre, chaque
// encre a sa version choisie (fond sombre de la même famille, encre claire), validée
// à 4,5:1 au moins ; une encre inconnue prend un neutre.
const DARK_PILLS = {
  "#146c3a": ["#173a26", "#8ee0ab"],
  "#8a5a00": ["#3d2d0b", "#f3c66f"],
  "#a32a22": ["#45201d", "#f6a59d"],
  "#52514e": ["#2e2e2c", "#d9d7cf"],
  "#898781": ["#2a2a28", "#b3b1a9"],
};
const DEFAULT_PILL = ["#eef0f3", "#52514e"];

export function pill(label, styles = {}) {
  const text = String(label ?? "");
  if (!text) return "";
  const [background, ink] = ((styles && styles.tags) || {})[text] || (styles && styles.default_tag) || DEFAULT_PILL;
  const [darkBackground, darkInk] = DARK_PILLS[String(ink).toLowerCase()] || ["#2e2e2c", "#e6e4dc"];
  const colours = [background, ink, darkBackground, darkInk].map((c) => (/^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : "#888888"));
  return `<span class="pill" style="--pill-bg:${colours[0]};--pill-ink:${colours[1]};--pill-bg-dark:${colours[2]};--pill-ink-dark:${colours[3]}">${esc(text)}</span>`;
}

const NBSP = " ";
const SYMBOLS = { EUR: "€", USD: "$", CAD: "$ CA", CHF: "CHF" };

export function currencySymbol(currency) {
  const code = String(currency || "").toUpperCase();
  return SYMBOLS[code] || code;
}

// « 1 234,5 » : un nombre à la française, sans zéros inutiles.
export function number(value, maxDecimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("fr-FR", { maximumFractionDigits: maxDecimals, minimumFractionDigits: 0 });
  return text.replace(/ /g, NBSP);
}

// « 100 € », « 16 830,50 € », « 57 $ CA » : comme le mail (_money_short).
export function money(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  let text = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, NBSP);
  if (text.endsWith(",00")) text = text.slice(0, -3);
  return `${text}${NBSP}${currencySymbol(currency)}`;
}

// Prix unitaire : jusqu'à 4 décimales (un ETF à 16,30 €, une crypto à 0,6123 $).
export function price(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const decimals = Math.abs(n) < 10 ? 4 : 2;
  const text = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: decimals }).replace(/ /g, NBSP);
  return `${text}${NBSP}${currencySymbol(currency)}`;
}

// Ce qu'Alexis tape : « 0,5 », « 1 234,56 », « 1234.56 ». null si ce n'est pas un nombre.
export function parseDecimal(raw) {
  let text = String(raw ?? "").trim().replace(/[\s  ']/g, "");
  if (!text) return null;
  if (text.includes(",") && text.includes(".")) {
    // « 1.234,56 » ou « 1,234.56 » : le dernier séparateur est la virgule décimale.
    const last = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
    text = text.slice(0, last).replace(/[.,]/g, "") + "." + text.slice(last + 1);
  } else {
    text = text.replace(",", ".");
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
  "septembre", "octobre", "novembre", "décembre"];
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function parseDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// « 4 novembre » (« 4 novembre 2025 » si ce n'est pas l'année en cours).
export function dayWords(iso) {
  const day = parseDay(iso);
  if (!day) return String(iso || "");
  const year = day.getFullYear() === new Date().getFullYear() ? "" : ` ${day.getFullYear()}`;
  return `${day.getDate() === 1 ? "1er" : day.getDate()} ${MONTHS[day.getMonth()]}${year}`;
}

export function longDayWords(iso) {
  const day = parseDay(iso);
  if (!day) return String(iso || "");
  return `${DAYS[day.getDay()]} ${dayWords(iso)}`;
}

export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// « à l'instant », « il y a 5 min », « il y a 2 h », « hier à 7 h 45 », « le 3 novembre ».
export function sinceWords(isoDateTime, now = new Date()) {
  const then = new Date(isoDateTime);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay || hours < 6) return `il y a ${hours} h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const clock = `${then.getHours()} h ${String(then.getMinutes()).padStart(2, "0")}`;
  if (then.toDateString() === yesterday.toDateString()) return `hier à ${clock}`;
  const pad = (n) => String(n).padStart(2, "0");
  return `le ${dayWords(`${then.getFullYear()}-${pad(then.getMonth() + 1)}-${pad(then.getDate())}`)}`;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// localStorage peut manquer (navigation privée, stockage plein) : jamais d'exception.
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* rien à faire */
    }
  },
};

export function isStandalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function isDemo() {
  try {
    return new URLSearchParams(location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

// Les cartes du mail, reprises telles quelles depuis `summary`
// (engines/message_layout.py fait la même chose pour le mail).

import { TABS } from "./config.js";
import { esc, longDayWords, pill, sinceWords } from "./outils.js";

const DEFAULT_TONES = { buy: "#8fe3ad", wait: "#c9c7c0", alert: "#ffcd6b", review: "#9ec2ff" };

// ---------------------------------------------------------------- graphiques
// Point d'accroche des graphiques. Aujourd'hui, chaque figure est l'image PNG du mail.
// Demain, si donnees.json porte un bloc `charts` indexé par nom de fichier et qu'un
// dessinateur est branché par setChartRenderer, la figure devient un graphique SVG
// interactif ; l'image PNG reste le repli (bloc absent, dessin raté).
let chartRenderer = null;

// render(spec, { filename, title, styles, picks }) -> HTML (ou "" pour garder l'image) ;
// il met `merged` à vrai dans ce contexte quand il reprend toute la liste `picks`.
// mount(element, spec) -> branche les gestes une fois la figure dans la page.
export function setChartRenderer(render, mount = null, helpers = {}) {
  chartRenderer = render ? { render, mount, ...helpers } : null;
}

export function mountFigures(root, data) {
  if (!chartRenderer || !chartRenderer.mount || !root) return;
  for (const element of root.querySelectorAll("[data-chart]")) {
    const spec = data && data.charts && data.charts[element.dataset.chart];
    try {
      if (spec) chartRenderer.mount(element, spec);
    } catch {
      /* un graphique qui ne se branche pas reste lisible tel quel */
    }
  }
}

export class Renderer {
  constructor(data) {
    this.data = data || {};
    this.images = this.data.images || {};
    this.charts = this.data.charts || {};
    this.styles = this.data.styles || {};
    this.actions = this.data.actions || {};
  }

  tag(label) {
    return pill(label, this.styles);
  }

  // Toutes les figures passent par ici (voir setChartRenderer).
  renderFigure(filename, title) {
    return this.figure(filename, title).html;
  }

  // La figure, et si le graphique a repris la liste de la carte (`merged`).
  figure(filename, title, extra = {}) {
    const spec = this.charts[filename];
    if (spec && chartRenderer) {
      try {
        const context = { filename, title, styles: this.styles, ...extra };
        const html = chartRenderer.render(spec, context);
        if (html) {
          return {
            html: `<figure class="chart" data-chart="${esc(filename)}" aria-label="${esc(title || "")}">${html}</figure>`,
            chart: true,
            merged: Boolean(context.merged),
            ownCaption: Boolean(context.ownCaption),
          };
        }
      } catch {
        /* repli sur l'image */
      }
    }
    return { html: this.picture(filename, title), chart: false, merged: false };
  }

  picture(filename, title) {
    const source = this.images[filename];
    if (!source) return "";
    return `<button type="button" class="figure" data-action="zoom" data-image="${esc(filename)}" aria-label="Agrandir : ${esc(title || "graphique")}">`
      + `<img src="${esc(source)}" alt="${esc(title || "")}" loading="lazy" decoding="async"></button>`;
  }

  hero(decision, { withButtons = false } = {}) {
    const d = decision || {};
    const tones = { ...DEFAULT_TONES, ...(this.styles.tones || {}) };
    const colour = tones[d.tone] || tones.wait;
    let html = `<section class="hero hero-${esc(d.tone || "wait")}" aria-label="Décision du jour">`;
    if (d.kicker) html += `<div class="hero-kicker" style="color:${esc(colour)}"><span class="hero-dot" style="background:${esc(colour)}"></span>${esc(d.kicker)}</div>`;
    html += `<h2 class="hero-title">${esc(d.title || "AlphaScope")}</h2>`;
    if (d.lead) html += `<p class="hero-lead">${esc(d.lead)}</p>`;
    if (d.todo) html += `<p class="hero-todo"><strong>À faire :</strong> ${esc(d.todo)}</p>`;
    if (d.detail) html += `<p class="hero-detail">${esc(d.detail)}</p>`;
    if (withButtons) {
      html += `<div class="hero-buttons">`;
      if (this.actions.decision) html += `<button type="button" class="button button-light" data-action="achat-decision">J'ai acheté</button>`;
      html += `<button type="button" class="button button-ghost" data-action="saisie">Noter un achat ou une vente</button>`;
      html += `</div>`;
    }
    return html + `</section>`;
  }

  pair(item) {
    if (Array.isArray(item)) return [item[0], item[1]];
    if (item && typeof item === "object") return [item.label ?? item.tag ?? "", item.value ?? item.text ?? ""];
    return ["", item];
  }

  items(section) {
    const kind = section.kind;
    const items = section.items || [];
    if (kind === "figures" || kind === "kpis") {
      if (!items.length) return "";
      return `<div class="kpis">` + items.map((item) => {
        const [label, value] = this.pair(item);
        return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div>`;
      }).join("") + `</div>`;
    }
    if (kind === "orders") {
      const known = new Map((this.actions.orders || []).map((order) => [String(order.id), order]));
      return items.map((item) => {
        const facts = (item.facts || []).map(esc).join(" · ");
        let block = `<div class="order">`;
        block += `<div class="order-head">${this.tag(item.tag)} <strong>${esc(item.title)}</strong></div>`;
        if (facts) block += `<div class="order-facts">${facts}</div>`;
        if (item.advice) block += `<div class="order-advice">${esc(item.advice)}</div>`;
        if (item.image) block += this.renderFigure(item.image, item.title);
        if (item.order_id && known.has(String(item.order_id))) {
          block += `<button type="button" class="button button-secondary" data-action="ordre" data-order="${esc(item.order_id)}">Exécuté ?</button>`;
        }
        return block + `</div>`;
      }).join("");
    }
    if (kind === "families") {
      if (section.rows_in_html === false) return "";
      return `<div class="rows">` + items.map((item) => {
        const chosen = item.chosen ? " row-chosen" : "";
        return `<div class="row${chosen}"><div class="row-label">${esc(item.label)}</div>`
          + `<div class="row-text">${esc(item.text)}${item.chosen ? " ←" : ""}</div></div>`;
      }).join("") + `</div>`;
    }
    if (kind === "picks") {
      return `<div class="picks">` + items.map((item) => (
        `<div class="pick"><strong>${esc(item.name)}</strong> : ${esc(item.text)}</div>`
      )).join("") + `</div>`;
    }
    if (kind === "tagged") {
      return items.map((item) => {
        const [tag, text] = this.pair(item);
        return `<div class="tagged">${this.tag(tag)} ${esc(text)}</div>`;
      }).join("");
    }
    if (kind === "news") {
      return `<ul class="list">` + items.map((item) => (
        `<li><strong>${esc(item.theme)}</strong> — ${esc(item.title)}`
        + (item.source ? ` <span class="muted">(${esc(item.source)})</span>` : "") + `</li>`
      )).join("") + `</ul>`;
    }
    const strong = section.strong ? " list-strong" : "";
    return `<ul class="list${strong}">` + items.map((item) => `<li>${esc(item)}</li>`).join("") + `</ul>`;
  }

  card(title, inner, note, extra = "") {
    return `<section class="card">`
      + (title ? `<h3 class="card-title">${esc(title)}</h3>` : "")
      + inner
      + extra
      + (note ? `<p class="card-note">${esc(note)}</p>` : "")
      + `</section>`;
  }

  section(section) {
    if (section.kind === "image") {
      const item = (section.items || [{}])[0] || {};
      return this.card(section.title, this.renderFigure(item.filename, item.title), section.note);
    }
    let heads = "";
    if (section.lead && section.lead_tag) {
      heads += `<p class="lead-tagged">${this.tag(section.lead_tag)} ${esc(section.lead)}</p>`;
    } else if (section.lead) {
      heads += `<p class="lead">${esc(section.lead)}</p>`;
    }
    for (const extra of section.subleads || []) {
      if (extra.tag) heads += `<p class="lead-tagged">${this.tag(extra.tag)} ${esc(extra.text)}</p>`;
      else heads += `<p class="sublead">${esc(extra.text)}</p>`;
    }
    // La liste des ETF ou des actions et sa figure : quand le graphique interactif
    // reprend chaque ligne de la liste (sa phrase s'ouvre au toucher), la liste
    // n'est pas répétée en dessous.
    const picks = section.kind === "picks" ? section.items || [] : null;
    const key = section.image || (section.id === "actions" && this.charts.actions ? "actions" : null);
    const figure = key ? this.figure(key, section.image_title || section.title, picks ? { picks } : {}) : null;
    const first = figure && (section.image_first || !section.image);
    if (first) heads += figure.html;
    let inner = heads + (figure && figure.merged ? "" : this.items(section));
    for (const line of section.after || []) inner += `<p class="after">${esc(line)}</p>`;
    if (figure && !first) inner += figure.html;
    for (const picture of section.images || []) {
      const [filename, title, caption] = Array.isArray(picture) ? picture : [picture.filename, picture.title, picture.caption];
      const figure = this.figure(filename, title);
      // La légende du mail décrit l'image ; un graphique qui dit lui-même sa période s'en passe.
      if (caption && !figure.ownCaption) inner += `<p class="caption">${esc(caption)}</p>`;
      inner += figure.html;
    }
    return this.card(section.title, inner, section.note, this.sectionButtons(section));
  }

  // Les boutons de saisie propres à une carte : la cagnotte crypto.
  sectionButtons(section) {
    const pot = this.actions.crypto_pot;
    if (section.id !== "crypto" || !pot || !(Number(pot.pending_eur) > 0)) return "";
    return `<div class="card-buttons">`
      + `<button type="button" class="button button-primary" data-action="versement">Versement fait</button>`
      + `<button type="button" class="button button-secondary" data-action="versement-saute">Je saute ce versement</button>`
      + `</div>`;
  }

  // Les sections d'un onglet, dans l'ordre du mail.
  sectionsFor(tabId, summary = this.data.summary) {
    const sections = (summary && summary.sections) || [];
    const placed = new Set(TABS.flatMap((tab) => tab.sections));
    const tab = TABS.find((t) => t.id === tabId);
    return sections.filter((section) => {
      if (!section.id || !placed.has(section.id)) return tabId === "aujourdhui";
      return tab && tab.sections.includes(section.id);
    });
  }

  // Les comptes à reconfirmer : tant qu'ils ne le sont pas, aucune proposition d'achat.
  accountsCard() {
    const due = ((this.actions.confirmations) || []).filter((c) => c && c.due);
    if (!due.length) return "";
    const late = due.some((c) => c.stale || Number(c.days_left) < 0);
    const one = due.length === 1;
    return `<button type="button" class="accounts-card${late ? " accounts-card-late" : ""}" data-action="comptes">`
      + `<span class="accounts-text"><span class="accounts-kicker">Mes comptes</span>`
      + `<span class="accounts-title">${due.length} compte${one ? "" : "s"} à reconfirmer</span>`
      + `<span class="accounts-lead">Tant qu'${one ? "il n'est pas confirmé" : "ils ne sont pas confirmés"}, AlphaScope ne propose aucun achat.</span></span>`
      + `<span class="weekly-chevron" aria-hidden="true">›</span></button>`;
  }

  // L'onglet « Aujourd'hui » : le bilan du dimanche, les comptes à reconfirmer, la décision,
  // les cartes du jour, le journal.
  today(pending, verdicts = []) {
    const summary = this.data.summary;
    let html = "";
    if (!summary) {
      // Le calcul a tourné mais le rapport du jour a échoué : on le dit, sans inventer de décision.
      html += this.accountsCard();
      html += this.hero({
        kicker: "", tone: "alert", title: "Pas de décision ce matin",
        lead: "Le calcul du jour n'a pas abouti. Le mail en dit plus ; l'appli se mettra à jour au prochain calcul.",
      }, { withButtons: true });
      html += this.journal(pending, verdicts);
      return html + `<p class="footer">AlphaScope ne passe aucun ordre à ta place.</p>`;
    }
    if (this.data.stale_summary) {
      html += `<div class="banner banner-warn" role="status">Pas de nouveau rapport ce matin : voici les dernières infos du `
        + `${esc(longDayWords(this.data.stale_summary.report_date))}.</div>`;
    }
    if (this.data.weekly) {
      const weekly = this.data.weekly.decision || {};
      html += `<button type="button" class="weekly-card" data-action="bilan">`
        + `<span class="weekly-text"><span class="weekly-kicker">Bilan de la semaine</span>`
        + `<span class="weekly-title">${esc(weekly.title || "Ta semaine en un coup d'œil")}</span></span>`
        + `<span class="weekly-chevron" aria-hidden="true">›</span></button>`;
    }
    html += this.accountsCard();
    html += this.hero(summary.decision || {
      kicker: "", title: summary.action_label || "AlphaScope", lead: summary.headline || "",
      detail: summary.instruction || "", todo: "", tone: "wait",
    }, { withButtons: true });
    const sections = this.sectionsFor("aujourdhui");
    const notes = sections.filter((s) => s.id === "a_noter");
    for (const section of sections.filter((s) => s.id !== "a_noter")) html += this.section(section);
    html += this.journal(pending, verdicts);
    for (const section of notes) html += this.section(section);
    html += `<p class="footer">AlphaScope ne passe aucun ordre à ta place.</p>`;
    return html;
  }

  // La valeur totale en grand, en tête de l'onglet Portefeuille, avec la variation
  // de la dernière séance et la petite courbe des trente dernières ; la carte garde le reste.
  portfolioTotal(section) {
    const items = (section && section.items) || [];
    if (!items.length) return { html: "", rest: section };
    const [, value] = this.pair(items[0]);
    const extra = items.slice(1).map((item) => {
      const [label, amount] = this.pair(item);
      return `<div class="total-line"><span>${esc(label)}</span><span class="total-line-value">${esc(amount)}</span></div>`;
    }).join("");
    const spec = this.charts["portefeuille.png"];
    const move = chartRenderer && chartRenderer.lastMove ? chartRenderer.lastMove(spec, this.data.report_date) : null;
    const spark = chartRenderer && chartRenderer.sparkline ? chartRenderer.sparkline(spec) : "";
    let moveHtml = "";
    if (move) {
      const tone = move.amount > 0.5 ? "up" : move.amount < -0.5 ? "down" : "flat";
      const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "";
      const amount = chartRenderer.money(move.amount, move.currency, { signed: true, decimals: Math.abs(move.amount) >= 10 ? 0 : 2 });
      moveHtml = `<div class="total-move total-move-${tone}"><span class="total-move-amount">`
        + (arrow ? `<span class="g-arrow" aria-hidden="true">${arrow}</span>` : "")
        + `${esc(amount)}${Math.abs(move.percent) >= 0.05 ? ` (${esc(chartRenderer.percent(move.percent))})` : ""}</span> `
        + `<span class="total-move-words">${esc(move.words)}</span></div>`;
    }
    const html = `<section class="total" aria-label="Valeur de ton portefeuille">`
      + `<div class="total-label">Valeur totale</div>`
      + `<div class="total-row"><div class="total-main"><div class="total-value" data-count>${esc(value)}</div>${moveHtml}</div>`
      + (spark ? `<div class="total-spark">${spark}</div>` : "") + `</div>`
      + (extra ? `<div class="total-lines">${extra}</div>` : "")
      + `</section>`;
    return { html, rest: { ...section, items: [] } };
  }

  tab(tabId) {
    const sections = this.sectionsFor(tabId);
    let html = "";
    for (const section of sections) {
      if (tabId === "portefeuille" && section.id === "portefeuille" && section.kind === "kpis") {
        const { html: total, rest } = this.portfolioTotal(section);
        html += total + this.section(rest);
      } else {
        html += this.section(section);
      }
    }
    if (tabId === "portefeuille") {
      html += `<div class="tab-action"><button type="button" class="button button-secondary" data-action="saisie">Noter un achat ou une vente</button></div>`;
    }
    if (!sections.length) html = `<p class="empty">Rien ici aujourd'hui.</p>` + html;
    return html;
  }

  weekly() {
    const summary = this.data.weekly || {};
    let html = this.hero(summary.decision || { title: "Bilan de la semaine", tone: "review" });
    for (const section of summary.sections || []) html += this.section(section);
    return html;
  }

  // Tes saisies : celles qui attendent leur réponse, puis les 10 dernières traitées,
  // la plus récente en haut (le fichier les garde de la plus ancienne à la plus récente).
  journal(pending = [], verdicts = []) {
    const known = new Set((this.data.journal || []).map((entry) => entry.id));
    const entries = [...(this.data.journal || []), ...verdicts.filter((entry) => !known.has(entry.id))]
      .sort((a, b) => String(b.received_at || "").localeCompare(String(a.received_at || "")));
    if (!entries.length && !pending.length) return "";
    const icons = { applied: "✓", rejected: "✕", duplicate: "=" };
    let rows = pending.map((item) => (
      `<li class="journal-row journal-pending"><span class="journal-icon" aria-hidden="true"><span class="spinner spinner-small"></span></span>`
      + `<span><span class="journal-text">${esc(item.label)}</span>`
      + `<span class="journal-when">Envoyé ${esc(sinceWords(item.sent_at))} · `
      + `${item.late ? "pas encore traité, regarde à nouveau plus tard" : "en cours"}</span></span></li>`
    )).join("");
    rows += entries.slice(0, 10).map((entry) => {
      const status = String(entry.status || "");
      return `<li class="journal-row journal-${esc(status)}"><span class="journal-icon" aria-hidden="true">${icons[status] || "•"}</span>`
        + `<span><span class="journal-text">${esc(entry.message || entry.action)}</span>`
        + `<span class="journal-when">${esc(sinceWords(entry.received_at))}</span></span></li>`;
    }).join("");
    return `<section class="card"><h3 class="card-title">Tes saisies</h3><ul class="journal">${rows}</ul></section>`;
  }

  // Un point sur l'onglet Suivi quand un ordre a sans doute été exécuté ou que la crypto attend.
  badges() {
    const urgent = new Set(["LIMITE TOUCHÉE", "À RENOUVELER ?", "EXPIRÉ"]);
    const orders = (this.actions.orders || []).some((order) => urgent.has(String(order.tag || "")));
    const pot = this.actions.crypto_pot;
    const crypto = pot && pot.tag === "ACHETER" && Number(pot.pending_eur) > 0;
    return { suivi: Boolean(orders || crypto) };
  }
}

// En attendant les données : la forme des cartes, sans contenu.
export function skeleton(tabId) {
  const line = (width) => `<span class="sk-line" style="width:${width}%"></span>`;
  const card = (lines) => `<section class="card card-skeleton" aria-hidden="true">${line(35)}${lines.map(line).join("")}<span class="sk-block"></span></section>`;
  const hero = `<section class="hero hero-skeleton" aria-hidden="true">${line(40)}<span class="sk-line sk-title"></span>${line(85)}${line(70)}<span class="sk-button"></span></section>`;
  const first = tabId === "aujourdhui" ? hero : tabId === "portefeuille"
    ? `<section class="total" aria-hidden="true">${line(30)}<span class="sk-line sk-total"></span></section>` : card([90, 75]);
  return `<div class="skeleton" role="status" aria-label="Chargement des données">${first}${card([92, 80, 60])}${card([88, 70])}</div>`;
}

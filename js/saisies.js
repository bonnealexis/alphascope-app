// Les saisies (docs/APPLI.md §2) : achat, vente, ordre exécuté, versement crypto.
// Chaque feuille : les champs, une phrase de confirmation, l'envoi, puis la réponse.

import { closeSheet, openSheet } from "./feuille.js";
import { currencySymbol, dayWords, esc, money, number, parseDecimal, price, todayIso, uuid } from "./outils.js";

const WEEKLY_ACCOUNT = "revolut-brokerage";
const SOURCE_LABELS = {
  decision: "Décision du jour",
  position: "Tes positions",
  etf: "ETF de la semaine",
  action: "Actions de la semaine",
};
const FUND_CATEGORIES = new Set(["ETF", "ETC", "FUND", "FONDS"]);

const keyOf = (item) => `${item.account_id}|${item.symbol}`;
const isCrypto = (item) => String(item.category || "").toUpperCase() === "CRYPTO" || item.account_id === "revolut-crypto";
// Le prix d'une crypto se saisit en euros (ce que Revolut débite), quelle que soit sa cotation.
const priceCurrency = (item) => (isCrypto(item) ? "EUR" : item.currency);
const codeOf = (item) => item.broker_symbol || String(item.symbol || "").split(".")[0];

// ---------------------------------------------------------------- champs

function decimalField(id, label, { value = "", suffix = "", hint = "" } = {}) {
  return `<div class="field" data-field="${id}">`
    + `<label for="f-${id}">${esc(label)}</label>`
    + `<div class="input-wrap"><input id="f-${id}" name="${id}" type="text" inputmode="decimal" autocomplete="off" `
    + `autocorrect="off" spellcheck="false" value="${esc(value)}">`
    + (suffix ? `<span class="input-suffix" data-suffix="${id}">${esc(suffix)}</span>` : "")
    + `</div>`
    + (hint ? `<p class="field-hint">${esc(hint)}</p>` : "")
    + `<p class="field-error" id="e-${id}"></p></div>`;
}

function dateField(id, label, value) {
  return `<div class="field" data-field="${id}"><label for="f-${id}">${esc(label)}</label>`
    + `<input id="f-${id}" name="${id}" type="date" value="${esc(value || todayIso())}" min="${todayIso(-60)}" max="${todayIso()}">`
    + `<p class="field-error" id="e-${id}"></p></div>`;
}

function textField(id, label, value = "") {
  return `<div class="field" data-field="${id}"><label for="f-${id}">${esc(label)}</label>`
    + `<input id="f-${id}" name="${id}" type="text" autocomplete="off" value="${esc(value)}" maxlength="140">`
    + `<p class="field-error" id="e-${id}"></p></div>`;
}

function switchField(id, label, checked, hint = "") {
  return `<div class="field field-switch" data-field="${id}"><label class="switch" for="f-${id}">`
    + `<span class="switch-text">${esc(label)}</span>`
    + `<input id="f-${id}" name="${id}" type="checkbox" role="switch"${checked ? " checked" : ""}>`
    + `<span class="switch-track" aria-hidden="true"></span></label>`
    + (hint ? `<p class="field-hint">${esc(hint)}</p>` : "") + `</div>`;
}

function readDecimal(form, id, errors, { allowZero = false, max = null, maxText = "", quantity = false } = {}) {
  const raw = form.elements[id]?.value ?? "";
  if (!String(raw).trim()) {
    if (allowZero) return 0;
    errors[id] = "À remplir.";
    return null;
  }
  const value = parseDecimal(raw);
  if (value === null) {
    errors[id] = "Écris un nombre, par exemple 0,5.";
    return null;
  }
  if (allowZero ? value < 0 : value <= 0) {
    errors[id] = allowZero ? "Pas de nombre négatif." : "Doit être plus grand que zéro.";
    return null;
  }
  // Une quantité est notée à 8 décimales : plus petite, elle vaudrait zéro.
  if (quantity && Number(value.toFixed(8)) <= 0) {
    errors[id] = "Trop petit : au moins 0,00000001.";
    return null;
  }
  if (max !== null && value > max + 1e-9) {
    errors[id] = maxText;
    return null;
  }
  return value;
}

function readDate(form, id, errors) {
  const value = String(form.elements[id]?.value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > todayIso() || value < todayIso(-60)) {
    errors[id] = "Choisis une date des 60 derniers jours.";
    return null;
  }
  return value;
}

// ---------------------------------------------------------------- déroulé commun

function flow(app, { title, fields, mount, read, sentence, payload, label }) {
  // L'id d'une saisie est tiré une fois, à sa première confirmation, puis réutilisé à
  // chaque nouvel essai de la même saisie : si GitHub l'a reçue mais que sa réponse
  // s'est perdue, la boîte de réception ne l'appliquera qu'une fois. Une saisie
  // corrigée (autres valeurs) reçoit un nouvel id.
  const holder = { attempt: null };
  const body = `<form class="form" novalidate>${fields}`
    + `<div class="form-total" aria-live="polite"></div>`
    + `<p class="form-error" role="alert"></p>`
    + `<button type="submit" class="button button-primary button-block">Vérifier</button></form>`
    + `<div class="confirm" hidden></div>`;
  openSheet({
    title,
    body,
    onMount(content) {
      const form = content.querySelector("form");
      const confirm = content.querySelector(".confirm");
      const total = content.querySelector(".form-total");
      const refreshTotal = () => {
        const { values } = read(form, {}, true);
        total.textContent = values && values.totalText ? values.totalText : "";
      };
      form.addEventListener("input", refreshTotal);
      form.addEventListener("change", refreshTotal);
      if (mount) mount(form, refreshTotal);
      refreshTotal();

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const errors = {};
        const { values } = read(form, errors, false);
        form.querySelectorAll(".field-error").forEach((node) => { node.textContent = ""; });
        form.querySelectorAll(".field").forEach((node) => node.classList.remove("field-invalid"));
        const ids = Object.keys(errors);
        if (ids.length) {
          for (const id of ids) {
            const node = form.querySelector(`#e-${id}`);
            if (node) node.textContent = errors[id];
            form.querySelector(`[data-field="${id}"]`)?.classList.add("field-invalid");
          }
          form.querySelector(`#f-${ids[0]}`)?.focus();
          return;
        }
        showConfirm(app, { form, confirm, holder, sentence: sentence(values), payload: payload(values), label: label(values) });
      });
    },
  });
}

function showConfirm(app, { form, confirm, holder, sentence, payload, label, back = "Corriger", kicker = "Tu confirmes ?", done = null }) {
  const body = JSON.stringify(payload);
  if (!holder.attempt || holder.attempt.body !== body) holder.attempt = { body, id: uuid() };
  const id = holder.attempt.id;
  form.hidden = true;
  confirm.hidden = false;
  confirm.innerHTML = (kicker ? `<p class="confirm-kicker">${esc(kicker)}</p>` : "")
    + `<p class="confirm-sentence">${esc(sentence)}</p>`
    + `<p class="form-error" role="alert"></p>`
    + `<button type="button" class="button button-primary button-block" data-send>Envoyer</button>`
    + `<button type="button" class="button button-secondary button-block" data-back>${esc(back)}</button>`;
  confirm.querySelector("[data-back]").addEventListener("click", () => {
    confirm.hidden = true;
    form.hidden = false;
  });
  const send = confirm.querySelector("[data-send]");
  send.addEventListener("click", async () => {
    send.disabled = true;
    send.textContent = "Envoi…";
    const message = { id, sent_at: new Date().toISOString(), ...payload };
    const result = await app.submit(message, label);
    if (!result.ok) {
      confirm.querySelector(".form-error").textContent = result.error;
      send.disabled = false;
      send.textContent = "Réessayer";
      return;
    }
    showSent(app, confirm, message, done || sentence);
  });
}

function showSent(app, confirm, message, sentence) {
  confirm.innerHTML = `<div class="sent">`
    + `<div class="sent-icon" aria-hidden="true"><span class="spinner"></span></div>`
    + `<p class="sent-title">Envoyé</p>`
    + `<p class="sent-text">${esc(sentence)}</p>`
    + `<p class="sent-status" aria-live="polite">AlphaScope vérifie ta saisie. La réponse arrive ici en une demi-minute environ.</p>`
    + `<button type="button" class="button button-secondary button-block" data-done>Fermer</button></div>`;
  confirm.querySelector("[data-done]").addEventListener("click", () => closeSheet());
  app.track(message.id, (entry, timedOut) => {
    const status = confirm.querySelector(".sent-status");
    const icon = confirm.querySelector(".sent-icon");
    const title = confirm.querySelector(".sent-title");
    if (!status) return;
    if (timedOut) {
      title.textContent = "Pas encore traité";
      status.textContent = "AlphaScope n'a pas encore répondu. Regarde à nouveau dans « Tes saisies » d'ici quelques minutes ; inutile de renvoyer.";
      icon.innerHTML = "…";
      return;
    }
    const applied = entry.status === "applied" || entry.status === "duplicate";
    icon.innerHTML = applied ? "✓" : "✗";
    icon.classList.add(applied ? "sent-ok" : "sent-ko");
    title.textContent = entry.status === "applied" ? "Noté" : entry.status === "duplicate" ? "Déjà noté" : "Refusé";
    status.textContent = (entry.message || "")
      + (entry.status === "applied" ? " L'écran se met à jour d'ici deux minutes." : "");
  });
}

// ---------------------------------------------------------------- listes

function instruments(data) {
  const seen = new Map();
  const list = (data.actions && data.actions.instruments) || [];
  const order = ["decision", "position", "etf", "action"];
  for (const source of order) {
    for (const item of list) {
      if ((item.source || "position") !== source) continue;
      if (!seen.has(keyOf(item))) seen.set(keyOf(item), item);
    }
  }
  for (const item of list) if (!seen.has(keyOf(item))) seen.set(keyOf(item), item);
  return [...seen.values()];
}

function accountOf(data, accountId) {
  return ((data.actions && data.actions.accounts) || []).find((a) => a.account_id === accountId) || null;
}

function instrumentSelect(data, selectedKey, list = instruments(data)) {
  const groups = new Map();
  for (const item of list) {
    const source = item.source || "position";
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(item);
  }
  let options = "";
  for (const [source, items] of groups) {
    options += `<optgroup label="${esc(SOURCE_LABELS[source] || "Autres")}">`;
    for (const item of items) {
      const selected = keyOf(item) === selectedKey ? " selected" : "";
      options += `<option value="${esc(keyOf(item))}"${selected}>${esc(item.name || item.symbol)} (${esc(codeOf(item))}) · ${esc(item.platform || "")}</option>`;
    }
    options += `</optgroup>`;
  }
  return `<div class="field" data-field="instrument"><label for="f-instrument">Quoi</label>`
    + `<select id="f-instrument" name="instrument">${options}</select>`
    + `<p class="field-hint" data-account-line></p><p class="field-error" id="e-instrument"></p></div>`;
}

function weeklyDefault(data, item) {
  const decision = data.actions && data.actions.decision;
  if (decision && keyOf(decision) === keyOf(item)) return decision.counts_as_weekly_purchase !== false;
  return FUND_CATEGORIES.has(String(item.category || "").toUpperCase());
}

function weeklyAccount(data) {
  const decision = data.actions && data.actions.decision;
  return decision ? decision.account_id : WEEKLY_ACCOUNT;
}

// ---------------------------------------------------------------- achat

export function openPurchase(app, { key = null, account = null } = {}) {
  const data = app.data;
  let list = instruments(data);
  if (account && list.some((item) => item.account_id === account)) list = list.filter((item) => item.account_id === account);
  if (!list.length) {
    openSheet({ title: "Noter un achat", body: `<p class="empty">Aucun titre à proposer aujourd'hui. Réessaie après le prochain calcul.</p>` });
    return;
  }
  const decision = data.actions && data.actions.decision;
  const first = list.find((item) => keyOf(item) === key) || (decision && list.find((i) => keyOf(i) === keyOf(decision))) || list[0];
  const fields = instrumentSelect(data, keyOf(first), list)
    + `<div class="field-row">`
    + decimalField("quantity", "Quantité", { hint: "Le nombre de parts, par exemple 0,68." })
    + decimalField("price", "Prix d'une part", { suffix: currencySymbol(priceCurrency(first)) })
    + `</div>`
    + `<p class="field-hint field-hint-tight" data-price-hint></p>`
    + decimalField("fees", "Frais", { value: "0", suffix: currencySymbol(priceCurrency(first)) })
    + dateField("date", "Date de l'achat", todayIso())
    + `<div data-weekly-slot></div>`;

  const current = (form) => list.find((item) => keyOf(item) === form.elements.instrument.value) || first;

  flow(app, {
    title: "J'ai acheté",
    fields,
    mount(form, refresh) {
      const update = () => {
        const item = current(form);
        const account = accountOf(data, item.account_id);
        form.querySelectorAll("[data-suffix]").forEach((node) => {
          if (node.dataset.suffix !== "quantity") node.textContent = currencySymbol(priceCurrency(item));
        });
        const cash = account && account.paid_from_cash
          ? `Payé avec l'argent du compte ${account.label} : il sera retiré de tes liquidités.`
          : `Sur ${account ? account.label : item.platform}. Tes liquidités notées ne changent pas.`;
        form.querySelector("[data-account-line]").textContent = cash;
        // Une position déjà détenue garde la devise de son premier achat (le bitcoin : en euros).
        form.querySelector("[data-price-hint]").textContent = isCrypto(item)
          ? "Prix d'une unité et frais en euros, comme Revolut les débite."
          : item.source === "position" ? `Prix et frais en ${currencySymbol(item.currency)}, comme ton premier achat.` : "";
        const slot = form.querySelector("[data-weekly-slot]");
        const pot = data.actions && data.actions.crypto_pot;
        if (isCrypto(item)) {
          const checked = Boolean(pot && pot.target === item.symbol && Number(pot.pending_eur) > 0);
          slot.innerHTML = switchField("pot", "C'est le versement de la cagnotte", checked,
            "Si oui, il est noté dans ta cagnotte crypto et le mail ne te le redemande pas.");
        } else if (item.account_id === weeklyAccount(data)) {
          const checked = weeklyDefault(data, item);
          slot.innerHTML = switchField("weekly", "Compte comme mon achat de la semaine", checked,
            "Si oui, le mail ne te demande plus rien avant lundi.");
        } else {
          slot.innerHTML = "";
        }
        refresh();
      };
      form.elements.instrument.addEventListener("change", update);
      update();
    },
    read(form, errors, quiet) {
      const item = current(form);
      const quantity = readDecimal(form, "quantity", errors, { quantity: true });
      const unit = readDecimal(form, "price", errors);
      const fees = readDecimal(form, "fees", errors, { allowZero: true });
      const date = quiet ? form.elements.date.value : readDate(form, "date", errors);
      const weekly = form.elements.weekly ? form.elements.weekly.checked : false;
      const pot = form.elements.pot ? form.elements.pot.checked : false;
      const currency = priceCurrency(item);
      const total = quantity !== null && unit !== null && fees !== null ? quantity * unit + fees : null;
      return {
        values: {
          item, quantity, unit, fees, date, weekly, pot, currency, total,
          totalText: total !== null ? `Total : ${money(total, currency)}, frais compris.` : "",
        },
      };
    },
    sentence(v) {
      const account = accountOf(data, v.item.account_id);
      let text = `Tu as acheté ${number(v.quantity, 8)} ${codeOf(v.item)} à ${price(v.unit, v.currency)} le ${dayWords(v.date)} : `
        + `${money(v.total, v.currency)} frais compris.`;
      if (v.weekly) text += " Ça compte comme ton achat de la semaine.";
      if (v.pot) text += " C'est le versement de ta cagnotte crypto.";
      if (account && account.paid_from_cash) text += ` Retiré de tes liquidités ${account.label}.`;
      return text;
    },
    payload(v) {
      return {
        action: "achat",
        data: {
          account_id: v.item.account_id,
          symbol: v.item.symbol,
          market_symbol: v.item.market_symbol,
          name: v.item.name,
          category: v.item.category,
          currency: v.currency,
          quantity: v.quantity,
          price: v.unit,
          fees: v.fees,
          date: v.date,
          // Toujours envoyé, vrai ou faux : le serveur respecte un « non ».
          counts_as_weekly_purchase: Boolean(v.weekly),
          ...(isCrypto(v.item) ? { counts_as_contribution: Boolean(v.pot) } : {}),
        },
      };
    },
    label: (v) => `Achat de ${number(v.quantity, 8)} ${codeOf(v.item)}`,
  });
}

// ---------------------------------------------------------------- vente

function positions(data) {
  return ((data.actions && data.actions.positions) || []).filter((p) => Number(p.quantity) > 0);
}

export function openSale(app, { key = null, account = null } = {}) {
  const data = app.data;
  let list = positions(data);
  if (account && list.some((p) => p.account_id === account)) list = list.filter((p) => p.account_id === account);
  if (!list.length) {
    openSheet({ title: "Noter une vente", body: `<p class="empty">Aucune position à vendre dans les données du jour.</p>` });
    return;
  }
  const first = list.find((p) => keyOf(p) === key) || list[0];
  const options = list.map((p) => (
    `<option value="${esc(keyOf(p))}"${keyOf(p) === keyOf(first) ? " selected" : ""}>`
    + `${esc(p.name || p.symbol)} (${esc(codeOf(p))}) · ${esc(p.platform || "")}</option>`
  )).join("");
  const fields = `<div class="field" data-field="position"><label for="f-position">Quoi</label>`
    + `<select id="f-position" name="position">${options}</select>`
    + `<p class="field-hint" data-held></p><p class="field-error" id="e-position"></p></div>`
    + `<div class="field-row">`
    + decimalField("quantity", "Quantité vendue")
    + decimalField("price", "Prix d'une part", { suffix: currencySymbol(first.currency) })
    + `</div>`
    + `<button type="button" class="link-button" data-all>Tout vendre</button>`
    + decimalField("fees", "Frais", { value: "0", suffix: currencySymbol(first.currency) })
    + dateField("date", "Date de la vente", todayIso());

  const current = (form) => list.find((p) => keyOf(p) === form.elements.position.value) || first;

  flow(app, {
    title: "J'ai vendu",
    fields,
    mount(form, refresh) {
      const update = () => {
        const p = current(form);
        form.querySelectorAll("[data-suffix]").forEach((node) => { if (node.dataset.suffix !== "quantity") node.textContent = currencySymbol(p.currency); });
        const account = accountOf(data, p.account_id);
        form.querySelector("[data-held]").textContent = `Tu en as ${number(p.quantity, 8)}.`
          + (account && account.paid_from_cash ? ` L'argent ira dans tes liquidités ${account.label}.` : "");
        refresh();
      };
      form.elements.position.addEventListener("change", update);
      form.querySelector("[data-all]").addEventListener("click", () => {
        form.elements.quantity.value = number(current(form).quantity, 8).replace(/ /g, "");
        refresh();
      });
      update();
    },
    read(form, errors, quiet) {
      const p = current(form);
      const quantity = readDecimal(form, "quantity", errors, {
        max: Number(p.quantity), maxText: `Tu n'en as que ${number(p.quantity, 8)}.`, quantity: true,
      });
      const unit = readDecimal(form, "price", errors);
      const fees = readDecimal(form, "fees", errors, { allowZero: true });
      const date = quiet ? form.elements.date.value : readDate(form, "date", errors);
      const total = quantity !== null && unit !== null && fees !== null ? quantity * unit - fees : null;
      return {
        values: {
          p, quantity, unit, fees, date, total,
          totalText: total !== null ? `Tu reçois : ${money(total, p.currency)}, frais déduits.` : "",
        },
      };
    },
    sentence(v) {
      const account = accountOf(data, v.p.account_id);
      let text = `Tu as vendu ${number(v.quantity, 8)} ${codeOf(v.p)} à ${price(v.unit, v.p.currency)} le ${dayWords(v.date)} : `
        + `${money(v.total, v.p.currency)} frais déduits.`;
      if (account && account.paid_from_cash) text += ` Ajouté à tes liquidités ${account.label}.`;
      return text;
    },
    payload(v) {
      return {
        action: "vente",
        data: {
          account_id: v.p.account_id, symbol: v.p.symbol, quantity: v.quantity,
          price: v.unit, fees: v.fees, date: v.date,
        },
      };
    },
    label: (v) => `Vente de ${number(v.quantity, 8)} ${codeOf(v.p)}`,
  });
}

export function openChooser(app, { account = null } = {}) {
  openSheet({
    title: "Noter",
    body: `<div class="chooser">`
      + `<button type="button" class="chooser-button" data-pick="achat"><span class="chooser-title">Un achat</span><span class="chooser-text">Tu as acheté un ETF, une action ou une crypto.</span></button>`
      + `<button type="button" class="chooser-button" data-pick="vente"><span class="chooser-title">Une vente</span><span class="chooser-text">Tu as vendu tout ou partie d'une position.</span></button>`
      + `</div>`,
    onMount(content) {
      content.querySelector('[data-pick="achat"]').addEventListener("click", () => openPurchase(app, { account }));
      content.querySelector('[data-pick="vente"]').addEventListener("click", () => openSale(app, { account }));
    },
  });
}

// ---------------------------------------------------------------- ordre exécuté

export function openOrder(app, orderId) {
  const data = app.data;
  const order = ((data.actions && data.actions.orders) || []).find((o) => String(o.id) === String(orderId));
  if (!order) return;
  const sideWord = order.side === "vente" ? "vente" : "achat";
  const size = order.quantity ? `${number(order.quantity, 8)} ${order.symbol}` : `${order.symbol} pour ${money(order.amount, order.currency)}`;
  const ofSide = sideWord === "vente" ? "de vente" : "d'achat";
  const intro = `<p class="form-intro">Ordre ${ofSide} : ${esc(size)} à ${esc(price(order.limit_price, order.currency))} sur ${esc(order.platform || "")}.`
    + (order.touched_on ? ` La limite a été touchée le ${esc(dayWords(order.touched_on))}.` : "")
    + ` Tout l'ordre d'un coup : une exécution en partie se note comme un achat ou une vente.</p>`;
  // Un ordre passé en montant (sans quantité) : la quantité obtenue se lit chez le courtier.
  const askQuantity = !(Number(order.quantity) > 0);
  const fields = intro
    + (askQuantity ? decimalField("quantity", "Quantité obtenue", { hint: "Le nombre de parts que l'ordre t'a donné, chez ton courtier." }) : "")
    + decimalField("price", "Prix obtenu pour une part", { value: number(order.limit_price, 4).replace(/ /g, ""), suffix: currencySymbol(order.currency), hint: "En général, ta limite." })
    + dateField("date", "Date de l'exécution", order.touched_on || todayIso());

  flow(app, {
    title: "Ordre exécuté",
    fields,
    read(form, errors, quiet) {
      const quantity = askQuantity ? readDecimal(form, "quantity", errors, { quantity: true }) : Number(order.quantity);
      const unit = readDecimal(form, "price", errors);
      const date = quiet ? form.elements.date.value : readDate(form, "date", errors);
      const total = unit !== null && quantity ? unit * quantity : null;
      return {
        values: {
          unit, date, quantity,
          totalText: total !== null ? `${sideWord === "vente" ? "Montant de la vente" : "Montant de l'achat"} : ${money(total, order.currency)}, hors frais.` : "",
        },
      };
    },
    sentence: (v) => `Ton ordre ${ofSide} de ${askQuantity ? `${number(v.quantity, 8)} ${order.symbol}` : size} a été exécuté `
      + `le ${dayWords(v.date)}, à ${price(v.unit, order.currency)}.`,
    payload: (v) => ({
      action: "ordre_execute",
      data: { order_id: order.id, date: v.date, price: v.unit, ...(askQuantity ? { quantity: v.quantity } : {}) },
    }),
    label: () => `Ordre exécuté : ${sideWord} ${order.symbol}`,
  });
}

// ---------------------------------------------------------------- crypto

function coins(data) {
  const pot = data.actions && data.actions.crypto_pot;
  const list = positions(data).filter((p) => String(p.category || "").toUpperCase() === "CRYPTO");
  const symbols = list.map((p) => ({ symbol: String(p.symbol), name: p.name || p.symbol }));
  if (pot && pot.target && !symbols.some((c) => c.symbol === pot.target)) symbols.unshift({ symbol: pot.target, name: pot.target });
  return symbols;
}

export function openContribution(app) {
  const data = app.data;
  const pot = (data.actions && data.actions.crypto_pot) || {};
  const list = coins(data);
  const target = pot.target || (list[0] && list[0].symbol) || "BTC";
  const options = list.map((c) => `<option value="${esc(c.symbol)}"${c.symbol === target ? " selected" : ""}>${esc(c.name)} (${esc(c.symbol)})</option>`).join("");
  const fields = (pot.venue ? `<p class="form-intro">À acheter sur ${esc(pot.venue)}.</p>` : "")
    + decimalField("amount", "Montant mis", { value: pot.pending_eur ? number(pot.pending_eur).replace(/ /g, "") : "", suffix: "€" })
    + `<div class="field" data-field="coin"><label for="f-coin">Crypto achetée</label><select id="f-coin" name="coin">${options}</select></div>`
    + decimalField("quantity", "Quantité reçue", { suffix: target, hint: "Ce que Revolut affiche, par exemple 0,00112." })
    + dateField("date", "Date de l'achat", todayIso());

  flow(app, {
    title: "Versement crypto fait",
    fields,
    mount(form, refresh) {
      form.elements.coin.addEventListener("change", () => {
        form.querySelector('[data-suffix="quantity"]').textContent = form.elements.coin.value;
        refresh();
      });
    },
    read(form, errors, quiet) {
      const amount = readDecimal(form, "amount", errors);
      const quantity = readDecimal(form, "quantity", errors, { quantity: true });
      const date = quiet ? form.elements.date.value : readDate(form, "date", errors);
      const coin = form.elements.coin.value;
      const unit = amount !== null && quantity ? amount / quantity : null;
      return {
        values: {
          amount, quantity, date, coin,
          totalText: unit !== null ? `Soit ${money(unit, "EUR")} pour 1 ${coin}.` : "",
        },
      };
    },
    sentence: (v) => `Tu as mis ${money(v.amount, "EUR")} en ${v.coin} (${number(v.quantity, 8)} ${v.coin}) le ${dayWords(v.date)}.`,
    payload: (v) => ({ action: "versement_crypto", data: { date: v.date, amount_eur: v.amount, coin: v.coin, quantity: v.quantity } }),
    label: (v) => `Versement crypto de ${money(v.amount, "EUR")}`,
  });
}

export function openSkip(app) {
  const pot = (app.data.actions && app.data.actions.crypto_pot) || {};
  const due = (pot.due_dates || [])[0] || todayIso();
  const fields = `<p class="form-intro">Le versement sauté sort de la cagnotte : il ne s'ajoute pas au suivant.</p>`
    + decimalField("amount", "Montant sauté", { value: pot.pending_eur ? number(pot.pending_eur).replace(/ /g, "") : "100", suffix: "€" })
    + dateField("date", "Versement du", due)
    + textField("note", "Pourquoi (facultatif)", "Argent utilisé ailleurs");

  flow(app, {
    title: "Je saute ce versement",
    fields,
    read(form, errors, quiet) {
      const amount = readDecimal(form, "amount", errors);
      const date = quiet ? form.elements.date.value : readDate(form, "date", errors);
      const note = String(form.elements.note.value || "").trim().slice(0, 140);
      return { values: { amount, date, note, totalText: "" } };
    },
    sentence: (v) => `Tu sautes le versement du ${dayWords(v.date)} (${money(v.amount, "EUR")}) : il ne s'ajoute pas au suivant.`,
    payload: (v) => ({ action: "versement_saute", data: { date: v.date, amount_eur: v.amount, note: v.note } }),
    label: (v) => `Versement sauté du ${dayWords(v.date)}`,
  });
}

// ---------------------------------------------------------------- mes comptes

// Chaque compte suivi (actions.confirmations, docs/APPLI.md §1.2) : ce qu'AlphaScope en
// connaît, à comparer avec l'appli du courtier. Identique : Alexis le confirme d'un geste
// (action `confirmation`), ce qui remplace la capture et débloque les conseils d'achat.

export function confirmationsOf(data) {
  const list = ((data && data.actions && data.actions.confirmations) || []).filter((c) => c && c.account_id);
  return [...list].sort((a, b) => (Number(Boolean(b.due)) - Number(Boolean(a.due)))
    || (Number(a.days_left ?? 99) - Number(b.days_left ?? 99)));
}

export function accountStatus(c) {
  const days = Number(c.days_left);
  if (c.due && (c.stale || days < 0)) return { tone: "late", text: `en retard depuis le ${dayWords(c.due_on)}` };
  if (c.due) return { tone: "soon", text: days === 0 ? "à confirmer aujourd'hui" : `à confirmer d'ici le ${dayWords(c.due_on)}` };
  return { tone: "ok", text: `à jour jusqu'au ${dayWords(c.due_on)}` };
}

function linesWords(count, cash) {
  const lines = count === 0 ? "aucune ligne" : count === 1 ? "cette ligne" : `ces ${count} lignes`;
  return cash ? `${lines} et ces liquidités` : lines;
}

function accountBlock(data, c, open) {
  const status = accountStatus(c);
  const lines = Array.isArray(c.lines) ? c.lines : [];
  const cash = c.cash && typeof c.cash === "object" ? c.cash : null;
  const platform = c.platform || c.label || "ton courtier";
  const canNote = ((data.actions && data.actions.instruments) || []).some((i) => i.account_id === c.account_id)
    || ((data.actions && data.actions.positions) || []).some((p) => p.account_id === c.account_id);
  let rows = lines.map((line) => (
    `<tr><th scope="row">${esc(line.name || line.symbol)}${line.name && line.symbol ? ` <span class="acct-code">${esc(codeOf(line))}</span>` : ""}</th>`
    + `<td>${esc(number(line.quantity, 8))}</td></tr>`
  )).join("");
  if (!lines.length) rows = `<tr><th scope="row" class="muted">Aucune ligne</th><td></td></tr>`;
  const cashRow = cash
    ? `<tr class="acct-cash"><th scope="row">Liquidités</th><td>${esc(money(cash.balance, cash.currency))}</td></tr>`
    : "";
  return `<section class="acct acct-${status.tone}${open ? " is-open" : ""}" data-account="${esc(c.account_id)}">`
    + `<button type="button" class="acct-head" aria-expanded="${open}">`
    + `<span class="acct-title"><span class="acct-name">${esc(c.label || c.account_id)}</span>`
    + `<span class="acct-status"><span class="acct-dot" aria-hidden="true"></span>${esc(status.text)}</span></span>`
    + `<span class="acct-chevron" aria-hidden="true">›</span></button>`
    + `<div class="acct-panel"><div class="acct-body">`
    + `<p class="acct-intro">Ce qu'AlphaScope connaît de ce compte :</p>`
    + `<table class="acct-lines"><thead><tr><th scope="col">Ligne</th><th scope="col">Quantité</th></tr></thead>`
    + `<tbody>${rows}${cashRow}</tbody></table>`
    + (cash ? "" : `<p class="acct-note">Pas de liquidités suivies sur ce compte.</p>`)
    + `<button type="button" class="button button-primary button-block" data-same>J'ai comparé avec ${esc(platform)} : tout est identique</button>`
    + `<button type="button" class="button button-secondary button-block" data-diff aria-expanded="false">Il y a une différence</button>`
    + `<div class="acct-diff" hidden>`
    + `<p>Si un achat ou une vente manque, note-le avec « Noter un achat ou une vente » : AlphaScope l'ajoute, puis tu pourras confirmer. `
    + `Pour toute autre différence (un nombre de parts, des liquidités), écris-le à Claude.</p>`
    + (canNote ? `<button type="button" class="button button-secondary button-block" data-note>Noter un achat ou une vente sur ${esc(platform)}</button>` : "")
    + `</div></div><div class="confirm" hidden></div></div></section>`;
}

export function openAccounts(app) {
  const data = app.data || {};
  const list = confirmationsOf(data);
  if (!list.length) {
    openSheet({ title: "Mes comptes", body: `<p class="empty">Aucun compte dans les données du jour.</p>` });
    return;
  }
  const firstDue = list.find((c) => c.due) || null;
  const body = `<p class="form-intro">Compare chaque compte avec l'appli de ton courtier. S'il est identique, confirme-le : `
    + `AlphaScope peut alors te proposer des achats.</p>`
    + list.map((c) => accountBlock(data, c, c === firstDue)).join("");
  openSheet({
    title: "Mes comptes",
    body,
    wide: true,
    onMount(content) {
      for (const block of content.querySelectorAll(".acct")) {
        const c = list.find((item) => item.account_id === block.dataset.account);
        if (!c) continue;
        const head = block.querySelector(".acct-head");
        head.addEventListener("click", () => {
          const open = !block.classList.contains("is-open");
          block.classList.toggle("is-open", open);
          head.setAttribute("aria-expanded", String(open));
        });
        const diff = block.querySelector(".acct-diff");
        const diffButton = block.querySelector("[data-diff]");
        diffButton.addEventListener("click", () => {
          diff.hidden = !diff.hidden;
          diffButton.setAttribute("aria-expanded", String(!diff.hidden));
        });
        block.querySelector("[data-note]")?.addEventListener("click", () => openChooser(app, { account: c.account_id }));
        // Même déroulé que les autres saisies : une phrase, l'envoi (id stable), puis la réponse.
        const holder = { attempt: null };
        const count = Array.isArray(c.lines) ? c.lines.length : 0;
        const cash = Boolean(c.cash && typeof c.cash === "object");
        block.querySelector("[data-same]").addEventListener("click", () => {
          diff.hidden = true;
          showConfirm(app, {
            form: block.querySelector(".acct-body"),
            confirm: block.querySelector(".confirm"),
            holder,
            sentence: `Tu confirmes que ${c.label || c.account_id} affiche exactement ${linesWords(count, cash)} ?`,
            payload: { action: "confirmation", data: { account_id: c.account_id } },
            label: `Confirmation : ${c.label || c.account_id}`,
            back: "Revenir",
            // La phrase est déjà une question ; une fois envoyée, elle devient un constat.
            kicker: "",
            done: `${c.label || c.account_id} : identique à ${c.platform || "ton courtier"}.`,
          });
        });
      }
    },
  });
}


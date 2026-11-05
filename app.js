// AlphaScope sur iPhone : ce que dit le mail du matin, et les saisies qui remplacent les captures.
// Le contrat avec le calcul du matin est dans docs/APPLI.md (dépôt privé).

import {
  ApiError, cachedData, checkToken, dispatch, fetchData, fetchJournal, forgetCopy, forgetToken, getToken, setToken,
} from "./js/api.js";
import {
  DATA_EVERY_MS, DATA_LIMIT_MS, PENDING_EXPIRY_MS, STORAGE, TABS, TOKEN_PAGE, UNTRACKED_ACTIONS,
  VERDICT_EVERY_MS, VERDICT_PATIENCE_MS,
} from "./js/config.js";
import { closeSheet, openSheet } from "./js/feuille.js";
import { animateNumbers, lastMove, moneyText, mountChart, pctText, renderChart, sparkline } from "./js/graphiques.js";
import { pushState, pushSupported, subscribe, unsubscribe } from "./js/notifications.js";
import { esc, isDemo, isStandalone, longDayWords, sinceWords, store, uuid } from "./js/outils.js";
import { Renderer, mountFigures, setChartRenderer, skeleton } from "./js/rendu.js";
import { confirmationsOf, openAccounts, openChooser, openContribution, openOrder, openPurchase, openSkip } from "./js/saisies.js";
import { openViewer } from "./js/visionneuse.js";

const APP_BUILD = "2026-11-05-245688ea53"; // remplacé par publier_appli.py

// Les images du mail deviennent des graphiques qu'on lit au doigt (js/graphiques.js) ;
// une image sans données de graphique reste telle quelle.
setChartRenderer(renderChart, mountChart, { sparkline, lastMove, money: moneyText, percent: pctText });

const app = {
  data: null,
  renderer: null,
  tab: store.get(STORAGE.tab, "aujourdhui") || "aujourdhui",
  lastFetch: 0,
  offline: false,
  problem: "",
  loading: false,
  fetched: false, // au moins une lecture tentée : avant, l'écran dit « chargement »
  waitingData: false,
  trackers: new Map(),
  scroll: {}, // la position de défilement de chaque onglet, retrouvée en y revenant
  verdicts: new Map(), // réponses lues dans le journal, avant que donnees.json ne les reprenne

  // ------------------------------------------------------------ saisies
  async submit(message, label) {
    try {
      await dispatch(message);
    } catch (error) {
      if (error instanceof ApiError && error.kind === "cle") {
        // La clé ne marche plus : on le dit, sans perdre ce qui a été tapé.
        return { ok: false, error: error.message + " Change-la dans Réglages." };
      }
      return { ok: false, error: error.message || "Rien n'a été envoyé, réessaie." };
    }
    if (!UNTRACKED_ACTIONS.has(message.action)) {
      const pending = pendingList();
      pending.unshift({ id: message.id, label, action: message.action, sent_at: message.sent_at });
      store.set(STORAGE.pending, pending.slice(0, 20));
      if (isDemo()) simulateDemoAnswer(message, label);
      render();
    }
    return { ok: true };
  },

  // Lit le journal toutes les 12 s jusqu'à la réponse ; au bout de 3 min sans
  // réponse : « pas encore traité ». Une réponse reçue, l'écran attend le nouveau calcul.
  track(id, onResult) {
    const item = pendingList().find((p) => p.id === id);
    const sentAt = item ? Date.parse(item.sent_at) : Date.now();
    const every = isDemo() ? 1500 : VERDICT_EVERY_MS;
    const tick = async () => {
      const entry = await lookupVerdict(id);
      if (entry) {
        this.trackers.delete(id);
        onResult(entry, false);
        render();
        if (entry.status === "applied") awaitFreshData();
        return;
      }
      if (Date.now() - sentAt > VERDICT_PATIENCE_MS) {
        this.trackers.delete(id);
        onResult(null, true);
        render();
        return;
      }
      this.trackers.set(id, setTimeout(tick, every));
    };
    this.trackers.set(id, setTimeout(tick, every));
  },
};

function pendingList() {
  const list = store.get(STORAGE.pending, []);
  return Array.isArray(list) ? list : [];
}

function findJournal(id) {
  return ((app.data && app.data.journal) || []).find((entry) => entry.id === id) || app.verdicts.get(id) || null;
}

// Le journal n'est relu qu'une fois toutes les 5 s, même avec plusieurs saisies en cours.
let journalRead = null;
let journalReadAt = 0;

async function lookupVerdict(id) {
  const known = findJournal(id);
  if (known || isDemo()) return known;
  if (!journalRead || Date.now() - journalReadAt > 5000) {
    journalReadAt = Date.now();
    journalRead = fetchJournal().catch(() => []);
  }
  const entries = await journalRead;
  const waiting = new Set(pendingList().map((item) => item.id));
  waiting.add(id);
  for (const entry of entries) if (waiting.has(entry.id)) app.verdicts.set(entry.id, entry);
  return app.verdicts.get(id) || null;
}

// À l'ouverture : les saisies encore « en cours » ont peut-être reçu leur réponse entre-temps.
async function resolvePending() {
  const pending = pendingList();
  if (!pending.length || isDemo()) return;
  const before = app.verdicts.size;
  await lookupVerdict(pending[0].id);
  if (app.verdicts.size !== before) render();
}

// Après une saisie notée : relit donnees.json toutes les 20 s (5 min au plus)
// jusqu'à ce qu'un nouveau calcul l'ait réécrit.
async function awaitFreshData() {
  if (isDemo() || app.waitingData) return;
  app.waitingData = true;
  renderStatus();
  const before = app.data && app.data.generated_at;
  const started = Date.now();
  while (Date.now() - started < DATA_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, DATA_EVERY_MS));
    await refresh({ quiet: true });
    if (app.data && app.data.generated_at !== before) break;
  }
  app.waitingData = false;
  renderStatus();
}

// Les saisies en cours qui ont reçu leur réponse ou qui sont trop vieilles s'effacent.
function prunePending() {
  const now = Date.now();
  const kept = pendingList().filter((item) => !findJournal(item.id) && now - new Date(item.sent_at).getTime() < PENDING_EXPIRY_MS);
  store.set(STORAGE.pending, kept);
  return kept.map((item) => ({ ...item, late: now - new Date(item.sent_at).getTime() > VERDICT_PATIENCE_MS }));
}

function simulateDemoAnswer(message, label) {
  setTimeout(() => {
    app.verdicts.set(message.id, {
      id: message.id, received_at: new Date().toISOString(), action: message.action, status: "applied",
      message: `Démo : ${label} noté (rien n'a été envoyé).`,
    });
  }, 2500);
}

// ------------------------------------------------------------------ écrans

function show(screen) {
  for (const id of ["ecran-installer", "ecran-cle", "ecran-principal"]) {
    document.getElementById(id).hidden = id !== screen;
  }
  document.body.dataset.screen = screen;
}

function tabLabel(tabId) {
  return (TABS.find((tab) => tab.id === tabId) || TABS[0]).label;
}

// Le grand titre de l'onglet, et le même en petit dans la barre du haut.
function renderTitles() {
  const label = tabLabel(app.tab);
  document.getElementById("grand-titre").textContent = label;
  document.getElementById("petit-titre").textContent = label;
  document.title = app.tab === "aujourdhui" ? "AlphaScope" : `${label} · AlphaScope`;
}

function render({ animate = false } = {}) {
  renderTitles();
  renderStatus();
  const body = document.getElementById("corps");
  if (!app.data) {
    renderEmpty(body);
    return;
  }
  app.renderer = new Renderer(app.data);
  const pending = prunePending();
  let html = app.problem ? `<div class="banner banner-warn" role="status">${esc(app.problem)}</div>` : "";
  if (isDemo()) html = `<div class="banner banner-demo" role="status">Démo : tous les chiffres sont inventés.</div>` + html;
  html += app.tab === "aujourdhui" ? app.renderer.today(pending, [...app.verdicts.values()]) : app.renderer.tab(app.tab);
  body.innerHTML = html;
  mountFigures(body, app.data);
  animateNumbers(body);
  if (animate) {
    body.classList.remove("tab-enter");
    void body.offsetWidth; // relance l'animation d'entrée
    body.classList.add("tab-enter");
  }
  const badges = app.renderer.badges();
  document.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.tab === app.tab;
    button.setAttribute("aria-current", active ? "page" : "false");
    button.classList.toggle("tab-badge", Boolean(badges[button.dataset.tab]) && !active);
  });
}

// Sans données : la forme des cartes pendant le chargement, sinon ce qui manque.
function renderEmpty(body) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.tab === app.tab ? "page" : "false");
  });
  if (!app.fetched || app.loading) {
    body.innerHTML = skeleton(app.tab);
    return;
  }
  const message = app.problem || "Pas encore de données.";
  body.innerHTML = `<div class="empty-state"><p>${esc(message)}</p>`
    + `<button type="button" class="button button-primary" data-action="rafraichir">Réessayer</button></div>`;
}

// Sous le grand titre : le jour du calcul et sa fraîcheur.
function renderStatus() {
  const status = document.getElementById("statut");
  if (!app.data) {
    status.textContent = app.loading || !app.fetched ? "Chargement…" : "";
    return;
  }
  const parts = [];
  if (app.data.report_date) parts.push(longDayWords(app.data.report_date));
  const when = sinceWords(app.data.generated_at);
  if (app.loading) parts.push("actualisation…");
  else if (app.offline) parts.push("hors ligne");
  else if (app.waitingData) parts.push("écran mis à jour d'ici deux minutes");
  else if (when) parts.push(`mis à jour ${when}`);
  status.textContent = parts.join(" · ");
}

// ------------------------------------------------------------------ données

async function refresh({ quiet = false } = {}) {
  if (app.loading) return;
  app.loading = true;
  if (!quiet) renderStatus();
  try {
    const data = await fetchData();
    app.data = data;
    app.offline = false;
    app.problem = "";
    app.lastFetch = Date.now();
  } catch (error) {
    if (error instanceof ApiError && error.kind === "cle") {
      app.loading = false;
      app.fetched = true;
      showKeyScreen(error.message + " Colle une nouvelle clé.");
      return;
    }
    if (error instanceof ApiError && error.kind === "reseau") {
      app.offline = true;
      app.problem = app.data ? `Pas de connexion : voici la copie du ${longDayWords(app.data.report_date)}.` : "Pas de connexion, et aucune copie enregistrée.";
    } else {
      app.problem = error.message || "Les données n'ont pas pu être lues.";
    }
  } finally {
    app.loading = false;
    app.fetched = true;
  }
  render();
  // Une saisie encore « en cours » a peut-être reçu sa réponse depuis.
  if (!app.trackers.size && pendingList().length) resolvePending();
}

// ------------------------------------------------------------------ clé

function showKeyScreen(message = "") {
  show("ecran-cle");
  const error = document.getElementById("cle-erreur");
  error.textContent = message;
  error.hidden = !message;
}

async function onKeySubmit(event) {
  event.preventDefault();
  const input = document.getElementById("cle-champ");
  const button = document.getElementById("cle-bouton");
  const error = document.getElementById("cle-erreur");
  const warning = document.getElementById("cle-lecture-seule");
  const token = input.value.trim();
  warning.hidden = true;
  if (!token) {
    error.textContent = "Colle la clé copiée sur GitHub.";
    error.hidden = false;
    return;
  }
  if (/\s/.test(token)) {
    error.textContent = "La clé contient un espace : recopie-la d'un seul bloc.";
    error.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = "Vérification…";
  error.hidden = true;
  try {
    const result = await checkToken(token);
    setToken(token);
    input.value = "";
    if (!result.canWrite) {
      warning.hidden = false;
      button.disabled = false;
      button.textContent = "Vérifier ma clé";
      return;
    }
    await enterMain(true);
  } catch (failure) {
    error.textContent = failure.message || "La clé n'a pas pu être vérifiée.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Vérifier ma clé";
  }
}

// ------------------------------------------------------------------ réglages

async function openSettings() {
  const token = getToken();
  const push = await pushState(app.data);
  const data = app.data || {};
  let body = `<div class="settings">`;
  body += `<section class="settings-group"><h3>Ta clé</h3>`;
  if (isDemo()) body += `<p>En démo, aucune clé n'est utilisée.</p>`;
  else body += `<p>${token ? `Enregistrée sur cet iPhone (se termine par ${esc(token.slice(-4))}).` : "Aucune clé."}</p>`
    + `<p class="muted settings-note">Cette clé ne sert qu'à AlphaScope ; ne publie pas d'autre site GitHub Pages sur ce compte.</p>`
    + `<button type="button" class="button button-secondary button-block" data-set="changer-cle">Changer de clé</button>`
    + `<button type="button" class="button button-danger button-block" data-set="oublier-cle">Oublier la clé sur cet iPhone</button>`;
  body += `</section>`;

  const accounts = confirmationsOf(data);
  if (accounts.length) {
    const due = accounts.filter((c) => c.due).length;
    body += `<section class="settings-group"><h3>Mes comptes</h3>`
      + `<p>${due ? `${due} compte${due > 1 ? "s" : ""} à reconfirmer sur ${accounts.length}.` : `Tes ${accounts.length} comptes sont à jour.`}</p>`
      + `<button type="button" class="button button-secondary button-block" data-set="comptes">Mes comptes</button></section>`;
  }

  body += `<section class="settings-group"><h3>Notifications</h3><p data-push-text>${esc(push.text)}</p>`;
  if (push.state === "off" || push.state === "demo") body += `<button type="button" class="button button-primary button-block" data-set="push-on">Activer les notifications</button>`;
  if (push.state === "on" || push.state === "demo") {
    body += `<button type="button" class="button button-secondary button-block" data-set="push-test">M'envoyer une notification d'essai</button>`
      + `<button type="button" class="button button-secondary button-block" data-set="push-off">Désactiver</button>`;
  }
  body += `<p class="form-error" role="alert" data-push-error></p></section>`;

  body += `<section class="settings-group"><h3>À propos</h3>`;
  if (data.generated_at) {
    body += `<p>Calcul du ${esc(longDayWords(data.report_date))}, ${esc(sinceWords(data.generated_at))}`
      + `${data.mode && data.mode !== "normal" ? ` (${esc(data.mode === "apercu" ? "mise à jour sans mail" : data.mode)})` : ""}.</p>`;
  }
  body += `<p class="muted">Appli ${esc(APP_BUILD)} · calcul AlphaScope ${esc(data.app_version || "—")}.</p>`
    + `<p class="muted">AlphaScope ne passe, n'annule ni ne renouvelle aucun ordre à ta place.</p></section></div>`;

  openSheet({
    title: "Réglages",
    body,
    onMount(content) {
      const errorLine = content.querySelector("[data-push-error]");
      content.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-set]");
        if (!button) return;
        const what = button.dataset.set;
        if (what === "comptes") {
          openAccounts(app);
        } else if (what === "changer-cle") {
          closeSheet(true);
          showKeyScreen();
        } else if (what === "oublier-cle") {
          forgetToken();
          await forgetCopy();
          app.data = null;
          closeSheet(true);
          showKeyScreen("Clé oubliée. Colle une clé pour revoir tes données.");
        } else if (what.startsWith("push-")) {
          errorLine.textContent = "";
          button.disabled = true;
          try {
            await handlePush(what, (text) => { content.querySelector("[data-push-text]").textContent = text; });
          } catch (failure) {
            errorLine.textContent = failure.message || "Ça n'a pas marché, réessaie.";
          } finally {
            button.disabled = false;
          }
        }
      });
    },
  });
}

async function handlePush(what, say) {
  const envelope = (message) => ({ id: uuid(), sent_at: new Date().toISOString(), ...message });
  if (isDemo()) {
    say("Démo : rien n'est envoyé. Dans la vraie appli, l'iPhone te demande d'autoriser les notifications.");
    return;
  }
  if (what === "push-on") {
    const message = await subscribe(app.data);
    const result = await app.submit(envelope(message), "Notifications activées");
    if (!result.ok) throw new Error(result.error);
    say("Activées sur cet iPhone. Tu recevras la décision du jour et les alertes importantes.");
  } else if (what === "push-test") {
    const result = await app.submit(envelope({ action: "test_notification", data: {} }), "Notification d'essai");
    if (!result.ok) throw new Error(result.error);
    say("Demandée : elle arrive d'ici une à deux minutes.");
  } else if (what === "push-off") {
    const message = await unsubscribe();
    if (message) {
      const result = await app.submit(envelope(message), "Notifications désactivées");
      if (!result.ok) throw new Error(result.error);
    }
    say("Désactivées sur cet iPhone.");
  }
}

// Après la clé : proposer une fois les notifications.
function offerNotifications() {
  if (isDemo() || !isStandalone() || !pushSupported()) return;
  if (!(app.data && app.data.push && app.data.push.vapid_public_key)) return;
  if (Notification.permission !== "default") return;
  openSheet({
    title: "Être prévenu",
    body: `<p class="form-intro">AlphaScope peut t'envoyer une notification : la décision du jour, un ordre sans doute exécuté, le bitcoin qui passe sous sa ligne.</p>`
      + `<button type="button" class="button button-primary button-block" data-push-yes>Activer les notifications</button>`
      + `<button type="button" class="button button-secondary button-block" data-close>Plus tard</button>`
      + `<p class="form-error" role="alert"></p>`,
    onMount(content) {
      content.querySelector("[data-push-yes]").addEventListener("click", async (event) => {
        event.target.disabled = true;
        try {
          await handlePush("push-on", (text) => { content.querySelector(".form-intro").textContent = text; });
          setTimeout(() => closeSheet(), 1800);
        } catch (failure) {
          content.querySelector(".form-error").textContent = failure.message;
          event.target.disabled = false;
        }
      });
    },
  });
}

// ------------------------------------------------------------------ démarrage

async function enterMain(justConnected = false) {
  show("ecran-principal");
  if (!app.data) app.data = await cachedData();
  render();
  await refresh();
  if (justConnected) offerNotifications();
}

function onClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "zoom") {
    const source = app.data && app.data.images && app.data.images[target.dataset.image];
    if (source) openViewer(source, target.querySelector("img")?.alt);
  } else if (action === "achat-decision") {
    const d = app.data.actions && app.data.actions.decision;
    openPurchase(app, { key: d ? `${d.account_id}|${d.symbol}` : null });
  } else if (action === "saisie") {
    openChooser(app);
  } else if (action === "ordre") {
    openOrder(app, target.dataset.order);
  } else if (action === "versement") {
    openContribution(app);
  } else if (action === "versement-saute") {
    openSkip(app);
  } else if (action === "bilan") {
    openWeekly();
  } else if (action === "comptes") {
    openAccounts(app);
  } else if (action === "rafraichir") {
    refresh();
  }
}

function openWeekly() {
  openSheet({
    title: "Bilan de la semaine",
    body: app.renderer.weekly(),
    wide: true,
    onMount: (content) => requestAnimationFrame(() => mountFigures(content, app.data)),
  });
}

function selectTab(tabId) {
  if (tabId === app.tab) {
    // Toucher l'onglet déjà ouvert remonte en haut, comme sur iPhone.
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  app.scroll[app.tab] = window.scrollY;
  app.tab = tabId;
  store.set(STORAGE.tab, app.tab);
  render({ animate: true });
  window.scrollTo({ top: app.scroll[tabId] || 0 });
  onScroll();
}

function setupTabs() {
  document.getElementById("onglets").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (button) selectTab(button.dataset.tab);
  });
  if (!TABS.some((tab) => tab.id === app.tab)) app.tab = "aujourdhui";
}

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Le grand titre glisse sous la barre du haut ; la barre prend alors son fond flouté
// et affiche le titre en petit.
let scrollQueued = false;
function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const y = window.scrollY;
    const bar = document.getElementById("barre");
    bar.classList.toggle("topbar-scrolled", y > 2);
    const progress = Math.min(Math.max((y - 18) / 26, 0), 1);
    bar.style.setProperty("--small-title", String(progress));
    document.getElementById("grand-titre").style.opacity = String(1 - progress);
  });
}

// Tirer vers le bas, tout en haut de la page : un anneau se remplit avec le geste ;
// plein, il suffit de relâcher, il tourne pendant l'actualisation puis tout revient.
function setupPullToRefresh() {
  const indicator = document.getElementById("tirer");
  const content = document.getElementById("contenu");
  const THRESHOLD = 80;
  let startY = null;
  let pulled = 0;

  const place = (distance, armed) => {
    indicator.style.setProperty("--pull", String(Math.min(distance / THRESHOLD, 1)));
    indicator.style.transform = `translateY(${Math.min(distance, THRESHOLD + 30) - 46}px)`;
    indicator.classList.toggle("ptr-armed", armed);
    content.style.transform = distance > 0 ? `translateY(${Math.min(distance, THRESHOLD + 30)}px)` : "";
  };
  const settle = () => {
    indicator.classList.add("ptr-settling");
    content.classList.add("ptr-settling");
    place(0, false);
    setTimeout(() => {
      indicator.classList.remove("ptr-settling", "ptr-loading");
      content.classList.remove("ptr-settling");
    }, 320);
  };

  document.addEventListener("touchstart", (event) => {
    const blocked = document.body.dataset.screen !== "ecran-principal" || document.body.classList.contains("sheet-open")
      || document.body.classList.contains("viewer-open") || indicator.classList.contains("ptr-loading");
    // Le doigt posé sur un graphique lit la courbe : ce n'est pas un geste pour actualiser.
    const onChart = event.target && event.target.closest && event.target.closest(".g-plot");
    startY = !blocked && !onChart && window.scrollY <= 0 && event.touches.length === 1 ? event.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (startY === null) return;
    const raw = event.touches[0].clientY - startY;
    if (raw <= 0 || window.scrollY > 0) {
      if (pulled) place(0, false);
      pulled = 0;
      return;
    }
    if (event.cancelable) event.preventDefault();
    pulled = raw * 0.5; // de la résistance, comme un élastique
    place(pulled, pulled >= THRESHOLD);
  }, { passive: false });
  document.addEventListener("touchend", async () => {
    if (startY === null) return;
    startY = null;
    if (pulled >= THRESHOLD) {
      indicator.classList.add("ptr-settling", "ptr-loading");
      content.classList.add("ptr-settling");
      place(56, true);
      await refresh();
      settle();
    } else if (pulled > 0) {
      settle();
    }
    pulled = 0;
  });
}

function registerServiceWorker() {
  // La démo (jamais publiée) se passe de copie hors ligne et de notifications.
  if (!("serviceWorker" in navigator) || isDemo()) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Une nouvelle version de l'appli vient de s'installer : on recharge une fois.
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
    /* sans service worker, l'appli marche en ligne */
  });
}

function boot() {
  document.addEventListener("click", onClick);
  document.getElementById("rafraichir").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.classList.add("icon-spinning");
    await refresh();
    button.classList.remove("icon-spinning");
  });
  document.getElementById("reglages").addEventListener("click", openSettings);
  document.getElementById("cle-formulaire").addEventListener("submit", onKeySubmit);
  document.getElementById("cle-continuer").addEventListener("click", () => enterMain(true));
  document.getElementById("continuer-navigateur").addEventListener("click", () => {
    store.set(STORAGE.browser, true);
    start();
  });
  document.querySelectorAll("[data-token-page]").forEach((link) => { link.href = TOKEN_PAGE; });
  setupTabs();
  setupPullToRefresh();
  window.addEventListener("scroll", onScroll, { passive: true });
  registerServiceWorker();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.body.dataset.screen === "ecran-principal"
      && Date.now() - app.lastFetch > 10 * 60_000) refresh({ quiet: true });
  });
  window.addEventListener("online", () => {
    if (app.offline) refresh({ quiet: true });
  });
  start();
}

function start() {
  if (isDemo()) {
    demoStart();
    return;
  }
  if (!isStandalone() && !store.get(STORAGE.browser, false)) {
    show("ecran-installer");
    return;
  }
  if (!getToken()) {
    showKeyScreen();
    return;
  }
  enterMain();
}

// En démo seulement : `&onglet=suivi`, `&feuille=achat|vente|ordre|versement|saute|reglages|bilan`,
// `&ecran=cle|installer`, `&defile=600`, `&capture=1` et `&remplir=1` ouvrent directement un écran, pour essayer
// et faire des captures.
async function demoStart() {
  const params = new URLSearchParams(location.search);
  // `&capture=1` : sans transitions, pour qu'une capture d'écran montre l'état final.
  if (params.get("capture") === "1") document.documentElement.classList.add("sans-transition");
  const screen = params.get("ecran");
  if (screen === "cle") {
    showKeyScreen();
    return;
  }
  if (screen === "installer") {
    show("ecran-installer");
    return;
  }
  const tab = params.get("onglet");
  if (TABS.some((t) => t.id === tab)) app.tab = tab;
  await enterMain();
  const sheet = params.get("feuille");
  const order = ((app.data && app.data.actions && app.data.actions.orders) || [])[0];
  const openers = {
    achat: () => openPurchase(app, {}),
    vente: () => openChooser(app),
    ordre: () => order && openOrder(app, order.id),
    versement: () => openContribution(app),
    saute: () => openSkip(app),
    reglages: () => openSettings(),
    bilan: () => openWeekly(),
    comptes: () => openAccounts(app),
  };
  if (openers[sheet]) openers[sheet]();
  // `&remplir=1` avec `&feuille=achat` : remplit l'achat et passe à la confirmation.
  const form = document.querySelector(".sheet form");
  if (params.get("remplir") === "1" && form && form.elements.quantity && form.elements.price) {
    form.elements.quantity.value = "0,68";
    form.elements.price.value = "146,20";
    form.requestSubmit();
  }
  const scrolled = Number(params.get("defile"));
  if (scrolled > 0) {
    window.scrollTo(0, scrolled);
    onScroll();
  }
}

boot();

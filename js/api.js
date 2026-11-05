// L'API GitHub : lire donnees.json dans le dépôt privé, envoyer une saisie.
// La clé reste dans l'iPhone ; elle ne part que vers api.github.com.

import { API, DATA_BRANCH, DATA_CACHE, DATA_FILE, JOURNAL_BRANCH, JOURNAL_FILE, REPO, STORAGE } from "./config.js";
import { isDemo, store } from "./outils.js";

export class ApiError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind; // cle | acces | lecture | ecriture | absent | reseau | autre
    this.status = status;
  }
}

export function getToken() {
  return store.get(STORAGE.token, "") || "";
}

export function setToken(token) {
  return store.set(STORAGE.token, token);
}

export function forgetToken() {
  store.remove(STORAGE.token);
}

function headers(token, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function call(url, options) {
  try {
    return await fetch(url, { cache: "no-store", ...options });
  } catch {
    throw new ApiError("reseau", "Pas de connexion.");
  }
}

const DATA_URL = `${API}/repos/${REPO}/contents/${DATA_FILE}?ref=${DATA_BRANCH}`;

// Les dernières données, depuis GitHub. Lève ApiError avec un message pour Alexis.
export async function fetchData(token = getToken()) {
  if (isDemo()) return fetchDemo();
  const response = await call(DATA_URL, { headers: headers(token, "application/vnd.github.raw+json") });
  if (response.status === 401) throw new ApiError("cle", "Ta clé ne marche plus : elle est fausse ou a expiré.", 401);
  if (response.status === 403) throw new ApiError("lecture", "Ta clé n'a pas le droit de lire AlphaScope.", 403);
  if (response.status === 404) {
    throw new ApiError("absent", "Pas encore de données : le prochain calcul du matin les créera.", 404);
  }
  if (!response.ok) throw new ApiError("autre", `GitHub ne répond pas comme prévu (${response.status}).`, response.status);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError("autre", "Les données reçues sont illisibles.");
  }
  // Un calcul dont le rapport a échoué arrive sans `summary` : on garde alors le
  // dernier rapport complet de la copie (et ses figures), daté, au lieu de l'effacer.
  if (!data.summary) {
    const kept = keepLastSummary(data, await cachedData());
    if (kept !== data) {
      await saveCopy(JSON.stringify(kept));
      return kept;
    }
  }
  await saveCopy(text);
  return data;
}

function keepLastSummary(data, previous) {
  if (!previous || !previous.summary) return data;
  return {
    ...data,
    summary: previous.summary,
    weekly: data.weekly || previous.weekly || null,
    images: { ...(previous.images || {}), ...(data.images || {}) },
    charts: { ...(previous.charts || {}), ...(data.charts || {}) },
    stale_summary: previous.stale_summary || { report_date: previous.report_date, generated_at: previous.generated_at },
  };
}

async function fetchDemo() {
  const response = await call("./demo/donnees-demo.json", {});
  if (!response.ok) throw new ApiError("absent", "Données de démonstration introuvables.", response.status);
  return response.json();
}

// La dernière copie, pour ouvrir l'appli sans réseau.
async function saveCopy(text) {
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put("./donnees.json", new Response(text, { headers: { "Content-Type": "application/json" } }));
  } catch {
    /* pas de cache : l'appli marche quand même, sans copie hors ligne */
  }
}

export async function cachedData() {
  if (isDemo()) return null;
  try {
    const cache = await caches.open(DATA_CACHE);
    const response = await cache.match("./donnees.json");
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function forgetCopy() {
  try {
    await caches.delete(DATA_CACHE);
  } catch {
    /* rien à effacer */
  }
}

const JOURNAL_URL = `${API}/repos/${REPO}/contents/${JOURNAL_FILE}?ref=${JOURNAL_BRANCH}`;

// Le journal des saisies tel que la boîte de réception vient de l'écrire
// (la plus récente à la fin) : la réponse arrive ici une demi-minute après l'envoi,
// bien avant le nouveau donnees.json.
export async function fetchJournal(token = getToken()) {
  if (isDemo()) return [];
  const response = await call(JOURNAL_URL, { headers: headers(token, "application/vnd.github.raw+json") });
  if (response.status === 404) return [];
  if (response.status === 401) throw new ApiError("cle", "Ta clé ne marche plus : elle est fausse ou a expiré.", 401);
  if (!response.ok) throw new ApiError("autre", `GitHub ne répond pas comme prévu (${response.status}).`, response.status);
  try {
    const data = await response.json();
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

// Vérifie une clé collée : accès au dépôt, lecture des données, envoi des saisies.
// Renvoie { canRead, canWrite, hasData } ou lève ApiError.
export async function checkToken(token) {
  const repo = await call(`${API}/repos/${REPO}`, { headers: headers(token) });
  if (repo.status === 401) throw new ApiError("cle", "Cette clé ne marche pas : elle est fausse ou a expiré. Recrée-en une.", 401);
  if (repo.status === 404 || repo.status === 403) {
    throw new ApiError("acces", "Cette clé n'a pas accès à AlphaScope. Dans « Repository access », choisis « Only select repositories » puis AlphaScope.", repo.status);
  }
  if (!repo.ok) throw new ApiError("autre", `GitHub ne répond pas comme prévu (${repo.status}). Réessaie dans un moment.`, repo.status);

  const data = await call(DATA_URL, { method: "GET", headers: headers(token, "application/vnd.github.raw+json") });
  if (data.status === 403) {
    throw new ApiError("lecture", "Cette clé ne peut pas lire AlphaScope. Dans « Permissions », mets « Contents » sur « Read and write ».", 403);
  }
  const hasData = data.ok;
  if (hasData) await saveCopy(await data.text());

  // Un envoi sans effet (aucun calcul n'écoute « appli-verification ») dit si la clé peut écrire.
  const probe = await call(`${API}/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "appli-verification", client_payload: {} }),
  });
  return { canRead: true, canWrite: probe.status === 204, hasData };
}

// Envoie une saisie (docs/APPLI.md §2). Rien n'est mis en file d'attente : hors ligne, c'est refusé.
export async function dispatch(payload, token = getToken()) {
  if (isDemo()) return true;
  if (navigator.onLine === false) throw new ApiError("reseau", "Pas de connexion : rien n'a été envoyé. Réessaie quand tu as du réseau.");
  const response = await call(`${API}/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "appli", client_payload: payload }),
  });
  if (response.status === 204) return true;
  if (response.status === 401) throw new ApiError("cle", "Ta clé ne marche plus : elle est fausse ou a expiré. Rien n'a été envoyé.", 401);
  if (response.status === 403 || response.status === 404) {
    throw new ApiError("ecriture", "Ta clé ne permet pas d'envoyer tes saisies : mets « Contents » sur « Read and write ». Rien n'a été envoyé.", response.status);
  }
  throw new ApiError("autre", `GitHub a refusé l'envoi (${response.status}). Rien n'a été noté, réessaie.`, response.status);
}

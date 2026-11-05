// Les notifications sur l'iPhone (docs/APPLI.md §3) : s'abonner, tester, se désabonner.
// Sur iPhone, elles ne marchent que dans l'appli ouverte depuis l'écran d'accueil (iOS 16.4 ou plus).

import { STORAGE } from "./config.js";
import { isDemo, isStandalone, store } from "./outils.js";

function base64UrlToBytes(text) {
  const padded = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Où en sont les notifications sur cet appareil : une phrase et ce qu'on peut faire.
export async function pushState(data) {
  const key = data && data.push && data.push.vapid_public_key;
  if (isDemo()) return { state: "demo", text: "En démo, rien n'est envoyé : les boutons montrent seulement le déroulé." };
  if (!isStandalone()) {
    return { state: "browser", text: "Les notifications ne marchent que dans l'appli ouverte depuis l'écran d'accueil de l'iPhone." };
  }
  if (!pushSupported()) {
    return { state: "unsupported", text: "Cet iPhone ne permet pas encore les notifications d'appli web : il faut iOS 16.4 ou plus (Réglages → Général → Mise à jour)." };
  }
  if (!key) return { state: "nokey", text: "Les notifications arrivent bientôt : leur clé n'est pas encore créée." };
  if (Notification.permission === "denied") {
    return { state: "denied", text: "Notifications refusées. Pour les remettre : Réglages de l'iPhone → Notifications → AlphaScope." };
  }
  const subscription = await currentSubscription();
  if (subscription && Notification.permission === "granted") return { state: "on", text: "Activées sur cet iPhone." };
  return { state: "off", text: "Désactivées sur cet iPhone." };
}

async function currentSubscription() {
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// À appeler depuis un toucher (iOS l'exige). Renvoie le message à envoyer, ou lève une erreur lisible.
export async function subscribe(data) {
  const key = data && data.push && data.push.vapid_public_key;
  if (!key) throw new Error("Les notifications ne sont pas encore prêtes : leur clé n'est pas créée.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Tu n'as pas autorisé les notifications. Tu peux le faire dans Réglages → Notifications → AlphaScope.");
  }
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // Une clé changée côté AlphaScope rend l'ancien abonnement inutile.
    const current = subscription.options && subscription.options.applicationServerKey;
    const wanted = base64UrlToBytes(key);
    const same = current && new Uint8Array(current).every((byte, i) => byte === wanted[i]) && new Uint8Array(current).length === wanted.length;
    if (!same) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
  }
  const json = subscription.toJSON();
  store.set(STORAGE.push, { endpoint: json.endpoint, at: new Date().toISOString() });
  return {
    action: "abonnement",
    data: { subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, device: "iPhone" },
  };
}

export async function unsubscribe() {
  const subscription = await currentSubscription();
  const endpoint = subscription ? subscription.endpoint : (store.get(STORAGE.push, {}) || {}).endpoint;
  if (subscription) await subscription.unsubscribe();
  store.remove(STORAGE.push);
  return endpoint ? { action: "desabonnement", data: { endpoint } } : null;
}

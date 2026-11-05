// Une feuille qui monte du bas de l'écran (saisies, réglages, bilan), comme sur iOS :
// elle arrive avec un léger ressort et se ferme en la glissant vers le bas.

import { esc } from "./outils.js";

let current = null;
const CLOSE_DISTANCE = 110; // px tirés vers le bas pour fermer
const CLOSE_SPEED = 0.55;   // px/ms : un geste vif ferme même s'il est court

export function openSheet({ title, body, onMount, onClose, wide = false }) {
  closeSheet(true);
  const root = document.getElementById("sheet-root");
  const wrapper = document.createElement("div");
  wrapper.className = "sheet-wrapper";
  wrapper.innerHTML = `<div class="sheet-backdrop" data-close></div>`
    + `<div class="sheet${wide ? " sheet-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">`
    + `<div class="sheet-handle"><div class="sheet-grip" aria-hidden="true"></div>`
    + `<header class="sheet-header"><h2 id="sheet-title">${esc(title)}</h2>`
    + `<button type="button" class="sheet-close" data-close>Fermer</button></header></div>`
    + `<div class="sheet-body"></div></div>`;
  const content = wrapper.querySelector(".sheet-body");
  if (typeof body === "string") content.innerHTML = body;
  else if (body) content.append(body);
  wrapper.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closeSheet();
  });
  root.append(wrapper);
  document.body.classList.add("sheet-open");
  // La feuille est d'abord posée en bas (lecture de sa hauteur), puis elle monte.
  void wrapper.offsetHeight;
  wrapper.classList.add("sheet-visible");
  current = { wrapper, onClose, content };
  setupDrag(wrapper);
  if (onMount) onMount(content, wrapper);
  return current;
}

export function closeSheet(immediate = false) {
  if (!current) return;
  const { wrapper, onClose } = current;
  current = null;
  document.body.classList.remove("sheet-open");
  if (onClose) onClose();
  if (immediate) {
    wrapper.remove();
    return;
  }
  const sheet = wrapper.querySelector(".sheet");
  sheet.style.transform = "";
  wrapper.classList.remove("sheet-visible");
  wrapper.classList.add("sheet-leaving");
  setTimeout(() => wrapper.remove(), 380);
}

export function sheetContent() {
  return current ? current.content : null;
}

// Glisser vers le bas : depuis la poignée et l'en-tête, ou depuis le contenu quand il
// est tout en haut. La feuille suit le doigt, le fond s'éclaircit ; relâchée assez bas
// (ou d'un geste vif), elle se ferme, sinon elle revient en place.
function setupDrag(wrapper) {
  const sheet = wrapper.querySelector(".sheet");
  const handle = wrapper.querySelector(".sheet-handle");
  const body = wrapper.querySelector(".sheet-body");
  const backdrop = wrapper.querySelector(".sheet-backdrop");
  let start = null;

  const begin = (y, fromHandle) => {
    start = { y, time: performance.now(), fromHandle, dragging: false, last: y, lastTime: performance.now(), speed: 0 };
  };
  const move = (y, event) => {
    if (!start) return;
    const dy = y - start.y;
    if (!start.dragging) {
      // Depuis le contenu, on ne prend la main que s'il est en haut et qu'on tire vers le bas.
      if (dy <= 4) return;
      if (!start.fromHandle && body.scrollTop > 0) {
        start = null;
        return;
      }
      start.dragging = true;
      sheet.classList.add("sheet-dragging");
      backdrop.style.transition = "none";
    }
    if (event && event.cancelable) event.preventDefault();
    const now = performance.now();
    start.speed = (y - start.last) / Math.max(now - start.lastTime, 1);
    start.last = y;
    start.lastTime = now;
    const offset = Math.max(0, dy);
    sheet.style.transform = `translateY(${offset}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - offset / (sheet.offsetHeight || 600)));
  };
  const end = () => {
    if (!start) return;
    const { dragging, speed } = start;
    const offset = start.last - start.y;
    start = null;
    sheet.classList.remove("sheet-dragging");
    backdrop.style.transition = "";
    backdrop.style.opacity = "";
    if (!dragging) return;
    if (offset > CLOSE_DISTANCE || speed > CLOSE_SPEED) {
      closeSheet();
    } else {
      sheet.style.transform = "";
    }
  };

  wrapper.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || event.target.closest("input, select, textarea")) return;
    begin(event.touches[0].clientY, Boolean(event.target.closest(".sheet-handle")));
  }, { passive: true });
  wrapper.addEventListener("touchmove", (event) => move(event.touches[0].clientY, event), { passive: false });
  wrapper.addEventListener("touchend", end);
  wrapper.addEventListener("touchcancel", end);

  // À la souris (ordinateur) : seulement depuis la poignée.
  handle.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.target.closest("button")) return;
    begin(event.clientY, true);
    const onMove = (e) => move(e.clientY, null);
    const onUp = () => {
      end();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSheet();
});

// Un graphique en plein écran : pincer pour zoomer, glisser pour déplacer,
// toucher deux fois pour agrandir ou revenir, « Fermer » pour sortir.

let overlay = null;

export function openViewer(source, title) {
  closeViewer();
  overlay = document.createElement("div");
  overlay.className = "viewer";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title || "Graphique");
  overlay.innerHTML = `<button type="button" class="viewer-close">Fermer</button>`
    + `<div class="viewer-stage"><img alt=""></div>`
    + `<p class="viewer-hint">Pince pour zoomer · touche deux fois pour agrandir</p>`;
  const image = overlay.querySelector("img");
  image.src = source;
  image.alt = title || "";
  document.body.append(overlay);
  document.body.classList.add("viewer-open");
  overlay.querySelector(".viewer-close").addEventListener("click", closeViewer);
  overlay.querySelector(".viewer-close").focus();

  const stage = overlay.querySelector(".viewer-stage");
  const state = { scale: 1, x: 0, y: 0 };
  const pointers = new Map();
  let start = null;
  let lastTap = 0;

  const apply = () => {
    state.scale = Math.min(Math.max(state.scale, 1), 5);
    if (state.scale === 1) {
      state.x = 0;
      state.y = 0;
    }
    image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  };

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  stage.addEventListener("pointerdown", (event) => {
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) start = { distance: distance(), scale: state.scale, x: state.x, y: state.y };
    else start = { px: event.clientX, py: event.clientY, x: state.x, y: state.y, scale: state.scale };
    const now = Date.now();
    if (pointers.size === 1 && now - lastTap < 300) {
      state.scale = state.scale > 1 ? 1 : 2.5;
      apply();
    }
    lastTap = now;
  });
  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && start && start.distance) {
      state.scale = start.scale * (distance() / start.distance);
    } else if (pointers.size === 1 && start && state.scale > 1) {
      state.x = start.x + (event.clientX - start.px);
      state.y = start.y + (event.clientY - start.py);
    }
    apply();
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      start = { px: p.x, py: p.y, x: state.x, y: state.y, scale: state.scale };
    } else {
      start = null;
    }
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  // Safari envoie aussi ses propres gestes de pincement : bloqués, pour que
  // seul le graphique zoome et pas toute la page.
  stage.addEventListener("gesturestart", (event) => event.preventDefault());
  stage.addEventListener("gesturechange", (event) => event.preventDefault());
}

export function closeViewer() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.body.classList.remove("viewer-open");
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeViewer();
});

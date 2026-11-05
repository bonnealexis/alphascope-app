// Si l'appli plante, le dire à l'écran plutôt que laisser une page blanche.
// (Un fichier à part : la politique de sécurité de la page interdit le script en ligne.)
(function () {
  var last = "";
  function show(message) {
    last = message || last || "erreur inconnue";
    var box = document.getElementById("erreur-appli");
    if (!box) return;
    box.hidden = false;
    box.textContent = "Un problème dans l'appli (" + last + "). Ferme-la et rouvre-la.";
  }
  addEventListener("error", function (event) { show(event.message); });
  addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    show(reason && reason.message ? reason.message : String(reason));
  });
  setTimeout(function () { if (!document.body.dataset.screen) show("démarrage impossible"); }, 8000);
})();

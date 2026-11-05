// Réglages fixes de l'appli. Ils reprennent config/appli.json du dépôt privé
// (dépôt, branche et fichier des données) : à changer aux deux endroits.
// Aucun chiffre personnel ici : ce fichier est publié sur un dépôt public.

export const REPO = "bonnealexis/AlphaScope";
export const DATA_BRANCH = "appli";
export const DATA_FILE = "donnees.json";
export const API = "https://api.github.com";
export const TOKEN_PAGE = "https://github.com/settings/personal-access-tokens/new";

// Après une saisie : son verdict se lit dans le journal des saisies (branche main)
// toutes les 12 s ; sans verdict au bout de 3 min, « pas encore traité » (jamais
// de renvoi automatique). L'écran attend ensuite le nouveau donnees.json, relu
// toutes les 20 s, 5 min au plus.
export const JOURNAL_FILE = "data/appli_journal.json";
export const JOURNAL_BRANCH = "main";
export const VERDICT_EVERY_MS = 12_000;
export const VERDICT_PATIENCE_MS = 3 * 60_000;
export const DATA_EVERY_MS = 20_000;
export const DATA_LIMIT_MS = 5 * 60_000;
// Une saisie sans réponse depuis 30 min n'est plus montrée « en cours ».
export const PENDING_EXPIRY_MS = 30 * 60_000;

// Saisies que le calcul ne recopie pas dans le journal tout de suite
// (pas de nouveau calcul après elles) : on n'attend pas leur réponse.
export const UNTRACKED_ACTIONS = new Set(["abonnement", "desabonnement", "test_notification"]);

// Répartition des cartes du mail entre les onglets (section.id, docs/APPLI.md §1.1).
export const TABS = [
  { id: "aujourdhui", label: "Aujourd'hui", sections: ["positions", "a_noter"] },
  { id: "idees", label: "Idées", sections: ["etf", "familles", "actions"] },
  { id: "suivi", label: "Suivi", sections: ["ordres", "crypto"] },
  { id: "portefeuille", label: "Portefeuille", sections: ["portefeuille", "cad_chf"] },
];

export const STORAGE = {
  token: "alphascope.cle",
  pending: "alphascope.saisies-en-cours",
  browser: "alphascope.continuer-navigateur",
  push: "alphascope.notifications",
  tab: "alphascope.onglet",
};

export const DATA_CACHE = "alphascope-donnees";

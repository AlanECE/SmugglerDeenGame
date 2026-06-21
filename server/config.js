// =============================================================
//  Paramètres d'équilibrage administrables
//  Modifie ces valeurs pour ajuster le fun sans toucher au code.
// =============================================================

const config = {
  // Joueurs
  minPlayers: 3,
  maxPlayers: 6,

  // Structure de partie
  totalRounds: 8, // nombre de manches (le douanier tourne à chaque manche)

  // Économie
  startingCoins: 20, // solde initial par joueur
  maxBribe: 10, // pot-de-vin maximum
  cargoMin: 1, // taille minimale de la cargaison
  cargoMax: 3, // taille maximale de la cargaison
  handSize: 5, // nombre de cartes distribuées au contrebandier

  // Règles d'équilibrage (version recommandée du cahier des charges)
  // - Le douanier laisse passer  -> il prend le pot-de-vin.
  // - Il ouvre et le joueur ment -> il confisque l'illégal + prend une amende.
  // - Il ouvre et le joueur dit vrai -> pas de pot-de-vin + indemnité au joueur.
  unjustifiedSearchIndemnity: 2, // indemnité versée au joueur en cas de fouille injustifiée
  falseDeclarationFine: 3, // amende de base en cas de fausse déclaration sans contrebande

  // Timers serveur (ms). 0 = pas de timer.
  preparePhaseMs: 90000, // temps pour préparer sa cargaison
  inspectDecisionMs: 30000, // temps par décision du douanier
  summaryAutoAdvanceMs: 20000, // passage auto à la manche suivante

  // Tirage des cartes : poids relatif (le légal est plus fréquent)
  legalDrawWeight: 2,
  illegalDrawWeight: 1,
};

module.exports = config;

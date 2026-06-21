// =============================================================
//  Douane & Contrebande — module de règles (logic.js)
//  Fonctions pures côté serveur. Source de vérité unique.
//  Aucun import, aucun timer (contrat de la plateforme).
// =============================================================

export const meta = { game: "Douane & Contrebande", minPlayers: 1, maxPlayers: 10 };

// ---- Paramètres d'équilibrage ----
const CFG = {
  startMin: 3,          // joueurs minimum pour lancer (le moteur démarre lui à 1)
  totalRounds: 8,
  startingCoins: 20,
  maxBribe: 10,
  cargoMin: 1,
  cargoMax: 3,
  handSize: 5,
  indemnity: 2,         // indemnité en cas de fouille injustifiée
  falseFine: 3,         // amende de base pour fausse déclaration sans contrebande
  legalWeight: 2,
  illegalWeight: 1,
  pistolRoundChance: 0.28, // proba qu'UN pistolet apparaisse dans une manche (manche 2+)
  begThreshold: 3,      // mendicité possible si solde < 3
};

// Économie :
//  - cost  = prix payé pour METTRE l'objet dans le coffre (au verrouillage).
//  - value = ce que l'objet RAPPORTE s'il passe (revente / compensation).
//  Légal  : cost 1-3, value = cost + 2 (profit de 2).
//  Illégal: value = ancienne valeur +40%, cost ≈ moitié du prix,
//           amende si saisi = penalty (= la valeur qu'il devait rapporter).
const ITEMS = {
  pasta: { name: "Pâtes", legal: true, cost: 1, value: 3 },
  eggs: { name: "Œufs", legal: true, cost: 1, value: 3 },
  coffee: { name: "Café", legal: true, cost: 2, value: 4 },
  cheese: { name: "Fromage", legal: true, cost: 3, value: 5 },
  weed: { name: "Weed", legal: false, cost: 3, value: 7, penalty: 7 },
  cocaine: { name: "Cocaïne", legal: false, cost: 5, value: 10, penalty: 10 },
  fakepapers: { name: "Faux papiers", legal: false, cost: 4, value: 8, penalty: 8 },
  watches: { name: "Montres volées", legal: false, cost: 3, value: 7, penalty: 7 },
  // Contrebande de plus en plus risquée (débloquée au fil des manches) : gros gain / grosse perte.
  diamonds: { name: "Diamants volés", legal: false, cost: 6, value: 12, penalty: 13 },
  ivory: { name: "Ivoire", legal: false, cost: 7, value: 14, penalty: 16 },
  arms: { name: "Armes", legal: false, cost: 8, value: 16, penalty: 18 },
  // Contrebande ultime : éco spéciale (+30 / -25), exempte du coût d'achat.
  pistol: { name: "Pistolet", legal: false, cost: 0, value: 30, penalty: 25, special: true },
  // Bombe nucléaire : 1 fois/partie. Si elle passe -> fin de partie, le marchand GAGNE.
  // Si saisie -> -50 pièces.
  nuke: { name: "Bombe nucléaire", legal: false, cost: 0, value: 0, penalty: 50, special: true, nuke: true },
};
const LEGAL_IDS = Object.keys(ITEMS).filter((k) => ITEMS[k].legal && !ITEMS[k].special);

// Diversité croissante : nouveaux items illégaux de plus en plus risqués à chaque manche.
function poolForRound(round) {
  const ids = ["pasta", "eggs", "weed"];            // manche 1
  if (round >= 2) ids.push("coffee", "watches");    // manche 2
  if (round >= 3) ids.push("cheese", "fakepapers"); // manche 3
  if (round >= 4) ids.push("cocaine");              // manche 4
  if (round >= 5) ids.push("diamonds");             // manche 5 : +risqué
  if (round >= 6) ids.push("ivory");                // manche 6 : ++
  if (round >= 7) ids.push("arms");                 // manche 7+ : +++
  return ids;
}
const COLORS = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#9d4edd", "#f4a261"];

// ---- utilitaires purs ----
function randInt(n) { return Math.floor(Math.random() * n); }
function drawItem(round) {
  // Le pistolet n'est JAMAIS tiré normalement (inséré à part, manche 2+).
  const pool = [];
  for (const id of poolForRound(round)) {
    const w = ITEMS[id].legal ? CFG.legalWeight : CFG.illegalWeight;
    for (let i = 0; i < w; i++) pool.push(id);
  }
  return pool[randInt(pool.length)];
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort(), y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}
function newStats() {
  return {
    smuggledThrough: 0, liesSuccessful: 0, bustedAsSmuggler: 0,
    correctSearches: 0, wrongSearches: 0, bribesAccepted: 0,
    bribesPaid: 0, winStreak: 0, bestStreak: 0, netGain: 0,
  };
}
function findPlayer(s, id) { return s.players.find((p) => p.id === id); }
function smugglerIds(s) { return s.players.filter((p) => p.id !== s.officerId && !p.eliminated).map((p) => p.id); }
function pickOfficer(s) {
  const N = s.players.length;
  let idx = (s.officerStartIndex + s.round - 1) % N;
  let guard = 0;
  while (s.players[idx].eliminated && guard++ < N) idx = (idx + 1) % N;
  return s.players[idx].id;
}

// =============================================================
//  setup
// =============================================================
export function setup(players) {
  const s = {
    phase: "lobby",
    round: 0,
    totalRounds: CFG.totalRounds,
    hostId: players[0],
    officerId: null,
    officerStartIndex: 0,
    players: [],
    subs: {},
    inspectOrder: [],
    inspectIndex: 0,
    roundEvents: [],
    lastReveal: null,
    chat: [],
    begged: [],      // ids ayant déjà mendié cette partie (1 fois max)
    begging: null,   // session de mendicité en cours { id, byName, total, donations:[] }
    debts: {},       // dette morale : beneficiaryId -> { donorId: total donné }
    cap: 10,         // nombre de joueurs max réglable par l'hôte (3 à 10) — 10 par défaut
    nukeRound: 0,    // manche où apparaît la bombe nucléaire
    nukeSpawned: false,
    nukeWinner: null,// marchand qui a fait passer la bombe (gagne la partie)
  };
  for (const id of players) addToRoster(s, id, null);
  return s;
}

function addToRoster(s, id, name) {
  if (s.players.some((p) => p.id === id)) return;
  if (s.players.length >= meta.maxPlayers) return; // seule limite dure : 10
  const idx = s.players.length;
  s.players.push({
    id,
    name: name || "Joueur",
    color: COLORS[idx % COLORS.length],
    avatar: idx % 6,
    coins: CFG.startingCoins,
    negRounds: 0,       // manches consécutives en solde négatif
    eliminated: false,  // éliminé après >3 manches en négatif
    stats: newStats(),
  });
  // L'hôte est toujours un joueur présent (utile après une revanche qui réinitialise la liste).
  if (!s.players.some((p) => p.id === s.hostId)) s.hostId = s.players[0].id;
  // Le nombre de joueurs prévu s'agrandit automatiquement si plus de monde rejoint (jusqu'à 10).
  if (s.players.length > (s.cap || 0)) s.cap = s.players.length;
}

// =============================================================
//  validateAction
// =============================================================
export function validateAction(state, playerId, action) {
  if (!action || typeof action.type !== "string") return { ok: false, error: "Action invalide" };
  const t = action.type;

  if (t === "hello") return { ok: true };
  if (t === "avatar") return { ok: true };
  if (t === "chat") return action.text ? { ok: true } : { ok: false, error: "Message vide" };

  const isHost = playerId === state.hostId;
  const isOfficer = playerId === state.officerId;

  if (t === "start") {
    if (state.phase !== "lobby") return { ok: false, error: "Partie déjà lancée" };
    if (!isHost) return { ok: false, error: "Seul l'hôte peut lancer" };
    if (state.players.length < CFG.startMin) return { ok: false, error: `Il faut au moins ${CFG.startMin} joueurs` };
    return { ok: true };
  }

  if (t === "set_cap") {
    if (state.phase !== "lobby") return { ok: false, error: "Réglable seulement dans le salon" };
    if (!isHost) return { ok: false, error: "Seul l'hôte règle le nombre de joueurs" };
    const n = parseInt(action.n, 10);
    if (!(n >= CFG.startMin && n <= meta.maxPlayers)) return { ok: false, error: `Entre ${CFG.startMin} et ${meta.maxPlayers}` };
    if (n < state.players.length) return { ok: false, error: "Déjà trop de joueurs présents" };
    return { ok: true };
  }

  if (t === "submit") {
    if (state.phase !== "prepare") return { ok: false, error: "Mauvaise phase" };
    if (isOfficer) return { ok: false, error: "Le douanier ne prépare pas de cargaison" };
    const sub = state.subs[playerId];
    if (!sub) return { ok: false, error: "Aucune cargaison" };
    if (sub.ready) return { ok: false, error: "Déjà validé" };
    const me0 = findPlayer(state, playerId);
    if (me0 && me0.eliminated) return { ok: false, error: "Tu es éliminé" };
    const items = Array.isArray(action.items) ? action.items : [];
    if (items.length < CFG.cargoMin || items.length > CFG.cargoMax)
      return { ok: false, error: `Choisis ${CFG.cargoMin} à ${CFG.cargoMax} objets` };
    // En solde négatif, impossible d'acheter une contrebande ultime (pistolet / bombe).
    if (me0 && me0.coins < 0 && items.some((id) => ITEMS[id] && ITEMS[id].special))
      return { ok: false, error: "Solde négatif : pistolet et bombe interdits" };
    const hand = [...sub.hand];
    for (const it of items) {
      const i = hand.indexOf(it);
      if (i === -1) return { ok: false, error: "Objet indisponible" };
      hand.splice(i, 1);
    }
    // Déclaration = liste de marchandises LÉGALES (1 à cargoMax, plusieurs types possibles).
    const decl = Array.isArray(action.decl) ? action.decl : [];
    if (decl.length < CFG.cargoMin || decl.length > CFG.cargoMax)
      return { ok: false, error: `Déclare ${CFG.cargoMin} à ${CFG.cargoMax} marchandises` };
    if (!decl.every((id) => ITEMS[id] && ITEMS[id].legal))
      return { ok: false, error: "On ne déclare que du légal" };
    return { ok: true };
  }

  if (t === "force_inspect") {
    if (state.phase !== "prepare") return { ok: false, error: "Mauvaise phase" };
    if (!isOfficer && !isHost) return { ok: false, error: "Réservé au douanier ou à l'hôte" };
    return { ok: true };
  }

  if (t === "decide") {
    if (state.phase !== "inspect") return { ok: false, error: "Mauvaise phase" };
    if (!isOfficer && !isHost) return { ok: false, error: "Seul le douanier décide" };
    const target = state.inspectOrder[state.inspectIndex];
    if (!target) return { ok: false, error: "Personne à traiter" };
    if (action.target && action.target !== target) return { ok: false, error: "Cible obsolète" };
    if (action.action !== "pass" && action.action !== "open") return { ok: false, error: "Décision invalide" };
    return { ok: true };
  }

  if (t === "raise_bribe") {
    if (state.phase !== "inspect") return { ok: false, error: "Mauvaise phase" };
    const target = state.inspectOrder[state.inspectIndex];
    if (playerId !== target) return { ok: false, error: "Seul le marchand contrôlé peut surenchérir" };
    const amt = parseInt(action.amount, 10);
    if (!(amt > 0)) return { ok: false, error: "Montant invalide" };
    const sub = state.subs[playerId];
    if (sub && sub.bribe >= CFG.maxBribe) return { ok: false, error: `Pot-de-vin déjà au max (${CFG.maxBribe})` };
    return { ok: true };
  }

  if (t === "next") {
    if (state.phase !== "summary") return { ok: false, error: "Mauvaise phase" };
    if (!isOfficer && !isHost) return { ok: false, error: "Réservé au douanier ou à l'hôte" };
    return { ok: true };
  }

  if (t === "beg_start") {
    if (state.phase !== "prepare" && state.phase !== "summary")
      return { ok: false, error: "Mendicité possible avant ou entre les manches" };
    if (state.round < 2) return { ok: false, error: "Pas de mendicité en première manche" };
    const p = findPlayer(state, playerId);
    if (!p) return { ok: false, error: "Joueur inconnu" };
    if (p.coins >= CFG.begThreshold) return { ok: false, error: `Mendicité réservée aux fauchés (< ${CFG.begThreshold} pièces)` };
    if ((state.begged || []).includes(playerId)) return { ok: false, error: "Tu as déjà mendié cette partie" };
    if (state.begging) return { ok: false, error: "Une mendicité est déjà en cours" };
    return { ok: true };
  }

  if (t === "beg_give") {
    if (!state.begging) return { ok: false, error: "Aucune mendicité en cours" };
    if (playerId === state.begging.id) return { ok: false, error: "Tu ne peux pas te donner à toi-même" };
    const donor = findPlayer(state, playerId);
    if (!donor) return { ok: false, error: "Joueur inconnu" };
    if (donor.eliminated) return { ok: false, error: "Tu es éliminé" };
    if (state.begging.gave && state.begging.gave[playerId] !== undefined)
      return { ok: false, error: "Tu as déjà donné (un seul don par personne)" };
    const amt = parseInt(action.amount, 10);
    if (!(amt >= 0)) return { ok: false, error: "Montant invalide" };
    // On ne peut pas s'endetter en donnant : max = solde courant.
    if (amt > Math.max(0, donor.coins)) return { ok: false, error: "Tu ne peux pas donner plus que ton solde" };
    return { ok: true };
  }

  if (t === "beg_end") {
    if (!state.begging) return { ok: false, error: "Aucune mendicité en cours" };
    if (playerId !== state.begging.id && playerId !== state.hostId)
      return { ok: false, error: "Réservé au mendiant ou à l'hôte" };
    return { ok: true };
  }

  if (t === "rematch") {
    if (state.phase !== "ended") return { ok: false, error: "Mauvaise phase" };
    if (!isHost) return { ok: false, error: "Seul l'hôte peut relancer" };
    return { ok: true };
  }

  return { ok: false, error: "Action inconnue" };
}

// =============================================================
//  applyAction
// =============================================================
export function applyAction(state, playerId, action) {
  const s = clone(state);
  const t = action.type;

  if (t === "hello") {
    const name = String(action.name || "Joueur").slice(0, 16) || "Joueur";
    const existing = findPlayer(s, playerId);
    // Le pseudo n'est modifiable que dans le salon ; il est figé au lancement.
    if (existing) { if (s.phase === "lobby") existing.name = name; }
    else if (s.phase === "lobby") addToRoster(s, playerId, name);
    return s;
  }

  if (t === "avatar") {
    const p = findPlayer(s, playerId);
    if (p) p.avatar = Math.max(0, Math.min(5, parseInt(action.avatar, 10) || 0));
    return s;
  }

  if (t === "chat") {
    const p = findPlayer(s, playerId);
    s.chat.push({
      name: p ? p.name : "??",
      color: p ? p.color : "#999",
      text: String(action.text).slice(0, 200),
    });
    if (s.chat.length > 30) s.chat.shift();
    return s;
  }

  if (t === "set_cap") {
    s.cap = parseInt(action.n, 10);
    return s;
  }

  if (t === "start") {
    s.round = 0;
    s.officerStartIndex = randInt(s.players.length);
    // Assez de manches pour que chacun soit douanier exactement 2 fois.
    s.totalRounds = 2 * s.players.length;
    // La bombe nucléaire apparaît une seule fois, dans une manche aléatoire (jamais la 1re).
    s.nukeSpawned = false;
    s.nukeWinner = null;
    s.nukeRound = 2 + randInt(Math.max(1, s.totalRounds - 1)); // entre 2 et totalRounds
    nextRound(s);
    return s;
  }

  if (t === "submit") {
    const sub = s.subs[playerId];
    const player = findPlayer(s, playerId);
    const hand = [...sub.hand];
    const chosen = [];
    for (const it of action.items) {
      const i = hand.indexOf(it);
      if (i !== -1) { hand.splice(i, 1); chosen.push(it); }
    }
    sub.items = chosen;
    sub.decl = (Array.isArray(action.decl) ? action.decl : []).filter((id) => ITEMS[id] && ITEMS[id].legal).slice(0, CFG.cargoMax);
    // Soldes négatifs autorisés : le pot-de-vin n'est plus bridé par le solde.
    sub.bribe = Math.max(0, Math.min(CFG.maxBribe, parseInt(action.bribe, 10) || 0));
    // Coût d'achat payé immédiatement pour charger le coffre (négatif autorisé).
    sub.cost = chosen.reduce((a, id) => a + (ITEMS[id].cost || 0), 0);
    player.coins -= sub.cost;
    player.stats.netGain -= sub.cost;
    sub.ready = true;
    if (smugglerIds(s).every((id) => s.subs[id] && s.subs[id].ready)) beginInspect(s);
    return s;
  }

  if (t === "force_inspect") {
    for (const id of smugglerIds(s)) {
      const sub = s.subs[id];
      if (sub && !sub.ready) {
        const legal = sub.hand.filter((x) => ITEMS[x].legal);
        const pick = (legal.length ? legal : sub.hand).slice(0, CFG.cargoMin);
        sub.items = pick.length ? pick : [sub.hand[0]];
        // Déclaration honnête par défaut : on déclare les objets légaux du coffre.
        const legalItems = sub.items.filter((x) => ITEMS[x].legal);
        sub.decl = legalItems.length ? legalItems : [LEGAL_IDS[0]];
        sub.bribe = 0;
        sub.cost = sub.items.reduce((a, id) => a + (ITEMS[id].cost || 0), 0);
        const pl = findPlayer(s, id);
        if (pl) { pl.coins -= sub.cost; pl.stats.netGain -= sub.cost; }
        sub.ready = true;
      }
    }
    beginInspect(s);
    return s;
  }

  if (t === "decide") {
    const targetId = s.inspectOrder[s.inspectIndex];
    const res = resolve(s, targetId, action.action === "open" ? "inspect" : "pass");
    s.roundEvents.push(res);
    s.lastReveal = res;
    s.inspectIndex += 1;
    // La bombe nucléaire qui passe met FIN à la partie : ce marchand gagne.
    if (res.nukePassed) { s.nukeWinner = res.smugglerId; s.phase = "ended"; return s; }
    if (s.inspectIndex >= s.inspectOrder.length) s.phase = "summary";
    return s;
  }

  if (t === "raise_bribe") {
    const targetId = s.inspectOrder[s.inspectIndex];
    const sub = s.subs[targetId];
    if (sub && targetId === playerId) {
      sub.bribe = Math.min(CFG.maxBribe, sub.bribe + parseInt(action.amount, 10));
    }
    return s;
  }

  if (t === "beg_start") {
    const p = findPlayer(s, playerId);
    s.begging = { id: playerId, byName: p ? p.name : "Joueur", total: 0, donations: [], gave: {} };
    s.begged = [...(s.begged || []), playerId];
    return s;
  }

  if (t === "beg_give") {
    if (s.begging && s.begging.gave[playerId] === undefined) {
      const donor = findPlayer(s, playerId);
      const ben = findPlayer(s, s.begging.id);
      // Un seul don par personne, plafonné au solde (pas d'endettement).
      const amt = Math.max(0, Math.min(parseInt(action.amount, 10) || 0, Math.max(0, donor ? donor.coins : 0)));
      if (donor && ben) {
        s.begging.gave[playerId] = amt; // verrouille le donneur, même pour 0
        if (amt > 0) {
          donor.coins -= amt;
          ben.coins += amt;
          s.begging.total += amt;
          s.begging.donations.push({ from: playerId, fromName: donor.name, amount: amt });
          s.debts[ben.id] = s.debts[ben.id] || {};
          s.debts[ben.id][playerId] = (s.debts[ben.id][playerId] || 0) + amt;
        }
      }
    }
    return s;
  }

  if (t === "beg_end") {
    s.begging = null;
    return s;
  }

  if (t === "next") {
    nextRound(s);
    return s;
  }

  if (t === "rematch") {
    // Nouvelle partie propre : on vide la liste et on n'y remet que l'hôte.
    // Les autres joueurs ENCORE connectés se ré-inscrivent automatiquement (hello),
    // les joueurs partis disparaissent — chaque partie a ses propres joueurs.
    const host = findPlayer(s, playerId);
    const keptName = host ? host.name : "Joueur";
    const keptAvatar = host ? host.avatar : 0;
    s.players = [];
    s.hostId = playerId;
    s.subs = {};
    s.roundEvents = [];
    s.lastReveal = null;
    s.inspectOrder = [];
    s.inspectIndex = 0;
    s.round = 0;
    s.officerId = null;
    s.phase = "lobby";
    s.begged = [];
    s.begging = null;
    s.debts = {};
    s.nukeSpawned = false;
    s.nukeWinner = null;
    s.nukeRound = 0;
    addToRoster(s, playerId, keptName);
    if (s.players[0]) s.players[0].avatar = keptAvatar;
    return s;
  }

  return s;
}

function nextRound(s) {
  s.round += 1;
  s.subs = {};
  s.roundEvents = [];
  s.lastReveal = null;
  s.inspectOrder = [];
  s.inspectIndex = 0;
  s.begging = null; // une mendicité ne traverse pas les manches
  // Élimination : >3 manches consécutives en solde négatif.
  for (const p of s.players) {
    if (p.coins < 0) p.negRounds = (p.negRounds || 0) + 1;
    else p.negRounds = 0;
    if (p.negRounds > 3) p.eliminated = true;
  }
  const active = s.players.filter((p) => !p.eliminated);
  // Fin si plus assez de joueurs (besoin d'un douanier + au moins un marchand) ou manches épuisées.
  if (s.round > s.totalRounds || active.length < 2) { s.phase = "ended"; return; }
  s.officerId = pickOfficer(s);
  const illegalThisRound = poolForRound(s.round).filter((x) => !ITEMS[x].legal);
  for (const id of smugglerIds(s)) {
    const hand = [];
    for (let i = 0; i < CFG.handSize; i++) hand.push(drawItem(s.round));
    // Garantie : il y a toujours AU MOINS une contrebande dans la main.
    if (!hand.some((x) => !ITEMS[x].legal)) {
      hand[randInt(hand.length)] = illegalThisRound[randInt(illegalThisRound.length)];
    }
    s.subs[id] = { hand, items: [], decl: [], bribe: 0, cost: 0, ready: false };
  }
  // Pistolet : JAMAIS en manche 1, au plus UN par manche, et rare.
  if (s.round > 1 && Math.random() < CFG.pistolRoundChance) {
    const sids = smugglerIds(s);
    if (sids.length) {
      const lucky = sids[randInt(sids.length)];
      const h = s.subs[lucky].hand;
      h[randInt(h.length)] = "pistol";
    }
  }
  // Bombe nucléaire : une seule fois dans la partie, à la manche tirée au sort.
  if (s.round === s.nukeRound && !s.nukeSpawned) {
    const sids = smugglerIds(s);
    if (sids.length) {
      const lucky = sids[randInt(sids.length)];
      const h = s.subs[lucky].hand;
      h[randInt(h.length)] = "nuke";
      s.nukeSpawned = true;
    }
  }
  s.phase = "prepare";
}

function beginInspect(s) {
  s.phase = "inspect";
  s.inspectOrder = smugglerIds(s).filter((id) => s.subs[id]);
  s.inspectIndex = 0;
  s.lastReveal = null;
}

function resolve(s, smugglerId, action) {
  const officer = findPlayer(s, s.officerId);
  const smuggler = findPlayer(s, smugglerId);
  const sub = s.subs[smugglerId];
  const items = sub.items.map((id) => ITEMS[id]);
  const hasContraband = items.some((it) => !it.legal);
  // Déclaration conforme : le coffre correspond EXACTEMENT à la liste déclarée.
  const matchesDeclaration = multisetEqual(sub.items, sub.decl);
  const isLie = hasContraband || !matchesDeclaration;

  const res = {
    smugglerId, smugglerName: smuggler.name, action,
    items: sub.items, decl: sub.decl, bribe: sub.bribe, cost: sub.cost || 0,
    isLie, hasContraband, hasPistol: sub.items.includes("pistol"), hasNuke: sub.items.includes("nuke"),
    nukePassed: sub.items.includes("nuke") && action === "pass",
    outcome: null, smugglerDelta: 0, officerDelta: 0,
  };

  if (action === "pass") {
    const resale = items.reduce((a, it) => a + it.value, 0);
    res.smugglerDelta = resale - sub.bribe;
    res.officerDelta = sub.bribe;
    res.outcome = "passed";
    res.resale = resale;
    smuggler.coins += res.smugglerDelta;
    officer.coins += res.officerDelta;
    smuggler.stats.smuggledThrough += 1;
    smuggler.stats.winStreak += 1;
    smuggler.stats.bestStreak = Math.max(smuggler.stats.bestStreak, smuggler.stats.winStreak);
    if (sub.bribe > 0) { smuggler.stats.bribesPaid += 1; officer.stats.bribesAccepted += 1; }
    if (isLie) smuggler.stats.liesSuccessful += 1;
  } else if (isLie) {
    const contrabandPenalty = items.filter((it) => !it.legal).reduce((a, it) => a + it.penalty, 0);
    const fine = hasContraband ? contrabandPenalty : CFG.falseFine;
    res.smugglerDelta = -fine;
    res.officerDelta = fine;
    res.outcome = "busted";
    res.fine = fine;
    smuggler.coins += res.smugglerDelta;
    officer.coins += res.officerDelta;
    smuggler.stats.bustedAsSmuggler += 1;
    smuggler.stats.winStreak = 0;
    officer.stats.correctSearches += 1;
  } else {
    // Honnête : le douanier verse le prix de la marchandise au joueur honnête.
    const resale = items.reduce((a, it) => a + it.value, 0);
    res.smugglerDelta = resale;
    res.officerDelta = -resale;
    res.outcome = "clean";
    res.resale = resale;
    smuggler.coins += res.smugglerDelta;
    officer.coins += res.officerDelta;
    smuggler.stats.smuggledThrough += 1;
    smuggler.stats.winStreak += 1;
    smuggler.stats.bestStreak = Math.max(smuggler.stats.bestStreak, smuggler.stats.winStreak);
    officer.stats.wrongSearches += 1;
  }
  smuggler.stats.netGain += res.smugglerDelta;
  officer.stats.netGain += res.officerDelta;
  return res;
}

// =============================================================
//  isGameOver — la salle reste vivante ; on gère la fin nous-mêmes
// =============================================================
export function isGameOver() { return { over: false }; }

// =============================================================
//  viewFor — masque les secrets selon le rôle
// =============================================================
export function viewFor(state, playerId) {
  const isOfficer = playerId === state.officerId;
  const me = state.players.find((p) => p.id === playerId);
  const v = {
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    hostId: state.hostId,
    officerId: state.officerId,
    you: playerId,
    inRoster: !!me,
    cfg: {
      startMin: CFG.startMin, maxPlayers: state.cap || meta.maxPlayers, hardMax: meta.maxPlayers,
      maxBribe: CFG.maxBribe, cargoMin: CFG.cargoMin, cargoMax: CFG.cargoMax,
      startingCoins: CFG.startingCoins, begThreshold: CFG.begThreshold,
    },
    players: state.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, avatar: p.avatar || 0, coins: p.coins,
      isHost: p.id === state.hostId, isOfficer: p.id === state.officerId,
      eliminated: !!p.eliminated, negRounds: p.negRounds || 0,
      ready: state.subs[p.id] ? state.subs[p.id].ready : false,
    })),
    chat: state.chat,
    begging: state.begging || null,
    canBeg: (state.phase === "prepare" || state.phase === "summary") && state.round >= 2 &&
            !!me && me.coins < CFG.begThreshold && !(state.begged || []).includes(playerId) && !state.begging,
    // dette morale : ce que JE dois à chacun (mes bienfaiteurs)
    myCreditors: state.debts[playerId] || {},
  };

  // Données privées du joueur (sa propre main)
  if (state.subs[playerId] && !isOfficer) {
    const sub = state.subs[playerId];
    v.me = {
      hand: sub.hand, items: sub.items, decl: sub.decl,
      bribe: sub.bribe, cost: sub.cost || 0, ready: sub.ready,
    };
  }

  if (state.phase === "inspect") {
    v.inspect = {
      index: state.inspectIndex,
      total: state.inspectOrder.length,
      currentTargetId: state.inspectOrder[state.inspectIndex] || null,
      queue: state.inspectOrder.map((id) => {
        const sub = state.subs[id];
        const done = state.roundEvents.find((e) => e.smugglerId === id);
        const pl = state.players.find((p) => p.id === id);
        // Dette morale : combien CE marchand a donné au douanier actuel (s'il a mendié avant).
        const benefactor = (state.debts[state.officerId] && state.debts[state.officerId][id]) || 0;
        return {
          id, name: pl.name, color: pl.color, avatar: pl.avatar || 0,
          decl: sub.decl, bribe: sub.bribe, benefactor,
          resolved: !!done, outcome: done ? done.outcome : null,
        };
      }),
    };
  }

  if (state.lastReveal) v.lastReveal = state.lastReveal;
  if (state.phase === "summary") v.summary = { events: state.roundEvents };

  if (state.phase === "ended") {
    // Les éliminés sont classés derrière les survivants, puis tri par pièces.
    let ranking = [...state.players].sort((a, b) => (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) || b.coins - a.coins);
    // La bombe nucléaire prime sur le classement : son porteur gagne d'office.
    if (state.nukeWinner) {
      const win = findPlayer(state, state.nukeWinner);
      if (win) ranking = [win, ...ranking.filter((p) => p.id !== state.nukeWinner)];
    }
    v.final = {
      ranking: ranking.map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, color: p.color, avatar: p.avatar || 0,
        coins: p.coins, eliminated: !!p.eliminated, stats: p.stats,
      })),
      awards: computeAwards(state),
      nukeWinner: state.nukeWinner || null,
    };
  }

  return v;
}

function computeAwards(state) {
  const awards = [];
  const top = (key, label, emoji, min = 1) => {
    let best = null;
    for (const p of state.players) {
      if (p.stats[key] >= min && (!best || p.stats[key] > best.stats[key])) best = p;
    }
    if (best && best.stats[key] >= min) awards.push({ label, emoji, name: best.name, color: best.color, value: best.stats[key] });
  };
  top("liesSuccessful", "Roi du bluff", "🃏");
  top("correctSearches", "Douanier parano", "🔍");
  top("bribesAccepted", "Corrompu en chef", "💰");
  top("smuggledThrough", "Contrebandier en or", "📦");
  top("bestStreak", "Intouchable", "🔥", 3);
  return awards;
}

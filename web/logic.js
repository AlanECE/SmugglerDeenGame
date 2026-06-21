// =============================================================
//  Douane & Contrebande — module de règles (logic.js)
//  Fonctions pures côté serveur. Source de vérité unique.
//  Aucun import, aucun timer (contrat de la plateforme).
// =============================================================

export const meta = { game: "Douane & Contrebande", minPlayers: 1, maxPlayers: 6 };

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
};

const ITEMS = {
  pasta: { name: "Pâtes", legal: true, value: 2, penalty: 1 },
  eggs: { name: "Œufs", legal: true, value: 2, penalty: 1 },
  coffee: { name: "Café", legal: true, value: 3, penalty: 1 },
  cheese: { name: "Fromage", legal: true, value: 3, penalty: 2 },
  weed: { name: "Weed", legal: false, value: 5, penalty: 4 },
  cocaine: { name: "Cocaïne", legal: false, value: 7, penalty: 6 },
  fakepapers: { name: "Faux papiers", legal: false, value: 6, penalty: 5 },
  watches: { name: "Montres volées", legal: false, value: 5, penalty: 4 },
};
const LEGAL_IDS = Object.keys(ITEMS).filter((k) => ITEMS[k].legal);
const COLORS = ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#9d4edd", "#f4a261"];

// ---- utilitaires purs ----
function randInt(n) { return Math.floor(Math.random() * n); }
function drawItem() {
  const pool = [];
  for (const id of Object.keys(ITEMS)) {
    const w = ITEMS[id].legal ? CFG.legalWeight : CFG.illegalWeight;
    for (let i = 0; i < w; i++) pool.push(id);
  }
  return pool[randInt(pool.length)];
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function newStats() {
  return {
    smuggledThrough: 0, liesSuccessful: 0, bustedAsSmuggler: 0,
    correctSearches: 0, wrongSearches: 0, bribesAccepted: 0,
    bribesPaid: 0, winStreak: 0, bestStreak: 0, netGain: 0,
  };
}
function findPlayer(s, id) { return s.players.find((p) => p.id === id); }
function smugglerIds(s) { return s.players.filter((p) => p.id !== s.officerId).map((p) => p.id); }

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
  };
  for (const id of players) addToRoster(s, id, null);
  return s;
}

function addToRoster(s, id, name) {
  if (s.players.some((p) => p.id === id)) return;
  if (s.players.length >= meta.maxPlayers) return;
  s.players.push({
    id,
    name: name || "Joueur",
    color: COLORS[s.players.length % COLORS.length],
    coins: CFG.startingCoins,
    stats: newStats(),
  });
}

// =============================================================
//  validateAction
// =============================================================
export function validateAction(state, playerId, action) {
  if (!action || typeof action.type !== "string") return { ok: false, error: "Action invalide" };
  const t = action.type;

  if (t === "hello") return { ok: true };
  if (t === "chat") return action.text ? { ok: true } : { ok: false, error: "Message vide" };

  const isHost = playerId === state.hostId;
  const isOfficer = playerId === state.officerId;

  if (t === "start") {
    if (state.phase !== "lobby") return { ok: false, error: "Partie déjà lancée" };
    if (!isHost) return { ok: false, error: "Seul l'hôte peut lancer" };
    if (state.players.length < CFG.startMin) return { ok: false, error: `Il faut au moins ${CFG.startMin} joueurs` };
    return { ok: true };
  }

  if (t === "submit") {
    if (state.phase !== "prepare") return { ok: false, error: "Mauvaise phase" };
    if (isOfficer) return { ok: false, error: "Le douanier ne prépare pas de cargaison" };
    const sub = state.subs[playerId];
    if (!sub) return { ok: false, error: "Aucune cargaison" };
    if (sub.ready) return { ok: false, error: "Déjà validé" };
    const items = Array.isArray(action.items) ? action.items : [];
    if (items.length < CFG.cargoMin || items.length > CFG.cargoMax)
      return { ok: false, error: `Choisis ${CFG.cargoMin} à ${CFG.cargoMax} objets` };
    const hand = [...sub.hand];
    for (const it of items) {
      const i = hand.indexOf(it);
      if (i === -1) return { ok: false, error: "Objet indisponible" };
      hand.splice(i, 1);
    }
    if (!ITEMS[action.declType] || !ITEMS[action.declType].legal)
      return { ok: false, error: "Déclaration invalide" };
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

  if (t === "next") {
    if (state.phase !== "summary") return { ok: false, error: "Mauvaise phase" };
    if (!isOfficer && !isHost) return { ok: false, error: "Réservé au douanier ou à l'hôte" };
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
    if (existing) existing.name = name;
    else if (s.phase === "lobby") addToRoster(s, playerId, name);
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

  if (t === "start") {
    s.round = 0;
    s.officerStartIndex = randInt(s.players.length);
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
    sub.declType = action.declType;
    sub.declQty = Math.max(CFG.cargoMin, Math.min(CFG.cargoMax, parseInt(action.declQty, 10) || chosen.length));
    let bribe = Math.max(0, Math.min(CFG.maxBribe, parseInt(action.bribe, 10) || 0));
    bribe = Math.min(bribe, Math.max(0, player.coins));
    sub.bribe = bribe;
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
        sub.declType = sub.items.find((x) => ITEMS[x].legal) || LEGAL_IDS[0];
        sub.declQty = sub.items.length;
        sub.bribe = 0;
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
    if (s.inspectIndex >= s.inspectOrder.length) s.phase = "summary";
    return s;
  }

  if (t === "next") {
    nextRound(s);
    return s;
  }

  if (t === "rematch") {
    for (const p of s.players) { p.coins = CFG.startingCoins; p.stats = newStats(); }
    s.phase = "lobby";
    s.round = 0;
    s.officerId = null;
    s.subs = {};
    s.roundEvents = [];
    s.lastReveal = null;
    s.inspectOrder = [];
    s.inspectIndex = 0;
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
  if (s.round > s.totalRounds) { s.phase = "ended"; return; }
  const idx = (s.officerStartIndex + s.round - 1) % s.players.length;
  s.officerId = s.players[idx].id;
  for (const id of smugglerIds(s)) {
    const hand = [];
    for (let i = 0; i < CFG.handSize; i++) hand.push(drawItem());
    s.subs[id] = { hand, items: [], declType: null, declQty: 1, bribe: 0, ready: false };
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
  // Déclaration conforme : tous les objets sont du type déclaré ET la quantité correspond.
  const matchesDeclaration = sub.items.length === sub.declQty && sub.items.every((id) => id === sub.declType);
  const isLie = hasContraband || !matchesDeclaration;

  const res = {
    smugglerId, smugglerName: smuggler.name, action,
    items: sub.items, declType: sub.declType, declQty: sub.declQty, bribe: sub.bribe,
    isLie, hasContraband, outcome: null, smugglerDelta: 0, officerDelta: 0,
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
    const resale = items.reduce((a, it) => a + it.value, 0);
    res.smugglerDelta = resale + CFG.indemnity;
    res.officerDelta = -CFG.indemnity;
    res.outcome = "clean";
    res.indemnity = CFG.indemnity;
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
  const v = {
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    hostId: state.hostId,
    officerId: state.officerId,
    you: playerId,
    inRoster: state.players.some((p) => p.id === playerId),
    cfg: {
      startMin: CFG.startMin, maxPlayers: meta.maxPlayers, maxBribe: CFG.maxBribe,
      cargoMin: CFG.cargoMin, cargoMax: CFG.cargoMax, startingCoins: CFG.startingCoins,
    },
    players: state.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, coins: p.coins,
      isHost: p.id === state.hostId, isOfficer: p.id === state.officerId,
      ready: state.subs[p.id] ? state.subs[p.id].ready : false,
    })),
    chat: state.chat,
  };

  // Données privées du joueur (sa propre main)
  if (state.subs[playerId] && !isOfficer) {
    const sub = state.subs[playerId];
    v.me = {
      hand: sub.hand, items: sub.items, declType: sub.declType,
      declQty: sub.declQty, bribe: sub.bribe, ready: sub.ready,
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
        return {
          id, name: pl.name, color: pl.color,
          declType: sub.declType, declQty: sub.declQty, bribe: sub.bribe,
          resolved: !!done, outcome: done ? done.outcome : null,
        };
      }),
    };
  }

  if (state.lastReveal) v.lastReveal = state.lastReveal;
  if (state.phase === "summary") v.summary = { events: state.roundEvents };

  if (state.phase === "ended") {
    const ranking = [...state.players].sort((a, b) => b.coins - a.coins);
    v.final = {
      ranking: ranking.map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, color: p.color, coins: p.coins, stats: p.stats,
      })),
      awards: computeAwards(state),
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

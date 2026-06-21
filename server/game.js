// =============================================================
//  Moteur de jeu autoritaire (source de vérité côté serveur).
//  Le client ne décide JAMAIS d'un résultat : il envoie une
//  action, le serveur la valide, applique les règles et diffuse
//  le nouvel état.
// =============================================================

const config = require('./config');
const { ITEMS, LEGAL_ITEMS } = require('./items');

const PLAYER_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#9d4edd', '#f4a261'];

let uid = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}_${(uid++).toString(36)}`;

function randInt(n) {
  return Math.floor(Math.random() * n);
}

// Tirage d'un item au hasard (le légal est plus fréquent que l'illégal)
function drawItem() {
  const pool = [];
  for (const it of Object.values(ITEMS)) {
    const w = it.legal ? config.legalDrawWeight : config.illegalDrawWeight;
    for (let i = 0; i < w; i++) pool.push(it.id);
  }
  return pool[randInt(pool.length)];
}

class Game {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.phase = 'lobby'; // lobby | prepare | inspect | summary | ended
    this.players = []; // { id, name, color, coins, connected, stats }
    this.round = 0;
    this.totalRounds = config.totalRounds;
    this.officerId = null;
    this.officerStartIndex = 0; // pour faire tourner le douanier

    this.submissions = {}; // playerId -> { items, declType, declQty, bribe, ready }
    this.inspectOrder = []; // ids des contrebandiers à traiter, dans l'ordre
    this.inspectIndex = 0;
    this.roundEvents = []; // résolutions de la manche en cours
    this.lastReveal = null; // dernière révélation (pour l'animation client)
    this.chat = [];

    this.timer = null;
    this.timerEndsAt = 0;
    this.onChange = () => {};
  }

  // ---------- gestion des joueurs ----------

  addPlayer(name) {
    const color = PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];
    const player = {
      id: newId('p'),
      name: (name || 'Joueur').slice(0, 16),
      color,
      coins: config.startingCoins,
      connected: true,
      stats: {
        smuggledThrough: 0, // cargaisons passées
        liesSuccessful: 0, // mensonges réussis (passés)
        bustedAsSmuggler: 0, // fois où le joueur s'est fait prendre
        correctSearches: 0, // fouilles correctes (en tant que douanier)
        wrongSearches: 0, // fouilles injustifiées
        bribesAccepted: 0, // pots-de-vin acceptés (en tant que douanier)
        bribesPaid: 0, // pots-de-vin versés (en tant que contrebandier)
        winStreak: 0, // série de cargaisons passées d'affilée
        bestStreak: 0,
        netGain: 0, // gain net total
      },
    };
    this.players.push(player);
    return player;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  removePlayer(id) {
    // En lobby on retire vraiment ; en partie on marque déconnecté pour reconnexion.
    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== id);
      if (id === this.hostId && this.players.length) this.hostId = this.players[0].id;
    } else {
      const p = this.getPlayer(id);
      if (p) p.connected = false;
      if (id === this.hostId) {
        const next = this.players.find((x) => x.connected);
        if (next) this.hostId = next.id;
      }
    }
  }

  reconnectPlayer(id) {
    const p = this.getPlayer(id);
    if (p) {
      p.connected = true;
      return true;
    }
    return false;
  }

  smugglers() {
    return this.players.filter((p) => p.id !== this.officerId);
  }

  // ---------- déroulé de partie ----------

  start() {
    if (this.phase !== 'lobby') return;
    if (this.players.length < config.minPlayers) return;
    this.round = 0;
    this.officerStartIndex = randInt(this.players.length);
    this.nextRound();
  }

  nextRound() {
    this.clearTimer();
    this.round += 1;
    if (this.round > this.totalRounds) {
      this.end();
      return;
    }
    // Le douanier tourne à chaque manche.
    const idx = (this.officerStartIndex + this.round - 1) % this.players.length;
    this.officerId = this.players[idx].id;

    this.submissions = {};
    this.roundEvents = [];
    this.lastReveal = null;
    this.inspectOrder = [];
    this.inspectIndex = 0;

    // Distribution secrète d'une main à chaque contrebandier.
    for (const p of this.smugglers()) {
      const hand = [];
      for (let i = 0; i < config.handSize; i++) hand.push(drawItem());
      this.submissions[p.id] = {
        hand,
        items: [],
        declType: null,
        declQty: 1,
        bribe: 0,
        ready: false,
      };
    }

    this.phase = 'prepare';
    this.startTimer(config.preparePhaseMs, () => this.autoSubmitMissing());
    this.emit();
  }

  // Le contrebandier soumet sa cargaison.
  submitCargo(playerId, payload) {
    if (this.phase !== 'prepare') return { error: 'Mauvaise phase' };
    if (playerId === this.officerId) return { error: 'Le douanier ne prépare pas de cargaison' };
    const sub = this.submissions[playerId];
    if (!sub) return { error: 'Aucune cargaison à préparer' };
    if (sub.ready) return { error: 'Déjà validé' };

    const player = this.getPlayer(playerId);
    let { items = [], declType, declQty, bribe = 0 } = payload || {};

    // Valider les items : sous-ensemble de la main, taille 1..cargoMax.
    if (!Array.isArray(items)) items = [];
    const hand = [...sub.hand];
    const chosen = [];
    for (const it of items) {
      const i = hand.indexOf(it);
      if (i === -1) return { error: 'Item non disponible dans la main' };
      hand.splice(i, 1);
      chosen.push(it);
    }
    if (chosen.length < config.cargoMin || chosen.length > config.cargoMax) {
      return { error: `Choisis entre ${config.cargoMin} et ${config.cargoMax} objets` };
    }

    // Valider la déclaration (type légal + quantité 1..cargoMax).
    if (!ITEMS[declType] || !ITEMS[declType].legal) return { error: 'Déclaration invalide (type légal requis)' };
    declQty = Math.max(config.cargoMin, Math.min(config.cargoMax, parseInt(declQty, 10) || 1));

    // Valider le pot-de-vin (0..maxBribe, et pas plus que le solde disponible).
    bribe = Math.max(0, Math.min(config.maxBribe, parseInt(bribe, 10) || 0));
    bribe = Math.min(bribe, Math.max(0, player.coins));

    sub.items = chosen;
    sub.declType = declType;
    sub.declQty = declQty;
    sub.bribe = bribe;
    sub.ready = true;

    this.maybeBeginInspect();
    this.emit();
    return { ok: true };
  }

  autoSubmitMissing() {
    // À l'expiration du timer : cargaison honnête par défaut pour les retardataires.
    for (const p of this.smugglers()) {
      const sub = this.submissions[p.id];
      if (sub && !sub.ready) {
        // On prend les items légaux de la main (sinon le premier item), déclaration conforme.
        const legalInHand = sub.hand.filter((id) => ITEMS[id].legal);
        const pick = (legalInHand.length ? legalInHand : sub.hand).slice(0, config.cargoMin);
        sub.items = pick.length ? pick : [sub.hand[0]];
        // Déclaration conforme si possible.
        const firstLegal = sub.items.find((id) => ITEMS[id].legal);
        sub.declType = firstLegal || LEGAL_ITEMS[0].id;
        sub.declQty = sub.items.length;
        sub.bribe = 0;
        sub.ready = true;
      }
    }
    this.maybeBeginInspect();
    this.emit();
  }

  maybeBeginInspect() {
    const all = this.smugglers().every((p) => this.submissions[p.id] && this.submissions[p.id].ready);
    if (all) this.beginInspect();
  }

  beginInspect() {
    this.clearTimer();
    this.phase = 'inspect';
    this.inspectOrder = this.smugglers().map((p) => p.id);
    this.inspectIndex = 0;
    this.lastReveal = null;
    this.startTimer(config.inspectDecisionMs, () => this.officerDecision(this.officerId, 'pass', true));
  }

  // Le douanier décide : 'pass' (laisser passer) ou 'inspect' (ouvrir).
  officerDecision(officerId, action, auto = false) {
    if (this.phase !== 'inspect') return { error: 'Mauvaise phase' };
    if (officerId !== this.officerId) return { error: 'Seul le douanier décide' };
    const targetId = this.inspectOrder[this.inspectIndex];
    if (!targetId) return { error: 'Aucun joueur à traiter' };

    const result = this.resolve(targetId, action);
    this.roundEvents.push(result);
    this.lastReveal = result;
    this.inspectIndex += 1;

    if (this.inspectIndex >= this.inspectOrder.length) {
      this.beginSummary();
    } else {
      this.startTimer(config.inspectDecisionMs, () => this.officerDecision(this.officerId, 'pass', true));
    }
    this.emit();
    return { ok: true };
  }

  // Applique les règles d'équilibrage recommandées.
  resolve(smugglerId, action) {
    const officer = this.getPlayer(this.officerId);
    const smuggler = this.getPlayer(smugglerId);
    const sub = this.submissions[smugglerId];
    const items = sub.items.map((id) => ITEMS[id]);

    const hasContraband = items.some((it) => !it.legal);
    // Déclaration conforme : tous les items du type déclaré ET bonne quantité.
    const matchesDeclaration =
      items.length === sub.declQty && items.every((it) => it.id === sub.declType);
    const isLie = hasContraband || !matchesDeclaration;

    const result = {
      smugglerId,
      smugglerName: smuggler.name,
      action,
      items: sub.items,
      declType: sub.declType,
      declQty: sub.declQty,
      bribe: sub.bribe,
      isLie,
      hasContraband,
      outcome: null,
      smugglerDelta: 0,
      officerDelta: 0,
    };

    if (action === 'pass') {
      // Laisser passer : le douanier prend le pot-de-vin, la cargaison passe.
      const resale = items.reduce((s, it) => s + it.value, 0);
      result.smugglerDelta = resale - sub.bribe;
      result.officerDelta = sub.bribe;
      result.outcome = 'passed';
      result.resale = resale;

      smuggler.coins += result.smugglerDelta;
      officer.coins += result.officerDelta;

      smuggler.stats.smuggledThrough += 1;
      smuggler.stats.winStreak += 1;
      smuggler.stats.bestStreak = Math.max(smuggler.stats.bestStreak, smuggler.stats.winStreak);
      if (sub.bribe > 0) {
        smuggler.stats.bribesPaid += 1;
        officer.stats.bribesAccepted += 1;
      }
      if (isLie) smuggler.stats.liesSuccessful += 1;
    } else {
      // Ouvrir le coffre.
      if (isLie) {
        // Fraude : confiscation de l'illégal + amende. Pot-de-vin non versé.
        const contrabandPenalty = items.filter((it) => !it.legal).reduce((s, it) => s + it.penalty, 0);
        const fine = hasContraband ? contrabandPenalty : config.falseDeclarationFine;
        result.smugglerDelta = -fine;
        result.officerDelta = fine;
        result.outcome = 'busted';
        result.fine = fine;

        smuggler.coins += result.smugglerDelta;
        officer.coins += result.officerDelta;

        smuggler.stats.bustedAsSmuggler += 1;
        smuggler.stats.winStreak = 0;
        officer.stats.correctSearches += 1;
      } else {
        // Déclaration conforme : fouille injustifiée -> indemnité au joueur.
        const indemnity = config.unjustifiedSearchIndemnity;
        const resale = items.reduce((s, it) => s + it.value, 0);
        // Les marchandises légales passent quand même (honnêtes), plus l'indemnité.
        result.smugglerDelta = resale + indemnity;
        result.officerDelta = -indemnity;
        result.outcome = 'clean';
        result.indemnity = indemnity;
        result.resale = resale;

        smuggler.coins += result.smugglerDelta;
        officer.coins += result.officerDelta;

        smuggler.stats.smuggledThrough += 1;
        smuggler.stats.winStreak += 1;
        smuggler.stats.bestStreak = Math.max(smuggler.stats.bestStreak, smuggler.stats.winStreak);
        officer.stats.wrongSearches += 1;
      }
    }

    smuggler.stats.netGain += result.smugglerDelta;
    officer.stats.netGain += result.officerDelta;
    return result;
  }

  beginSummary() {
    this.clearTimer();
    this.phase = 'summary';
    if (config.summaryAutoAdvanceMs > 0) {
      this.startTimer(config.summaryAutoAdvanceMs, () => this.nextRound());
    }
    this.emit();
  }

  // Passage manuel à la manche suivante (douanier ou hôte).
  advanceRound(playerId) {
    if (this.phase !== 'summary') return { error: 'Mauvaise phase' };
    if (playerId !== this.officerId && playerId !== this.hostId) {
      return { error: 'Seul le douanier ou l\'hôte peut continuer' };
    }
    this.nextRound();
    return { ok: true };
  }

  end() {
    this.clearTimer();
    this.phase = 'ended';
    this.emit();
  }

  // Revanche avec le même groupe.
  rematch(playerId) {
    if (playerId !== this.hostId) return { error: 'Seul l\'hôte peut relancer' };
    for (const p of this.players) {
      p.coins = config.startingCoins;
      p.stats = {
        smuggledThrough: 0, liesSuccessful: 0, bustedAsSmuggler: 0,
        correctSearches: 0, wrongSearches: 0, bribesAccepted: 0,
        bribesPaid: 0, winStreak: 0, bestStreak: 0, netGain: 0,
      };
    }
    this.phase = 'lobby';
    this.round = 0;
    this.officerId = null;
    this.submissions = {};
    this.roundEvents = [];
    this.lastReveal = null;
    this.emit();
    return { ok: true };
  }

  addChat(playerId, text) {
    const p = this.getPlayer(playerId);
    if (!p || !text) return;
    const msg = { name: p.name, color: p.color, text: String(text).slice(0, 200), t: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 50) this.chat.shift();
    this.emit();
  }

  // ---------- timers ----------

  startTimer(ms, cb) {
    this.clearTimer();
    if (!ms || ms <= 0) {
      this.timerEndsAt = 0;
      return;
    }
    this.timerEndsAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerEndsAt = 0;
      try { cb(); } catch (e) { console.error('timer cb error', e); }
    }, ms);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerEndsAt = 0;
  }

  emit() {
    this.onChange();
  }

  // ---------- sérialisation (masquage des secrets par rôle) ----------

  serializeFor(playerId) {
    const isOfficer = playerId === this.officerId;
    const state = {
      code: this.code,
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      hostId: this.hostId,
      officerId: this.officerId,
      yourId: playerId,
      yourRole: this.phase === 'lobby' ? 'lobby' : isOfficer ? 'officer' : 'smuggler',
      timerEndsAt: this.timerEndsAt,
      config: {
        minPlayers: config.minPlayers,
        maxPlayers: config.maxPlayers,
        maxBribe: config.maxBribe,
        cargoMin: config.cargoMin,
        cargoMax: config.cargoMax,
        startingCoins: config.startingCoins,
      },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        coins: p.coins,
        connected: p.connected,
        isHost: p.id === this.hostId,
        isOfficer: p.id === this.officerId,
        ready: this.submissions[p.id] ? this.submissions[p.id].ready : false,
      })),
      chat: this.chat,
    };

    // Données privées du joueur (sa propre main / cargaison).
    if (this.submissions[playerId] && !isOfficer) {
      const s = this.submissions[playerId];
      state.you = {
        hand: s.hand,
        items: s.items,
        declType: s.declType,
        declQty: s.declQty,
        bribe: s.bribe,
        ready: s.ready,
      };
    }

    // Phase d'inspection : infos publiques (déclaration + bribe, PAS le contenu).
    if (this.phase === 'inspect') {
      state.inspect = {
        index: this.inspectIndex,
        total: this.inspectOrder.length,
        currentTargetId: this.inspectOrder[this.inspectIndex] || null,
        queue: this.inspectOrder.map((id) => {
          const s = this.submissions[id];
          const done = this.roundEvents.find((e) => e.smugglerId === id);
          return {
            id,
            name: this.getPlayer(id).name,
            color: this.getPlayer(id).color,
            declType: s.declType,
            declQty: s.declQty,
            bribe: s.bribe,
            resolved: !!done,
            outcome: done ? done.outcome : null,
          };
        }),
      };
    }

    // Dernière révélation (visible par tous une fois résolue).
    if (this.lastReveal) state.lastReveal = this.lastReveal;

    // Récap de manche.
    if (this.phase === 'summary') {
      state.summary = { events: this.roundEvents };
    }

    // Fin de partie : classement + stats.
    if (this.phase === 'ended') {
      const ranking = [...this.players].sort((a, b) => b.coins - a.coins);
      state.final = {
        ranking: ranking.map((p, i) => ({
          rank: i + 1, id: p.id, name: p.name, color: p.color, coins: p.coins, stats: p.stats,
        })),
        awards: this.computeAwards(),
      };
    }

    return state;
  }

  computeAwards() {
    const awards = [];
    const top = (key, label, emoji, min = 1) => {
      let best = null;
      for (const p of this.players) {
        if (p.stats[key] >= min && (!best || p.stats[key] > best.stats[key])) best = p;
      }
      if (best && best.stats[key] >= min) {
        awards.push({ label, emoji, name: best.name, color: best.color, value: best.stats[key] });
      }
    };
    top('liesSuccessful', 'Roi du bluff', '🃏');
    top('correctSearches', 'Douanier parano', '🔍');
    top('bribesAccepted', 'Corrompu en chef', '💰');
    top('smuggledThrough', 'Contrebandier en or', '📦');
    top('bestStreak', 'Intouchable', '🔥', 3);
    return awards;
  }
}

module.exports = { Game };

/* =============================================================
   Client : connexion temps réel + rendu des écrans.
   Le client n'affiche que l'état reçu du serveur (source de vérité).
   ============================================================= */

const socket = io();

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const store = {
  get name() { return localStorage.getItem('sd_name') || ''; },
  set name(v) { localStorage.setItem('sd_name', v); },
  get session() { try { return JSON.parse(localStorage.getItem('sd_session') || 'null'); } catch { return null; } },
  set session(v) { v ? localStorage.setItem('sd_session', JSON.stringify(v)) : localStorage.removeItem('sd_session'); },
};

let STATE = null; // dernier snapshot serveur
let myId = null;
let prepare = null; // état local de préparation de cargaison
let lastPrepareRound = -1;
let lastRevealKey = null;
let timerInterval = null;

/* ---------------- navigation d'écrans ---------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}

/* ---------------- accueil ---------------- */
$('#input-name').value = store.name;

function getName() {
  const n = $('#input-name').value.trim();
  if (!n) { $('#home-error').textContent = 'Choisis un pseudo'; return null; }
  store.name = n;
  return n;
}

$('#btn-create').onclick = () => {
  const name = getName(); if (!name) return;
  socket.emit('room:create', { name }, (res) => {
    if (res.error) return ($('#home-error').textContent = res.error);
    myId = res.playerId;
    store.session = { code: res.code, playerId: res.playerId };
    history.replaceState(null, '', '?room=' + res.code);
  });
};

$('#btn-join').onclick = () => {
  const name = getName(); if (!name) return;
  const code = $('#input-code').value.trim().toUpperCase();
  if (!code) return ($('#home-error').textContent = 'Entre un code');
  socket.emit('room:join', { name, code }, (res) => {
    if (res.error) return ($('#home-error').textContent = res.error);
    myId = res.playerId;
    store.session = { code: res.code, playerId: res.playerId };
    history.replaceState(null, '', '?room=' + res.code);
  });
};

$('#input-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('#input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-create').click(); });

/* ---------------- reconnexion auto ---------------- */
function tryReconnect() {
  const params = new URLSearchParams(location.search);
  const urlCode = params.get('room');
  const sess = store.session;
  const name = store.name || 'Joueur';
  if (sess && (!urlCode || urlCode === sess.code)) {
    socket.emit('room:join', { name, code: sess.code, playerId: sess.playerId }, (res) => {
      if (res.ok) { myId = res.playerId; store.session = { code: res.code, playerId: res.playerId }; }
      else { store.session = null; if (urlCode) $('#input-code').value = urlCode; }
    });
  } else if (urlCode) {
    $('#input-code').value = urlCode;
  }
}

socket.on('connect', tryReconnect);

/* ---------------- réception d'état ---------------- */
socket.on('game:state', (state) => {
  STATE = state;
  myId = state.yourId;
  render();
});

$('#btn-leave').onclick = () => {
  socket.emit('room:leave');
  store.session = null;
  STATE = null;
  history.replaceState(null, '', location.pathname);
  showScreen('screen-home');
};

/* ---------------- rendu principal ---------------- */
function render() {
  if (!STATE) return showScreen('screen-home');
  handleReveal();
  if (STATE.phase === 'lobby') { renderLobby(); showScreen('screen-lobby'); }
  else { renderGame(); showScreen('screen-game'); }
  updateTimer();
}

/* ---------------- LOBBY ---------------- */
function renderLobby() {
  $('#lobby-code').textContent = STATE.code;
  const grid = $('#lobby-players');
  grid.innerHTML = '';
  STATE.players.forEach((p) => {
    const card = el('div', 'player-chip' + (p.connected ? '' : ' offline'));
    card.style.borderColor = p.color;
    card.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span class="pname">${esc(p.name)}</span>
      ${p.isHost ? '<span class="tag">Hôte</span>' : ''}`;
    grid.appendChild(card);
  });

  const isHost = STATE.hostId === myId;
  const enough = STATE.players.length >= STATE.config.minPlayers;
  const startBtn = $('#btn-start');
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = !enough;
  $('#lobby-info').textContent = enough
    ? (isHost ? 'Tout le monde est prêt ? Lance la partie !' : "En attente de l'hôte…")
    : `Il faut au moins ${STATE.config.minPlayers} joueurs (${STATE.players.length} connectés).`;

  renderChat('#chat-box-lobby');
}

$('#btn-start').onclick = () => socket.emit('room:start', {}, (r) => { if (r.error) alert(r.error); });
$('#btn-copy').onclick = () => {
  const url = location.origin + '?room=' + STATE.code;
  navigator.clipboard?.writeText(url);
  const b = $('#btn-copy'); const t = b.textContent; b.textContent = 'Copié ✓';
  setTimeout(() => (b.textContent = t), 1500);
};

/* ---------------- JEU ---------------- */
function renderGame() {
  $('#round-now').textContent = STATE.round;
  $('#round-total').textContent = STATE.totalRounds;
  const me = STATE.players.find((p) => p.id === myId);
  $('#me-coins').textContent = me ? me.coins : '-';

  renderScoreboard();
  renderChat('#chat-box-game');

  const main = $('#game-main');
  if (STATE.phase === 'prepare') renderPrepare(main);
  else if (STATE.phase === 'inspect') renderInspect(main);
  else if (STATE.phase === 'summary') renderSummary(main);
  else if (STATE.phase === 'ended') renderEnded(main);
}

function renderScoreboard() {
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  [...STATE.players].sort((a, b) => b.coins - a.coins).forEach((p) => {
    const chip = el('div', 'score-chip' + (p.id === myId ? ' me' : '') + (p.connected ? '' : ' offline'));
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      ${p.isOfficer ? '👮 ' : ''}${esc(p.name)} <b>${p.coins}</b>`;
    sb.appendChild(chip);
  });
}

/* ---------- préparation (contrebandier) ---------- */
function resetPrepareIfNeeded() {
  if (lastPrepareRound !== STATE.round || !prepare) {
    lastPrepareRound = STATE.round;
    prepare = { sel: [], declType: LEGAL_IDS[0], declQty: 1, bribe: 0 };
  }
}

function renderPrepare(main) {
  const officer = STATE.players.find((p) => p.id === STATE.officerId);

  if (STATE.yourRole === 'officer') {
    const waiting = STATE.players.filter((p) => !p.isOfficer);
    main.innerHTML = `<div class="center-card">
      <h2>👮 Tu es le douanier</h2>
      <p class="muted">Les contrebandiers préparent leur coffre…</p>
      <div class="wait-list">${waiting.map((p) => `<span class="player-chip ${p.ready ? 'ready' : ''}">
        <span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${p.ready ? '✓' : '…'}</span>`).join('')}</div>
    </div>`;
    return;
  }

  if (!STATE.you) { main.innerHTML = '<div class="center-card"><p>…</p></div>'; return; }
  if (STATE.you.ready) {
    main.innerHTML = `<div class="center-card">
      <h2>Coffre verrouillé 🔒</h2>
      <p class="muted">En attente des autres contrebandiers…</p>
    </div>`;
    return;
  }

  resetPrepareIfNeeded();
  const me = STATE.players.find((p) => p.id === myId);
  const hand = STATE.you.hand;

  main.innerHTML = `
    <div class="prepare">
      <h2>Prépare ta cargaison <span class="muted">(coffre vers ${esc(officer?.name || 'le douanier')})</span></h2>
      <p class="sub">Choisis ${STATE.config.cargoMin} à ${STATE.config.cargoMax} objets, puis déclare-les (mens si tu oses).</p>

      <div class="section-label">Ta main</div>
      <div class="hand" id="hand"></div>

      <div class="section-label">Ton coffre (${prepare.sel.length}/${STATE.config.cargoMax})</div>
      <div class="coffre" id="coffre"></div>

      <div class="declaration">
        <div class="section-label">Déclaration officielle</div>
        <div class="decl-row">
          <div class="stepper">
            <button class="btn btn-small" id="qty-minus">−</button>
            <span id="decl-qty">${prepare.declQty}</span>
            <button class="btn btn-small" id="qty-plus">+</button>
          </div>
          <span class="decl-x">×</span>
          <div class="decl-types" id="decl-types"></div>
        </div>
      </div>

      <div class="bribe">
        <div class="section-label">Pot-de-vin 💰 <span id="bribe-val">${prepare.bribe}</span> (max ${Math.min(STATE.config.maxBribe, Math.max(0, me?.coins ?? 0))})</div>
        <input type="range" id="bribe-range" min="0" max="${Math.min(STATE.config.maxBribe, Math.max(0, me?.coins ?? 0))}" value="${prepare.bribe}" />
      </div>

      <button class="btn btn-primary btn-big" id="btn-submit">Verrouiller le coffre</button>
      <p class="error" id="prep-error"></p>
    </div>`;

  // Main
  const handEl = $('#hand');
  hand.forEach((id, i) => {
    const inSel = prepare.sel.includes(i);
    const c = itemCard(id, inSel ? 'in-coffre' : '');
    c.onclick = () => {
      if (inSel) prepare.sel = prepare.sel.filter((x) => x !== i);
      else {
        if (prepare.sel.length >= STATE.config.cargoMax) return;
        prepare.sel.push(i);
      }
      Sound.select();
      prepare.declQty = Math.max(STATE.config.cargoMin, Math.min(STATE.config.cargoMax, prepare.sel.length || 1));
      renderPrepare(main);
    };
    handEl.appendChild(c);
  });

  // Coffre
  const coffreEl = $('#coffre');
  for (let s = 0; s < STATE.config.cargoMax; s++) {
    const idx = prepare.sel[s];
    if (idx !== undefined) coffreEl.appendChild(itemCard(hand[idx], 'slot-filled'));
    else coffreEl.appendChild(el('div', 'slot-empty', '?'));
  }

  // Types de déclaration (légaux uniquement)
  const typesEl = $('#decl-types');
  LEGAL_IDS.forEach((id) => {
    const t = el('button', 'decl-type' + (prepare.declType === id ? ' active' : ''),
      `${ITEMS[id].emoji} ${ITEMS[id].name}`);
    t.onclick = () => { prepare.declType = id; Sound.select(); renderPrepare(main); };
    typesEl.appendChild(t);
  });

  $('#qty-minus').onclick = () => { prepare.declQty = Math.max(STATE.config.cargoMin, prepare.declQty - 1); renderPrepare(main); };
  $('#qty-plus').onclick = () => { prepare.declQty = Math.min(STATE.config.cargoMax, prepare.declQty + 1); renderPrepare(main); };
  $('#bribe-range').oninput = (e) => { prepare.bribe = +e.target.value; $('#bribe-val').textContent = prepare.bribe; Sound.coin(); };

  $('#btn-submit').onclick = () => {
    if (prepare.sel.length < STATE.config.cargoMin) return ($('#prep-error').textContent = `Choisis au moins ${STATE.config.cargoMin} objet`);
    const items = prepare.sel.map((i) => hand[i]);
    socket.emit('cargo:submit', { items, declType: prepare.declType, declQty: prepare.declQty, bribe: prepare.bribe }, (r) => {
      if (r.error) $('#prep-error').textContent = r.error;
      else Sound.chest();
    });
  };
}

/* ---------- inspection (douanier) ---------- */
function renderInspect(main) {
  const ins = STATE.inspect;
  const target = ins.queue.find((q) => q.id === ins.currentTargetId);
  const isOfficer = STATE.yourRole === 'officer';

  const queueHtml = ins.queue.map((q) => {
    let badge = '…';
    if (q.resolved) badge = q.outcome === 'busted' ? '🚨' : q.outcome === 'clean' ? '✅' : '➡️';
    else if (q.id === ins.currentTargetId) badge = '🔎';
    return `<span class="player-chip ${q.id === ins.currentTargetId ? 'current' : ''} ${q.resolved ? 'resolved' : ''}">
      <span class="dot" style="background:${q.color}"></span>${esc(q.name)} ${badge}</span>`;
  }).join('');

  if (!target) { main.innerHTML = `<div class="center-card"><p>Résolution…</p></div>`; return; }

  const decl = ITEMS[target.declType];
  const declStr = `${target.declQty} × ${decl.emoji} ${decl.name}`;

  if (isOfficer) {
    main.innerHTML = `
      <div class="inspect">
        <div class="queue">${queueHtml}</div>
        <div class="suspect-card" style="border-color:${target.color}">
          <div class="suspect-head"><span class="dot big" style="background:${target.color}"></span>
            <h2>${esc(target.name)}</h2></div>
          <div class="declaration-box">
            <div class="dlabel">Déclare</div>
            <div class="dvalue">${declStr}</div>
          </div>
          <div class="bribe-box ${target.bribe > 0 ? 'has-bribe' : ''}">
            ${target.bribe > 0 ? `💰 Pot-de-vin proposé : <b>${target.bribe}</b>` : 'Aucun pot-de-vin'}
          </div>
          <div class="decision-buttons">
            <button class="btn btn-pass btn-big" id="btn-pass">✅ Laisser passer<small>tu prends ${target.bribe} 💰</small></button>
            <button class="btn btn-open btn-big" id="btn-open">🔓 Ouvrir le coffre<small>risqué…</small></button>
          </div>
        </div>
      </div>`;
    $('#btn-pass').onclick = () => decide('pass');
    $('#btn-open').onclick = () => decide('inspect');
  } else {
    const officer = STATE.players.find((p) => p.id === STATE.officerId);
    main.innerHTML = `
      <div class="inspect">
        <div class="queue">${queueHtml}</div>
        <div class="center-card">
          <h2>👮 ${esc(officer?.name || 'Le douanier')} inspecte…</h2>
          <p class="muted">Sous le feu : <b>${esc(target.name)}</b></p>
          <p class="muted">Déclaration : ${declStr} · 💰 ${target.bribe}</p>
        </div>
      </div>`;
  }
}

function decide(action) {
  socket.emit('customs:decide', { action }, (r) => { if (r.error) alert(r.error); });
}

/* ---------- récap de manche ---------- */
function renderSummary(main) {
  const ev = STATE.summary.events;
  const canNext = STATE.officerId === myId || STATE.hostId === myId;
  main.innerHTML = `
    <div class="summary">
      <h2>Bilan de la manche ${STATE.round}</h2>
      <div class="summary-list">
        ${ev.map(eventRow).join('')}
      </div>
      ${canNext
        ? `<button class="btn btn-primary btn-big" id="btn-next">${STATE.round >= STATE.totalRounds ? 'Voir le classement' : 'Manche suivante'}</button>`
        : `<p class="muted">En attente du douanier pour continuer…</p>`}
    </div>`;
  if (canNext) $('#btn-next').onclick = () => socket.emit('round:next', {}, (r) => { if (r.error) alert(r.error); });
}

function eventRow(e) {
  const items = e.items.map((id) => `${ITEMS[id].emoji}`).join(' ');
  let line, cls;
  if (e.outcome === 'passed') { cls = 'pass'; line = `passe — ${e.isLie ? 'a bluffé 😏' : 'honnête'} (+${e.smugglerDelta} / douanier +${e.officerDelta})`; }
  else if (e.outcome === 'busted') { cls = 'bust'; line = `PRIS 🚨 (${e.smugglerDelta} / douanier +${e.officerDelta})`; }
  else { cls = 'clean'; line = `fouille injustifiée ✅ (+${e.smugglerDelta} / douanier ${e.officerDelta})`; }
  return `<div class="summary-row ${cls}">
    <b>${esc(e.smugglerName)}</b> <span class="items">${items}</span> <span>${line}</span></div>`;
}

/* ---------- fin de partie ---------- */
function renderEnded(main) {
  const f = STATE.final;
  const isHost = STATE.hostId === myId;
  main.innerHTML = `
    <div class="ended">
      <h2>🏁 Fin de la partie</h2>
      <div class="ranking">
        ${f.ranking.map((r) => `<div class="rank-row ${r.rank === 1 ? 'gold' : ''}">
          <span class="rank-pos">${r.rank === 1 ? '👑' : r.rank}</span>
          <span class="dot" style="background:${r.color}"></span>
          <span class="rname">${esc(r.name)}</span>
          <b>${r.coins} 💰</b>
        </div>`).join('')}
      </div>
      ${f.awards.length ? `<div class="awards"><h3>Trophées</h3>
        ${f.awards.map((a) => `<div class="award"><span class="aem">${a.emoji}</span>
          <span><b>${a.label}</b> — ${esc(a.name)} (${a.value})</span></div>`).join('')}</div>` : ''}
      <div class="stats-table">
        <h3>Statistiques</h3>
        <table>
          <tr><th>Joueur</th><th>📦 passées</th><th>😏 bluffs</th><th>🚨 pris</th><th>🔍 fouilles ✓</th><th>💰 acceptés</th></tr>
          ${f.ranking.map((r) => `<tr><td>${esc(r.name)}</td>
            <td>${r.stats.smuggledThrough}</td><td>${r.stats.liesSuccessful}</td>
            <td>${r.stats.bustedAsSmuggler}</td><td>${r.stats.correctSearches}</td>
            <td>${r.stats.bribesAccepted}</td></tr>`).join('')}
        </table>
      </div>
      ${isHost
        ? `<button class="btn btn-primary btn-big" id="btn-rematch">🔁 Revanche (même groupe)</button>`
        : `<p class="muted">En attente de l'hôte pour la revanche…</p>`}
    </div>`;
  if (isHost) $('#btn-rematch').onclick = () => socket.emit('game:rematch', {}, (r) => { if (r.error) alert(r.error); });
}

/* ---------- révélation animée ---------- */
function handleReveal() {
  if (!STATE.lastReveal) { lastRevealKey = null; return; }
  const r = STATE.lastReveal;
  const key = `${STATE.round}-${r.smugglerId}`;
  if (key === lastRevealKey) return;
  lastRevealKey = key;
  showReveal(r);
}

function showReveal(r) {
  const overlay = $('#reveal-overlay');
  const card = $('#reveal-card');
  const items = r.items.map((id) => `<div class="reveal-item" style="background:${ITEMS[id].color}">${ITEMS[id].emoji}<small>${ITEMS[id].name}</small></div>`).join('');

  let title, cls, money;
  if (r.action === 'pass') {
    cls = 'rv-pass'; title = '➡️ Laissé passer';
    money = `Contrebandier ${fmt(r.smugglerDelta)} · Douanier +${r.officerDelta} 💰`;
    Sound.coin();
  } else if (r.outcome === 'busted') {
    cls = 'rv-bust'; title = '🚨 FRAUDE DÉCOUVERTE !';
    money = `Contrebandier ${fmt(r.smugglerDelta)} · Douanier +${r.officerDelta} 💰`;
    Sound.siren();
  } else {
    cls = 'rv-clean'; title = '✅ Déclaration conforme';
    money = `Fouille injustifiée — Contrebandier +${r.smugglerDelta} · Douanier ${fmt(r.officerDelta)} 💰`;
    Sound.lose();
  }

  card.className = 'reveal-card ' + cls;
  card.innerHTML = `
    <div class="rv-chest">🧰</div>
    <h2>${title}</h2>
    <div class="rv-name">${esc(r.smugglerName)}</div>
    <div class="reveal-items">${items}</div>
    <div class="rv-money">${money}</div>`;
  overlay.classList.add('show');
  setTimeout(() => card.classList.add('open'), 60);
  clearTimeout(showReveal._t);
  showReveal._t = setTimeout(() => {
    overlay.classList.remove('show');
    card.classList.remove('open');
  }, 2600);
}

/* ---------- chat ---------- */
function renderChat(sel) {
  const box = $(sel);
  if (!box.dataset.init) {
    box.dataset.init = '1';
    box.innerHTML = `<div class="chat-msgs"></div>
      <div class="chat-input"><input maxlength="200" placeholder="Message…" /><button class="btn btn-small">↑</button></div>`;
    const input = box.querySelector('input');
    const send = () => {
      const t = input.value.trim();
      if (t) socket.emit('chat:send', { text: t });
      input.value = '';
    };
    box.querySelector('button').onclick = send;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  }
  const msgs = box.querySelector('.chat-msgs');
  msgs.innerHTML = (STATE.chat || []).map((m) =>
    `<div class="cmsg"><b style="color:${m.color}">${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
  msgs.scrollTop = msgs.scrollHeight;
}

/* ---------- timer ---------- */
function updateTimer() {
  const t = $('#timer');
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (!STATE || !STATE.timerEndsAt || STATE.phase === 'lobby' || STATE.phase === 'ended') { t.textContent = ''; return; }
  const tick = () => {
    const left = Math.max(0, Math.ceil((STATE.timerEndsAt - Date.now()) / 1000));
    t.textContent = '⏱ ' + left + 's';
    t.classList.toggle('urgent', left <= 10);
    if (left <= 0 && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  };
  tick();
  timerInterval = setInterval(tick, 500);
}

/* ---------- utils ---------- */
function itemCard(id, extra = '') {
  const it = ITEMS[id];
  const c = el('div', `item-card ${it.legal ? 'legal' : 'illegal'} ${extra}`);
  c.style.setProperty('--icolor', it.color);
  c.innerHTML = `<div class="emoji">${it.emoji}</div><div class="iname">${it.name}</div>
    <div class="ival">+${it.value}${it.legal ? '' : ' ⚠'}</div>`;
  return c;
}
function fmt(n) { return n >= 0 ? '+' + n : '' + n; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

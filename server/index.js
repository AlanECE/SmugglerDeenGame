const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { createRoom, getRoom } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/health', (_req, res) => res.json({ ok: true }));

// socketId -> { code, playerId }
const sessions = new Map();

function broadcastRoom(game) {
  for (const [sockId, sess] of sessions) {
    if (sess.code !== game.code) continue;
    const sock = io.sockets.sockets.get(sockId);
    if (sock) sock.emit('game:state', game.serializeFor(sess.playerId));
  }
}

function attach(game) {
  game.onChange = () => broadcastRoom(game);
}

io.on('connection', (socket) => {
  const bind = (game, playerId) => {
    sessions.set(socket.id, { code: game.code, playerId });
    socket.join(game.code);
    attach(game);
  };

  socket.on('room:create', ({ name }, cb) => {
    const { game, player } = createRoom(name);
    bind(game, player.id);
    cb && cb({ ok: true, code: game.code, playerId: player.id });
    broadcastRoom(game);
  });

  socket.on('room:join', ({ name, code, playerId }, cb) => {
    const game = getRoom(code);
    if (!game) return cb && cb({ error: 'Salon introuvable' });

    // Reconnexion d'un joueur existant.
    if (playerId && game.getPlayer(playerId)) {
      game.reconnectPlayer(playerId);
      bind(game, playerId);
      cb && cb({ ok: true, code: game.code, playerId });
      broadcastRoom(game);
      return;
    }

    if (game.phase !== 'lobby') return cb && cb({ error: 'Partie déjà commencée' });
    if (game.players.length >= config.maxPlayers) return cb && cb({ error: 'Salon complet' });

    const player = game.addPlayer(name);
    bind(game, player.id);
    cb && cb({ ok: true, code: game.code, playerId: player.id });
    broadcastRoom(game);
  });

  const withGame = (fn) => (payload, cb) => {
    const sess = sessions.get(socket.id);
    if (!sess) return cb && cb({ error: 'Pas de session' });
    const game = getRoom(sess.code);
    if (!game) return cb && cb({ error: 'Salon fermé' });
    const res = fn(game, sess.playerId, payload) || {};
    cb && cb(res);
  };

  socket.on('room:start', withGame((game, playerId) => {
    if (playerId !== game.hostId) return { error: 'Seul l\'hôte peut lancer' };
    if (game.players.length < config.minPlayers) return { error: `Minimum ${config.minPlayers} joueurs` };
    game.start();
    return { ok: true };
  }));

  socket.on('cargo:submit', withGame((game, playerId, payload) => game.submitCargo(playerId, payload)));
  socket.on('customs:decide', withGame((game, playerId, payload) => game.officerDecision(playerId, payload.action)));
  socket.on('round:next', withGame((game, playerId) => game.advanceRound(playerId)));
  socket.on('game:rematch', withGame((game, playerId) => game.rematch(playerId)));
  socket.on('chat:send', withGame((game, playerId, payload) => { game.addChat(playerId, payload.text); return { ok: true }; }));

  socket.on('room:leave', () => {
    const sess = sessions.get(socket.id);
    if (sess) {
      const game = getRoom(sess.code);
      if (game) { game.removePlayer(sess.playerId); broadcastRoom(game); }
      sessions.delete(socket.id);
    }
  });

  socket.on('disconnect', () => {
    const sess = sessions.get(socket.id);
    if (sess) {
      const game = getRoom(sess.code);
      if (game) { game.removePlayer(sess.playerId); broadcastRoom(game); }
      sessions.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🕵️  Smuggler & Deen — serveur démarré sur http://localhost:${PORT}`);
});

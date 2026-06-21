// Gestion des salons en mémoire (suffisant pour un party game entre amis).

const { Game } = require('./game');

const rooms = new Map(); // code -> Game

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(hostName) {
  const code = makeCode();
  const game = new Game(code, null);
  const host = game.addPlayer(hostName);
  game.hostId = host.id;
  rooms.set(code, game);
  return { game, player: host };
}

function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

function deleteRoom(code) {
  const g = rooms.get(code);
  if (g) g.clearTimer();
  rooms.delete(code);
}

// Nettoyage : supprime les salons vides (tous déconnectés) après un délai.
function cleanupEmptyRooms() {
  for (const [code, game] of rooms) {
    const anyConnected = game.players.some((p) => p.connected);
    if (!anyConnected) {
      if (!game._emptySince) game._emptySince = Date.now();
      else if (Date.now() - game._emptySince > 10 * 60 * 1000) deleteRoom(code);
    } else {
      game._emptySince = null;
    }
  }
}

setInterval(cleanupEmptyRooms, 60 * 1000);

module.exports = { createRoom, getRoom, deleteRoom, rooms };

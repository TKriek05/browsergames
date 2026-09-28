// Lobby rules shared by server (enforces) and client (explains why the start
// button is disabled). Works on the public room state the server broadcasts.
import { getGame } from './catalog.js';

export function seatedPlayers(room) {
  return room.players.filter((p) => p.role === 'player');
}

export function checkCanStart(room) {
  const game = getGame(room.game);
  if (!game || !game.available) return { ok: false, reason: 'Dit spel is nog niet speelbaar.' };
  if (room.state !== 'lobby') return { ok: false, reason: 'Er loopt al een spel.' };

  const seated = seatedPlayers(room);
  if (seated.length < game.min) {
    return { ok: false, reason: `Minimaal ${game.min} spelers nodig. Voeg eventueel bots toe.` };
  }
  const waiting = seated.filter((p) => !p.bot && p.id !== room.hostId && p.connected && !p.ready);
  if (waiting.length === 1) return { ok: false, reason: `Wacht tot ${waiting[0].name} klaar is.` };
  if (waiting.length > 1) return { ok: false, reason: `Wacht tot iedereen klaar is (${waiting.length} nog niet).` };
  return { ok: true, reason: '' };
}

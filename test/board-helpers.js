// Helpers for board game tests: a fake room around the generic adapter.
import { boardGame } from '../server/games/board.js';

export function fakeRoom(players) {
  const room = {
    players,
    events: [],
    game: null,
    ended: null,
    gamePlayers: () => players,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame: (results) => { room.ended = results; },
  };
  return room;
}

export const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
export const bot = (id, slot, botLevel = 'hard') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel });

export function makeGame(rules, players, settings = {}) {
  const room = fakeRoom(players);
  room.game = boardGame(rules).create(room, settings);
  return { room, game: room.game };
}

// Run ticks until `until()` or the time limit; bot moves may be async.
export async function runTicks(game, until, maxSeconds = 30) {
  for (let t = 0; t < maxSeconds * 10; t++) {
    game.tick(0.1);
    await new Promise((r) => setImmediate(r));
    if (until()) return true;
  }
  return false;
}

// Registry of server-side game modules.
//
// ─── Game module interface (server) ─────────────────────────────────────────
// export default {
//   id: 'tag',
//   realtime: true,            // true: 30 Hz sim + 20 Hz binary snapshots
//                              // false: 10 Hz tick, JSON snapshot when `dirty`
//   tickRate?: number,         // optional override
//   create(room, settings) → instance
// }
//
// instance:
//   onJoin(player)             a seated player enters (also called for each
//                              seated player when the game is created, if you like)
//   onLeave(player)            a seated player is gone for good
//   onReconnect?(player)       same player, new socket (reset input queues)
//   onBotTakeover?(player)     player.isBot just became true
//   onInput(player, msg)       realtime: decoded input { seq, buttons, ax, ay, aim }
//                              (object is reused: copy what you keep!)
//                              board: validated JSON `data` from { t:'input' }
//   tick(dt)                   advance the simulation by dt seconds
//   snapshot(arg)              realtime: arg is a ByteWriter with the header
//                              already written; append your body.
//                              board: arg is the recipient player (may be a
//                              spectator); return a JSON-safe object.
//   dirty                      board games: set true to push a snapshot
//   dispose?()                 cleanup
//
// Room API available to games:
//   room.gamePlayers()  room.settings  room.now()  room.emit(e, data)
//   room.sendTo(player, type, payload)  room.endGame(results)
//
// results: { title, columns: [..], rows: [{ id, name, color, rank, values: [..] }] }
// ─────────────────────────────────────────────────────────────────────────────
import tag from './tag.js';
import { boardGame } from './board.js';
import tictactoe from '../../shared/rules/tictactoe.js';

// Board games are pure rules modules wrapped by the generic adapter.
const BOARD_RULES = [tictactoe];

const MODULES = new Map([[tag.id, tag], ...BOARD_RULES.map((rules) => [rules.id, boardGame(rules)])]);

export const registry = {
  get: (id) => MODULES.get(id) ?? null,
  has: (id) => MODULES.has(id),
};

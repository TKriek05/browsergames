// Worker thread: runs one engine search at a time.
import { parentPort } from 'node:worker_threads';
import { ENGINES } from './engines.js';

parentPort.on('message', ({ id, gameId, state, seat, level }) => {
  try {
    const engine = ENGINES[gameId];
    if (!engine) throw new Error(`no engine for ${gameId}`);
    parentPort.postMessage({ id, move: engine.pick(state, seat, level, Math.random) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});

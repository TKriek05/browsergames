// A small pool of worker threads for heavy bot thinking (chess, draughts,
// reversi…), so a long search never blocks the event loop / other rooms.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const WORKER_URL = new URL('./worker.js', import.meta.url);

export class AiPool {
  constructor(size = Math.max(1, Math.min(3, availableParallelism() - 1))) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
  }

  _spawn() {
    const w = new Worker(WORKER_URL);
    w.unref(); // never keep the process alive on shutdown
    const slot = { worker: w, job: null };
    w.on('message', (msg) => {
      const job = slot.job;
      if (!job || job.id !== msg.id) return;
      clearTimeout(job.timer);
      slot.job = null;
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg.move);
      this._drain();
    });
    w.on('error', (err) => this._fail(slot, err));
    w.on('exit', () => {
      if (slot.job) this._fail(slot, new Error('worker exited'));
      this.workers = this.workers.filter((s) => s !== slot);
    });
    this.workers.push(slot);
    return slot;
  }

  _fail(slot, err) {
    const job = slot.job;
    slot.job = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(err);
    }
    this._drain();
  }

  // job: { gameId, state, seat, level } → Promise<move>
  run(job, timeoutMs) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, id: this.nextId++, resolve, reject, timeoutMs });
      this._drain();
    });
  }

  _drain() {
    while (this.queue.length) {
      let slot = this.workers.find((s) => !s.job);
      if (!slot && this.workers.length < this.size) slot = this._spawn();
      if (!slot) return;
      const job = this.queue.shift();
      slot.job = job;
      // A runaway search is killed; the caller falls back to a simple move.
      job.timer = setTimeout(() => {
        slot.worker.terminate();
        this._fail(slot, new Error('ai timeout'));
      }, job.timeoutMs);
      slot.worker.postMessage({ id: job.id, gameId: job.gameId, state: job.state, seat: job.seat, level: job.level });
    }
  }

  terminate() {
    for (const s of this.workers) s.worker.terminate();
    this.workers = [];
  }
}

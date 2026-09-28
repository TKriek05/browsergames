// Quizkoorts (server side): everyone answers the same multiple-choice
// question at the same time. A right answer scores 500 points plus up to 500
// for speed, and a streak bonus. The right answer and the others' picks are
// only sent at the reveal. Bots answer after a "thinking" delay with an
// accuracy that depends on their level.
import { createRng } from '../../shared/rng.js';
import { QUESTIONS } from './quiz-questions.js';

const INTRO_S = 4;
const REVEAL_S = 5;
const EARLY_S = 0.9; // everyone answered: reveal after this pause
const END_HOLD_S = 7;
const BASE = 500;
const SPEED = 500;
const STREAK = 100; // per correct answer in a row, from the second one (max 3×)

const BOT = {
  easy: { accuracy: 0.45, from: 0.35, to: 0.9 },
  normal: { accuracy: 0.65, from: 0.25, to: 0.75 },
  hard: { accuracy: 0.85, from: 0.15, to: 0.55 },
};

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Pick `count` questions (a category, or a mix) with shuffled answers.
export function pickQuestions(rng, count, category = 'alles', bank = QUESTIONS) {
  let pool = bank.filter((q) => category === 'alles' || q[0] === category);
  if (pool.length < count) pool = bank.slice();
  return shuffle(pool.slice(), rng).slice(0, count).map(([cat, text, ...answers]) => {
    const order = shuffle([0, 1, 2, 3], rng);
    return { category: cat, text, answers: order.map((i) => answers[i]), correct: order.indexOf(0) };
  });
}

class QuizGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.duration = settings.time ?? 15;
    this.questions = pickQuestions(this.rng, settings.count ?? 10, settings.category ?? 'alles');
    this.q = -1;
    this.time = 0;
    this.phase = 'intro'; // intro → ask → reveal → … → end
    this.phaseEnd = INTRO_S;
    this.entries = new Map(); // player id → { score, correct, streak, answer, at, gain, botAt, botPick }
    for (const p of room.gamePlayers()) this.onJoin(p);
    this.dirty = true;
  }

  onJoin(player) {
    if (this.entries.has(player.id)) return;
    this.entries.set(player.id, { player, score: 0, correct: 0, streak: 0, answer: -1, at: 0, gain: 0, botAt: 0, botPick: -1 });
    if (this.phase === 'ask') this._planBot(this.entries.get(player.id));
    this.dirty = true;
  }

  onLeave(player) {
    this.entries.delete(player.id);
    this.dirty = true;
  }

  onBotTakeover(player) {
    const e = this.entries.get(player.id);
    if (e && this.phase === 'ask' && e.answer < 0) this._planBot(e);
    this.dirty = true;
  }

  onReconnect() {
    this.dirty = true;
  }

  onInput(player, data) {
    const e = this.entries.get(player.id);
    if (!e || this.phase !== 'ask' || !data || data.type !== 'answer') return;
    if (!Number.isInteger(data.a) || data.a < 0 || data.a > 3 || e.answer >= 0) return;
    this._answer(e, data.a);
  }

  _answer(e, a) {
    e.answer = a;
    e.at = this.time - (this.phaseEnd - this.duration);
    this.dirty = true;
    if ([...this.entries.values()].every((x) => x.answer >= 0)) this.phaseEnd = Math.min(this.phaseEnd, this.time + EARLY_S);
  }

  _planBot(e) {
    const cfg = BOT[e.player.botLevel] ?? BOT.normal;
    e.botAt = this.time + this.duration * (cfg.from + this.rng() * (cfg.to - cfg.from));
    const right = this.questions[this.q].correct;
    if (this.rng() < cfg.accuracy) e.botPick = right;
    else {
      const wrong = [0, 1, 2, 3].filter((i) => i !== right);
      e.botPick = wrong[Math.floor(this.rng() * wrong.length)];
    }
  }

  _ask() {
    this.q++;
    this.phase = 'ask';
    this.phaseEnd = this.time + this.duration;
    for (const e of this.entries.values()) {
      e.answer = -1;
      e.at = 0;
      e.gain = 0;
      if (e.player.isBot) this._planBot(e);
    }
    this.room.emit('question', { q: this.q });
    this.dirty = true;
  }

  _reveal() {
    const right = this.questions[this.q].correct;
    for (const e of this.entries.values()) {
      if (e.answer === right) {
        e.streak++;
        e.correct++;
        const speed = Math.max(0, 1 - e.at / this.duration);
        e.gain = BASE + Math.round(SPEED * speed) + STREAK * Math.min(3, e.streak - 1);
        e.score += e.gain;
      } else {
        e.streak = 0;
        e.gain = 0;
      }
    }
    this.phase = 'reveal';
    this.phaseEnd = this.time + REVEAL_S;
    this.room.emit('reveal', { q: this.q });
    this.dirty = true;
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === 'ask') {
      for (const e of this.entries.values()) {
        if (e.player.isBot && e.answer < 0 && this.time >= e.botAt) this._answer(e, e.botPick);
      }
    }
    if (this.time < this.phaseEnd) return;
    if (this.phase === 'intro') this._ask();
    else if (this.phase === 'ask') this._reveal();
    else if (this.phase === 'reveal') {
      if (this.q + 1 < this.questions.length) this._ask();
      else {
        this.phase = 'end';
        this.phaseEnd = this.time + END_HOLD_S;
        this.room.emit('end');
        this.dirty = true;
      }
    } else if (this.phase === 'end') this.room.endGame(this.results());
  }

  _ranked() {
    return [...this.entries.values()].sort((a, b) => b.score - a.score || b.correct - a.correct);
  }

  // Per recipient: the right answer and other players' picks only after the reveal.
  snapshot(player) {
    const showAll = this.phase === 'reveal' || this.phase === 'end';
    const cur = this.q >= 0 ? this.questions[this.q] : null;
    const mine = player ? this.entries.get(player.id) : null;
    return {
      phase: this.phase,
      q: this.q,
      total: this.questions.length,
      left: Math.max(0, this.phaseEnd - this.time),
      duration: this.duration,
      question: cur && this.phase !== 'intro' ? { category: cur.category, text: cur.text, answers: cur.answers } : null,
      correct: showAll && cur ? cur.correct : -1,
      mine: mine ? mine.answer : -1,
      players: this._ranked().map((e) => ({
        id: e.player.id,
        score: e.score,
        correct: e.correct,
        streak: e.streak,
        answered: e.answer >= 0,
        pick: showAll || e === mine ? e.answer : -1,
        gain: showAll ? e.gain : 0,
      })),
    };
  }

  results() {
    const rows = this._ranked();
    return {
      title: 'Uitslag Quizkoorts',
      columns: ['Punten', 'Goed'],
      rows: rows.map((e) => ({
        id: e.player.id,
        name: e.player.name,
        color: e.player.color,
        rank: 1 + rows.filter((o) => o.score > e.score).length,
        values: [String(e.score), `${e.correct}/${this.questions.length}`],
      })),
    };
  }
}

export default {
  id: 'quiz',
  realtime: false,
  create: (room, settings) => new QuizGame(room, settings),
};

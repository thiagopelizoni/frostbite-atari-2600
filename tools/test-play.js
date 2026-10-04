'use strict';

// Play-through bot. The real game only ever receives what the browser feeds it: Game.step(dt, input)
// with the five controls. Decisions read the state and rehearse moves on throwaway copies.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  console,
  Math,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const filename of ['config.js', 'sprites.js', 'world.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', filename), 'utf8'), sandbox, { filename });
}

const FB = sandbox.FB;
const C = FB.Config;
const T = C.TUNE;
const W = FB.World;

const FRAME = 1 / 60;
// By default levels 1-6, which cover every floe shape, the night palette, clams and the bear.
// `node tools/test-play.js N` plays levels 1 to N instead, for N from 1 to 9. From level 10 the bear
// outruns Bailey on the shore and the first row carries him away from the door; the bot neither rides
// the second row back nor waits for the bear to walk off, so it freezes there.
const MAX_LEVELS = 9;
const LEVELS = Math.max(1, Math.floor(Number(process.argv[2])) || 6);
if (LEVELS > MAX_LEVELS) {
  console.error(`o robô só sabe jogar as fases 1 a ${MAX_LEVELS}; a fase ${LEVELS} está fora do alcance dele`);
  process.exit(2);
}
const LEVEL_LIMIT = 120;
// Wall-clock budget per run, so a long run on a slow machine fails only when it stalls.
const WALL_LIMIT = Math.max(60000, LEVELS * 10000);
const wallStart = Date.now();
const DOOR = (T.doorMin + T.doorMax) / 2;
const MARGIN = 2;
const DECIDE_EVERY = 4;
const HORIZON = 120;
const NONE = {};
const CANDIDATES = [
  NONE, { left: true }, { right: true }, { up: true }, { down: true },
  { up: true, left: true }, { up: true, right: true }, { down: true, left: true }, { down: true, right: true },
];

// A planning copy: same prototype, fresh data, shared silent audio.
function fork(game) {
  const copy = Object.create(Object.getPrototypeOf(game));
  for (const key of Object.keys(game)) {
    const value = game[key];
    copy[key] = key === 'audio' || key === 'onScore' || !value || typeof value !== 'object' ? value : structuredClone(value);
  }
  return copy;
}

function fingerprint(game) {
  return JSON.stringify(game, (key, value) => (key === 'audio' || key === 'onScore' ? undefined : value));
}

// Where a row will be `ahead` seconds from now; the start-of-life hold keeps it still.
function rowAt(game, row, ahead) {
  const moving = Math.max(0, ahead - game.hold);
  return {
    offset: W.wrap(row.offset + row.dir * row.speed * moving),
    shape: row.shape,
    gap: W.breathGap(row.shape, game.breath + moving),
  };
}

function driftAt(game, lane, ahead) {
  if (lane === 0) return 0;
  const row = game.rowOf(lane);
  return row.dir * row.speed * Math.max(0, ahead - game.hold);
}

// Shortest move from x to safe footing on a (predicted) row, if it is within reach; else null.
// MARGIN keeps the bot a little inside the engine's own foot tolerance.
function landing(row, x, reach) {
  let best = null;
  for (const piece of W.pieces(row)) {
    const span = Math.max(0, piece.w / 2 + T.footTolerance - MARGIN);
    const delta = W.wrapDelta(piece.x + piece.w / 2, x);
    if (Math.abs(delta) > reach + span) continue;
    const move = Math.abs(delta) <= span ? 0 : delta - Math.sign(delta) * span;
    if (best === null || Math.abs(move) < Math.abs(best)) best = move;
  }
  return best;
}

function reach(game) {
  return C.airSpeed(game.level) * T.jumpTime * 0.75;
}

function whiteSteps(game) {
  if (game.doorOpen()) return [-1];
  let distance = Infinity;
  const steps = new Set();
  game.rows.forEach((row) => {
    const lane = row.index + 1;
    if (!row.white || lane === game.lane) return;
    const d = Math.abs(lane - game.lane);
    if (d < distance) {
      distance = d;
      steps.clear();
    }
    if (d === distance) steps.add(Math.sign(lane - game.lane));
  });
  if (!steps.size) return game.lane < 4 ? [1] : [-1];
  return [...steps];
}

// How soon (seconds) a jump of `step` would land, walking `dir` until then; Infinity if never.
function plan(game, step, dir) {
  const next = game.lane + step;
  const air = reach(game);
  for (let wait = 0; wait <= 1.5; wait += 3 * FRAME) {
    let x = game.x + driftAt(game, game.lane, wait) + dir * T.walkSpeed * wait;
    if (game.lane === 0) {
      x = Math.max(T.shoreMin, Math.min(T.shoreMax, x));
    } else {
      const here = rowAt(game, game.rowOf(game.lane), wait);
      if (!W.supportAt(here, x, T.footTolerance - 0.5)) return Infinity;
    }
    if (next === 0) {
      if (!game.doorOpen() || Math.abs(DOOR - x) <= air) return wait;
      continue;
    }
    if (landing(rowAt(game, game.rowOf(next), wait + T.jumpTime), W.wrap(x), air) !== null) return wait;
  }
  return Infinity;
}

// Nothing to plan: drift back toward the middle of the floe underfoot.
function centre(game) {
  const move = landing(game.rowOf(game.lane), W.wrap(game.x), 16);
  if (move === null || Math.abs(move) < 0.5) return NONE;
  return move > 0 ? { right: true } : { left: true };
}

// The cheap stateless player used both live and to finish every rehearsal.
function policy(game) {
  // The first move a player tends to make; the floes hold, so it must never drown Bailey.
  if (game.phase === 'ready') return { down: true };
  if (game.phase !== 'playing') return NONE;
  if (game.jump) {
    const left = game.jump.duration - game.jump.t;
    let target = null;
    if (game.jump.to === 0) target = game.doorOpen() ? DOOR - game.x : null;
    else target = landing(rowAt(game, game.rowOf(game.jump.to), left), W.wrap(game.x), reach(game) * 2);
    if (target === null || Math.abs(target) < 0.5) return NONE;
    return target > 0 ? { right: true } : { left: true };
  }
  if (game.lane === 0 && game.doorOpen()) {
    if (game.inDoor()) return { up: true };
    return game.x < DOOR ? { right: true } : { left: true };
  }
  let best = null;
  for (const step of whiteSteps(game)) {
    for (const dir of [0, -1, 1]) {
      const wait = plan(game, step, dir);
      if (!best || wait < best.wait) best = { step, dir, wait };
    }
  }
  if (!best || best.wait === Infinity) return game.lane === 0 ? NONE : centre(game);
  if (best.wait === 0) {
    const input = best.step < 0 ? { up: true } : { down: true };
    if (game.doorOpen() && game.lane === 1) {
      if (game.x < DOOR - 1) input.right = true;
      else if (game.x > DOOR + 1) input.left = true;
    }
    return input;
  }
  if (best.dir < 0) return { left: true };
  if (best.dir > 0) return { right: true };
  return NONE;
}

function value(game, base, frame) {
  if (game.level > base.level || game.phase === 'clear') return 1e9 - frame;
  if (game.lives < base.lives || game.phase === 'dying' || game.phase === 'gameover') return -1e9 + frame;
  let v = 1000 * game.blocks + 0.1 * (game.score - base.score);
  if (game.doorOpen()) v -= 300 * game.lane + 2 * Math.abs(game.x - DOOR);
  else {
    const whites = game.rows.filter((row) => row.white && row.index + 1 !== game.lane);
    if (whites.length) v -= 100 * Math.min(...whites.map((row) => Math.abs(row.index + 1 - game.lane)));
  }
  return v;
}

function rehearse(game, first) {
  const copy = fork(game);
  const base = { level: game.level, lives: game.lives, score: game.score };
  for (let frame = 1; frame <= HORIZON; frame++) {
    const input = first && frame <= DECIDE_EVERY ? first : policy(copy);
    copy.step(FRAME, input);
    if (copy.phase !== 'playing') return value(copy, base, frame);
  }
  return value(copy, base, HORIZON);
}

// Follow the policy unless rehearsing it ends in a lost life; then try every control.
function decide(game) {
  let best = { first: null, v: rehearse(game, null) };
  if (best.v > -1e8) return null;
  for (const first of CANDIDATES) {
    const v = rehearse(game, first);
    if (v > best.v) best = { first, v };
  }
  return best.first;
}

function run() {
  const runStart = Date.now();
  const game = new FB.Game();
  const log = [];
  let frame = 0;
  let held = null;
  let heldFor = DECIDE_EVERY;
  let levelStart = 0;
  let deaths = 0;
  let lastPhase = game.phase;

  const fail = (message) => {
    const detail = {
      erro: message,
      phase: game.phase,
      reason: game.reason,
      level: game.level,
      lane: game.lane,
      x: Number(game.x.toFixed(1)),
      blocks: game.blocks,
      degrees: game.degrees,
      score: game.score,
      lives: game.lives,
      frame: frame,
      levels: log,
    };
    console.error(JSON.stringify(detail));
    process.exit(1);
  };

  // GAME RESET by the fire button, as on the title screen in the browser.
  game.step(FRAME, { fire: true });
  frame++;
  if (game.phase === 'title') fail('o botão vermelho não inicia o jogo');
  if (game.phase !== 'ready') fail('o botão vermelho pula a espera do JOGADOR 1');

  while (game.level <= LEVELS) {
    if (game.phase === 'gameover') fail('fim de jogo antes de concluir as fases');
    if ((frame - levelStart) * FRAME > LEVEL_LIMIT) fail(`a fase ${game.level} passou de ${LEVEL_LIMIT}s`);
    if (Date.now() - runStart > WALL_LIMIT) fail('o robô estourou o tempo de execução');

    let input = NONE;
    if (game.phase === 'playing' || game.phase === 'ready') {
      const before = fingerprint(game);
      if (game.phase === 'playing' && heldFor >= DECIDE_EVERY) {
        held = decide(game);
        heldFor = 0;
      }
      input = held && game.phase === 'playing' ? held : policy(game);
      heldFor++;
      if (game.phase === 'ready') held = null;
      assert.equal(fingerprint(game), before, 'as decisões só leem o estado');
    }

    const level = game.level;
    game.step(FRAME, Object.assign({}, input));
    frame++;
    if (game.phase === 'dying' && lastPhase !== 'dying') {
      deaths++;
      if (game.reason === 'frio') fail(`Bailey congelou na fase ${level}`);
      console.error(`fase ${level}: perdeu uma vida (${game.reason}) aos ${((frame - levelStart) * FRAME).toFixed(1)}s`);
    }
    if (lastPhase === 'playing' && game.phase === 'clear') {
      const seconds = (frame - levelStart) * FRAME;
      log.push({ level, seconds: Number(seconds.toFixed(2)), degrees: game.displayedDegrees(), bonus: game.lastBonus });
    }
    if (game.level > level) {
      levelStart = frame;
      held = null;
      heldFor = DECIDE_EVERY;
    }
    lastPhase = game.phase;
  }

  return {
    summary: {
      play: 'passed',
      inputOnly: true,
      levels: game.level - 1,
      score: game.score,
      lives: game.lives,
      seconds: Number((frame * FRAME).toFixed(2)),
    },
    log,
    deaths,
  };
}

const result = run();
const again = run();
assert.deepEqual(again, result, 'duas partidas com os mesmos controles terminam iguais');
console.error(JSON.stringify({ fases: result.log, mortes: result.deaths, ms: Date.now() - wallStart }));
assert.ok(result.summary.levels >= LEVELS, `o robô conclui as fases 1 a ${LEVELS}`);
assert.ok(result.summary.lives > 0);
console.log(JSON.stringify(result.summary));

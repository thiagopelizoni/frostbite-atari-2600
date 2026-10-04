'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { console, Math, performance: { now: () => 0 } };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const name of ['config', 'sprites', 'world', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), sandbox);
}

const FB = sandbox.FB;
const C = FB.Config;
const T = C.TUNE;
const W = FB.World;
const game = new FB.Game();
game.start();

function landingSafe(x, row, lead) {
  const future = W.wrap(row.offset + row.dir * row.speed * lead);
  const pieces = W.segments(row.pattern, future);
  if (!W.feetOn(pieces, x, T.half + 1)) return false;
  return game.enemies.every((enemy) => {
    if (enemy.row !== row.index) return true;
    const futureX = enemy.x + (enemy.paused ? 0 : enemy.dir * enemy.speed * lead);
    return Math.abs(W.wrapDelta(x, futureX)) > 16;
  });
}

function nearestSafe(row, lead) {
  let best = null;
  for (let x = 8; x <= 152; x += 2) {
    if (!landingSafe(x, row, lead)) continue;
    const distance = Math.abs(x - game.x);
    if (!best || distance < best.distance) best = { x: x, distance: distance };
  }
  return best;
}

function targetLane() {
  if (game.blocks >= T.blocksNeeded) return 5;
  let best = null;
  for (let index = 0; index < game.rows.length; index++) {
    const lane = index + 1;
    if (!game.rows[index].white || lane === game.lane) continue;
    const distance = Math.abs(lane - game.lane);
    if (!best || distance < best.distance) best = { lane: lane, distance: distance };
  }
  return best ? best.lane : (game.lane < 4 ? game.lane + 1 : game.lane - 1);
}

function threatened() {
  if (game.lane < 1 || game.lane > 4) return false;
  return game.enemies.some(function (enemy) {
    if (enemy.row !== game.lane - 1) return false;
    const gap = W.wrapDelta(enemy.x, game.x);
    const closing = (gap > 0 && enemy.dir < 0) || (gap < 0 && enemy.dir > 0);
    return Math.abs(gap) < 12 || (!enemy.paused && closing && Math.abs(gap) < 30);
  });
}

function flee() {
  const target = targetLane();
  const steps = [];
  if (game.lane < 5) steps.push(1);
  if (game.lane > 0) steps.push(-1);
  steps.sort(function (a, b) {
    return Math.abs(game.lane + a - target) - Math.abs(game.lane + b - target);
  });
  const lead = T.jumpTime + 1 / 60;
  for (let i = 0; i < steps.length; i++) {
    const dest = game.lane + steps[i];
    const safe = dest === 0 || dest === 5 || landingSafe(game.x, game.rows[dest - 1], lead);
    if (safe) return steps[i] > 0 ? { up: true } : { down: true };
  }
  return {};
}

function decide() {
  if (game.phase !== 'playing' || game.jump || game.hopLock > 0) return {};
  if (threatened()) return flee();
  if (game.blocks >= T.blocksNeeded && game.lane === 5) {
    const door = T.doorX + T.doorW / 2;
    if (Math.abs(game.x - door) <= 3) return {};
    return game.x < door ? { right: true } : { left: true };
  }
  const target = targetLane();
  if (target === game.lane) return {};
  const step = target > game.lane ? 1 : -1;
  const destination = game.lane + step;
  const input = step > 0 ? { up: true } : { down: true };
  if (destination === 0 || destination === 5) return input;
  const row = game.rows[destination - 1];
  const lead = T.jumpTime + 1 / 60;
  if (landingSafe(game.x, row, lead)) return input;
  if (game.lane === 0 || game.lane === 5) {
    const safe = nearestSafe(row, lead);
    if (!safe) return {};
    if (safe.distance <= 2) return input;
    return safe.x > game.x ? { right: true } : { left: true };
  }
  return {};
}

const limit = 60 * 75;
let frame = 0;
for (; frame < limit && game.level < 2 && game.phase !== 'gameover'; frame++) {
  const input = game.phase === 'ready' ? { right: true } : decide();
  game.step(1 / 60, input);
}

if (game.level < 2) {
  console.error(JSON.stringify({
    phase: game.phase,
    reason: game.reason,
    level: game.level,
    lane: game.lane,
    x: Math.round(game.x),
    blocks: game.blocks,
    degrees: Number(game.degrees.toFixed(2)),
    score: game.score,
    lives: game.lives,
    frame: frame,
  }));
}

assert.equal(game.level, 2, 'Bailey entra no iglu da primeira fase');
assert.ok(game.score >= 16 * 10 + 160, 'o iglu e a entrada pontuam');
assert.equal(game.lives, 4, 'a primeira fase não custa uma vida');
assert.equal(game.blocks, 0);
console.log(`Fase 1 concluída em ${(frame / 60).toFixed(1)}s com ${game.score} pontos.`);

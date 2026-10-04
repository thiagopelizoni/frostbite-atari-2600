'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { buildArtifact, ROOT, OUTPUT } = require('./build-artifact');

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

function fresh() {
  const game = new FB.Game();
  game.start();
  return game;
}

function play(game) {
  game.step(1 / 60, { right: true });
  assert.equal(game.phase, 'playing');
  return game;
}

function park(row, x) {
  const piece = row.pattern[0];
  const shift = row.dir * row.speed / 120;
  row.offset = W.wrap(x - piece[1] / 2 - piece[0] - shift);
}

function clearCreatures(game) {
  for (const enemy of game.enemies) enemy.x = 4;
  for (const fish of game.fish) {
    fish.x = 4;
    fish.alive = false;
    fish.respawn = 30;
  }
}

function landOn(game, lane, x) {
  const from = Math.max(0, lane - 1);
  game.lane = from;
  game.x = x;
  game.jump = null;
  game.hopLock = 0;
  game.phase = 'playing';
  if (lane >= 1 && lane <= 4) park(game.rows[lane - 1], x);
  clearCreatures(game);
  game.jump = { from: from, to: lane, t: T.jumpTime - 0.001, duration: T.jumpTime };
  game.step(1 / 60, {});
}

test('as fileiras têm gelo para pisar e água para cair', () => {
  const first = W.create(1);
  const second = W.create(1);
  assert.deepEqual(first.rows.map((row) => [row.offset, row.dir, row.speed, row.white]), second.rows.map((row) => [row.offset, row.dir, row.speed, row.white]));
  assert.equal(first.bear, null);
  assert.ok(W.create(4).bear);
  for (const row of first.rows) {
    const pieces = W.segments(row.pattern, 0);
    const covered = pieces.reduce((sum, piece) => sum + piece.w, 0);
    assert.ok(covered > 70 && covered < T.period - 20, `cobertura da fileira ${row.index}`);
    assert.ok(pieces.some((piece) => piece.w >= 12));
    let gap = false;
    for (let x = 0; x < T.period; x += 1) {
      if (!W.feetOn(pieces, x, T.half)) gap = true;
    }
    assert.equal(gap, true, `a fileira ${row.index} tem vão de água`);
    assert.notEqual(row.dir, first.rows[(row.index + 1) % 4] ? first.rows[row.index + 1]?.dir : row.dir);
  }
  assert.equal(first.rows[0].dir, -first.rows[1].dir);
  assert.equal(first.rows[1].dir, -first.rows[2].dir);
});

test('a partida espera o joystick e começa com uma vida e três reservas', () => {
  const game = new FB.Game();
  assert.equal(game.phase, 'title');
  game.start();
  assert.equal(game.phase, 'ready');
  const degrees = game.degrees;
  game.step(1, {});
  assert.equal(game.degrees, degrees);
  assert.equal(game.lives, 4);
  assert.equal(game.level, 1);
  game.step(1 / 60, { up: true });
  assert.equal(game.phase, 'playing');
  assert.ok(game.jump, 'o primeiro comando para cima já salta');
});

test('a tabela de pontos segue o cartucho e estaciona na nona fase', () => {
  for (let level = 1; level <= 9; level++) {
    assert.equal(C.icePoints(level), level * 10);
    assert.equal(C.enterPoints(level), level * 160);
  }
  assert.equal(C.icePoints(10), 90);
  assert.equal(C.enterPoints(12), 1440);
  assert.equal(C.degreePoints(1, 20), 200);
  assert.equal(C.degreePoints(4, 10), 400);
  assert.equal(C.degreePoints(10, 8), 800);
  assert.equal(C.startingLevel(1), 1);
  assert.equal(C.startingLevel(3), 5);
  assert.equal(C.isNight(1), false);
  assert.equal(C.isNight(5), true);
  assert.equal(C.isNight(9), false);
  assert.notEqual(C.palette(1).water, C.palette(5).water);
});

test('pisar no gelo branco constrói o iglu e o azul não repete o bloco', () => {
  const game = play(fresh());
  landOn(game, 1, 80);
  assert.equal(game.phase, 'playing');
  assert.equal(game.lane, 1);
  assert.equal(game.blocks, 1);
  assert.equal(game.score, 10);
  assert.equal(game.rows[0].white, false);
  const stayed = game.x;
  game.step(0.2, {});
  assert.equal(game.blocks, 1);
  assert.equal(game.score, 10);
  assert.notEqual(Math.round(game.x), Math.round(stayed));
  assert.equal(game.phase, 'playing', 'o gelo carrega Bailey sem derrubá-lo');
});

test('as quatro fileiras azuis voltam a ficar brancas e 16 blocos abrem a porta', () => {
  const game = play(fresh());
  for (let block = 1; block <= 16; block++) {
    const lane = (block - 1) % 4 + 1;
    landOn(game, lane, 80);
    assert.equal(game.blocks, block, `bloco ${block}`);
    assert.equal(game.phase, 'playing');
    if (block % 4 === 0 && block < 16) {
      assert.ok(game.rows.every((row) => row.white), `ciclo ${block}`);
    }
  }
  assert.equal(game.doorOpen(), true);
  assert.equal(game.score, 160);
  game.degrees = 40;
  game.lane = 5;
  game.x = T.doorX + T.doorW / 2;
  game.jump = null;
  game.step(1 / 60, {});
  assert.equal(game.phase, 'clear');
  assert.equal(game.lastBonus, 160 + 10 * 40 * 1);
  assert.equal(game.score, 160 + game.lastBonus);
  game.step(2, {});
  assert.equal(game.level, 2);
  assert.equal(game.blocks, 0);
  assert.equal(game.phase, 'playing');
  assert.equal(game.lane, 0);
});

test('cair na água, encostar na criatura e congelar custam uma vida', () => {
  const drowned = play(fresh());
  drowned.lane = 1;
  drowned.jump = null;
  drowned.rows[0].offset = 0;
  let gap = null;
  const pieces = W.segments(drowned.rows[0].pattern, drowned.rows[0].offset);
  for (let x = 8; x < 150; x++) {
    if (!W.feetOn(pieces, x, T.half)) { gap = x; break; }
  }
  assert.ok(gap != null);
  drowned.x = gap;
  drowned.step(1 / 60, {});
  assert.equal(drowned.phase, 'dying');
  assert.equal(drowned.reason, 'mar');

  const bitten = play(fresh());
  bitten.jump = { from: 0, to: 2, t: 0, duration: 1 };
  bitten.lane = 0;
  bitten.x = 70;
  bitten.enemies[0].row = 1;
  bitten.enemies[0].x = 70;
  bitten.step(0.05, {});
  assert.equal(bitten.phase, 'playing', 'no ar a criatura não alcança');
  park(bitten.rows[1], 70);
  bitten.enemies[0].x = 70;
  bitten.jump.duration = T.jumpTime;
  bitten.jump.t = T.jumpTime - 0.001;
  bitten.step(1 / 60, {});
  assert.equal(bitten.phase, 'dying');
  assert.equal(bitten.reason, 'criatura');

  const frozen = play(fresh());
  frozen.degrees = 0.01;
  frozen.step(0.05, {});
  assert.equal(frozen.phase, 'dying');
  assert.equal(frozen.reason, 'frio');
  assert.equal(frozen.degrees, 0);
});

test('o peixe vale 200 e o botão vermelho desfaz um bloco por toque', () => {
  const game = play(fresh());
  game.lane = 0;
  game.x = 80;
  park(game.rows[0], 80);
  game.fish[0].gap = 0;
  game.fish[0].x = 80;
  game.fish[0].alive = true;
  game.jump = { from: 0, to: 1, t: T.jumpTime - 0.001, duration: T.jumpTime };
  game.step(1 / 60, {});
  assert.equal(game.score, 210);
  assert.equal(game.blocks, 1);
  assert.equal(game.fish[0].alive, false);

  const before = game.rows[0].dir;
  game.step(1 / 30, { fire: true });
  assert.equal(game.blocks, 0);
  assert.equal(game.rows[0].dir, -before);
  game.step(0.2, { fire: true });
  assert.equal(game.blocks, 0, 'segurar o botão não desfaz outro bloco');
  game.blocks = 16;
  const openDir = game.rows[0].dir;
  game.fireLatch = false;
  game.step(1 / 60, { fire: true });
  assert.equal(game.blocks, 16, 'com a porta aberta o botão não desfaz o iglu');
  assert.equal(game.rows[0].dir, -openDir);
});

test('o urso aparece na fase 4, respeita o esconderijo e muda de lado com o botão', () => {
  const game = fresh();
  game.action('select3');
  assert.equal(game.level, 5);
  game.action('select1');
  game.level = 4;
  game.beginRound();
  game.phase = 'playing';
  assert.ok(game.bear);
  const dir = game.bear.dir;
  game.blocks = 3;
  game.lane = 5;
  game.x = 12;
  game.step(1 / 30, { fire: true });
  assert.equal(game.phase, 'playing');
  assert.equal(game.bear.dir, -dir);
  assert.equal(game.blocks, 2);
  game.x = game.bear.x;
  game.fireLatch = true;
  game.step(1 / 60, {});
  assert.equal(game.phase, 'dying');
  assert.equal(game.reason, 'urso');
});

test('vida extra a cada 5.000 pontos, com teto de nove reservas', () => {
  const game = play(fresh());
  game.scorePoints(5000);
  assert.equal(game.lives, 5);
  game.scorePoints(45000);
  assert.equal(game.score, 50000);
  assert.equal(game.lives, 10);
  assert.equal(game.magicFish, false);
  game.scorePoints(60000);
  assert.equal(game.score, 110000);
  assert.equal(game.lives, 10);
  assert.equal(game.magicFish, true);
  game.scorePoints(999999);
  assert.equal(game.score, 999999);
});

test('perder as quatro vidas encerra a partida sem reiniciar com o botão preso', () => {
  const game = play(fresh());
  game.scorePoints(500);
  for (let i = 0; i < 4; i++) {
    if (game.phase === 'ready') game.step(1 / 60, { right: true });
    game.die('mar');
    game.step(2, i === 3 ? { fire: true } : {});
  }
  assert.equal(game.phase, 'gameover');
  assert.equal(game.lives, 0);
  game.step(1, { fire: true });
  assert.equal(game.phase, 'gameover');
  assert.equal(game.score, 500);
  game.step(1 / 60, {});
  game.step(1 / 60, { fire: true });
  assert.equal(game.phase, 'playing');
  assert.equal(game.score, 0);
  assert.equal(game.lives, 4);
});

test('no jogo 2 os jogadores alternam com placar e fase independentes', () => {
  const game = new FB.Game();
  game.action('select2');
  assert.equal(game.gameMode, 2);
  assert.equal(game.players.length, 2);
  game.step(1 / 60, { right: true });
  game.scorePoints(80);
  game.level = 2;
  game.die('mar');
  game.step(2, {});
  assert.equal(game.player, 1);
  assert.equal(game.score, 0);
  assert.equal(game.lives, 4);
  assert.equal(game.level, 1);
  game.step(1 / 60, { right: true });
  game.scorePoints(30);
  game.die('mar');
  game.step(2, {});
  assert.equal(game.player, 0);
  assert.equal(game.score, 80);
  assert.equal(game.lives, 3);
  assert.equal(game.level, 2);
});

test('a alavanca de dificuldade não muda fase nem pontuação', () => {
  const game = fresh();
  const level = game.level;
  game.action('difficulty');
  assert.equal(game.expertLever, true);
  assert.equal(game.level, level);
  assert.equal(game.phase, 'ready');
  assert.equal(C.icePoints(1), 10);
});

test('a simulação produz o mesmo resultado em passos grandes e pequenos', () => {
  const coarse = play(fresh());
  const fine = play(fresh());
  coarse.step(0.8, { up: true, right: true });
  for (let i = 0; i < 96; i++) fine.step(1 / 120, { up: true, right: true });
  for (const key of ['x', 'lane', 'score', 'blocks', 'degrees', 'lives']) {
    assert.ok(Math.abs(coarse[key] - fine[key]) < 1e-6, key);
  }
});

test('o artefato entrega um documento HTML completo sem arquivos externos', () => {
  const result = buildArtifact();
  const html = fs.readFileSync(OUTPUT, 'utf8');
  assert.ok(result.bytes > 10000);
  assert.match(html, /^\s*<!doctype html>/i);
  assert.match(html, /<meta\b[^>]*name=["']viewport["']/i);
  assert.match(html, /<canvas\b/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.match(html, /FROSTBITE/);
  assert.doesNotMatch(html, /<script\b[^>]*src=/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

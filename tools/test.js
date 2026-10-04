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
const FRAME = 1 / 60;

function near(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message || 'valor'}: esperado ${expected} ± ${tolerance}, obtido ${actual}`);
}

// A game already in 'playing' at the given level.
function fresh(level) {
  const game = new FB.Game();
  game.start();
  if (level && level !== game.level) {
    game.level = level;
    game.beginLevel();
  }
  game.phase = 'playing';
  return game;
}

// Still floes, no creatures and no hold: landings become deterministic.
function calm(game, keepBear) {
  game.clearCreatures();
  game.hold = 0;
  if (!keepBear) game.bear = null;
  for (const row of game.rows) row.speed = 0;
  return game;
}

// Slides a row so the centre of its first piece sits under x.
function parkUnder(game, lane, x) {
  const row = game.rowOf(lane);
  const piece = W.pieces(row)[0];
  row.offset = W.wrap(row.offset + (x - (piece.x + piece.w / 2)));
}

// One press, then frames until the jump ends.
function hop(game, step) {
  game.step(FRAME, step > 0 ? { down: true } : { up: true });
  assert.ok(game.jump, 'o salto começou');
  let frames = 0;
  while (game.jump && frames++ < 120) game.step(FRAME, {});
  assert.equal(game.jump, null, 'o salto terminou');
}

// Lands on a lane from the lane above it, with both rows parked under Bailey.
function landOn(game, lane, x = 80) {
  game.lane = lane - 1;
  game.x = x;
  game.jump = null;
  if (lane - 1 >= 1) parkUnder(game, lane - 1, x);
  parkUnder(game, lane, x);
  hop(game, 1);
}

// A water x on a row, far from every piece.
function waterOn(row) {
  for (let x = 0; x < T.period; x += 0.5) {
    if (!W.supportAt(row, x, 0) && !W.supportAt(row, x - 6, 0) && !W.supportAt(row, x + 6, 0) && !W.supportAt(row, x)) return x;
  }
  return null;
}

function runClear(game, input = {}) {
  let frames = 0;
  while (game.phase === 'clear' && frames++ < 5000) game.step(FRAME, input);
}

function snapshot(game) {
  return JSON.stringify({
    phase: game.phase, x: game.x, lane: game.lane, jump: game.jump, degrees: game.degrees, chill: game.chill,
    score: game.score, blocks: game.blocks, lives: game.lives, hold: game.hold, breath: game.breath, time: game.time,
    rows: game.rows, enemies: game.enemies, fish: game.fish, bear: game.bear, death: game.death, deathTimer: game.deathTimer,
  });
}

test('layout: margem no topo, quatro fileiras abaixo e mar aberto no fundo', () => {
  assert.equal(C.W, 160);
  assert.equal(C.H, 192);
  assert.equal(C.LANES.length, 5, 'não existe margem de baixo');
  assert.equal(C.LANES[0].kind, 'shore');
  for (let lane = 1; lane <= 4; lane++) {
    assert.equal(C.LANES[lane].kind, 'ice');
    assert.ok(C.LANES[lane].feet > C.LANES[lane - 1].feet, `a fileira ${lane} fica abaixo da anterior`);
  }
  assert.ok(C.LAYOUT.shoreTop >= C.LAYOUT.hud, 'a margem fica sob o HUD');
  assert.ok(C.LANES[4].top + C.LANES[4].height <= C.LAYOUT.waterBottom, 'a última fileira flutua no mar');
  assert.ok(C.LAYOUT.iglooX > C.W / 2, 'o iglu fica na ponta direita da margem');

  const game = calm(fresh());
  assert.equal(game.lane, 0);
  assert.equal(game.x, 64);
  game.step(FRAME, { up: true });
  assert.equal(game.jump, null, 'para cima na margem, longe da porta, não faz nada');
  for (let lane = 1; lane <= 4; lane++) parkUnder(game, lane, 64);
  for (let lane = 1; lane <= 4; lane++) {
    hop(game, 1);
    assert.equal(game.lane, lane, `para baixo leva à fileira ${lane}`);
    assert.equal(game.phase, 'playing');
  }
  game.step(FRAME, { down: true });
  assert.equal(game.jump, null, 'para baixo na fileira 4 não faz nada');
  game.step(0.5, { down: true });
  assert.equal(game.lane, 4);
  assert.equal(game.phase, 'playing');
  for (let lane = 3; lane >= 0; lane--) {
    hop(game, -1);
    assert.equal(game.lane, lane, `para cima volta à faixa ${lane}`);
  }
  assert.equal(game.phase, 'playing');
});

test('segurar o direcional encadeia saltos e cada salto dura 28 quadros', () => {
  const game = calm(fresh());
  for (let lane = 1; lane <= 4; lane++) parkUnder(game, lane, 64);
  near(T.jumpTime, 28 / 60, 1e-9, 'duração do salto');
  game.step(FRAME, { down: true });
  game.step(26 * FRAME, {});
  assert.ok(game.jump, 'no 27.º quadro Bailey ainda está no ar');
  game.step(2 * FRAME, {});
  assert.equal(game.jump, null);
  assert.equal(game.lane, 1);
  const held = calm(fresh());
  for (let lane = 1; lane <= 4; lane++) parkUnder(held, lane, 64);
  held.step(4 * T.jumpTime + 0.3, { down: true });
  assert.equal(held.lane, 4, 'segurar para baixo desce as quatro fileiras');
  assert.equal(held.phase, 'playing');
});

test('a temperatura começa em 45 e cai 1 grau a cada 64 quadros em toda fase', () => {
  near(C.degreeRate(), 60 / 64, 1e-12, 'graus por segundo');
  for (let level = 1; level <= 24; level++) {
    assert.equal(C.startDegrees(level), 45, `fase ${level}`);
    const game = calm(fresh(level));
    assert.equal(game.degrees, 45, `fase ${level} começa em 45`);
    game.step(64 / 60 - 0.01, {});
    assert.equal(game.degrees, 45, `fase ${level}: ainda 45 antes de 64 quadros`);
    game.step(0.02, {});
    assert.equal(game.degrees, 44, `fase ${level}: 44 depois de 64 quadros`);
    game.step(10 * 64 / 60, {});
    assert.equal(game.degrees, 34, `fase ${level}: ritmo fixo`);
    assert.ok(Number.isInteger(game.degrees), 'a temperatura é inteira');
  }
  const ready = new FB.Game();
  ready.start();
  ready.step(1, {});
  assert.equal(ready.degrees, 45, 'a espera inicial não esfria');
});

test('a temperatura em zero congela Bailey e a vida seguinte volta a 45 graus', () => {
  const game = calm(fresh(9));
  game.degrees = 1;
  game.chill = 0;
  game.step(64 / 60 + 0.02, {});
  assert.equal(game.phase, 'dying');
  assert.equal(game.reason, 'frio');
  assert.equal(game.degrees, 0);
  assert.equal(game.lives, 3);
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.phase, 'playing');
  assert.equal(game.degrees, 45);
  // Late levels stay winnable: 45 degrees last 48 s whatever the level.
  near(45 / C.degreeRate(), 48, 1e-9, 'segundos até congelar');
});

test('a tabela de pontos segue o cartucho e estaciona na nona fase', () => {
  for (let level = 1; level <= 9; level++) {
    assert.equal(C.tier(level), level);
    assert.equal(C.icePoints(level), 10 * level);
    assert.equal(C.enterPoints(level), 160 * level);
    assert.equal(C.degreePoints(level, 1), 10 * level);
  }
  for (const level of [10, 12, 21, 50]) {
    assert.equal(C.tier(level), 9);
    assert.equal(C.icePoints(level), 90);
    assert.equal(C.enterPoints(level), 1440);
  }
  assert.equal(C.degreePoints(1, 20), 200);
  assert.equal(C.degreePoints(4, 10), 400);
  assert.equal(C.enterPoints(10) + C.degreePoints(10, 37), 4770);
  assert.equal(T.fishScore, 200);
});

test('entrar no iglu na fase 10 com 37 graus rende 4770, um passo de cada vez', () => {
  const game = calm(fresh(10));
  game.blocks = 16;
  game.degrees = 37;
  game.chill = 0;
  game.x = 123;
  const before = game.score;
  game.step(FRAME, { up: true });
  assert.equal(game.phase, 'clear');
  assert.equal(game.lastBonus, 4770);
  const offsets = game.rows.map((row) => row.offset);
  let last = game.score;
  let frames = 0;
  let lastDegrees = game.degrees;
  while (game.phase === 'clear' && frames++ < 5000) {
    game.step(FRAME, {});
    const gained = game.score - last;
    assert.ok(gained === 0 || gained === 90, `o placar sobe 90 por passo (subiu ${gained})`);
    if (game.phase === 'clear') {
      assert.deepEqual(game.rows.map((row) => row.offset), offsets, 'o mundo fica parado na contagem');
      assert.ok(game.degrees <= lastDegrees, 'os graus só descem');
      lastDegrees = game.degrees;
    }
    last = game.score;
  }
  const expected = (8 + 65 + 16 * 7 + 7 + 3 * 37 + 52) / 60;
  near(frames / 60, expected, 2 / 60, 'duração da contagem');
  assert.equal(game.score, before + 4770);
  assert.equal(game.level, 11);
  assert.equal(game.blocks, 0);
  assert.equal(game.degrees, 45);
  assert.equal(game.phase, 'playing');
  assert.equal(game.lane, 0);
});

test('pisar no gelo branco pontua, deixa a fileira azul e o azul não paga de novo', () => {
  const game = calm(fresh());
  landOn(game, 1);
  assert.equal(game.phase, 'playing');
  assert.equal(game.blocks, 1);
  assert.equal(game.score, 10);
  assert.equal(game.rows[0].white, false, 'a fileira inteira fica azul');
  assert.ok(game.rows.slice(1).every((row) => row.white));
  landOn(game, 2);
  hop(game, -1);
  assert.equal(game.lane, 1);
  assert.equal(game.blocks, 2, 'voltar à fileira azul não soma bloco');
  assert.equal(game.score, 20);
  const level3 = calm(fresh(3));
  landOn(level3, 1);
  assert.equal(level3.score, 30, 'na fase 3 o gelo vale 30');
});

test('as quatro fileiras azuis voltam a ficar brancas e 16 pousos abrem a porta', () => {
  const game = calm(fresh());
  for (let block = 1; block <= 16; block++) {
    const lane = (block - 1) % 4 + 1;
    landOn(game, lane);
    assert.equal(game.phase, 'playing');
    assert.equal(game.blocks, block, `bloco ${block}`);
    if (block % 4 === 0 && block < 16) assert.ok(game.rows.every((row) => row.white), `as fileiras voltam ao branco no bloco ${block}`);
    else if (block < 16) assert.equal(game.rows[lane - 1].white, false);
    assert.equal(game.doorOpen(), block === 16);
  }
  assert.equal(game.score, 160);
  assert.equal(T.blocksNeeded, 16);
});

test('com o iglu pronto o gelo branco ainda paga, sem bloco extra e sem voltar ao branco', () => {
  const game = calm(fresh());
  game.blocks = 15;
  for (let lane = 1; lane <= 4; lane++) {
    landOn(game, lane);
    assert.equal(game.blocks, 16);
    assert.equal(game.score, 10 * lane, `o pouso ${lane} paga 10`);
  }
  assert.ok(game.rows.every((row) => !row.white), 'depois de completo as fileiras ficam azuis');
  hop(game, -1);
  assert.equal(game.score, 40, 'o azul não paga');
});

test('a porta só abre com o iglu completo e para cima dentro da janela', () => {
  const game = calm(fresh());
  game.blocks = 16;
  game.degrees = 40;
  game.x = 100;
  game.step(3, { right: true });
  assert.equal(game.phase, 'playing', 'passar pela porta andando não entra');
  assert.ok(game.x > T.doorMax);
  for (const x of [T.doorMin - 0.5, T.doorMax + 0.5, 64]) {
    game.x = x;
    game.step(FRAME, { up: true });
    assert.equal(game.phase, 'playing', `x ${x} fica fora da porta`);
    assert.equal(game.jump, null);
  }
  const closed = calm(fresh());
  closed.blocks = 15;
  closed.x = 123;
  closed.step(FRAME, { up: true });
  assert.equal(closed.phase, 'playing', 'com 15 blocos a porta não existe');
  for (const x of [T.doorMin, 123, T.doorMax]) {
    const open = calm(fresh());
    open.blocks = 16;
    open.x = x;
    open.degrees = 40;
    open.chill = 0;
    open.step(FRAME, { up: true });
    assert.equal(open.phase, 'clear', `x ${x} entra`);
    assert.equal(open.lastBonus, 160 + 400);
  }
  assert.ok(T.doorMax - T.doorMin <= 8, 'a janela tem uns 8 px');
});

test('o botão vermelho vira só a fileira sob os pés e custa um bloco', () => {
  const game = calm(fresh());
  landOn(game, 1);
  landOn(game, 2);
  assert.equal(game.blocks, 2);
  const dirs = game.rows.map((row) => row.dir);
  game.step(FRAME, { fire: true });
  assert.equal(game.blocks, 1);
  assert.equal(game.rows[1].dir, -dirs[1]);
  for (const i of [0, 2, 3]) assert.equal(game.rows[i].dir, dirs[i], `a fileira ${i + 1} não muda`);
  game.step(0.5, { fire: true });
  assert.equal(game.rows[1].dir, -dirs[1], 'segurar o botão não vira de novo');
  assert.equal(game.blocks, 1);
  game.step(FRAME, {});
  game.step(FRAME, { fire: true });
  assert.equal(game.rows[1].dir, dirs[1], 'soltar e apertar vira outra vez');
  assert.equal(game.blocks, 0);
  game.step(FRAME, {});
  game.step(FRAME, { fire: true });
  assert.equal(game.rows[1].dir, dirs[1], 'sem blocos o botão não faz nada');
  assert.equal(game.blocks, 0);
  game.blocks = 16;
  game.step(FRAME, {});
  game.step(FRAME, { fire: true });
  assert.equal(game.rows[1].dir, -dirs[1], 'com o iglu completo virar é de graça');
  assert.equal(game.blocks, 16);
});

test('na margem o botão não faz nada e nunca mexe no urso', () => {
  const shore = calm(fresh());
  shore.blocks = 5;
  const dirs = shore.rows.map((row) => row.dir);
  shore.step(FRAME, { fire: true });
  assert.equal(shore.blocks, 5);
  assert.deepEqual(shore.rows.map((row) => row.dir), dirs);
  const bear = calm(fresh(4), true);
  bear.blocks = 5;
  bear.bear.idle = 0;
  bear.bear.x = 140;
  bear.bear.dir = -1;
  bear.x = 20;
  bear.step(FRAME, { fire: true });
  assert.equal(bear.bear.dir, -1, 'o urso não vira com o botão na margem');
  assert.equal(bear.blocks, 5);
  landOn(bear, 1, 80);
  const blocks = bear.blocks;
  const bearDir = bear.bear.dir;
  bear.step(FRAME, {});
  bear.step(FRAME, { fire: true });
  assert.equal(bear.blocks, blocks - 1, 'no gelo o botão vira a fileira');
  assert.equal(bear.bear.dir, bearDir, 'o urso segue o mesmo rumo');
});

test('o botão segurado durante a troca de fase não vira o gelo no primeiro quadro', () => {
  const game = calm(fresh());
  game.blocks = 16;
  game.x = 123;
  game.step(FRAME, { up: true });
  assert.equal(game.phase, 'clear');
  runClear(game, { fire: true });
  assert.equal(game.level, 2);
  assert.equal(game.phase, 'playing');
  calm(game);
  game.lane = 1;
  parkUnder(game, 1, game.x);
  game.blocks = 3;
  const dir = game.rows[0].dir;
  game.step(FRAME, { fire: true });
  assert.equal(game.rows[0].dir, dir, 'a trava segura o botão preso');
  assert.equal(game.blocks, 3);
  game.step(FRAME, {});
  game.step(FRAME, { fire: true });
  assert.equal(game.rows[0].dir, -dir);
  assert.equal(game.blocks, 2);
  const title = new FB.Game();
  title.step(FRAME, { fire: true });
  assert.equal(title.phase, 'ready', 'o botão vermelho começa a partida e mostra a espera, como o Enter');
  assert.equal(title.fireLatch, true, 'e fica travado até ser solto');
  title.step(1, { fire: true });
  assert.equal(title.phase, 'ready', 'o mesmo aperto, ainda segurado, não sai da espera');
  title.step(FRAME, {});
  title.step(FRAME, { fire: true });
  assert.equal(title.phase, 'playing', 'um novo aperto sai da espera');
  assert.equal(title.fireLatch, true, 'sem contar como inversão');
  const held = new FB.Game();
  held.step(FRAME, { fire: true });
  held.step(T.readyTime + 0.1, { fire: true });
  assert.equal(held.phase, 'playing', 'segurando o botão, a espera termina no tempo normal');
});

test('saltar na água afoga Bailey', () => {
  const game = calm(fresh());
  game.x = 80;
  const water = waterOn(game.rows[0]);
  assert.ok(water != null);
  game.rows[0].offset = W.wrap(game.rows[0].offset + 80 - water);
  assert.equal(game.supported(game.rows[0], 80), false);
  hop(game, 1);
  assert.equal(game.phase, 'dying');
  assert.equal(game.reason, 'mar');
  assert.equal(game.lives, 3);
  near(T.deathTime, 200 / 60, 1e-9, 'duração da morte');
});

test('enquanto o gelo espera, o joystick não responde e o primeiro salto não afoga', () => {
  for (const level of [1, 3, 5, 7]) {
    const game = new FB.Game();
    game.start();
    if (level !== game.level) {
      game.level = level;
      game.beginLevel();
    }
    game.clearCreatures();
    game.bear = null;
    assert.equal(game.phase, 'ready');
    game.step(FRAME, { down: true });
    assert.equal(game.phase, 'playing', `fase ${level}: para baixo começa a rodada`);
    assert.equal(game.jump, null, `fase ${level}: mas não salta enquanto o gelo espera`);
    let frames = 0;
    while (!game.jump && frames++ < 120) game.step(FRAME, { down: true });
    assert.ok(game.jump, `fase ${level}: o salto sai quando o gelo parte`);
    assert.equal(game.hold, 0);
    near(frames, T.floeHold * 60, 2, `fase ${level}: quadros de espera`);
    while (game.jump) game.step(FRAME, {});
    assert.equal(game.phase, 'playing', `fase ${level}: segurar para baixo desde o começo não afoga Bailey`);
    assert.equal(game.lane, 1);
  }
  const walker = fresh();
  walker.step(T.floeHold - 0.05, { left: true, fire: true });
  assert.equal(walker.x, T.startX, 'Bailey não anda enquanto o gelo espera');
  walker.step(0.2, { left: true });
  assert.ok(walker.x < T.startX, 'e anda assim que o gelo parte');
});

test('o empurrão anterior não leva a culpa de um salto na água', () => {
  const game = calm(fresh());
  game.lane = 1;
  game.x = 80;
  parkUnder(game, 1, 80);
  game.spawnGroup(0, 'goose', 76, 1, 1);
  game.step(FRAME, {});
  assert.equal(game.pushedBy, 'goose');
  game.clearCreatures();
  const water = waterOn(game.rows[1]);
  game.rows[1].offset = W.wrap(game.rows[1].offset + game.x - water);
  hop(game, 1);
  assert.equal(game.reason, 'mar');
  assert.equal(game.death.pushedBy, null, 'Bailey saltou sozinho');
});

test('a morte da última vida tira as criaturas de cena', () => {
  const game = fresh(2);
  game.step(5, {});
  assert.ok(game.enemies.length + game.fish.length > 0);
  game.lives = 1;
  game.die('mar');
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.phase, 'gameover');
  game.step(2, {});
  assert.equal(game.enemies.length + game.fish.length, 0, 'nenhuma criatura parada sobre o gelo que corre');
});

test('as criaturas empurram Bailey na velocidade delas e só o mar mata', () => {
  for (const [level, kind] of [[1, 'goose'], [3, 'crab'], [5, 'clam']]) {
    const game = calm(fresh(level));
    game.lane = 1;
    game.x = 80;
    parkUnder(game, 1, 80);
    game.spawnGroup(0, kind, 76, 1, 1);
    game.step(FRAME, {});
    assert.equal(game.phase, 'playing', `encostar no ${kind} não mata`);
    assert.ok(game.x > 80, `o ${kind} empurra Bailey`);
    const x0 = game.x;
    game.step(0.2, {});
    assert.equal(game.phase, 'playing');
    near(game.x - x0, C.creatureSpeed(level) * 0.2, 0.05, `${kind} empurra na própria velocidade`);
    let frames = 0;
    while (game.phase === 'playing' && frames++ < 600) game.step(FRAME, {});
    assert.equal(game.phase, 'dying');
    assert.equal(game.reason, 'mar', 'a morte vem da água');
    assert.equal(game.death.pushedBy, kind);
  }
  const still = calm(fresh());
  still.lane = 1;
  still.x = 80;
  parkUnder(still, 1, 80);
  still.spawnGroup(0, 'goose', 95, 1, 1);
  still.step(0.1, {});
  assert.equal(still.x, 80, 'o ganso atrás de Bailey não empurra');

  // The push stops at the screen edge: Bailey never wraps to the other side.
  const edge = calm(fresh());
  edge.lane = 1;
  edge.x = 145;
  parkUnder(edge, 1, 145);
  edge.spawnGroup(0, 'goose', 141, 1, 1);
  edge.step(0.7, {});
  assert.equal(edge.phase, 'playing');
  assert.equal(edge.x, T.iceMax, 'o empurrão para na borda direita da tela');
  edge.step(0.5, {});
  assert.ok(edge.enemies.length === 0 || edge.enemies[0].x > edge.x, 'o ganso passa por Bailey');
  assert.equal(edge.x, T.iceMax, 'Bailey fica na borda, sem dar a volta');
  assert.equal(edge.pushedBy, null, 'o ganso que passou não empurra mais');

  // Creatures never wrap, so one still off-screen cannot touch Bailey.
  const leaving = calm(fresh());
  leaving.lane = 1;
  leaving.x = T.iceMax;
  parkUnder(leaving, 1, T.iceMax);
  leaving.spawnGroup(0, 'goose', 163, 1, 1);
  leaving.step(FRAME, {});
  assert.equal(leaving.x, T.iceMax, 'o ganso já fora da tela à direita não empurra Bailey');
  assert.equal(leaving.pushedBy, null);
  // The guard holds even closer to the left edge than a jump from the hideout can take Bailey.
  const entering = calm(fresh());
  entering.lane = 1;
  entering.x = 4;
  parkUnder(entering, 1, 4);
  entering.spawnGroup(0, 'goose', -3, 1, 1);
  entering.step(FRAME, {});
  assert.equal(entering.x, 4, 'o ganso ainda fora da tela à esquerda não empurra Bailey');
  const hidden = calm(fresh(2));
  hidden.lane = 1;
  hidden.x = 4;
  parkUnder(hidden, 1, 4);
  hidden.spawnGroup(0, 'fish', -2, 1, 1);
  hidden.step(FRAME, {});
  assert.equal(hidden.score, 0, 'o peixe fora da tela não pontua');
  assert.equal(hidden.fish.length, 1);

  const fish = calm(fresh(2));
  fish.lane = 1;
  fish.x = T.iceMax;
  parkUnder(fish, 1, T.iceMax);
  fish.spawnGroup(0, 'fish', 156, 1, 1);
  fish.step(FRAME, {});
  assert.equal(fish.score, T.fishScore, 'o peixe junto à borda direita é pego');
  assert.equal(fish.fish.length, 0);
});

test('no ar Bailey fica imune a criaturas e peixes', () => {
  const game = calm(fresh(2));
  game.lane = 1;
  game.x = 80;
  parkUnder(game, 1, 80);
  parkUnder(game, 2, 80);
  game.step(FRAME, { down: true });
  assert.ok(game.jump);
  game.spawnGroup(0, 'goose', 79, 1, 1);
  game.spawnGroup(1, 'goose', 79, 1, 1);
  game.spawnGroup(0, 'fish', 80, 1, 1);
  const score = game.score;
  game.step(0.1, {});
  assert.ok(game.jump);
  assert.equal(game.x, 80, 'sem empurrão no ar');
  assert.equal(game.score, score, 'sem peixe no ar');
  assert.equal(game.fish.length, 1);
});

test('peixes valem 200 a partir da fase 2 e só ao tocar com os pés no gelo', () => {
  assert.ok(!C.creatureKinds(1).includes('fish'));
  for (let level = 2; level <= 30; level++) assert.ok(C.creatureKinds(level).includes('fish'), `fase ${level}`);
  const game = calm(fresh(2));
  game.lane = 1;
  game.x = 80;
  parkUnder(game, 1, 80);
  const group = game.spawnGroup(0, 'fish', 70, 1, 2);
  assert.equal(group.length, 2);
  game.step(3, {});
  assert.equal(game.phase, 'playing', 'peixe não empurra nem mata');
  assert.equal(game.score, 400);
  assert.equal(game.fish.length, 0);
  near(game.x, 80, 1e-9, 'peixe não empurra');
  const other = calm(fresh(2));
  other.lane = 1;
  other.x = 80;
  parkUnder(other, 1, 80);
  other.spawnGroup(1, 'fish', 80, 1, 1);
  other.step(0.2, {});
  assert.equal(other.score, 0, 'peixe de outra fileira não conta');
});

test('as criaturas chegam em grupos e seguem o calendário de cada fase', () => {
  assert.deepEqual([...C.creatureKinds(1)], ['goose']);
  assert.deepEqual([...C.creatureKinds(2)].sort(), ['fish', 'goose']);
  assert.deepEqual([...C.creatureKinds(3)].sort(), ['crab', 'fish', 'goose']);
  assert.deepEqual([...C.creatureKinds(4)].sort(), ['clam', 'crab', 'fish', 'goose']);
  for (let level = 1; level <= 30; level++) {
    const size = C.groupSize(level);
    assert.ok(size >= 1 && size <= 3, `grupo da fase ${level}`);
  }
  assert.deepEqual([1, 2, 3, 4].map(C.groupSize), [1, 2, 2, 1]);
  assert.equal(C.groupSpacing(2), 32);
  assert.equal(C.groupSpacing(3), 16);

  // The favoured kind cycles with the level, as the cartridge's mix does; from level 8 it evens out.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(W.featuredKind), ['goose', 'fish', 'crab', 'clam', 'goose', 'fish', 'crab', 'clam']);
  for (const [level, kind, low, high] of [[2, 'fish', 0.6, 0.85], [3, 'crab', 0.45, 0.7], [4, 'clam', 0.35, 0.6], [5, 'goose', 0.35, 0.6], [5, 'fish', 0.12, 0.3], [6, 'fish', 0.35, 0.6], [7, 'crab', 0.35, 0.6], [7, 'fish', 0.12, 0.3], [8, 'fish', 0.15, 0.35], [8, 'clam', 0.2, 0.45]]) {
    const lane = { seed: level * 31 + 5 };
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (W.pickKind(lane, level) === kind) hits++;
    const share = hits / 4000;
    assert.ok(share >= low && share <= high, `fase ${level}: ${kind} em ${(share * 100).toFixed(0)}% dos grupos (esperado ${low * 100}-${high * 100}%)`);
  }
  const expectNew = { 1: 'goose', 2: 'fish', 3: 'crab', 4: 'clam' };
  assert.equal(T.stopGoFrom, 6, 'no cartucho caranguejos e mariscos param e andam da fase 6 em diante');
  for (let level = 1; level <= 8; level++) {
    const game = fresh(level);
    game.bear = null;
    const kinds = new Set();
    const lanes = new Set();
    const groups = new Map();
    let stopped = false;
    let stoppedWrong = false;
    for (let frame = 0; frame < 60 * 60; frame++) {
      game.degrees = 45;
      game.step(FRAME, {});
      assert.equal(game.phase, 'playing');
      for (const creature of [...game.enemies, ...game.fish]) {
        kinds.add(creature.type);
        lanes.add(creature.row);
        assert.equal(creature.speed, C.creatureSpeed(level));
        if (!creature.moving) {
          if (creature.type === 'crab' || creature.type === 'clam') stopped = true;
          else stoppedWrong = true;
        }
        const key = `${creature.row}:${creature.group}`;
        if (!groups.has(key)) {
          const members = [...game.enemies, ...game.fish].filter((item) => item.row === creature.row && item.group === creature.group);
          groups.set(key, members.map((item) => ({ type: item.type, x: item.x })));
        }
      }
    }
    const allowed = C.creatureKinds(level);
    for (const kind of kinds) assert.ok(allowed.includes(kind), `fase ${level}: ${kind} fora do calendário`);
    if (expectNew[level]) assert.ok(kinds.has(expectNew[level]), `fase ${level} traz ${expectNew[level]}`);
    assert.equal(lanes.size, 4, `fase ${level}: as quatro faixas recebem criaturas`);
    assert.ok(groups.size >= 8, `fase ${level}: grupos suficientes (${groups.size})`);
    for (const members of groups.values()) {
      assert.equal(members.length, C.groupSize(level), `fase ${level}: tamanho do grupo`);
      assert.ok(members.every((item) => item.type === members[0].type), 'o grupo é de um tipo só');
      const xs = members.map((item) => item.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) near(xs[i] - xs[i - 1], C.groupSpacing(members.length), 1e-6, 'espaçamento do grupo');
    }
    assert.equal(stoppedWrong, false, 'gansos e peixes nunca param');
    if (level >= T.stopGoFrom) assert.ok(stopped, `fase ${level}: caranguejos e mariscos param e andam`);
    else assert.equal(stopped, false, `fase ${level}: ninguém para antes da fase 6`);
  }
});

test('os blocos de gelo seguem o formato de cada fase', () => {
  const expected = { 1: 'solid', 2: 'chunks', 3: 'solid', 4: 'chunks', 5: 'solid', 6: 'breathing', 7: 'solid', 8: 'breathing', 9: 'solid', 10: 'breathing', 21: 'solid', 22: 'breathing' };
  for (const [level, shape] of Object.entries(expected)) assert.equal(C.floeShape(Number(level)), shape, `fase ${level}`);
  for (let level = 1; level <= 12; level++) {
    const rows = W.createRows(level);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.shape === rows[0].shape && row.speed === rows[0].speed), 'um padrão por fase');
    assert.equal(rows[0].offset, rows[2].offset, 'fileiras 1 e 3 em fase');
    assert.equal(rows[1].offset, rows[3].offset, 'fileiras 2 e 4 em fase');
    assert.deepEqual(Array.from(rows, (row) => row.dir), [-1, 1, -1, 1], 'a fileira de cima vai para a esquerda');
  }
  const solid = W.createRows(1)[0];
  const blocks = W.pieces(solid);
  assert.equal(blocks.length, 3);
  assert.ok(blocks.every((piece) => piece.w === 16));
  const starts = Array.from(blocks, (piece) => W.wrapDelta(piece.x, blocks[0].x));
  assert.deepEqual(starts, [0, 32, 64], 'blocos de 16 px separados por 16 px');
  let water = 0;
  for (let x = 0; x < 160; x++) if (!W.supportAt(solid, x + 0.5, 0)) water++;
  assert.equal(water, 160 - 48, 'o resto da largura é mar aberto');
  assert.equal(W.pattern(1).shape, 'solid');
});

test('os pedaços de 8 px das fases 2 e 4 aguentam Bailey e deixam água entre os grupos', () => {
  for (const level of [2, 4]) {
    const row = W.createRows(level)[0];
    const pieces = W.pieces(row);
    assert.equal(pieces.length, 6);
    assert.ok(pieces.every((piece) => piece.w === 8));
    const xs = Array.from(pieces, (piece) => W.wrapDelta(piece.x, pieces[0].x));
    assert.deepEqual(xs, [0, 16, 32, 48, 64, 80], 'pedaços de 8 px a cada 16 px');
    const first = pieces[0].x;
    for (let dx = 0; dx <= 88; dx += 0.25) assert.ok(W.supportAt(row, first + dx), `fase ${level}: dá para ficar em ${dx}`);
    let water = false;
    for (let dx = 100; dx < 150; dx++) if (!W.supportAt(row, first + dx)) water = true;
    assert.ok(water, 'existe água fora do grupo');
  }
  const game = calm(fresh(2));
  game.x = 64;
  parkUnder(game, 1, 64);
  hop(game, 1);
  assert.equal(game.phase, 'playing', 'pousa num pedaço de 8 px');
  game.step(1, { right: true });
  assert.equal(game.phase, 'playing', 'atravessa os pedaços andando');
});

test('a partir da fase 6 os blocos se abrem e fecham sem derrubar Bailey', () => {
  near(W.breathGap('breathing', 0), T.breathGap, 1e-9, 'começa aberto');
  near(W.breathGap('breathing', T.breathPeriod / 2), 0, 1e-9, 'fecha no meio do ciclo');
  near(W.breathGap('breathing', T.breathPeriod), T.breathGap, 1e-9, 'reabre no fim do ciclo');
  near(T.breathGap, 8, 1e-9, 'abre até 8 px');
  near(T.breathPeriod, 256 / 60, 1e-9, 'ciclo de 256 quadros');
  assert.equal(W.breathGap('solid', 1), 0);
  const game = calm(fresh(6));
  game.x = 80;
  parkUnder(game, 1, 80);
  hop(game, 1);
  assert.equal(game.phase, 'playing');
  const gaps = new Set();
  for (let frame = 0; frame < 300; frame++) {
    game.degrees = 45;
    game.step(FRAME, {});
    assert.equal(game.phase, 'playing', `quadro ${frame}: o bloco que respira ainda sustenta`);
    assert.ok(game.rows.every((row) => row.gap === game.rows[0].gap), 'todas as fileiras respiram juntas');
    gaps.add(Math.round(game.rows[0].gap));
    const pieces = W.pieces(game.rows[0]);
    assert.equal(pieces.length, 6);
    near(W.wrapDelta(pieces[1].x, pieces[0].x), 8 + game.rows[0].gap, 1e-6, 'as metades se afastam pelo vão');
  }
  assert.ok(gaps.has(0) && gaps.has(8), 'o vão passa por fechado e aberto');
});

test('velocidades por fase: gelo, criaturas, salto, urso e caminhada', () => {
  near(C.floeSpeed(1), 7.5, 0.5, 'gelo L1');
  near(C.floeSpeed(2), 7.5, 0.5, 'gelo L2');
  near(C.floeSpeed(3), 11, 0.5, 'gelo L3');
  near(C.floeSpeed(4), 11, 0.5, 'gelo L4');
  near(C.floeSpeed(5), 15, 0.5, 'gelo L5');
  near(C.floeSpeed(6), 15, 0.5, 'gelo L6');
  near(C.floeSpeed(7), 18.5, 0.5, 'gelo L7');
  // Measured on the cartridge: one speed step per level, three steps back every seven levels from 12.
  const steps = { 1: 1, 7: 7, 8: 8, 11: 11, 12: 9, 14: 11, 18: 15, 19: 13, 25: 19, 26: 17, 32: 23, 40: 25, 64: 40 };
  for (const [level, step] of Object.entries(steps)) assert.equal(C.pace(Number(level)), step, `passo de velocidade da fase ${level}`);
  const floes = { 8: 18.75, 9: 22.5, 11: 26.25, 12: 22.5, 16: 30, 18: 33.75, 20: 30, 24: 37.5, 26: 37.5, 32: 48.75, 40: 52.5, 64: 78.75 };
  for (const [level, speed] of Object.entries(floes)) near(C.floeSpeed(Number(level)), speed, 1e-9, `gelo L${level}`);
  [11.25, 15, 18.75, 22.5, 26.25, 30, 33.75, 37.5, 41.25, 45, 48.75, 41.25].forEach((speed, i) => near(C.creatureSpeed(i + 1), speed, 1e-9, `criaturas L${i + 1}`));
  near(C.creatureSpeed(24), 75, 1e-9, 'criaturas L24');
  [15, 18.75, 22.5, 26.25, 30, 33.75, 37.5, 41.25, 45, 48.75, 52.5, 45].forEach((speed, i) => near(C.airSpeed(i + 1), speed, 1e-9, `salto L${i + 1}`));
  [22.5, 26.25, 30, 33.75, 37.5, 41.25, 45, 48.75, 41.25].forEach((speed, i) => near(C.bearSpeed(i + 4), speed, 1e-9, `urso L${i + 4}`));
  near(C.bearSpeed(16), 56.25, 1e-9, 'urso L16');
  assert.ok(C.bearSpeed(6) <= T.walkSpeed && C.bearSpeed(7) > T.walkSpeed, 'da fase 7 em diante o urso corre mais que Bailey');
  near(T.walkSpeed, 30, 1, 'caminhada');

  for (const level of [1, 3, 5, 7, 12]) {
    const game = fresh(level);
    game.clearCreatures();
    game.bear = null;
    const start = game.rows.map((row) => row.offset);
    game.step(1, {});
    assert.deepEqual(game.rows.map((row) => row.offset), start, `fase ${level}: o gelo espera no começo`);
    game.step(T.floeHold - 1 + 0.01, {});
    const from = game.rows.map((row) => row.offset);
    game.step(1, {});
    game.rows.forEach((row, i) => near(W.wrapDelta(row.offset, from[i]), row.dir * C.floeSpeed(level), 1e-6, `fase ${level}, fileira ${i + 1}`));
  }
  near(T.floeHold, 1.1, 0.05, 'o gelo segura ~1,1 s');

  const shore = calm(fresh());
  shore.x = 40;
  shore.step(1, { right: true });
  near(shore.x, 70, 1e-6, 'caminhada na margem');
  const ice = calm(fresh());
  landOn(ice, 1, 80);
  ice.step(0.2, { left: true });
  near(ice.x, 74, 1e-6, 'caminhada no gelo');
  const air = calm(fresh(5));
  for (let lane = 1; lane <= 4; lane++) parkUnder(air, lane, 80);
  air.x = 80;
  air.step(FRAME, { down: true });
  const x0 = air.x;
  air.step(0.2, { right: true });
  near(air.x - x0, C.airSpeed(5) * 0.2, 1e-6, 'direção no ar');
});

test('o gelo leva Bailey até a borda da tela, escorrega por baixo dele e o derruba no mar', () => {
  assert.equal(T.iceMax, 151, 'no cartucho Bailey para em x 151 na borda direita');
  for (const [lane, x, limit] of [[4, 140, T.iceMax], [1, 30, T.iceMin]]) {
    const game = fresh();
    game.clearCreatures();
    game.bear = null;
    game.hold = 0;
    game.lane = lane;
    game.x = x;
    parkUnder(game, lane, x);
    assert.equal(game.rowOf(lane).dir, limit === T.iceMax ? 1 : -1);
    let held = 0;
    let frames = 0;
    while (game.phase === 'playing' && frames++ < 1200) {
      game.degrees = 45;
      game.step(FRAME, {});
      assert.ok(game.x >= T.iceMin && game.x <= T.iceMax, `fileira ${lane}: x ${game.x} dentro da tela`);
      if (game.x === limit) held++;
    }
    assert.ok(held > 30, `fileira ${lane}: Bailey fica preso na borda enquanto o gelo passa (${held} quadros)`);
    assert.equal(game.phase, 'dying', `fileira ${lane}: o gelo sai de baixo dele`);
    assert.equal(game.reason, 'mar');
    assert.equal(game.x, limit, `fileira ${lane}: cai na borda, sem dar a volta`);
  }

  const air = calm(fresh(5));
  for (let lane = 1; lane <= 4; lane++) parkUnder(air, lane, 148);
  air.lane = 1;
  air.x = 148;
  air.step(FRAME, { down: true, right: true });
  assert.ok(air.jump);
  while (air.jump) {
    air.step(FRAME, { right: true });
    assert.ok(air.x <= T.iceMax, 'no ar entre fileiras Bailey também para na borda');
  }
  assert.equal(air.x, T.iceMax);
  assert.equal(air.phase, 'playing');
});

test('o urso surge na fase 4, persegue Bailey e o arrasta para a esquerda', () => {
  for (let level = 1; level <= 3; level++) assert.equal(fresh(level).bear, null, `sem urso na fase ${level}`);
  assert.equal(C.hasBear(4), true);
  const game = calm(fresh(4), true);
  assert.equal(game.bear.x, 140);
  game.x = 64;
  game.step(1, {});
  assert.equal(game.bear.x, 140, 'o urso espera');
  near(T.bearIdle, 64 / 60, 1e-9, 'o urso espera 64 quadros');
  game.step(0.5, {});
  assert.ok(game.bear.x < 140);
  const x1 = game.bear.x;
  game.step(0.5, {});
  near(x1 - game.bear.x, C.bearSpeed(4) * 0.5, 0.01, 'o urso anda na direção de Bailey');
  let frames = 0;
  while (game.phase === 'playing' && frames++ < 600) game.step(FRAME, {});
  assert.equal(game.phase, 'dying');
  assert.equal(game.reason, 'urso');
  assert.equal(game.lives, 3);
  game.step(T.deathTime - 0.1, {});
  assert.ok(game.x <= 4.01, 'arrastado para fora pela esquerda');
  game.step(0.2, {});
  assert.equal(game.phase, 'playing');
  assert.equal(game.bear.x, 140, 'o urso volta ao começo');

  // The cartridge's left edge 10 (hideout) becomes centre 14; the landing stops where Bailey clears the comb.
  near(T.hideout, 14, 1e-9, 'esconderijo na ponta esquerda');
  near(T.shoreEdge, 12, 1e-9, 'limite do pouso na margem');
  assert.ok(T.shoreEdge <= T.hideout, 'o limite do pouso fica dentro do esconderijo');
  const drawn = (rows) => rows.flatMap((line) => [...line].flatMap((pixel, col) => (pixel === '.' ? [] : [col])));
  assert.ok(Math.round(T.hideout - 4) + Math.min(...drawn(FB.Sprites.bailey)) >= T.hmove, 'na borda do esconderijo Bailey aparece inteiro, fora do pente preto');
  for (const rows of [FB.Sprites.bailey, FB.Sprites.baileyLeft, FB.Sprites.baileyJump, FB.Sprites.baileyJumpLeft]) {
    assert.ok(Math.round(T.shoreEdge - 4) + Math.min(...drawn(rows)) >= T.hmove, 'no limite do pouso Bailey aparece inteiro, fora do pente preto');
  }
  assert.ok(T.hideout < T.shoreMin, 'andando não se chega ao esconderijo');
  const walker = calm(fresh(4), true);
  walker.bear.idle = 0;
  let walked = 0;
  while (walker.phase === 'playing' && walked++ < 900) walker.step(FRAME, { left: true });
  near(walker.x, T.shoreMin, 1, 'a caminhada para antes do esconderijo');
  assert.equal(walker.reason, 'urso', 'no limite da caminhada o urso pega Bailey');

  const safe = calm(fresh(4), true);
  safe.bear.idle = 0;
  landOn(safe, 1, 20);
  safe.step(FRAME, { up: true, left: true });
  while (safe.jump) safe.step(FRAME, { left: true });
  assert.equal(safe.lane, 0);
  assert.ok(safe.x <= T.hideout && safe.inHideout(), `um salto do gelo leva Bailey ao esconderijo (x ${safe.x.toFixed(1)})`);
  safe.bear.x = 60;
  safe.step(8, {});
  assert.equal(safe.phase, 'playing', 'o esconderijo é seguro');
  near(safe.bear.x, T.bearMinX, 1e-9, 'o urso para diante do esconderijo');
  const inks = (rows) => rows.flatMap((line) => [...line].flatMap((pixel, col) => (pixel === '.' ? [] : [col])));
  const bearInk = Math.round(safe.bear.x - 7) + Math.min(...inks(FB.Sprites.bearFrames[0]));
  const baileyInk = Math.round(T.hideout - 4) + Math.max(...inks(FB.Sprites.bailey));
  assert.ok(bearInk > baileyInk + 1, `os desenhos não se tocam com Bailey na borda do esconderijo (${baileyInk} e ${bearInk})`);
  safe.x = T.hideout + 1;
  safe.step(0.1, {});
  assert.equal(safe.phase, 'dying', 'um pixel fora do esconderijo o urso pega');

  const ice = calm(fresh(4), true);
  landOn(ice, 1, 80);
  ice.bear.idle = 0;
  ice.bear.x = 80;
  ice.step(2, {});
  assert.equal(ice.phase, 'playing', 'o urso não alcança o gelo');
  assert.notEqual(C.palette(4).bear, C.palette(5).bear, 'urso cinza de dia, branco à noite');
});

test('com o urso na margem, entrar no iglu não depende de acertar um quadro', () => {
  let entered = 0;
  const tries = 240;
  for (let offset = 0; offset < tries; offset++) {
    const game = calm(fresh(4), true);
    game.bear.idle = 0;
    game.blocks = T.blocksNeeded;
    game.lane = 1;
    game.x = 123;
    parkUnder(game, 1, 123);
    for (let frame = 0; frame < 180 + offset; frame++) game.step(FRAME, {});
    assert.equal(game.phase, 'playing');
    for (let frame = 0; frame < 60 && game.phase === 'playing'; frame++) game.step(FRAME, { up: true });
    if (game.phase === 'clear') entered++;
  }
  assert.ok(entered / tries >= 0.4, `segurar para cima diante da porta entra em ${entered} de ${tries} tentativas`);
});

test('a morte custa uma vida, mantém o iglu e recomeça o resto', () => {
  const game = fresh(4);
  game.step(5, { left: true });
  assert.equal(game.phase, 'playing');
  assert.ok(game.enemies.length + game.fish.length > 0, 'há criaturas em cena');
  assert.ok(game.bear.x < 140, 'o urso saiu do lugar');
  game.blocks = 7;
  game.rows[0].white = false;
  game.rows[2].white = false;
  game.x = 100;
  game.degrees = 12;
  game.die('mar');
  assert.equal(game.phase, 'dying');
  assert.equal(game.lives, 3);
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.phase, 'playing', 'o mesmo jogador volta direto');
  assert.equal(game.blocks, 7);
  assert.equal(game.level, 4);
  assert.equal(game.degrees, 45);
  assert.equal(game.lane, 0);
  assert.equal(game.x, 64);
  assert.ok(game.rows.every((row) => row.white));
  assert.deepEqual(Array.from(game.rows, (row) => row.offset), Array.from(W.ROW_START));
  assert.equal(game.enemies.length + game.fish.length, 0, 'as criaturas recomeçam');
  assert.equal(game.bear.x, 140);
  near(game.hold, T.floeHold, 0.03, 'o gelo segura de novo');
  assert.equal(game.reserves, 2);
});

test('vida extra a cada 5.000 pontos até nove reservas, e o placar vira em um milhão', () => {
  const game = fresh();
  assert.equal(game.lives, 4);
  assert.equal(game.reserves, 3);
  game.scorePoints(4990);
  assert.equal(game.lives, 4);
  game.scorePoints(10);
  assert.equal(game.lives, 5);
  game.scorePoints(10000);
  assert.equal(game.lives, 7, 'duas marcas de uma vez dão duas vidas');
  game.scorePoints(100000);
  assert.equal(game.lives, 10);
  assert.equal(game.reserves, 9, 'no máximo nove reservas');
  game.lives = 4;
  game.score = 999990;
  game.scorePoints(20);
  assert.equal(game.score, 10, 'o placar de seis dígitos dá a volta');
  assert.equal(game.lives, 5, 'cruzar um milhão também é marca de 5.000');
  game.score = 999900;
  game.scorePoints(530);
  assert.equal(game.score, 430);
  assert.equal(game.highScore, 115000, 'o recorde guarda o maior placar real');
});

test('dia e noite se alternam a cada quatro fases', () => {
  const night = [];
  for (let level = 1; level <= 16; level++) if (C.isNight(level)) night.push(level);
  assert.deepEqual(night, [5, 6, 7, 8, 13, 14, 15, 16]);
  assert.equal(C.palette(1), C.DAY);
  assert.equal(C.palette(5), C.NIGHT);
  assert.equal(C.palette(9), C.DAY);
  assert.notEqual(C.DAY.sky, C.NIGHT.sky);
  assert.notEqual(C.DAY.shore, C.NIGHT.shore);
});

test('os jogos 1 a 4 escolhem jogadores e fase inicial', () => {
  const expected = { 1: [1, 1], 2: [2, 1], 3: [1, 5], 4: [2, 5] };
  for (const [mode, [players, level]] of Object.entries(expected)) {
    const game = new FB.Game();
    game.action(`select${mode}`);
    assert.equal(game.gameMode, Number(mode));
    assert.equal(game.players.length, players, `jogo ${mode}: jogadores`);
    assert.equal(game.level, level, `jogo ${mode}: fase inicial`);
    assert.equal(game.phase, 'ready');
    assert.equal(game.lives, 4);
    assert.equal(C.startingLevel(Number(mode)), level);
    assert.match(FB.modeLabel(Number(mode)), new RegExp(`Jogo ${mode}`));
  }
  const cycle = new FB.Game();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    cycle.action('select');
    seen.push(cycle.gameMode);
  }
  assert.deepEqual(seen, [2, 3, 4, 1]);
  const advanced = new FB.Game();
  advanced.action('select3');
  assert.ok(advanced.bear, 'o jogo avançado começa com urso');
  assert.equal(C.isNight(advanced.level), true);
});

test('a alavanca de dificuldade não muda nada na simulação', () => {
  const plain = fresh(4);
  const lever = fresh(4);
  lever.action('difficulty');
  assert.equal(lever.expertLever, true);
  assert.equal(lever.phase, 'playing');
  const script = [{ down: true }, {}, { right: true }, { up: true }, { left: true, fire: true }, {}];
  for (let frame = 0; frame < 60 * 20; frame++) {
    const input = script[Math.floor(frame / 23) % script.length];
    plain.step(FRAME, input);
    lever.step(FRAME, input);
  }
  const strip = (game) => snapshot(game);
  assert.equal(strip(lever), strip(plain));
  lever.action('difficulty');
  assert.equal(lever.expertLever, false);
});

test('o peixe mágico aparece na fase 21 e o emblema de arquiteto aos 40.000', () => {
  assert.equal(T.magicFishLevel, 21);
  assert.equal(fresh(20).magicFish, false);
  assert.equal(fresh(21).magicFish, true);
  assert.equal(fresh(30).magicFish, true);
  const rich = fresh();
  rich.scorePoints(500000);
  assert.equal(rich.magicFish, false, 'pontos não trazem o peixe mágico');
  const climb = calm(fresh(20));
  climb.blocks = 16;
  climb.x = 123;
  climb.step(FRAME, { up: true });
  runClear(climb);
  assert.equal(climb.level, 21);
  assert.equal(climb.magicFish, true, 'chega ao entrar na fase 21');
  const architect = fresh();
  architect.scorePoints(39990);
  assert.equal(architect.architect, false);
  architect.scorePoints(10);
  assert.equal(architect.architect, true);
});

test('no jogo 2 os jogadores alternam com placar, fase e iglu próprios', () => {
  const game = new FB.Game();
  game.action('select2');
  assert.equal(game.player, 0);
  game.step(FRAME, { right: true });
  assert.equal(game.phase, 'playing');
  calm(game);
  game.blocks = 16;
  game.x = 123;
  game.step(FRAME, { up: true });
  runClear(game);
  assert.equal(game.level, 2);
  const score0 = game.score;
  game.blocks = 5;
  game.die('mar');
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.player, 1);
  assert.equal(game.phase, 'ready', 'a troca de jogador passa pela espera');
  assert.equal(game.score, 0);
  assert.equal(game.level, 1);
  assert.equal(game.blocks, 0);
  assert.equal(game.lives, 4);
  game.step(T.readyTime + 0.02, {});
  assert.equal(game.phase, 'playing', 'a espera avança sozinha');
  game.scorePoints(30);
  game.blocks = 2;
  game.die('frio');
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.player, 0);
  assert.equal(game.score, score0);
  assert.equal(game.level, 2);
  assert.equal(game.blocks, 5, 'o jogador 1 mantém o próprio iglu');
  assert.equal(game.lives, 3);
  game.step(FRAME, { left: true });
  game.die('mar');
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.player, 1);
  assert.equal(game.score, 30);
  assert.equal(game.blocks, 2);
  assert.equal(game.lives, 3);
});

test('no jogo de dois, quem sobra continua sozinho até o fim da partida', () => {
  const game = new FB.Game();
  game.action('select2');
  game.players[1].lives = 0;
  game.step(FRAME, { right: true });
  game.die('mar');
  game.step(T.deathTime + 0.02, {});
  assert.equal(game.player, 0);
  assert.equal(game.phase, 'playing');
  assert.equal(game.lives, 3);
  for (let i = 0; i < 3; i++) {
    game.die('mar');
    game.step(T.deathTime + 0.02, {});
  }
  assert.equal(game.phase, 'gameover');
});

test('a pausa congela a simulação inteira', () => {
  const game = fresh(4);
  game.x = T.hideout;
  game.step(4, {});
  assert.ok(game.inHideout(), 'escondido do urso');
  assert.equal(game.phase, 'playing');
  game.action('pause');
  assert.equal(game.phase, 'paused');
  const frozen = snapshot(game);
  game.step(5, { left: true, down: true, fire: true });
  assert.equal(snapshot(game), frozen, 'nada muda em pausa');
  game.action('start');
  assert.equal(game.phase, 'playing', 'Enter retoma');
  game.step(1.2, {});
  assert.notEqual(snapshot(game), frozen);
  game.die('mar');
  game.action('pause');
  const dying = snapshot(game);
  game.step(10, {});
  assert.equal(snapshot(game), dying, 'a morte também espera');
  game.action('pause');
  assert.equal(game.phase, 'dying');
  const ready = new FB.Game();
  ready.start();
  ready.action('pause');
  ready.step(10, {});
  ready.action('pause');
  assert.equal(ready.phase, 'ready');
});

test('a simulação produz o mesmo resultado em passos grandes e pequenos', () => {
  for (const level of [1, 6, 8]) {
    const coarse = fresh(level);
    const medium = fresh(level);
    const fine = fresh(level);
    coarse.step(3, { right: true });
    for (let i = 0; i < 180; i++) medium.step(1 / 60, { right: true });
    for (let i = 0; i < 360; i++) fine.step(1 / 120, { right: true });
    for (const other of [medium, fine]) {
      for (const key of ['x', 'lane', 'score', 'blocks', 'degrees', 'lives', 'breath']) near(other[key], coarse[key], 1e-6, `fase ${level}: ${key}`);
      coarse.rows.forEach((row, i) => near(other.rows[i].offset, row.offset, 1e-6, `fase ${level}: fileira ${i + 1}`));
      assert.equal(other.enemies.length, coarse.enemies.length);
      coarse.enemies.forEach((enemy, i) => near(other.enemies[i].x, enemy.x, 1e-6, 'criatura'));
    }
  }
  const game = fresh();
  const before = snapshot(game);
  for (const dt of [0, -1, NaN, Infinity]) game.step(dt, { right: true });
  assert.equal(snapshot(game), before, 'passos inválidos são ignorados');
});

test('a partida espera o joystick e começa com uma vida e três reservas', () => {
  const game = new FB.Game();
  assert.equal(game.phase, 'title');
  game.start();
  assert.equal(game.phase, 'ready');
  assert.equal(game.lives, 4);
  assert.equal(game.reserves, 3);
  assert.equal(game.level, 1);
  assert.equal(game.blocks, 0);
  assert.equal(game.score, 0);
  game.step(1, {});
  assert.equal(game.phase, 'ready');
  game.step(FRAME, { down: true });
  assert.equal(game.phase, 'playing');
  assert.equal(game.jump, null, 'o primeiro comando começa a rodada, mas o joystick só responde quando o gelo parte');
  const idle = new FB.Game();
  idle.start();
  idle.step(T.readyTime + 0.1, {});
  assert.equal(idle.phase, 'playing', 'a espera nunca trava');
});

test('perder as quatro vidas encerra a partida sem reiniciar com o botão preso', () => {
  const game = fresh();
  game.scorePoints(500);
  for (let i = 0; i < 4; i++) {
    assert.equal(game.phase, 'playing');
    game.die(['mar', 'frio', 'urso', 'mar'][i]);
    game.step(T.deathTime + 0.02, i === 3 ? { fire: true } : {});
  }
  assert.equal(game.phase, 'gameover');
  assert.equal(game.lives, 0);
  game.step(1, { fire: true });
  assert.equal(game.phase, 'gameover', 'o botão preso não reinicia');
  assert.equal(game.score, 500);
  assert.equal(game.highScore, 500);
  game.step(FRAME, {});
  game.step(FRAME, { fire: true });
  assert.equal(game.phase, 'ready', 'soltar e apertar de novo começa outra partida, pela espera');
  assert.equal(game.score, 0);
  assert.equal(game.lives, 4);
  assert.equal(game.level, 1);
  assert.equal(game.highScore, 500);
});

test('os cartões da tela usam só letras que a fonte desenha, com acento, e falam com o toque', () => {
  const game = new FB.Game();
  game.highScore = 1234;
  const seen = [];
  for (const phase of ['title', 'gameover', 'paused', 'ready']) {
    game.phase = phase;
    for (const touch of [false, true]) {
      const lines = FB.cardLines(game, touch);
      assert.ok(lines && lines.length >= 2, `${phase}: há cartão`);
      for (const line of lines) {
        assert.ok(line.length * 6 - 1 <= 124, `"${line}" cabe no cartão`);
        for (const letter of line.toUpperCase()) assert.ok(FB.Font[letter], `"${letter}" de "${line}" existe na fonte`);
      }
      seen.push(...lines);
    }
  }
  assert.ok(seen.includes('ENTER OU BOTÃO') && seen.includes('TOQUE PARA JOGAR'), 'título e fim de jogo pedem Enter no teclado e toque no celular');
  assert.ok(!seen.some((line) => /BOTAO/.test(line)), 'nenhum cartão perde o til');
  const tilde = FB.Font['Ã'];
  assert.equal(tilde.top, -3, 'o til fica acima da linha');
  assert.deepEqual(tilde.rows.slice(3), FB.Font.A, 'Ã é o A com o til por cima');
  assert.deepEqual(FB.Font['Ç'].rows.slice(0, 7), FB.Font.C, 'Ç é o C com a cedilha por baixo');
  game.phase = 'playing';
  assert.equal(FB.cardLines(game, false), null, 'em jogo não há cartão');
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

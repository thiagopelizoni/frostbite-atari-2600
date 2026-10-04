'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { buildArtifact, ROOT, OUTPUT } = require('./build-artifact');
const { createServer } = require('./serve');

const RESULTS = path.join(ROOT, 'test-results');
let checks = 0;

function ok(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log(`✓ ${message}`);
}

function observe(page) {
  const problems = [];
  const requests = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('request', (request) => requests.push(request.url()));
  return { problems, requests };
}

async function load(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.FB && FB.game && FB.game.phase === 'title');
  await page.locator('#screen').waitFor({ state: 'visible' });
}

async function phase(page, expected) {
  await page.waitForFunction((wanted) => FB.game.phase === wanted, expected);
}

async function frames(page, count = 2) {
  await page.evaluate((left) => new Promise((resolve) => {
    const next = () => (left-- <= 0 ? resolve() : requestAnimationFrame(next));
    next();
  }), count);
}

async function focusedId(page) {
  return page.evaluate(() => document.activeElement && document.activeElement.id);
}

async function noOverflow(page, label) {
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  ok(width.content <= width.viewport, `${label}: página sem rolagem horizontal (${width.viewport}px)`);
  const rect = await page.locator('#screen').boundingBox();
  ok(Math.abs(rect.width / rect.height - 4 / 3) < 0.01, `${label}: tela preserva a proporção Atari 4:3`);
}

// Stops floes and creatures so state set from the test stays put; the clock and the joystick still run.
async function freezeWorld(page) {
  await page.evaluate(() => {
    const game = FB.game;
    game.hold = 0;
    game.rows.forEach((row) => { row.speed = 0; });
    game.clearCreatures();
    game.bear = null;
    game.degrees = FB.Config.startDegrees(game.level);
    game.chill = 0;
  });
}

// Puts Bailey on the centre of a floe of the top ice row, away from the wrap seam.
async function standOnIce(page, blocks) {
  return page.evaluate((blocks) => {
    const game = FB.game;
    const row = game.rows[0];
    const piece = FB.World.pieces(row).find((item) => item.x >= 24 && item.x + item.w <= 136);
    game.lane = 1;
    game.jump = null;
    game.blocks = blocks;
    game.x = piece.x + piece.w / 2;
    return { x: game.x, dir: row.dir, blocks: game.blocks, supported: game.supported(row), phase: game.phase };
  }, blocks);
}

// Keeps a reference to the 160×192 frame the game blits to #screen, before scaling and scanlines.
async function tapFrame(page) {
  await page.evaluate(() => {
    if ('testFrame' in window) return;
    window.testFrame = null;
    const proto = CanvasRenderingContext2D.prototype;
    const draw = proto.drawImage;
    proto.drawImage = function (source, ...rest) {
      if (this.canvas.id === 'screen' && source.width === FB.Config.W && source.height === FB.Config.H) window.testFrame = source;
      return draw.call(this, source, ...rest);
    };
  });
  await frames(page);
  await page.waitForFunction(() => !!window.testFrame);
}

// Counts exact palette colours in the native frame and the expected counts from the game state.
async function paletteReport(page) {
  return page.evaluate(() => {
    const C = FB.Config;
    const T = C.TUNE;
    const L = C.LAYOUT;
    const game = FB.game;
    const colors = C.palette(game.level);
    const hex = (data, i) => '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const native = window.testFrame.getContext('2d').getImageData(0, 0, C.W, C.H).data;
    const count = (data, width, color, x0, y0, x1, y1) => {
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) if (hex(data, (y * width + x) * 4) === color.toUpperCase()) total++;
      }
      return total;
    };

    const ice = new Set();
    const used = new Set();
    game.rows.forEach((row, index) => {
      const lane = C.LANES[index + 1];
      const target = row.white ? ice : used;
      FB.World.pieces(row).forEach((piece) => FB.World.SLANT.forEach((slant, line) => {
        const left = Math.round(piece.x + slant);
        for (const shift of [0, C.W, -C.W]) {
          for (let x = left + shift; x < left + shift + piece.w; x++) {
            if (x >= T.hmove && x < C.W) target.add(`${x},${lane.top + line}`);
          }
        }
      }));
    });

    const sprite = FB.Sprites.bailey;
    const left = Math.round(game.x - 4);
    const top = C.LANES[0].feet - sprite.length + 1;
    const bailey = { h: 0, f: 0, c: 0, d: 0 };
    sprite.forEach((line, row) => [...line].forEach((pixel, col) => {
      if (pixel !== '.' && left + col >= T.hmove && left + col < C.W && top + row >= L.shoreTop) bailey[pixel]++;
    }));
    const baileyTotal = Object.values(bailey).reduce((a, b) => a + b, 0);

    const seaArea = (C.W - T.hmove) * (L.waterBottom - L.waterTop);
    const shoreArea = (C.W - T.hmove) * (L.shoreBottom - L.shoreTop);
    const expected = {
      water: seaArea - ice.size - used.size,
      ice: ice.size,
      iceUsed: used.size,
      shore: shoreArea - baileyTotal,
      hat: bailey.h, face: bailey.f, coat: bailey.c, boots: bailey.d,
    };
    const region = { water: 'sea', ice: 'sea', iceUsed: 'sea', shore: 'shore', hat: 'shore', face: 'shore', coat: 'shore', boots: 'shore' };
    const bounds = { sea: [0, L.waterTop, C.W, L.waterBottom], shore: [0, L.shoreTop, C.W, L.shoreBottom] };
    const actual = {};
    Object.keys(expected).forEach((name) => { actual[name] = count(native, C.W, colors[name], ...bounds[region[name]]); });

    const screen = document.getElementById('screen');
    const shown = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height).data;
    const visible = {};
    Object.keys(expected).forEach((name) => { visible[name] = count(shown, screen.width, colors[name], 0, 0, screen.width, screen.height); });
    return { expected, actual, visible, phase: game.phase, lane: game.lane, blocks: game.blocks };
  });
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, pathToFileURL(path.join(ROOT, 'index.html')).href);
  await noOverflow(page, 'Desktop');
  await page.screenshot({ path: path.join(RESULTS, 'desktop-title.png'), fullPage: true });

  await page.locator('#screen').focus();
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => FB.game.phase === 'ready' && FB.game.lives === 4 && FB.game.level === 1 && FB.game.reserves === 3), 'Enter prepara a fase 1 com uma vida em jogo e três reservas');

  // Walking on the shore: nothing else moves Bailey there at level 1.
  await page.keyboard.down('ArrowRight');
  await phase(page, 'playing');
  const origin = await page.evaluate(() => FB.game.x);
  await page.waitForFunction((x) => FB.game.x > x + 1, origin);
  const first = await page.evaluate(() => ({ x: FB.game.x, time: FB.game.time, lane: FB.game.lane, jump: FB.game.jump }));
  await page.waitForFunction((x) => FB.game.x > x + 8, first.x);
  const second = await page.evaluate(() => ({ x: FB.game.x, time: FB.game.time, lane: FB.game.lane, jump: FB.game.jump, walk: FB.Config.TUNE.walkSpeed }));
  await page.keyboard.up('ArrowRight');
  const pace = (second.x - first.x) / (second.time - first.time);
  ok(first.lane === 0 && second.lane === 0 && !first.jump && !second.jump, 'a seta para a direita mantém Bailey na margem, sem saltar');
  ok(Math.abs(pace - second.walk) < 0.5, `Bailey anda na margem a ${pace.toFixed(2)} px/s, a velocidade de caminhada`);
  await page.waitForFunction(() => !FB.Input.state.right);
  const rest = await page.evaluate(() => ({ x: FB.game.x, time: FB.game.time }));
  await page.waitForFunction((time) => FB.game.time > time + 0.2, rest.time);
  ok(await page.evaluate((x) => FB.game.x === x && FB.game.lane === 0, rest.x), 'parado na margem, Bailey não acompanha a deriva do gelo');
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction((x) => FB.game.x < x - 4, rest.x);
  await page.keyboard.up('ArrowLeft');
  ok(await page.evaluate(() => FB.game.lane === 0 && FB.game.facing === -1), 'a seta para a esquerda anda de volta pela margem');
  await page.screenshot({ path: path.join(RESULTS, 'desktop-playing.png'), fullPage: true });

  await page.keyboard.press('p');
  ok(await page.evaluate(() => FB.game.phase === 'paused'), 'P pausa a partida em andamento');
  const snapshot = () => page.evaluate(() => ({
    x: FB.game.x, degrees: FB.game.degrees, chill: FB.game.chill, blocks: FB.game.blocks,
    time: FB.game.time, hold: FB.game.hold, offsets: FB.game.rows.map((row) => row.offset),
  }));
  const paused = await snapshot();
  await frames(page, 12);
  assert.deepEqual(await snapshot(), paused);
  ok(await page.locator('#pause-button').getAttribute('aria-pressed') === 'true' && await page.locator('#pause-label').textContent() === 'CONTINUAR', 'a pausa congela a simulação e informa o estado do botão');
  await page.locator('#pause-button').click();
  ok(await page.evaluate(() => FB.game.phase === 'playing'), 'o botão CONTINUAR retoma a mesma partida');
  await page.waitForFunction((when) => FB.game.time > when + 0.1, paused.time);
  await page.waitForFunction((before) => FB.game.phase === 'playing' && FB.game.rows.every((row, i) => row.offset !== before[i]), paused.offsets);
  ok(await page.evaluate((before) => FB.game.phase === 'playing' && FB.game.rows.every((row, i) => row.offset !== before[i]), paused.offsets), 'depois da pausa o gelo volta a andar');

  // Palette: a quiet shore scene, compared pixel by pixel against the engine state.
  await freezeWorld(page);
  await page.evaluate(() => { FB.game.facing = 1; FB.game.walkClock = 0; FB.game.lane = 0; FB.game.x = 64; });
  await tapFrame(page);
  await frames(page, 2);
  const report = await paletteReport(page);
  ok(report.phase === 'playing' && report.lane === 0 && report.blocks === 0, 'a cena de referência está em jogo, com Bailey na margem e o iglu vazio');
  for (const name of ['water', 'ice', 'shore', 'hat', 'face', 'coat', 'boots']) {
    ok(report.expected[name] > 0 && report.actual[name] === report.expected[name], `quadro nativo: ${report.actual[name]} pixels exatos de ${name} (esperado ${report.expected[name]})`);
    ok(report.visible[name] >= report.actual[name], `tela ampliada mostra ${name} na cor exata da paleta (${report.visible[name]} pixels)`);
  }
  ok(report.actual.iceUsed === 0, 'no início da fase nenhuma fileira está azul');
  await page.locator('#screen').screenshot({ path: path.join(RESULTS, 'desktop-palette.png') });

  // Focus regression: after a toolbar click, Enter and Space must reach the game, not the button.
  await page.locator('#mute-button').click();
  ok(await page.evaluate(() => FB.Audio.muted) && await page.locator('#mute-button').getAttribute('aria-pressed') === 'true', 'o botão de som silencia o áudio e atualiza seu estado');
  ok(await focusedId(page) === 'screen', 'depois de clicar num botão da barra, o foco volta para a tela do jogo');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => FB.game.phase === 'paused' && FB.Audio.muted), 'Enter pausa o jogo em vez de apertar de novo o botão de som');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => FB.game.phase === 'playing' && FB.Audio.muted), 'Enter de novo retoma a partida');
  await page.keyboard.press('p');
  await page.locator('#pause-button').click();
  ok(await page.evaluate(() => FB.game.phase === 'playing') && await focusedId(page) === 'screen', 'CONTINUAR devolve o teclado à tela');
  const ice = await standOnIce(page, 3);
  ok(ice.supported && ice.phase === 'playing', 'Bailey está sobre um bloco da primeira fileira com três blocos no iglu');
  await page.keyboard.down('Space');
  await page.waitForFunction((dir) => FB.game.rows[0].dir === -dir, ice.dir);
  await frames(page, 6);
  await page.keyboard.up('Space');
  ok(await page.evaluate(() => FB.game.phase === 'playing' && FB.game.blocks === 2 && FB.game.lane === 1), 'espaço inverte a fileira sob Bailey uma única vez e gasta um bloco, sem acionar CONTINUAR');
  ok(await page.locator('#start-label').textContent() === 'REINICIAR' && await page.locator('#start-key').textContent() === 'R', 'durante o jogo o botão REINICIAR mostra a tecla R, já que Enter pausa');
  const clickDir = await page.evaluate(() => { document.activeElement.blur(); return FB.game.rows[0].dir; });
  await page.locator('#screen').click({ delay: 80 });
  await frames(page, 4);
  ok(await page.evaluate((dir) => FB.game.phase === 'playing' && FB.game.blocks === 2 && FB.game.rows[0].dir === dir, clickDir) && await focusedId(page) === 'screen', 'no computador, clicar na tela com o mouse só devolve o teclado ao jogo, sem inverter o gelo');
  // A press released before the next frame: both events land in one task, between two polls.
  const latched = await page.evaluate(() => {
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
    key('keydown', 'ArrowRight');
    key('keyup', 'ArrowRight');
    const first = FB.Input.poll().right;
    const second = FB.Input.poll().right;
    return { first, second };
  });
  ok(latched.first && !latched.second, 'uma tecla solta antes do próximo quadro ainda conta, uma única vez');
  const tapDir = await page.evaluate(() => {
    const dir = FB.game.rows[0].dir;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true, cancelable: true }));
    return dir;
  });
  await frames(page, 4);
  ok(await page.evaluate((dir) => FB.game.phase === 'playing' && FB.game.blocks === 1 && FB.game.rows[0].dir === -dir, tapDir), 'um toque de espaço mais curto que um quadro inverte o gelo uma vez');
  await page.evaluate(() => { FB.game.lane = 0; FB.game.x = 64; });

  await page.locator('#difficulty-switch').click();
  ok(await page.evaluate(() => FB.game.expertLever === true && FB.game.level === 1) && await page.locator('#difficulty-switch').getAttribute('aria-pressed') === 'true', 'a alavanca B/A muda de posição sem alterar a fase');
  await page.locator('#color-switch').click();
  ok(await page.locator('#screen').evaluate((canvas) => canvas.classList.contains('bw')) && await page.locator('#color-switch').getAttribute('aria-pressed') === 'true', 'a chave da TV ativa preto e branco');
  await page.locator('#color-switch').click();
  ok(await page.locator('#screen').evaluate((canvas) => !canvas.classList.contains('bw')), 'a chave da TV volta às cores');
  await page.locator('#select-button').click();
  ok(await page.evaluate(() => FB.game.gameMode === 2 && FB.game.players.length === 2 && FB.game.phase === 'ready'), 'GAME SELECT prepara os dois jogadores');
  ok(await page.locator('#game-state').textContent() === 'Jogo 2 · regular, dois jogadores', 'o painel do console mostra o jogo escolhido');
  await page.evaluate(() => FB.game.scorePoints(30));
  await page.locator('#reset-button').click();
  ok(await page.evaluate(() => FB.game.score === 0 && FB.game.lives === 4 && FB.game.gameMode === 2), 'GAME RESET reinicia a partida preservando o jogo selecionado');
  await page.reload();
  await phase(page, 'title');
  ok(await page.evaluate(() => FB.game.highScore === 30), 'o recorde permanece após recarregar a página');

  await page.locator('#screen').focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  ok(await page.evaluate(() => FB.game.phase === 'paused' && FB.game.previousPhase === 'ready'), 'perder o foco na espera do começo também pausa');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#pause-button').click();
  ok(await page.evaluate(() => FB.game.phase === 'ready'), 'e a rodada volta à espera do joystick');
  await page.keyboard.down('ArrowRight');
  await phase(page, 'playing');
  await page.waitForFunction(() => FB.Input.state.right);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await phase(page, 'paused');
  ok(await page.evaluate(() => Object.values(FB.Input.poll()).every((held) => !held)), 'perder o foco pausa o jogo e libera os comandos presos');
  await page.keyboard.up('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#pause-button').click();
  await phase(page, 'playing');
  ok(await page.locator('#fullscreen-button').isVisible(), 'com a Fullscreen API o botão TELA CHEIA aparece');
  await page.locator('#fullscreen-button').click();
  await page.waitForFunction(() => !!document.fullscreenElement && document.querySelector('.stage').classList.contains('full'));
  ok(await page.evaluate(() => document.fullscreenElement === document.querySelector('.stage') && document.fullscreenElement.contains(document.querySelector('.tv')) && document.fullscreenElement.contains(document.querySelector('#pad'))), 'o botão de tela cheia expande o televisor junto com o joystick de toque');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('.stage').classList.contains('full'));

  ok(observed.problems.length === 0, `a página abre offline sem erros de JavaScript: ${observed.problems.join('; ')}`);
  ok(observed.requests.every((url) => url.startsWith('file:')), 'o jogo não solicita serviços externos');
  await context.close();
}

async function gamepad(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, url);
  await page.evaluate(() => {
    window.testPad = { connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad], configurable: true });
    window.testPad.buttons[0].pressed = true;
  });
  await phase(page, 'ready');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => FB.game.phase === 'ready'), 'o botão de ação começa a partida e, ainda segurado, não pula a espera do JOGADOR 1');
  const x = await page.evaluate(() => {
    testPad.buttons[0].pressed = false;
    testPad.axes[0] = 0.6;
    return FB.game.x;
  });
  await phase(page, 'playing');
  await page.waitForFunction((origin) => FB.game.x > origin + 3, x);
  ok(await page.evaluate(() => FB.game.lane === 0 && !FB.game.jump), 'entrada de gamepad aceita o botão de ação e o eixo analógico');
  await page.evaluate(() => { testPad.axes[0] = 0.1; });
  await page.waitForFunction(() => !FB.Input.state.right);
  const still = await page.evaluate(() => ({ x: FB.game.x, time: FB.game.time }));
  await page.waitForFunction((time) => FB.game.time > time + 0.1, still.time);
  ok(await page.evaluate((origin) => !FB.Input.poll().right && FB.game.x === origin, still.x), 'a zona morta do gamepad ignora o manche quase parado');
  await page.evaluate(() => { testPad.buttons[9].pressed = true; });
  await phase(page, 'paused');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => FB.game.phase === 'paused'), 'segurar START no gamepad não alterna a pausa o tempo todo');
  await page.evaluate(() => { testPad.buttons[9].pressed = false; });
  await frames(page, 3);
  await page.evaluate(() => { testPad.buttons[9].pressed = true; });
  await phase(page, 'playing');
  await page.evaluate(() => { testPad.buttons[9].pressed = false; });
  ok(observed.problems.length === 0, 'o jogo servido por HTTP funciona sem erros no navegador');
  await context.close();
}

async function mobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, offline: true,
  });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, pathToFileURL(path.join(ROOT, 'index.html')).href);
  await noOverflow(page, 'Celular');
  await page.locator('#start-button').tap();
  ok(await page.evaluate(() => FB.game.phase === 'ready'), 'o botão COMEÇAR prepara a fase pelo toque');
  // Leave 'ready' before touching, so the touches below act on a running game.
  await page.evaluate(() => { if (FB.game.phase === 'ready') FB.game.action('start'); });
  await phase(page, 'playing');
  await freezeWorld(page);
  const ice = await standOnIce(page, 3);
  ok(ice.supported && ice.blocks === 3, 'Bailey está no gelo com blocos para gastar');

  await page.locator('#pad').scrollIntoViewIfNeeded();
  const left = await page.locator('#pad [data-dir="left"]').boundingBox();
  const right = await page.locator('#pad [data-dir="right"]').boundingBox();
  const fire = await page.locator('#fire-button').boundingBox();
  const touch = (rect, id) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id, radiusX: 2, radiusY: 2, force: 1 });
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(left, 1), touch(fire, 2)] });
  await page.waitForFunction(() => FB.Input.state.left && FB.Input.state.fire);
  await page.waitForFunction((dir) => FB.game.rows[0].dir === -dir, ice.dir);
  await page.waitForFunction((x) => FB.game.x < x - 2, ice.x);
  ok(await page.evaluate(() => FB.game.phase === 'playing' && FB.game.lane === 1 && FB.game.blocks === 2), 'dois dedos andam e invertem o gelo ao mesmo tempo, gastando um bloco');
  const turned = await page.evaluate(() => FB.game.x);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(right, 1), touch(fire, 2)] });
  await page.waitForFunction(() => FB.Input.state.right && !FB.Input.state.left && FB.Input.state.fire);
  await page.waitForFunction((x) => FB.game.x > x + 2, turned);
  ok(await page.evaluate((dir) => FB.game.phase === 'playing' && FB.game.blocks === 2 && FB.game.rows[0].dir === -dir, ice.dir), 'arrastar o dedo pelo direcional muda o lado sem soltar o botão vermelho nem inverter de novo');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => !FB.Input.state.left && !FB.Input.state.right && !FB.Input.state.fire);
  ok(await page.locator('#pad .held').count() === 0, 'soltar os dedos libera os controles de toque');
  const quickDir = await page.evaluate(() => {
    const dir = FB.game.rows[0].dir;
    const button = document.getElementById('fire-button');
    const init = { pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0 };
    button.dispatchEvent(new PointerEvent('pointerdown', init));
    button.dispatchEvent(new PointerEvent('pointerup', init));
    return dir;
  });
  await frames(page, 4);
  ok(await page.evaluate((dir) => FB.game.phase === 'playing' && FB.game.blocks === 1 && FB.game.rows[0].dir === -dir, quickDir), 'um toque no botão vermelho mais curto que um quadro inverte o gelo uma vez');
  // The pause card asks for a tap, so the TV and the red button resume, and that press is not fire.
  const resumeBy = async (selector) => {
    const before = await page.evaluate(() => ({ dir: FB.game.rows[0].dir, blocks: FB.game.blocks }));
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await phase(page, 'paused');
    await page.locator(selector).tap();
    await frames(page, 4);
    return page.evaluate((before) => FB.game.phase === 'playing' && FB.game.blocks === before.blocks && FB.game.rows[0].dir === before.dir && !FB.Input.state.fire, before);
  };
  ok(await page.evaluate(() => FB.cardLines({ phase: 'paused' }, true).includes('TOQUE PARA CONTINUAR')), 'no toque a pausa pede um toque para continuar');
  ok(await resumeBy('#screen'), 'tocar na tela retoma a partida pausada sem inverter o gelo');
  ok(await resumeBy('#fire-button'), 'tocar no botão vermelho retoma a partida pausada sem inverter o gelo');
  await page.evaluate(() => { FB.game.lane = 0; FB.game.x = 64; });
  await page.screenshot({ path: path.join(RESULTS, 'mobile-playing.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page, 'Celular compacto');
  await page.screenshot({ path: path.join(RESULTS, 'mobile-320.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page, 2);
  const fits = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const screen = box('#screen');
    const pad = box('#pad');
    return { screenTop: screen.top, padBottom: pad.bottom, height: innerHeight, scroll: document.documentElement.scrollWidth };
  });
  ok(fits.screenTop >= 0 && fits.padBottom <= fits.height && fits.scroll <= 320, `em 320×568 a tela e o direcional inteiro cabem juntos (tela em ${Math.round(fits.screenTop)}px, direcional até ${Math.round(fits.padBottom)}px)`);
  await page.screenshot({ path: path.join(RESULTS, 'mobile-320x568.png') });
  // Sideways phones and a short tablet window: the screen, the d-pad and the red button all on screen at once.
  const SWITCHES = ['#color-switch', '#difficulty-switch', '#select-button', '#reset-button'];
  const inView = (extra = []) => page.evaluate((extra) => {
    const rects = ['#screen', '#pad [data-dir="up"]', '#pad [data-dir="down"]', '#pad [data-dir="left"]', '#pad [data-dir="right"]', '#fire-button', ...extra].map((selector) => document.querySelector(selector).getBoundingClientRect());
    return { fits: rects.every((rect) => rect.width > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight), scroll: document.documentElement.scrollWidth <= innerWidth };
  }, extra);
  for (const [width, height] of [[568, 320], [740, 360], [844, 390], [650, 700]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await frames(page, 2);
    const sideways = width > height;
    const view = await inView(sideways ? SWITCHES : []);
    ok(view.fits && view.scroll, `em ${width}×${height} a tela, o direcional${sideways ? ', o botão vermelho e as chaves do console' : ' e o botão vermelho'} cabem juntos sem rolar`);
    await noOverflow(page, `Toque ${width}×${height}`);
  }
  await page.screenshot({ path: path.join(RESULTS, 'mobile-650x700.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page, 2);
  await page.screenshot({ path: path.join(RESULTS, 'mobile-844x390.png') });
  const mode = await page.evaluate(() => FB.game.gameMode);
  await page.locator('#select-button').tap();
  ok(await page.evaluate((before) => FB.game.gameMode === before % 4 + 1, mode), 'com o celular deitado, GAME SELECT continua ao alcance do toque');
  await page.locator('#fullscreen-button').tap();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await frames(page, 2);
  const full = await inView();
  ok(full.fits, 'em tela cheia no celular deitado o direcional e o botão vermelho continuam à mão');
  await page.evaluate(() => { if (FB.game.phase === 'ready') FB.game.action('start'); });
  await phase(page, 'playing');
  ok(await resumeBy('#screen'), 'em tela cheia, onde CONTINUAR fica de fora, tocar na tela retoma a partida pausada');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  ok(observed.problems.length === 0, `controles de toque não produzem erros: ${observed.problems.join('; ')}`);
  await context.close();
}

async function standalone(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, pathToFileURL(OUTPUT).href);
  await page.locator('#screen').focus();
  await page.keyboard.down('Space');
  await phase(page, 'ready');
  await frames(page, 6);
  ok(await page.evaluate(() => FB.game.phase === 'ready'), 'espaço começa a partida pela espera do JOGADOR 1, como o Enter');
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  await phase(page, 'playing');
  await freezeWorld(page);
  await page.screenshot({ path: path.join(RESULTS, 'offline-playing.png'), fullPage: true });

  const note = page.locator('#architect-state');
  ok(await note.isHidden(), 'a nota do Arctic Architect fica escondida no começo');
  await page.evaluate(() => FB.game.scorePoints(39990));
  await frames(page, 2);
  ok(await note.isHidden(), 'abaixo de 40.000 pontos a nota continua escondida');
  await page.evaluate(() => FB.game.scorePoints(10));
  await note.waitFor({ state: 'visible' });
  ok(await page.evaluate(() => FB.game.score === 40000 && FB.game.architect), 'aos 40.000 pontos aparece a nota do Arctic Architect');

  await page.evaluate(() => FB.game.scorePoints(959999));
  ok(await page.evaluate(() => FB.game.score === 999999 && FB.game.highScore === 999999 && FB.game.lives === FB.Config.TUNE.maxLives), 'o placar chega a 999999 e as vidas extras param no limite');
  await page.evaluate(() => FB.game.scorePoints(1));
  ok(await page.evaluate(() => FB.game.score === 0 && FB.game.highScore === 999999), 'o placar volta a zero ao passar de um milhão e o recorde fica');

  await page.evaluate(() => {
    const game = FB.game;
    game.level = FB.Config.TUNE.magicFishLevel;
    game.beginLife();
  });
  await freezeWorld(page);
  await tapFrame(page);
  await frames(page, 2);
  const hud = await page.evaluate(() => {
    const C = FB.Config;
    const L = C.LAYOUT;
    const magic = FB.Sprites.magic;
    const ink = C.palette(FB.game.level).ink.toUpperCase();
    const x0 = L.scoreX + 23;
    const width = Math.max(...magic.map((line) => line.length));
    const data = window.testFrame.getContext('2d').getImageData(x0, L.lineY, width, magic.length).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ('#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() === ink) lit++;
    }
    const expected = magic.join('').replace(/\./g, '').length;
    // The cartridge keeps the reserve digit beside the magic fish.
    const reserve = FB.Sprites.digits[String(FB.game.reserves)];
    const pixels = window.testFrame.getContext('2d').getImageData(L.scoreX + 40, L.lineY, 8, reserve.length).data;
    let digitLit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if ('#' + [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() === ink) digitLit++;
    }
    const digitExpected = reserve.join('').replace(/\./g, '').length;
    return { magicFish: FB.game.magicFish, lit, expected, digitLit, digitExpected, reserves: FB.game.reserves, phase: FB.game.phase };
  });
  await page.locator('#screen').screenshot({ path: path.join(RESULTS, 'high-score.png') });
  ok(hud.magicFish && hud.phase === 'playing' && hud.lit === hud.expected, `da fase 21 em diante o peixe mágico aparece no placar (${hud.lit} de ${hud.expected} pixels)`);
  ok(hud.reserves > 0 && hud.digitLit === hud.digitExpected, `o número de reservas continua ao lado do peixe mágico (${hud.digitLit} de ${hud.digitExpected} pixels)`);

  const deaths = [
    ['frio', null, 'A temperatura chegou a zero e Frostbite Bailey congelou.'],
    ['urso', null, 'O urso polar arrastou Frostbite Bailey para fora da tela.'],
    ['mar', 'crab', 'Um caranguejo empurrou Frostbite Bailey para o mar Ártico.'],
    ['mar', null, 'Frostbite Bailey caiu no mar Ártico.'],
  ];
  for (const [reason, pushedBy, message] of deaths) {
    await page.evaluate(({ reason, pushedBy }) => {
      const game = FB.game;
      game.phase = 'playing';
      game.pushedBy = pushedBy;
      game.die(reason);
    }, { reason, pushedBy });
    await frames(page, 2);
    ok(await page.locator('#status').textContent() === message, `a barra de estado explica a morte (${reason}${pushedBy ? `, ${pushedBy}` : ''})`);
  }
  await page.evaluate(() => { FB.game.beginLife(); FB.game.phase = 'playing'; });
  await freezeWorld(page);

  await page.keyboard.down('Space');
  await page.evaluate(() => { FB.game.lives = 1; FB.game.die('mar'); });
  await phase(page, 'gameover');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => FB.game.phase === 'gameover'), 'manter espaço pressionado não reinicia sozinho depois da última vida');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => !FB.Input.state.fire);
  await frames(page, 2);
  await page.keyboard.down('Space');
  await phase(page, 'ready');
  await page.keyboard.up('Space');
  ok(await page.evaluate(() => FB.game.score === 0 && FB.game.lives === 4 && FB.game.level === 1), 'soltar e apertar espaço de novo começa outra partida no HTML único');
  ok(observed.requests.length === 1 && observed.requests[0] === pathToFileURL(OUTPUT).href, 'o HTML único joga offline sem solicitar outros arquivos');
  ok(observed.problems.length === 0, `o HTML único não apresenta erros: ${observed.problems.join('; ')}`);
  await context.close();
}

// A host page can block the Gamepad API with a permissions policy; the game must keep running.
async function blockedGamepad(browser) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, offline: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => { throw new DOMException('Access to the feature "gamepad" is disallowed by permissions policy.', 'SecurityError'); },
      configurable: true,
    });
  });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, pathToFileURL(OUTPUT).href);
  const time = await page.evaluate(() => FB.game.time);
  await page.waitForFunction((before) => FB.game.time > before + 0.2, time);
  await page.locator('#screen').focus();
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => FB.game.phase === 'ready') && observed.problems.length === 0, `com o gamepad bloqueado pela página hospedeira o jogo continua rodando e aceita o teclado: ${observed.problems.join('; ')}`);
  await context.close();
}

// Older Safari has only the webkit-prefixed API, and the iPhone has no element fullscreen at all.
async function fullscreenFallbacks(browser) {
  const prefixed = await browser.newContext({ viewport: { width: 1024, height: 768 }, offline: true });
  await prefixed.addInitScript(() => {
    delete Element.prototype.requestFullscreen;
    delete Document.prototype.exitFullscreen;
  });
  let page = await prefixed.newPage();
  let observed = observe(page);
  await load(page, pathToFileURL(OUTPUT).href);
  ok(await page.evaluate(() => !Element.prototype.requestFullscreen && !!Element.prototype.webkitRequestFullscreen) && await page.locator('#fullscreen-button').isVisible(), 'só com a API prefixada o botão TELA CHEIA continua visível');
  await page.locator('#fullscreen-button').click();
  await page.waitForFunction(() => !!document.webkitFullscreenElement);
  await frames(page, 2);
  ok(await page.evaluate(() => document.webkitFullscreenElement === document.querySelector('.stage') && document.querySelector('.stage').classList.contains('full')), 'o botão usa webkitRequestFullscreen quando a API padrão não existe');
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.webkitFullscreenElement && !document.querySelector('.stage').classList.contains('full'));
  ok(observed.problems.length === 0, `F sai da tela cheia prefixada sem erros: ${observed.problems.join('; ')}`);
  await prefixed.close();

  const none = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, offline: true });
  await none.addInitScript(() => {
    delete Element.prototype.requestFullscreen;
    delete Element.prototype.webkitRequestFullscreen;
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
    Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false, configurable: true });
  });
  page = await none.newPage();
  observed = observe(page);
  await load(page, pathToFileURL(OUTPUT).href);
  ok(await page.locator('#fullscreen-button').isHidden(), 'sem tela cheia no navegador, como no iPhone, o botão TELA CHEIA some');
  await page.locator('#screen').focus();
  await page.keyboard.press('f');
  await frames(page, 2);
  ok(await page.evaluate(() => !document.fullscreenElement) && observed.problems.length === 0, `sem tela cheia, F não faz nada e não gera erros: ${observed.problems.join('; ')}`);
  await none.close();
}

async function main() {
  buildArtifact();
  fs.mkdirSync(RESULTS, { recursive: true });
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await desktop(browser);
    await gamepad(browser, `http://127.0.0.1:${server.address().port}/`);
    await mobile(browser);
    await standalone(browser);
    await blockedGamepad(browser);
    await fullscreenFallbacks(browser);
    console.log(`\n${checks} verificações de navegador passaram. Capturas em test-results/.`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

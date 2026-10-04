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

async function noOverflow(page, label) {
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  ok(width.content <= width.viewport, `${label}: página sem rolagem horizontal (${width.viewport}px)`);
  const rect = await page.locator('#screen').boundingBox();
  ok(Math.abs(rect.width / rect.height - 4 / 3) < 0.01, `${label}: tela preserva a proporção Atari 4:3`);
}

async function canvasPainted(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('screen');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 40) lit++;
    }
    return lit;
  });
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
  const page = await context.newPage();
  const observed = observe(page);
  await load(page, pathToFileURL(path.join(ROOT, 'index.html')).href);
  await noOverflow(page, 'Desktop');
  await page.screenshot({ path: path.join(RESULTS, 'desktop-title.png'), fullPage: true });
  ok(await canvasPainted(page) > 200, 'a tela desenha o lago, o gelo e Bailey');

  await page.locator('#screen').focus();
  await page.keyboard.press('Enter');
  await phase(page, 'ready');
  await page.keyboard.down('ArrowUp');
  await phase(page, 'playing');
  ok(await page.evaluate(() => FB.game.lives === 4 && FB.game.level === 1), 'Enter e a seta para cima iniciam a fase com três reservas');
  await page.keyboard.up('ArrowUp');
  const initialX = await page.evaluate(() => FB.game.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((x) => Math.abs(FB.game.x - x) > 3, initialX);
  await page.keyboard.up('ArrowRight');
  ok(true, 'a seta para a direita anda no gelo');
  await page.screenshot({ path: path.join(RESULTS, 'desktop-playing.png'), fullPage: true });

  await page.keyboard.press('p');
  await phase(page, 'paused');
  const paused = await page.evaluate(() => ({ x: FB.game.x, degrees: FB.game.degrees, blocks: FB.game.blocks, time: FB.game.time }));
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(() => ({ x: FB.game.x, degrees: FB.game.degrees, blocks: FB.game.blocks, time: FB.game.time })), paused);
  ok(await page.locator('#pause-button').getAttribute('aria-pressed') === 'true', 'P pausa a simulação e informa o estado do botão');
  await page.locator('#pause-button').click();
  await phase(page, 'playing');
  await page.waitForFunction((when) => FB.game.time > when, paused.time);
  ok(true, 'o botão CONTINUAR retoma a mesma partida');

  await page.locator('#mute-button').click();
  ok(await page.evaluate(() => FB.Audio.muted) && await page.locator('#mute-button').getAttribute('aria-pressed') === 'true', 'o botão de som silencia o áudio e atualiza seu estado');
  await page.locator('#difficulty-switch').click();
  ok(await page.evaluate(() => FB.game.expertLever === true && FB.game.level === 1) && await page.locator('#difficulty-switch').getAttribute('aria-pressed') === 'true', 'a alavanca B/A muda de posição sem alterar a fase');
  await page.locator('#color-switch').click();
  ok(await page.locator('#screen').evaluate((canvas) => canvas.classList.contains('bw')) && await page.locator('#color-switch').getAttribute('aria-pressed') === 'true', 'a chave da TV ativa preto e branco');
  await page.locator('#color-switch').click();
  await page.locator('#select-button').click();
  ok(await page.evaluate(() => FB.game.gameMode === 2 && FB.game.players.length === 2 && FB.game.phase === 'ready'), 'GAME SELECT prepara os dois jogadores');
  await page.evaluate(() => FB.game.scorePoints(30));
  await page.locator('#reset-button').click();
  ok(await page.evaluate(() => FB.game.score === 0 && FB.game.lives === 4 && FB.game.gameMode === 2), 'GAME RESET reinicia a partida preservando o jogo selecionado');
  await page.reload();
  await phase(page, 'title');
  ok(await page.evaluate(() => FB.game.highScore === 30), 'o recorde permanece após recarregar a página');

  await page.locator('#screen').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowRight');
  await phase(page, 'playing');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await phase(page, 'paused');
  ok(await page.evaluate(() => Object.values(FB.Input.poll()).every((held) => !held)), 'perder o foco pausa o jogo e libera os comandos presos');
  await page.keyboard.up('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#pause-button').click();
  await phase(page, 'playing');
  await page.locator('#fullscreen-button').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  ok(true, 'o botão de tela cheia expande o televisor');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);

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
  await phase(page, 'playing');
  const x = await page.evaluate(() => {
    testPad.buttons[0].pressed = false;
    testPad.axes[0] = 0.6;
    return FB.game.x;
  });
  await page.waitForFunction((origin) => FB.game.x > origin + 3, x);
  ok(true, 'entrada de gamepad aceita o botão de ação e o eixo analógico');
  await page.evaluate(() => { testPad.axes[0] = 0.1; });
  await page.waitForTimeout(50);
  ok(await page.evaluate(() => !FB.Input.poll().right), 'a zona morta do gamepad ignora o manche quase parado');
  await page.evaluate(() => { testPad.buttons[9].pressed = true; });
  await phase(page, 'paused');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => FB.game.phase === 'paused'), 'segurar START no gamepad não alterna a pausa o tempo todo');
  await page.evaluate(() => { testPad.buttons[9].pressed = false; });
  await page.waitForTimeout(50);
  await page.evaluate(() => { testPad.buttons[9].pressed = true; });
  await phase(page, 'playing');
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
  await phase(page, 'ready');
  await page.locator('#pad').scrollIntoViewIfNeeded();
  const left = await page.locator('#pad [data-dir="left"]').boundingBox();
  const right = await page.locator('#pad [data-dir="right"]').boundingBox();
  const fire = await page.locator('#fire-button').boundingBox();
  const touch = (rect, id) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id, radiusX: 2, radiusY: 2, force: 1 });
  const session = await context.newCDPSession(page);
  const initialX = await page.evaluate(() => FB.game.x);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(left, 1), touch(fire, 2)] });
  await phase(page, 'playing');
  await page.waitForFunction(() => FB.Input.state.left && FB.Input.state.fire);
  await page.waitForFunction((x) => FB.game.x < x - 3, initialX);
  ok(await page.evaluate(() => FB.game.phase === 'playing'), 'dois dedos andam e invertem o gelo ao mesmo tempo');
  const turned = await page.evaluate(() => FB.game.x);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(right, 1), touch(fire, 2)] });
  await page.waitForFunction(() => FB.Input.state.right && !FB.Input.state.left);
  await page.waitForFunction((x) => FB.game.x > x + 2, turned);
  ok(true, 'arrastar o dedo pelo direcional muda o lado sem soltar o botão vermelho');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => !FB.Input.state.left && !FB.Input.state.right && !FB.Input.state.fire);
  ok(await page.locator('#pad .held').count() === 0, 'soltar os dedos libera os controles de toque');
  await page.screenshot({ path: path.join(RESULTS, 'mobile-playing.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page, 'Celular compacto');
  await page.screenshot({ path: path.join(RESULTS, 'mobile-320.png'), fullPage: true });
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
  await phase(page, 'playing');
  await page.keyboard.up('Space');
  await page.screenshot({ path: path.join(RESULTS, 'offline-playing.png'), fullPage: true });
  await page.evaluate(() => FB.game.scorePoints(999999));
  await page.waitForTimeout(40);
  await page.locator('#screen').screenshot({ path: path.join(RESULTS, 'high-score.png') });
  ok(await page.evaluate(() => FB.game.score === 999999 && FB.game.highScore === 999999 && FB.game.magicFish), 'o placar chega ao teto de seis dígitos e mostra o peixe mágico');
  await page.keyboard.down('Space');
  await page.evaluate(() => { FB.game.lives = 1; FB.game.die('mar'); });
  await phase(page, 'gameover');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => FB.game.phase === 'gameover'), 'manter espaço pressionado não reinicia sozinho depois da última vida');
  await page.keyboard.up('Space');
  await page.waitForTimeout(40);
  await page.keyboard.down('Space');
  await phase(page, 'playing');
  await page.keyboard.up('Space');
  ok(await page.evaluate(() => FB.game.score === 0 && FB.game.lives === 4), 'soltar e apertar espaço de novo começa outra partida no HTML único');
  ok(observed.requests.length === 1 && observed.requests[0] === pathToFileURL(OUTPUT).href, 'o HTML único joga offline sem solicitar outros arquivos');
  ok(observed.problems.length === 0, `o HTML único não apresenta erros: ${observed.problems.join('; ')}`);
  await context.close();
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

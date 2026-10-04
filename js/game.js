window.FB = window.FB || {};

(function (FB) {
  'use strict';

  const C = FB.Config;
  const T = C.TUNE;
  const L = C.LAYOUT;
  const W = FB.World;
  const S = FB.Sprites;
  const silent = new Proxy({}, { get: () => () => {} });
  const controls = ['left', 'right', 'up', 'down', 'fire'];
  const FRAME = 1 / 60;
  // Bailey's height above his starting lane, one entry per frame of the 28-frame jump.
  const HOP_DOWN = [-2, -2, -4, -4, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -4, -4, -2, -2, 1, 1, 5, 5, 10, 10, 15, 15, 20, 20, 26];
  const HOP_UP = [-6, -6, -11, -11, -16, -16, -21, -21, -25, -25, -28, -28, -30, -30, -31, -31, -31, -31, -31, -31, -31, -31, -31, -31, -30, -30, -28, -28, -26];

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  // Moves from `from` toward `to` but never further out past low/high; nothing snaps back inside.
  function bound(from, to, low, high) {
    if (to < from) return Math.max(to, Math.min(from, low));
    if (to > from) return Math.min(to, Math.max(from, high));
    return to;
  }

  function modeLabel(mode) {
    const advanced = mode >= 3;
    const pair = C.twoPlayers(mode);
    return `Jogo ${mode} · ${advanced ? 'avançado' : 'regular'}, ${pair ? 'dois jogadores' : 'um jogador'}`;
  }

  // The lines of the card drawn over the screen, or null. Touch screens have no Enter key, so they are
  // told to tap: the screen and the red button both start the game.
  function cardLines(game, touch) {
    const phase = game.phase;
    const start = touch ? 'TOQUE PARA JOGAR' : 'ENTER OU BOTÃO';
    if (phase === 'title') return ['FROSTBITE', start, `RECORDE ${game.highScore}`];
    if (phase === 'gameover') return ['FIM DE JOGO', start, `RECORDE ${game.highScore}`];
    if (phase === 'paused') return ['PAUSA', touch ? 'TOQUE PARA CONTINUAR' : 'P PARA CONTINUAR'];
    if (phase === 'ready') return [`JOGADOR ${game.player + 1}`, 'MOVA O JOYSTICK'];
    return null;
  }

  // The simulation never touches the DOM. Coordinates are Atari pixels; see config.js for lanes.
  class Game {
    constructor(options = {}) {
      this.audio = options.audio || silent;
      this.onScore = options.onScore || (() => {});
      this.expertLever = false;
      this.gameMode = 1;
      this.player = 0;
      this.players = [];
      this.phase = 'title';
      this.previousPhase = 'playing';
      this.reason = '';
      this.time = 0;
      this.highScore = 0;
      this.startArmed = true;
      this.lastBonus = 0;
      this.magicFish = false;
      this.level = 1;
      this.score = 0;
      this.lives = T.startLives;
      this.blocks = 0;
      this.degrees = C.startDegrees(1);
      this.chill = 0;
      this.hold = 0;
      this.breath = 0;
      this.lane = 0;
      this.x = T.startX;
      this.facing = 1;
      this.jump = null;
      this.walkClock = 0;
      this.pushedBy = null;
      this.fireLatch = false;
      this.round = 0;
      this.readyTimer = 0;
      this.deathTimer = 0;
      this.death = null;
      this.clear = null;
      this.rows = [];
      this.lanes = [];
      this.enemies = [];
      this.fish = [];
      this.bear = null;
      this.preview();
    }

    preview() {
      this.level = C.startingLevel(this.gameMode);
      this.blocks = 0;
      this.beginLife();
    }

    loadArctic() {
      const arctic = W.create(this.level, this.round);
      this.rows = arctic.rows;
      this.lanes = arctic.lanes;
      this.enemies = arctic.enemies;
      this.fish = arctic.fish;
      this.bear = arctic.bear;
    }

    capture() {
      return { score: this.score, lives: this.lives, level: this.level, blocks: this.blocks };
    }

    restore(builder) {
      this.score = builder.score;
      this.lives = builder.lives;
      this.level = builder.level;
      this.blocks = builder.blocks;
    }

    get reserves() {
      return clamp(this.lives - 1, 0, T.maxLives - 1);
    }

    get architect() {
      return this.score >= T.architectScore;
    }

    displayedDegrees() {
      return Math.max(0, Math.ceil(this.degrees - 1e-9));
    }

    doorOpen() {
      return this.blocks >= T.blocksNeeded;
    }

    inDoor() {
      return this.x >= T.doorMin && this.x <= T.doorMax;
    }

    inHideout() {
      return this.lane === 0 && !this.jump && this.x <= T.hideout;
    }

    onIce() {
      return this.lane >= 1 && this.lane <= 4 && !this.jump;
    }

    rowOf(lane) {
      return this.rows[lane - 1];
    }

    pieces(row) {
      return W.pieces(row);
    }

    supported(row, x) {
      return W.supportAt(row, x == null ? this.x : x);
    }

    surface(lane) {
      return C.LANES[lane].feet;
    }

    footY() {
      if (!this.jump) return this.surface(this.lane);
      const table = this.jump.to > this.jump.from ? HOP_DOWN : HOP_UP;
      const frame = clamp(this.jump.t / FRAME, 0, table.length - 1);
      const low = Math.floor(frame);
      const high = Math.min(table.length - 1, low + 1);
      const rise = table[low] + (table[high] - table[low]) * (frame - low);
      return this.surface(this.jump.from) + rise;
    }

    start() {
      this.player = 0;
      this.level = C.startingLevel(this.gameMode);
      this.score = 0;
      this.lives = T.startLives;
      this.reason = '';
      this.lastBonus = 0;
      this.blocks = 0;
      this.round = 0;
      this.players = [this.capture()];
      if (C.twoPlayers(this.gameMode)) this.players.push(this.capture());
      this.beginLevel();
      this.phase = 'ready';
      this.readyTimer = T.readyTime;
      this.audio.stop();
    }

    beginLevel() {
      this.blocks = 0;
      this.beginLife();
    }

    // A new life keeps the igloo; the temperature, the floes and the creatures start over.
    beginLife() {
      this.round += 1;
      this.degrees = C.startDegrees(this.level);
      this.chill = 0;
      this.hold = T.floeHold;
      this.breath = 0;
      this.lane = 0;
      this.x = T.startX;
      this.facing = 1;
      this.jump = null;
      this.walkClock = 0;
      this.pushedBy = null;
      this.death = null;
      this.clear = null;
      this.magicFish = this.level >= T.magicFishLevel;
      this.loadArctic();
    }

    action(action) {
      if (action === 'start') {
        if (this.phase === 'title' || this.phase === 'gameover') this.start();
        else if (this.phase === 'ready') this.phase = 'playing';
        else this.togglePause();
      } else if (action === 'pause') this.togglePause();
      else if (action === 'reset') this.start();
      else if (action === 'difficulty') this.expertLever = !this.expertLever;
      else if (action === 'select' || /^select[1-4]$/.test(action)) {
        if (action === 'select') this.gameMode = this.gameMode % 4 + 1;
        else this.gameMode = Number(action.slice(6));
        this.start();
      }
    }

    togglePause() {
      if (this.phase === 'paused') this.phase = this.previousPhase;
      else if (this.phase === 'playing' || this.phase === 'ready' || this.phase === 'dying' || this.phase === 'clear') {
        this.previousPhase = this.phase;
        this.phase = 'paused';
        this.audio.stop();
      }
    }

    // The score rolls over at a million like the cartridge's six BCD digits.
    scorePoints(points) {
      if (!points) return;
      const before = this.score;
      const after = before + points;
      const earned = Math.floor(after / T.extraLifeEvery) - Math.floor(before / T.extraLifeEvery);
      for (let i = 0; i < earned; i++) {
        if (this.lives < T.maxLives) {
          this.lives += 1;
          this.audio.extraLife();
        }
      }
      this.score = after % T.scoreWrap;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.onScore(this.score);
      }
    }

    // Fire turns only the row underfoot. It costs a block until the igloo is complete.
    reverse() {
      if (!this.onIce()) return false;
      const complete = this.doorOpen();
      if (!complete && this.blocks <= 0) return false;
      this.rowOf(this.lane).dir *= -1;
      if (!complete) this.blocks -= 1;
      this.audio.reverse();
      return true;
    }

    die(reason) {
      if (this.phase !== 'playing') return;
      this.phase = 'dying';
      this.reason = reason;
      this.deathTimer = T.deathTime;
      this.death = {
        reason: reason,
        t: 0,
        feet: this.footY(),
        pushedBy: reason === 'mar' ? this.pushedBy : null,
        grip: reason === 'urso' && this.bear ? this.x - this.bear.x : 0,
      };
      this.lives = Math.max(0, this.lives - 1);
      this.jump = null;
      this.audio.stop();
      if (reason === 'frio') this.audio.freeze();
      else if (reason === 'urso') this.audio.caught();
      else this.audio.fall();
    }

    resumeLife() {
      this.players[this.player] = this.capture();
      let next = this.player;
      if (C.twoPlayers(this.gameMode)) {
        const other = 1 - this.player;
        if (this.players[other] && this.players[other].lives > 0) next = other;
      }
      const builder = this.players[next];
      if (!builder || builder.lives <= 0) {
        this.phase = 'gameover';
        this.death = null;
        this.clearCreatures();
        this.startArmed = false;
        this.audio.stop();
        return;
      }
      const switched = next !== this.player;
      this.player = next;
      this.restore(builder);
      this.beginLife();
      if (switched) {
        this.phase = 'ready';
        this.readyTimer = T.readyTime;
      } else this.phase = 'playing';
    }

    enterIgloo() {
      this.phase = 'clear';
      this.jump = null;
      this.lastBonus = C.enterPoints(this.level) + C.degreePoints(this.level, this.displayedDegrees());
      this.clear = { stage: 'enter', t: 0 };
      this.audio.enter();
    }

    // The tally runs at the cartridge's pace: the igloo comes down block by block, then the degrees.
    advanceClear(dt) {
      const c = this.clear;
      const F = T.clear;
      const points = 10 * C.tier(this.level);
      c.t += dt;
      for (;;) {
        if (c.stage === 'enter' || c.stage === 'pause' || c.stage === 'gap') {
          const wait = F[c.stage] * FRAME;
          if (c.t < wait) return;
          c.t -= wait;
          c.stage = c.stage === 'enter' ? 'pause' : c.stage === 'pause' ? 'blocks' : 'degrees';
        } else if (c.stage === 'blocks') {
          if (this.blocks <= 0) {
            c.stage = 'gap';
            continue;
          }
          if (c.t < F.block * FRAME) return;
          c.t -= F.block * FRAME;
          this.blocks -= 1;
          this.scorePoints(points);
          this.audio.tally(this.blocks);
        } else if (c.stage === 'degrees') {
          if (this.degrees <= 0) {
            c.stage = 'tail';
            continue;
          }
          if (c.t < F.degree * FRAME) return;
          c.t -= F.degree * FRAME;
          this.degrees -= 1;
          this.scorePoints(points);
          this.audio.degree(this.degrees);
        } else {
          if (c.t < F.tail * FRAME) return;
          this.nextLevel();
          return;
        }
      }
    }

    nextLevel() {
      this.level += 1;
      this.beginLevel();
      this.phase = 'playing';
      this.players[this.player] = this.capture();
    }

    // UP heads for the shore (lane - 1), DOWN for the open sea (lane + 1).
    startJump(step) {
      const next = this.lane + step;
      if (next < 0 || next > 4) return false;
      this.pushedBy = null;
      this.jump = { from: this.lane, to: next, t: 0, duration: T.jumpTime };
      this.audio.jump();
      return true;
    }

    // Lands score once per white row; blocks stop at 16 but the points keep coming.
    land() {
      const lane = this.jump.to;
      this.lane = lane;
      this.jump = null;
      if (lane === 0) {
        this.x = clamp(this.x, T.shoreEdge, C.W - 4);
        return;
      }
      const row = this.rowOf(lane);
      if (!this.supported(row)) {
        this.die('mar');
        return;
      }
      if (!row.white) return;
      row.white = false;
      this.scorePoints(C.icePoints(this.level));
      if (this.blocks < T.blocksNeeded) {
        this.blocks += 1;
        if (this.blocks === T.blocksNeeded) this.audio.door();
        else this.audio.block();
      } else this.audio.block();
      if (this.blocks < T.blocksNeeded && this.rows.every((item) => !item.white)) {
        for (let i = 0; i < this.rows.length; i++) this.rows[i].white = true;
      }
    }

    // The single floe path: rows drift together and breathing floes open and close.
    drift(dt) {
      if (dt > 0) this.breath += dt;
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        row.shift = row.dir * row.speed * dt;
        row.offset = W.wrap(row.offset + row.shift);
        row.gap = W.breathGap(row.shape, this.breath);
      }
    }

    creaturesIn(row) {
      return this.enemies.some((item) => item.row === row) || this.fish.some((item) => item.row === row);
    }

    spawnGroup(row, kind, x, dir, count) {
      const lane = this.lanes[row];
      const group = W.spawnGroup(lane, this.level, kind, dir, count);
      if (x != null) {
        const lead = group[0].x;
        for (let i = 0; i < group.length; i++) group[i].x += x - lead;
      }
      const bucket = group[0].type === 'fish' ? this.fish : this.enemies;
      for (let i = 0; i < group.length; i++) bucket.push(group[i]);
      return group;
    }

    clearCreatures() {
      this.enemies.length = 0;
      this.fish.length = 0;
      for (let i = 0; i < this.lanes.length; i++) this.lanes[i].wait = Infinity;
    }

    // Groups cross from edge to edge. Crabs and clams stop and go from level 6.
    moveCreatures(dt) {
      const stopGo = this.level >= T.stopGoFrom;
      for (let i = 0; i < this.lanes.length; i++) {
        const lane = this.lanes[i];
        lane.goClock += dt;
        while (lane.goClock >= T.stopGoTime) {
          lane.goClock -= T.stopGoTime;
          lane.go = !lane.go;
        }
      }
      const move = (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const creature = list[i];
          const lane = this.lanes[creature.row];
          creature.moving = !(stopGo && (creature.type === 'crab' || creature.type === 'clam') && lane && !lane.go);
          if (creature.moving) creature.x += creature.dir * creature.speed * dt;
          if (W.offscreen(creature)) list.splice(i, 1);
        }
      };
      move(this.enemies);
      move(this.fish);
      for (let i = 0; i < this.lanes.length; i++) {
        const lane = this.lanes[i];
        if (this.creaturesIn(i)) continue;
        lane.wait -= dt;
        if (lane.wait > 0) continue;
        this.spawnGroup(i);
        lane.wait = W.nextWait(lane);
      }
    }

    // The bear walks toward Bailey, overshooting by the slack before it turns, and backs off to
    // bearMinX while Bailey is in the hideout.
    moveBear(dt) {
      const bear = this.bear;
      if (!bear) return;
      if (bear.idle > 0) {
        bear.idle = Math.max(0, bear.idle - dt);
        return;
      }
      const low = this.inHideout() ? T.bearMinX : T.bearEdge;
      let next;
      if (bear.x < low) {
        next = Math.min(low, bear.x + bear.speed * dt);
        bear.dir = next < low ? 1 : -1;
      } else {
        if (bear.dir < 0 && this.x > bear.x + T.bearSlack) bear.dir = 1;
        else if (bear.dir > 0 && this.x < bear.x - T.bearSlack) bear.dir = -1;
        next = clamp(bear.x + bear.dir * bear.speed * dt, low, T.bearMaxX);
      }
      if (next !== bear.x) bear.walk += dt;
      bear.x = next;
    }

    bearHit() {
      if (!this.bear || this.lane !== 0 || this.jump || this.inHideout()) return false;
      return Math.abs(this.x - this.bear.x) < T.bearReach;
    }

    // Creatures never wrap, and one still off-screen cannot reach Bailey.
    visible(creature) {
      return creature.x >= 0 && creature.x < C.W;
    }

    // A moving creature carries Bailey along at its own speed, a few pixels ahead of it.
    pushByCreatures(row) {
      let pushed = null;
      for (let i = 0; i < this.enemies.length; i++) {
        const creature = this.enemies[i];
        if (creature.row !== row || !creature.moving || !this.visible(creature)) continue;
        const ahead = (this.x - creature.x) * creature.dir;
        if (ahead < 0 || ahead >= T.creatureReach) continue;
        if (ahead < T.pushGap) this.x = bound(this.x, creature.x + creature.dir * T.pushGap, T.iceMin, T.iceMax);
        pushed = creature.type;
      }
      this.pushedBy = pushed;
    }

    collectFish(row) {
      for (let i = this.fish.length - 1; i >= 0; i--) {
        const fish = this.fish[i];
        if (fish.row !== row || !this.visible(fish) || Math.abs(this.x - fish.x) >= T.creatureReach) continue;
        this.fish.splice(i, 1);
        this.scorePoints(T.fishScore);
        this.audio.fish();
      }
    }

    step(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0 || this.phase === 'paused') return;
      while (dt > 1e-8) {
        const part = Math.min(dt, 1 / 120);
        this.advance(part, input);
        dt -= part;
      }
    }

    advance(dt, input) {
      this.time += dt;
      if (this.phase === 'title' || this.phase === 'gameover') {
        this.drift(dt);
        if (!input.fire) this.startArmed = true;
        if (input.fire && this.startArmed) {
          this.start();
          this.fireLatch = true;
        }
      }
      if (this.phase === 'ready') {
        this.readyTimer -= dt;
        // The press that started the game is still latched, so only a fresh command leaves the wait.
        const fresh = controls.some((key) => input[key] && (key !== 'fire' || !this.fireLatch));
        if (fresh || this.readyTimer <= 0) {
          this.phase = 'playing';
          if (input.fire) this.fireLatch = true;
        }
      }
      if (this.phase === 'dying') this.advanceDying(dt);
      else if (this.phase === 'clear') this.advanceClear(dt);
      else if (this.phase === 'playing') this.advancePlaying(dt, input);
      this.fireLatch = !!input.fire;
    }

    advanceDying(dt) {
      const death = this.death;
      if (death) {
        death.t += dt;
        // The bear drags Bailey off the left edge of the screen.
        if (death.reason === 'urso' && this.bear && this.x > 4) {
          this.bear.dir = -1;
          this.bear.walk += dt;
          this.bear.x -= Math.max(this.bear.speed, T.walkSpeed) * dt;
          this.x = Math.max(4, this.bear.x + death.grip);
        }
      }
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.resumeLife();
    }

    advancePlaying(dt, input) {
      this.chill += dt;
      while (this.chill >= T.degreeTime) {
        this.chill -= T.degreeTime;
        this.degrees -= 1;
      }
      if (this.degrees <= 0) {
        this.degrees = 0;
        this.die('frio');
        return;
      }

      // While the floes hold at the start of a level or life the cartridge ignores the joystick.
      const still = this.hold > 0;
      this.hold = Math.max(0, this.hold - dt);
      this.drift(still ? 0 : dt);
      if (!still) this.moveCreatures(dt);
      this.moveBear(dt);
      if (still) {
        if (this.bearHit()) this.die('urso');
        return;
      }

      const direction = Number(!!input.right) - Number(!!input.left);
      if (direction) this.facing = direction;

      if (this.jump) {
        const target = this.x + direction * C.airSpeed(this.level) * dt;
        this.x = this.jump.to === 0 ? clamp(target, T.shoreEdge, C.W - 4) : bound(this.x, target, T.iceMin, T.iceMax);
        this.jump.t += dt;
        if (this.jump.t >= this.jump.duration) this.land();
        return;
      }

      if (direction) this.walkClock += dt;
      if (this.lane === 0) {
        this.x = bound(this.x, this.x + direction * T.walkSpeed * dt, T.shoreMin, T.shoreMax);
        if (this.bearHit()) {
          this.die('urso');
          return;
        }
        if (input.up && this.doorOpen() && this.inDoor()) {
          this.enterIgloo();
          return;
        }
        if (input.down) this.startJump(1);
        return;
      }

      // Ice rows wrap but Bailey does not: at an edge he stays put while the floe slides on.
      const row = this.rowOf(this.lane);
      this.x = bound(this.x, this.x + row.shift + direction * T.walkSpeed * dt, T.iceMin, T.iceMax);
      this.pushByCreatures(row.index);
      this.collectFish(row.index);
      if (!this.supported(row)) {
        this.die('mar');
        return;
      }
      if (input.fire && !this.fireLatch) this.reverse();
      if (input.up) this.startJump(-1);
      else if (input.down) this.startJump(1);
    }
  }

  FB.Game = Game;
  FB.modeLabel = modeLabel;
  FB.cardLines = cardLines;

  FB.boot = function () {
    const canvas = document.getElementById('screen');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const frame = document.createElement('canvas');
    frame.width = C.W;
    frame.height = C.H;
    const g = frame.getContext('2d', { alpha: false });
    const game = new Game({ audio: FB.Audio, onScore: saveRecord });
    FB.game = game;
    let muted = false;
    let monochrome = false;
    let last = null;
    let statusText = '';
    let architectShown = null;
    let record = 0;
    try { record = Number(localStorage.getItem('frostbite2600.highScore')) || 0; } catch (_) { /* Storage is optional. */ }
    game.highScore = record;

    function saveRecord(score) {
      try { localStorage.setItem('frostbite2600.highScore', String(score)); } catch (_) { /* Private browsing can deny storage. */ }
    }

    function label(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function action(type) {
      FB.Audio.unlock();
      if (type === 'mute') {
        muted = !muted;
        FB.Audio.setMuted(muted);
        label('mute-state', muted ? 'Som desligado' : 'Som ligado');
        const button = document.querySelector('[data-action="mute"]');
        if (button) button.setAttribute('aria-pressed', String(muted));
      } else if (type === 'color') {
        monochrome = !monochrome;
        canvas.classList.toggle('bw', monochrome);
        label('tv-state', monochrome ? 'TV em preto e branco' : 'TV colorida');
        const button = document.querySelector('[data-switch="tv"]');
        if (button) button.setAttribute('aria-pressed', String(monochrome));
      } else if (type === 'fullscreen') {
        toggleFullscreen();
      } else {
        game.action(type);
        label('diff-state', game.expertLever ? 'Alavanca A · sem efeito no cartucho' : 'Alavanca B · sem efeito no cartucho');
        label('game-state', modeLabel(game.gameMode));
        const button = document.querySelector('[data-switch="difficulty"]');
        if (button) button.setAttribute('aria-pressed', String(game.expertLever));
      }
      syncStatus();
    }
    // The stage holds the television and the touch pad, so a phone keeps its controls. Older Safari
    // only has the webkit-prefixed API, and the iPhone has neither, so the button hides there.
    const stage = document.querySelector('.stage');
    const requestFull = stage && (stage.requestFullscreen || stage.webkitRequestFullscreen);
    const canFullscreen = !!requestFull && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    const fullscreenButton = document.getElementById('fullscreen-button');
    if (fullscreenButton && !canFullscreen) fullscreenButton.hidden = true;

    function fullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function settle(result) {
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }

    function toggleFullscreen() {
      if (!canFullscreen) return;
      try {
        if (fullscreenElement()) settle((document.exitFullscreen || document.webkitExitFullscreen).call(document));
        else settle(requestFull.call(stage));
      } catch (_) { /* The browser can refuse fullscreen. */ }
    }

    function markFullscreen() {
      if (stage) stage.classList.toggle('full', fullscreenElement() === stage);
    }
    document.addEventListener('fullscreenchange', markFullscreen);
    document.addEventListener('webkitfullscreenchange', markFullscreen);

    FB.Input.init(action);

    function pauseOnLeave() {
      FB.Input.clear();
      if (game.phase === 'playing' || game.phase === 'ready' || game.phase === 'dying' || game.phase === 'clear') game.togglePause();
      FB.Audio.stop();
      last = null;
      syncStatus();
    }
    window.addEventListener('blur', pauseOnLeave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnLeave(); });

    function deathMessage() {
      if (game.reason === 'frio') return 'A temperatura chegou a zero e Frostbite Bailey congelou.';
      if (game.reason === 'urso') return 'O urso polar arrastou Frostbite Bailey para fora da tela.';
      const pushedBy = game.death && game.death.pushedBy;
      if (pushedBy) {
        const names = { goose: 'Um ganso', crab: 'Um caranguejo', clam: 'Um marisco' };
        return `${names[pushedBy] || 'Uma criatura'} empurrou Frostbite Bailey para o mar Ártico.`;
      }
      return 'Frostbite Bailey caiu no mar Ártico.';
    }

    function touchScreen() {
      return document.body.classList.contains('touch');
    }

    function syncStatus() {
      const touch = touchScreen();
      const messages = {
        title: touch ? 'Toque na tela ou no botão vermelho para começar a construir.' : 'Aperte Enter ou o botão vermelho para começar a construir.',
        ready: `Jogador ${game.player + 1}. Mova o joystick para começar; o gelo parte logo depois.`,
        playing: game.doorOpen() ? `Jogador ${game.player + 1}: o iglu está pronto. Pare diante da porta e empurre para cima.` : `Jogador ${game.player + 1} no gelo. A temperatura está caindo.`,
        paused: touch ? 'Jogo pausado. Toque na tela, no botão vermelho ou em CONTINUAR para voltar ao gelo.' : 'Jogo pausado. Aperte P ou CONTINUAR para voltar ao gelo.',
        clear: `Bailey entrou no iglu. Bônus de ${game.lastBonus} pontos.`,
        dying: deathMessage(),
        gameover: `Fim de jogo. Recorde: ${game.highScore}. ${touch ? 'Toque na tela ou no botão vermelho' : 'Aperte Enter ou o botão vermelho'} para tentar de novo.`,
      };
      if (statusText !== messages[game.phase]) {
        statusText = messages[game.phase];
        label('status', statusText);
      }
      const pauseLabel = document.getElementById('pause-label');
      if (pauseLabel) pauseLabel.textContent = game.phase === 'paused' ? 'CONTINUAR' : 'PAUSA';
      const pause = document.getElementById('pause-button');
      if (pause) {
        pause.disabled = game.phase === 'title' || game.phase === 'gameover';
        pause.setAttribute('aria-pressed', String(game.phase === 'paused'));
      }
      // During play Enter pauses, so the restart button shows R, the key that restarts.
      const startLabel = document.getElementById('start-label');
      const starting = game.phase === 'title' || game.phase === 'gameover';
      const resetting = !starting && game.phase !== 'ready';
      if (startLabel) startLabel.textContent = starting ? 'COMEÇAR' : resetting ? 'REINICIAR' : 'JOGAR';
      const startKey = document.getElementById('start-key');
      if (startKey && startKey.textContent !== (resetting ? 'R' : 'ENTER')) startKey.textContent = resetting ? 'R' : 'ENTER';
      const start = document.getElementById('start-button');
      if (start) start.setAttribute('data-action', resetting ? 'reset' : 'start');
      const architect = game.architect;
      if (architect !== architectShown) {
        architectShown = architect;
        const note = document.getElementById('architect-state');
        if (note) note.hidden = !architect;
      }
    }

    function fill(color, x, y, w, h) {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    }

    // Draws a bitmap from its top-left corner; rows below `clip` stay hidden under the water.
    function sprite(rows, left, top, colors, clip) {
      if (!rows) return;
      for (let row = 0; row < rows.length; row++) {
        const y = top + row;
        if (clip != null && y > clip) break;
        const line = rows[row];
        for (let col = 0; col < line.length; col++) {
          const pixel = line[col];
          if (pixel === '.') continue;
          g.fillStyle = colors[pixel] || colors.default;
          g.fillRect(left + col, y, 1, 1);
        }
      }
    }

    // Entities on the ice wrap at 160 px, so a second copy covers the seam.
    function wrapped(draw, left, width) {
      draw(left);
      if (left < 0) draw(left + C.W);
      if (left + width > C.W) draw(left - C.W);
    }

    function text(value, x, y, color, centered) {
      const font = FB.Font;
      value = String(value).toUpperCase();
      const width = value.length * 6 - 1;
      if (centered) x = Math.round(x - width / 2);
      g.fillStyle = color;
      for (let i = 0; i < value.length; i++) {
        const glyph = font[value[i]] || font[' '];
        const rows = glyph.rows || glyph;
        const top = y + (glyph.top || 0);
        for (let row = 0; row < rows.length; row++) {
          for (let col = 0; col < rows[row].length; col++) {
            if (rows[row][col] === '1') g.fillRect(x + col, top + row, 1, 1);
          }
        }
        x += 6;
      }
    }

    function digit(value, x, y, color) {
      sprite(S.digits[value], x, y, { default: color });
    }

    function shimmer(line, tick) {
      let h = Math.imul(line + 1, 374761393) ^ Math.imul(tick + 7, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h >>> 16) & 1;
    }

    function drawScenery(colors) {
      fill('#000000', 0, 0, C.W, C.H);
      fill(colors.sky, 0, 0, C.W, L.hud);
      const tick = Math.floor(game.time * 60 / 8);
      for (let i = 0; i < colors.horizon.length; i++) {
        fill(colors.horizon[i][shimmer(i, tick)], 0, L.horizon + i, C.W, 1);
      }
      fill(colors.shore, 0, L.shoreTop, C.W, L.shoreBottom - L.shoreTop);
      fill(colors.water, 0, L.waterTop, C.W, L.waterBottom - L.waterTop);
    }

    function drawIgloo(colors) {
      const count = Math.min(game.blocks, T.blocksNeeded - 1);
      for (let i = 0; i < count; i++) {
        const block = S.iglooBlocks[i];
        fill(colors.igloo, L.iglooX + block[0], L.iglooY + block[1], block[2], block[3]);
      }
      if (game.blocks >= T.blocksNeeded) {
        for (let i = 0; i < S.iglooDoor.length; i++) {
          const door = S.iglooDoor[i];
          fill(colors.door, L.iglooX + door[0], L.iglooY + door[1], door[2], door[3]);
        }
      }
    }

    function drawFloes(colors) {
      for (let i = 0; i < game.rows.length; i++) {
        const row = game.rows[i];
        const lane = C.LANES[i + 1];
        const color = row.white ? colors.ice : colors.iceUsed;
        const list = W.pieces(row);
        for (let p = 0; p < list.length; p++) {
          const piece = list[p];
          for (let k = 0; k < W.SLANT.length; k++) {
            const left = Math.round(piece.x + W.SLANT[k]);
            wrapped((x) => fill(color, x, lane.top + k, piece.w, 1), left, piece.w);
          }
        }
      }
    }

    function drawCreature(creature, colors) {
      const lane = C.LANES[creature.row + 1];
      const left = Math.round(creature.x - 4);
      const beat = Math.floor((game.time + creature.phase) * 60 / 8);
      if (creature.type === 'goose') {
        const frames = creature.dir < 0 ? S.gooseLeft : S.gooseFrames;
        sprite(frames[beat % 2], left, lane.water - 7, { default: colors.goose });
        return;
      }
      let rows;
      let color;
      if (creature.type === 'crab') {
        rows = S.crabFrames[beat % 2];
        color = colors.crab;
      } else if (creature.type === 'clam') {
        rows = (creature.dir > 0 ? S.clamRight : S.clamFrames)[Math.floor(beat / 2) % 2];
        color = colors.clam;
      } else {
        rows = (creature.dir > 0 ? S.fishRight : S.fishFrames)[beat % 2];
        color = colors.fish;
      }
      // Sea creatures bob, sinking a few lines below the waterline and rising again.
      const bob = Math.round(2 - 2 * Math.cos((game.time * 60 / 64 + creature.phase) * Math.PI * 2));
      sprite(rows, left, lane.water - rows.length + 1 + bob, { default: color }, lane.water);
    }

    function drawBear(colors) {
      const bear = game.bear;
      if (!bear) return;
      const frames = bear.dir < 0 ? S.bearFrames : S.bearRight;
      const rows = frames[Math.floor(bear.walk * 60 / 8) % 2];
      sprite(rows, Math.round(bear.x - 7), C.LANES[0].feet - rows.length + 1, { default: colors.bear });
    }

    function baileyInks(colors) {
      return { h: colors.hat, f: colors.face, c: game.player === 1 ? colors.player2 : colors.coat, d: colors.boots };
    }

    // A paused game draws the scene it paused in.
    function shownPhase() {
      return game.phase === 'paused' ? game.previousPhase : game.phase;
    }

    function baileyRows() {
      const left = game.facing < 0;
      if (game.jump && game.jump.t < 14 * FRAME) return left ? S.baileyJumpLeft : S.baileyJump;
      const stepping = !game.jump && shownPhase() === 'playing' && Math.floor(game.walkClock / T.walkFrame) % 2 === 1;
      if (stepping) return left ? S.baileyWalkLeft : S.baileyWalk;
      return left ? S.baileyLeft : S.bailey;
    }

    function drawBailey(colors) {
      if (game.phase === 'gameover') return;
      const inks = baileyInks(colors);
      const icy = game.lane > 0 || (game.jump && game.jump.to > 0);
      const phase = shownPhase();
      if (phase === 'clear') {
        const c = game.clear;
        if (!c || c.stage !== 'enter') return;
        const rise = Math.round(c.t / (T.clear.enter * FRAME) * 27);
        const rows = S.bailey;
        sprite(rows, Math.round(game.x - 4), C.LANES[0].feet - rows.length + 1 - rise, inks);
        return;
      }
      if (phase === 'dying' && game.death) {
        const death = game.death;
        const rows = game.facing < 0 ? S.baileyLeft : S.bailey;
        const feet = Math.round(death.feet);
        const left = Math.round(game.x - 4);
        if (death.reason === 'mar') {
          const sink = Math.floor(death.t * 60 / 3);
          if (sink >= rows.length) return;
          wrapped((x) => sprite(rows, x, feet - rows.length + 1 + sink, inks, feet), left, 8);
        } else if (death.reason === 'frio') {
          const frozen = Math.min(rows.length, Math.floor(death.t * 60 / 85 * rows.length));
          const iced = rows.map((line, index) => {
            const fromBottom = rows.length - 1 - index;
            if (fromBottom >= frozen) return line;
            const band = Math.min(3, Math.floor(fromBottom / (rows.length / 4)));
            return line.replace(/[^.]/g, String(band));
          });
          const inksFrozen = Object.assign({}, inks, { 0: colors.frozen[0], 1: colors.frozen[1], 2: colors.frozen[2], 3: colors.frozen[3] });
          wrapped((x) => sprite(iced, x, feet - rows.length + 1, inksFrozen), left, 8);
        } else {
          sprite(S.baileyJumpLeft, left, feet - S.baileyJumpLeft.length + 1, inks);
        }
        return;
      }
      const rows = baileyRows();
      const left = Math.round(game.x - 4);
      const top = Math.round(game.footY()) - rows.length + 1;
      if (icy) wrapped((x) => sprite(rows, x, top, inks), left, 8);
      else sprite(rows, left, top, inks);
    }

    function drawHud(colors) {
      const score = String(game.score);
      for (let i = 0; i < score.length; i++) {
        digit(score[i], L.scoreX + 8 * (6 - score.length + i), L.scoreY, colors.ink);
      }
      const degrees = game.displayedDegrees();
      if (degrees >= 10) digit(String(Math.floor(degrees / 10) % 10), L.scoreX, L.lineY, colors.ink);
      digit(String(degrees % 10), L.scoreX + 8, L.lineY, colors.ink);
      sprite(S.degree, L.scoreX + 15, L.lineY, { default: colors.ink });
      if (game.magicFish) sprite(S.magic, L.scoreX + 23, L.lineY, { default: colors.ink });
      if (game.reserves > 0) digit(String(game.reserves), L.scoreX + 40, L.lineY, colors.ink);
    }

    function drawCard(colors) {
      const lines = cardLines(game, touchScreen());
      if (!lines) return;
      const height = lines.length * 12 + 8;
      const top = 124 - Math.round(height / 2);
      fill(colors.card, 18, top, 124, height);
      for (let i = 0; i < lines.length; i++) {
        text(lines[i], 80, top + 6 + i * 12, i === 0 ? colors.text : i === 2 ? colors.textDim : '#D6D6D6', true);
      }
    }

    function render() {
      const colors = C.palette(game.level);
      drawScenery(colors);
      drawIgloo(colors);
      fill('#000000', 0, L.shoreBottom, C.W, 1);
      drawFloes(colors);
      for (let i = 0; i < game.fish.length; i++) drawCreature(game.fish[i], colors);
      for (let i = 0; i < game.enemies.length; i++) drawCreature(game.enemies[i], colors);
      if (game.phase !== 'gameover') drawBear(colors);
      drawBailey(colors);
      drawHud(colors);
      // Activision cartridges blank the first 8 columns of every line (the HMOVE comb).
      fill('#000000', 0, 0, T.hmove, L.waterBottom);
      sprite(S.signature, 20, L.signatureTop, colors.signature);
      drawCard(colors);

      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(160, Math.round(rect.width * ratio));
      const height = Math.max(192, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, 0, 0, width, height);
      if (height >= C.H * 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        for (let y = 0; y < C.H; y++) ctx.fillRect(0, Math.floor((y + 1) * height / C.H) - 1, width, 1);
      }
    }

    // The next frame is booked first, so one exception cannot stop the game for good.
    function tick(timestamp) {
      requestAnimationFrame(tick);
      const input = FB.Input.poll();
      if (controls.some((key) => input[key])) FB.Audio.unlock();
      if (last !== null) game.step(Math.min((timestamp - last) / 1000, 0.06), input);
      last = timestamp;
      syncStatus();
      render();
    }

    label('game-state', modeLabel(game.gameMode));
    label('diff-state', 'Alavanca B · sem efeito no cartucho');
    label('tv-state', 'TV colorida');
    label('mute-state', 'Som ligado');
    syncStatus();
    render();
    requestAnimationFrame(tick);
  };
})(window.FB);

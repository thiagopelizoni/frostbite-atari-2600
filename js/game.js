window.FB = window.FB || {};

(function (FB) {
  'use strict';

  const C = FB.Config;
  const T = C.TUNE;
  const W = FB.World;
  const silent = new Proxy({}, { get: () => () => {} });
  const controls = ['left', 'right', 'up', 'down', 'fire'];

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function modeLabel(mode) {
    const advanced = mode >= 3;
    const pair = C.twoPlayers(mode);
    return `Jogo ${mode} · ${advanced ? 'avançado' : 'regular'}, ${pair ? 'dois jogadores' : 'um jogador'}`;
  }

  // The simulation never touches the DOM. Coordinates are Atari pixels.
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
      this.banner = '';
      this.lastBonus = 0;
      this.magicFish = false;
      this.badge = false;
      this.level = 1;
      this.score = 0;
      this.lives = T.startLives;
      this.nextExtraLife = T.extraLifeEvery;
      this.blocks = 0;
      this.degrees = C.startDegrees(1);
      this.lane = 0;
      this.x = T.startX;
      this.facing = 1;
      this.jump = null;
      this.hopLock = 0;
      this.fireLatch = false;
      this.clearTimer = 0;
      this.deathTimer = 0;
      this.rows = [];
      this.enemies = [];
      this.fish = [];
      this.bear = null;
      this.preview();
    }

    preview() {
      this.level = C.startingLevel(this.gameMode);
      this.blocks = 0;
      this.degrees = C.startDegrees(this.level);
      this.lane = 0;
      this.x = 36;
      this.facing = 1;
      this.jump = null;
      this.loadArctic();
    }

    loadArctic() {
      const arctic = W.create(this.level);
      this.rows = arctic.rows;
      this.enemies = arctic.enemies;
      this.fish = arctic.fish;
      this.bear = arctic.bear;
    }

    capture() {
      return {
        score: this.score,
        lives: this.lives,
        level: this.level,
        nextExtraLife: this.nextExtraLife,
      };
    }

    displayedDegrees() {
      return Math.max(0, Math.ceil(this.degrees - 1e-9));
    }

    doorOpen() {
      return this.blocks >= T.blocksNeeded;
    }

    inDoor() {
      return this.x >= T.doorX && this.x <= T.doorX + T.doorW;
    }

    inHideout() {
      return this.lane === 5 && this.x <= T.hideout;
    }

    onIce() {
      return this.lane >= 1 && this.lane <= 4;
    }

    rowOf(lane) {
      return this.rows[lane - 1];
    }

    pieces(row) {
      return W.segments(row.pattern, row.offset);
    }

    supported(row, x, half) {
      return W.feetOn(this.pieces(row), x, half == null ? T.half : half);
    }

    surface(lane) {
      const spec = C.LANES[lane];
      // The upper bank is drawn under the score, so Bailey stands on its lower edge.
      if (lane === 5) return spec.top + spec.height - 2;
      return spec.top;
    }

    footY() {
      if (!this.jump) return this.surface(this.lane);
      const from = this.surface(this.jump.from);
      const to = this.surface(this.jump.to);
      const u = clamp(this.jump.t / this.jump.duration, 0, 1);
      return from + (to - from) * u - Math.sin(u * Math.PI) * 8;
    }

    start() {
      this.player = 0;
      this.level = C.startingLevel(this.gameMode);
      this.score = 0;
      this.lives = T.startLives;
      this.nextExtraLife = T.extraLifeEvery;
      this.magicFish = false;
      this.badge = false;
      this.reason = '';
      this.banner = '';
      this.lastBonus = 0;
      this.players = [this.capture()];
      if (C.twoPlayers(this.gameMode)) this.players.push(this.capture());
      this.beginRound();
      this.phase = 'ready';
      this.audio.stop();
    }

    beginRound() {
      this.blocks = 0;
      this.degrees = C.startDegrees(this.level);
      this.lane = 0;
      this.x = T.startX;
      this.facing = 1;
      this.jump = null;
      this.hopLock = 0;
      this.fireLatch = false;
      this.badge = this.level > 20;
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

    scorePoints(points) {
      if (!points) return;
      this.score = Math.min(T.scoreCap, this.score + points);
      while (this.score >= this.nextExtraLife) {
        this.nextExtraLife += T.extraLifeEvery;
        if (this.lives < T.maxLives) {
          this.lives += 1;
          this.audio.extraLife();
        }
      }
      if (this.score >= T.magicFishScore) this.magicFish = true;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.onScore(this.score);
      }
    }

    addBlock() {
      if (this.blocks >= T.blocksNeeded) return;
      this.blocks += 1;
      this.scorePoints(C.icePoints(this.level));
      this.audio.block();
      if (this.blocks === T.blocksNeeded) this.audio.door();
    }

    reverse() {
      let acted = false;
      if (this.onIce()) {
        this.rowOf(this.lane).dir *= -1;
        acted = true;
      }
      if (this.bear) {
        this.bear.dir *= -1;
        acted = true;
      }
      if (!acted) return;
      if (this.blocks > 0 && this.blocks < T.blocksNeeded) this.blocks -= 1;
      this.audio.reverse();
    }

    die(reason) {
      if (this.phase !== 'playing') return;
      this.phase = 'dying';
      this.reason = reason;
      this.deathTimer = T.deathTime;
      this.lives = Math.max(0, this.lives - 1);
      this.jump = null;
      this.audio.stop();
      if (reason === 'frio') this.audio.freeze();
      else if (reason === 'urso') this.audio.caught();
      else this.audio.fall();
    }

    resumeLife() {
      this.players[this.player] = this.capture();
      if (C.twoPlayers(this.gameMode)) {
        const other = 1 - this.player;
        if (this.players[other] && this.players[other].lives > 0) this.player = other;
      }
      const builder = this.players[this.player];
      if (!builder || builder.lives <= 0) {
        this.phase = 'gameover';
        this.startArmed = false;
        this.audio.stop();
        return;
      }
      this.score = builder.score;
      this.lives = builder.lives;
      this.level = builder.level;
      this.nextExtraLife = builder.nextExtraLife;
      this.magicFish = this.score >= T.magicFishScore;
      this.beginRound();
      this.phase = 'ready';
    }

    finishLevel() {
      const shown = this.displayedDegrees();
      const bonus = C.enterPoints(this.level) + C.degreePoints(this.level, shown);
      this.lastBonus = bonus;
      this.banner = `BONUS ${bonus}`;
      this.scorePoints(bonus);
      this.phase = 'clear';
      this.clearTimer = T.clearTime;
      this.jump = null;
      this.audio.clear();
    }

    nextLevel() {
      this.level += 1;
      this.beginRound();
      this.phase = 'playing';
      this.players[this.player] = this.capture();
    }

    startJump(direction) {
      const next = this.lane + direction;
      if (next < 0 || next > 5) return;
      this.jump = { from: this.lane, to: next, t: 0, duration: T.jumpTime };
      this.hopLock = T.jumpTime;
      this.audio.jump();
    }

    enemyHit(rowIndex, x) {
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        if (enemy.row !== rowIndex) continue;
        if (Math.abs(W.wrapDelta(x, enemy.x)) < 8) return true;
      }
      return false;
    }

    bearHit() {
      if (!this.bear || this.lane !== 5 || this.inHideout()) return false;
      return Math.abs(this.x - this.bear.x) < 10;
    }

    tryFish() {
      if (!this.jump) return;
      const low = Math.min(this.jump.from, this.jump.to);
      const high = Math.max(this.jump.from, this.jump.to);
      for (let i = 0; i < this.fish.length; i++) {
        const fish = this.fish[i];
        if (!fish.alive || fish.gap < low || fish.gap >= high) continue;
        if (Math.abs(W.wrapDelta(this.x, fish.x)) < 9) {
          fish.alive = false;
          fish.respawn = 3.4;
          this.scorePoints(T.fishScore);
          this.audio.fish();
        }
      }
    }

    land() {
      const lane = this.lane;
      if (lane === 0 || lane === 5) {
        if (lane === 5 && this.doorOpen() && this.inDoor()) {
          this.finishLevel();
          return;
        }
        if (this.bearHit()) this.die('urso');
        return;
      }
      const row = this.rowOf(lane);
      if (!this.supported(row, this.x)) {
        this.die('mar');
        return;
      }
      if (this.enemyHit(lane - 1, this.x)) {
        this.die('criatura');
        return;
      }
      if (!row.white) return;
      row.white = false;
      this.addBlock();
      if (this.phase !== 'playing') return;
      if (this.rows.every((item) => !item.white)) {
        for (let i = 0; i < this.rows.length; i++) this.rows[i].white = true;
      }
    }

    drift(dt) {
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        row.offset = W.wrap(row.offset + row.dir * row.speed * dt);
      }
      for (let i = 0; i < this.fish.length; i++) {
        const fish = this.fish[i];
        fish.x = W.wrap(fish.x + fish.dir * fish.speed * dt);
      }
    }

    moveHazards(dt) {
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        enemy.timer += dt;
        enemy.paused = enemy.type !== 'goose' && (enemy.timer % 1.8) > 1.45;
        if (!enemy.paused) enemy.x = W.wrap(enemy.x + enemy.dir * enemy.speed * dt);
      }
      for (let i = 0; i < this.fish.length; i++) {
        const fish = this.fish[i];
        if (!fish.alive) {
          fish.respawn -= dt;
          if (fish.respawn <= 0) {
            fish.alive = true;
            fish.x = W.wrap(fish.x + 83);
          }
          continue;
        }
        fish.x = W.wrap(fish.x + fish.dir * fish.speed * dt);
      }
      if (this.bear) {
        this.bear.x += this.bear.dir * this.bear.speed * dt;
        if (this.bear.x <= T.bearMinX) {
          this.bear.x = T.bearMinX;
          this.bear.dir = 1;
        } else if (this.bear.x >= T.bearMaxX) {
          this.bear.x = T.bearMaxX;
          this.bear.dir = -1;
        }
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
        } else return;
      }
      if (this.phase === 'ready') {
        if (!controls.some((key) => input[key])) return;
        this.phase = 'playing';
        if (input.fire) this.fireLatch = true;
      }
      if (this.phase === 'dying') {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.resumeLife();
        return;
      }
      if (this.phase === 'clear') {
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) this.nextLevel();
        return;
      }
      if (this.phase !== 'playing') return;

      this.degrees -= C.degreeRate(this.level) * dt;
      if (this.degrees <= 0) {
        this.degrees = 0;
        this.die('frio');
        return;
      }

      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        row.offset = W.wrap(row.offset + row.dir * row.speed * dt);
      }
      this.moveHazards(dt);

      const direction = Number(!!input.right) - Number(!!input.left);
      if (direction) this.facing = direction;

      if (this.jump) {
        const air = T.airSpeed + (this.level - 1) * T.airPerLevel;
        this.x = W.wrap(this.x + direction * air * dt);
        this.tryFish();
        this.jump.t += dt;
        if (this.jump.t >= this.jump.duration) {
          this.lane = this.jump.to;
          this.jump = null;
          this.hopLock = (input.up || input.down) ? 1 : 0;
          this.land();
        }
      } else {
        if (this.lane === 0 || this.lane === 5) {
          this.x = clamp(this.x + direction * T.walkSpeed * dt, 4, C.W - 4);
          if (this.phase === 'playing' && this.lane === 5 && this.doorOpen() && this.inDoor()) {
            this.finishLevel();
          } else if (this.phase === 'playing' && this.bearHit()) {
            this.die('urso');
          }
        } else {
          const row = this.rowOf(this.lane);
          this.x = W.wrap(this.x + row.dir * row.speed * dt + direction * T.walkSpeed * dt);
          if (!this.supported(row, this.x)) this.die('mar');
          else if (this.enemyHit(this.lane - 1, this.x)) this.die('criatura');
        }

        if (this.phase === 'playing') {
          if (!input.up && !input.down) this.hopLock = 0;
          if (this.hopLock <= 0) {
            if (input.up) this.startJump(1);
            else if (input.down) this.startJump(-1);
          }
          if (input.fire && !this.fireLatch) this.reverse();
        }
      }

      this.fireLatch = !!input.fire;
      this.audio.chill(this.phase === 'playing' && this.displayedDegrees() <= 10);
    }
  }

  FB.Game = Game;
  FB.modeLabel = modeLabel;

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
        const tv = document.querySelector('.tv');
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else tv.requestFullscreen?.().catch(() => {});
      } else {
        game.action(type);
        label('diff-state', game.expertLever ? 'Alavanca A · sem efeito no cartucho' : 'Alavanca B · sem efeito no cartucho');
        label('game-state', modeLabel(game.gameMode));
        const button = document.querySelector('[data-switch="difficulty"]');
        if (button) button.setAttribute('aria-pressed', String(game.expertLever));
      }
      syncStatus();
    }
    FB.Input.init(action);

    function pauseOnLeave() {
      FB.Input.clear();
      if (game.phase === 'playing' || game.phase === 'dying' || game.phase === 'clear') game.togglePause();
      FB.Audio.stop();
      last = null;
      syncStatus();
    }
    window.addEventListener('blur', pauseOnLeave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnLeave(); });

    function syncStatus() {
      const cold = game.phase === 'dying' && game.reason === 'frio';
      const bear = game.phase === 'dying' && game.reason === 'urso';
      const messages = {
        title: 'Aperte Enter ou o botão vermelho para começar a construir.',
        ready: `Jogador ${game.player + 1}. Mova o joystick para saltar no gelo.`,
        playing: `Jogador ${game.player + 1} no gelo. A temperatura está caindo.`,
        paused: 'Jogo pausado. Aperte P ou CONTINUAR para voltar ao gelo.',
        clear: 'Iglu pronto. O bônus de temperatura entrou no placar.',
        dying: cold ? 'A temperatura chegou a zero.' : bear ? 'O urso expulsou Frostbite Bailey.' : 'Frostbite Bailey caiu no mar Ártico.',
        gameover: `Fim de jogo. Recorde: ${game.highScore}. Aperte Enter para tentar de novo.`,
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
      const startLabel = document.getElementById('start-label');
      const starting = game.phase === 'title' || game.phase === 'gameover';
      if (startLabel) startLabel.textContent = starting ? 'COMEÇAR' : game.phase === 'ready' ? 'SALTAR' : 'REINICIAR';
      const start = document.getElementById('start-button');
      if (start) start.setAttribute('data-action', starting || game.phase === 'ready' ? 'start' : 'reset');
    }

    function outlined(rows, x, y, colors, flip) {
      sprite(rows, x + 1, y + 1, { 1: '#10141c', 2: '#10141c', 3: '#10141c' }, flip);
      sprite(rows, x, y, colors, flip);
    }

    function sprite(rows, x, y, colors, flip) {
      if (!rows) return;
      const left = Math.round(x - rows[0].length / 2);
      const top = Math.round(y - rows.length / 2);
      for (let row = 0; row < rows.length; row++) {
        for (let col = 0; col < rows[row].length; col++) {
          const pixel = rows[row][flip ? rows[row].length - 1 - col : col];
          if (pixel === '.' || pixel === ' ' || pixel === '0') continue;
          g.fillStyle = colors[pixel] || colors[1] || '#ffffff';
          g.fillRect(left + col, top + row, 1, 1);
        }
      }
    }

    function text(value, x, y, color, scale, centered) {
      const font = FB.Font;
      value = String(value).toUpperCase();
      const size = scale || 1;
      const width = value.length * 6 * size - size;
      if (centered) x -= width / 2;
      g.fillStyle = color;
      for (let i = 0; i < value.length; i++) {
        const rows = font[value[i]] || font[' '];
        for (let row = 0; row < rows.length; row++) {
          for (let col = 0; col < rows[row].length; col++) {
            if (rows[row][col] === '1') g.fillRect(Math.round(x + col * size), y + row * size, size, size);
          }
        }
        x += 6 * size;
      }
    }

    function palette() {
      return C.palette(game.level);
    }

    function drawIgloo(colors) {
      const cell = T.iglooCell;
      for (let n = 0; n < T.blocksNeeded; n++) {
        const col = n % 4;
        const row = Math.floor(n / 4);
        const x = T.iglooX + col * cell;
        const y = T.iglooY + (3 - row) * cell;
        const built = n < game.blocks;
        const door = game.doorOpen() && row === 0 && (col === 1 || col === 2);
        if (door) {
          g.fillStyle = colors.door;
          g.fillRect(x, y, cell - 1, cell - 1);
        } else if (built) {
          g.fillStyle = colors.igloo;
          g.fillRect(x, y, cell - 1, cell - 1);
          g.fillStyle = colors.iglooEdge;
          g.fillRect(x, y + cell - 1, cell - 1, 1);
        } else {
          g.fillStyle = colors.iglooEdge;
          g.fillRect(x, y, cell - 1, 1);
          g.fillRect(x, y + cell - 2, cell - 1, 1);
          g.fillRect(x, y, 1, cell - 1);
          g.fillRect(x + cell - 2, y, 1, cell - 1);
        }
      }
    }

    function render() {
      const colors = palette();
      g.fillStyle = colors.water;
      g.fillRect(0, 0, C.W, C.H);

      const top = C.LANES[5];
      const bottom = C.LANES[0];
      g.fillStyle = colors.snow;
      g.fillRect(0, top.top, C.W, top.height);
      g.fillRect(0, bottom.top, C.W, bottom.height);
      g.fillStyle = colors.snowShadow;
      g.fillRect(0, top.top + top.height - 2, C.W, 2);
      g.fillRect(0, bottom.top, C.W, 2);
      g.fillStyle = colors.alcove;
      g.fillRect(0, top.top + 12, 30, top.height - 12);

      for (let i = 0; i < game.rows.length; i++) {
        const row = game.rows[i];
        const lane = C.LANES[i + 1];
        const pieces = W.segments(row.pattern, row.offset);
        g.fillStyle = row.white ? colors.ice : colors.iceUsed;
        for (let p = 0; p < pieces.length; p++) g.fillRect(pieces[p].x, lane.top, pieces[p].w, lane.height - 2);
        g.fillStyle = row.white ? colors.iceEdge : colors.iceUsedEdge;
        for (let p = 0; p < pieces.length; p++) g.fillRect(pieces[p].x, lane.top + lane.height - 2, pieces[p].w, 2);
      }

      for (let i = 0; i < game.fish.length; i++) {
        const fish = game.fish[i];
        if (!fish.alive) continue;
        const lower = C.LANES[fish.gap];
        const upper = C.LANES[fish.gap + 1];
        const y = (lower.top + upper.top + upper.height) / 2;
        sprite(FB.Sprites.fish, fish.x, y, { 1: colors.fish, 2: colors.fishBelly }, fish.dir < 0);
      }

      for (let i = 0; i < game.enemies.length; i++) {
        const enemy = game.enemies[i];
        const lane = C.LANES[enemy.row + 1];
        const bob = enemy.paused ? -2 : 0;
        const y = lane.top - 2 + bob;
        if (enemy.type === 'goose') {
          const frame = FB.Sprites.gooseFrames[Math.floor(game.time * 8) % 2];
          outlined(frame, enemy.x, y, { 1: colors.goose, 3: colors.beak }, enemy.dir < 0);
        } else if (enemy.type === 'crab') {
          sprite(FB.Sprites.crab, enemy.x, y, { 1: colors.crab, 3: colors.crabDark });
        } else {
          const frame = enemy.paused ? FB.Sprites.clamOpen : FB.Sprites.clam;
          sprite(frame, enemy.x, y, { 1: colors.clamDark, 2: colors.clam });
        }
      }

      drawIgloo(colors);

      if (game.bear && game.phase !== 'gameover') {
        const rows = game.bear.dir < 0 ? FB.Sprites.bearLeft : FB.Sprites.bear;
        outlined(rows, game.bear.x, game.surface(5) - rows.length / 2, {
          1: colors.bear, 2: colors.bearDark,
        });
      }

      if (game.phase === 'dying') {
        sprite(FB.Sprites.splash, game.x, game.footY() - 4, { 1: colors.splash, 2: colors.text });
      } else if (game.phase !== 'gameover') {
        const jumping = !!game.jump;
        const left = game.facing < 0;
        const rows = jumping ? (left ? FB.Sprites.baileyJumpLeft : FB.Sprites.baileyJump) : (left ? FB.Sprites.baileyLeft : FB.Sprites.bailey);
        const suit = game.player === 1 ? colors.player2 : colors.bailey;
        outlined(rows, game.x, game.footY() - rows.length / 2, { 1: suit, 2: colors.skin, 3: colors.boot });
      }

      g.fillStyle = colors.hud;
      g.fillRect(0, 0, C.W, C.HUD);
      g.fillStyle = colors.hudLine;
      g.fillRect(0, C.HUD - 1, C.W, 1);
      text(String(game.score), 2, 4, colors.score);
      if (game.magicFish) sprite(FB.Sprites.magic, 46, 8, { 1: colors.fish, 2: colors.fishBelly });
      text(`F${game.level}`, 54, 4, colors.textDim);
      const cold = game.displayedDegrees() <= 10 && Math.floor(game.time * 4) % 2 === 0;
      text(`${game.displayedDegrees()}`, 86, 4, cold ? colors.tempLow : colors.temp);
      text('°', 86 + String(game.displayedDegrees()).length * 6, 4, cold ? colors.tempLow : colors.temp);
      const reserves = Math.max(0, game.lives - 1);
      sprite(FB.Sprites.bailey, 128, 8, { 1: game.player === 1 ? colors.player2 : colors.bailey, 2: colors.skin, 3: colors.boot });
      text(String(reserves), 136, 4, colors.text);
      if (game.badge) {
        g.fillStyle = colors.temp;
        g.fillRect(150, 4, 6, 6);
      }

      if (game.phase === 'title' || game.phase === 'gameover' || game.phase === 'paused' || game.phase === 'ready' || game.phase === 'clear') {
        const title = game.phase === 'title' ? 'FROSTBITE' :
          game.phase === 'gameover' ? 'FIM DE JOGO' :
          game.phase === 'paused' ? 'PAUSA' :
          game.phase === 'clear' ? 'IGLU' :
          `JOGADOR ${game.player + 1}`;
        g.fillStyle = 'rgba(8,10,20,0.84)';
        g.fillRect(10, 70, 140, game.phase === 'title' ? 58 : 40);
        text(title, 80, 78, colors.text, 1, true);
        if (game.phase === 'title') text('CARTWRIGHT 1983', 80, 90, '#ffffff', 1, true);
        const prompt = game.phase === 'paused' ? 'P PARA CONTINUAR' :
          game.phase === 'clear' ? game.banner :
          game.phase === 'ready' ? 'MOVA PARA SALTAR' :
          'ENTER OU BOTAO';
        text(prompt, 80, game.phase === 'title' ? 104 : 96, '#ffffff', 1, true);
        if (game.phase === 'title' || game.phase === 'gameover') {
          text(`RECORDE ${game.highScore}`, 80, game.phase === 'title' ? 116 : 108, colors.textDim, 1, true);
        }
      }

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

    function tick(timestamp) {
      const input = FB.Input.poll();
      if (controls.some((key) => input[key])) FB.Audio.unlock();
      if (last !== null) game.step(Math.min((timestamp - last) / 1000, 0.06), input);
      last = timestamp;
      syncStatus();
      render();
      requestAnimationFrame(tick);
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

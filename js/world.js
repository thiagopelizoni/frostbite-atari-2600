window.FB = window.FB || {};

// Four ice rows tile the 160-pixel screen. Gaps are water; the pieces wrap.
window.FB.World = (function () {
  'use strict';

  const C = window.FB.Config;
  const PERIOD = C.TUNE.period;

  const PATTERNS = [
    [[0, 50], [66, 40], [122, 24]],
    [[0, 36], [52, 30], [98, 26], [138, 12]],
    [[6, 30], [50, 28], [96, 24], [136, 14]],
    [[0, 22], [38, 18], [72, 20], [108, 16], [140, 12]],
  ];

  function wrap(value, mod) {
    const m = mod || PERIOD;
    return ((value % m) + m) % m;
  }

  function wrapDelta(a, b, mod) {
    const m = mod || PERIOD;
    let delta = wrap(a - b, m);
    if (delta > m / 2) delta -= m;
    return delta;
  }

  function segments(pattern, offset) {
    const out = [];
    for (let i = 0; i < pattern.length; i++) {
      const start = wrap(pattern[i][0] + offset);
      const width = pattern[i][1];
      if (start + width <= PERIOD) out.push({ x: start, w: width });
      else {
        out.push({ x: start, w: PERIOD - start });
        out.push({ x: 0, w: start + width - PERIOD });
      }
    }
    return out;
  }

  function feetOn(pieces, x, half) {
    const span = half == null ? C.TUNE.half : half;
    const samples = [x - span, x, x + span];
    for (let i = 0; i < samples.length; i++) {
      const point = wrap(samples[i]);
      let supported = false;
      for (let s = 0; s < pieces.length; s++) {
        const piece = pieces[s];
        if (point >= piece.x && point <= piece.x + piece.w) {
          supported = true;
          break;
        }
      }
      if (!supported) return false;
    }
    return true;
  }

  function enemiesFor(level) {
    const plan = [];
    function add(type, row) { plan.push({ type: type, row: row }); }
    if (level >= 1) add('goose', 1);
    if (level >= 2) add('clam', 2);
    if (level >= 3) add('crab', 0);
    if (level >= 4) add('goose', 3);
    if (level >= 6) add('clam', 3);
    if (level >= 8) add('crab', 2);
    if (level >= 10) add('goose', 0);
    return plan;
  }

  function create(level) {
    const rows = PATTERNS.map(function (pattern, index) {
      return {
        index: index,
        pattern: pattern,
        offset: wrap(12 + index * 47 + level * 13),
        dir: index % 2 === 0 ? 1 : -1,
        speed: C.floeSpeed(index, level),
        white: true,
      };
    });

    const plan = enemiesFor(level);
    const enemies = plan.map(function (item, index) {
      return {
        type: item.type,
        row: item.row,
        x: wrap(28 + index * 46 + level * 9),
        dir: index % 2 === 0 ? 1 : -1,
        speed: C.enemySpeed(level),
        timer: index * 0.37,
        paused: false,
      };
    });

    const fish = [0, 2, 4].map(function (gap, index) {
      return {
        gap: gap,
        x: wrap(24 + index * 52),
        dir: index % 2 === 0 ? 1 : -1,
        speed: 22 + index * 6 + (level % 3) * 2,
        alive: true,
        respawn: 0,
      };
    });

    const bear = level >= 4 ? {
      x: 96,
      dir: level % 2 === 0 ? -1 : 1,
      speed: C.bearSpeed(level),
    } : null;

    return { rows: rows, enemies: enemies, fish: fish, bear: bear, period: PERIOD };
  }

  return {
    PATTERNS: PATTERNS,
    PERIOD: PERIOD,
    wrap: wrap,
    wrapDelta: wrapDelta,
    segments: segments,
    feetOn: feetOn,
    enemiesFor: enemiesFor,
    create: create,
  };
})();

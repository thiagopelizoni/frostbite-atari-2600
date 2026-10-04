window.FB = window.FB || {};

// Four ice rows share one floe pattern per level and wrap every 160 px. Each row holds three
// 32 px slots; a slot is one 16 px floe or two 8 px halves split by `gap`.
// Creature lanes sit just above each row and carry one group at a time, crossing edge to edge.
window.FB.World = (function () {
  'use strict';

  const C = window.FB.Config;
  const T = C.TUNE;
  const PERIOD = T.period;
  // Feet-line x of the first slot when a life starts: rows 1 and 3, rows 2 and 4 in phase.
  // Like every x in the engine, the cartridge's left-edge values are used as centres here.
  const ROW_START = [71, 7, 71, 7];
  // Each floe is a 7-line parallelogram; line 3 is the feet line.
  const SLANT = [5, 3, 2, 0, 1, -1, -3];
  // Each level favours one kind, cycling goose, fish, crab, clam; the bias softens from level 8.
  const FEATURED = ['goose', 'fish', 'crab', 'clam'];

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

  // Seeded generator (mulberry32) kept in the lane, so every level plays the same way.
  function random(state) {
    let t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function startGap(shape) {
    return shape === 'solid' ? 0 : T.breathGap;
  }

  // Breathing floes start open, close over half a period and open again.
  function breathGap(shape, breath) {
    if (shape === 'solid') return 0;
    if (shape === 'chunks') return T.breathGap;
    const u = wrap(breath / T.breathPeriod, 1);
    return T.breathGap * Math.abs(1 - 2 * u);
  }

  function pieces(row) {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const slot = row.offset + i * T.floeSlot;
      if (row.shape === 'solid') {
        out.push({ x: wrap(slot), w: T.floeWidth });
      } else {
        const half = T.floeWidth / 2;
        out.push({ x: wrap(slot - row.gap / 2), w: half });
        out.push({ x: wrap(slot + half + row.gap / 2), w: half });
      }
    }
    return out;
  }

  // The cartridge keeps Bailey up while his feet line touches ice: centre-based with a margin.
  function supportAt(row, x, tolerance) {
    const margin = tolerance == null ? T.footTolerance : tolerance;
    const list = pieces(row);
    for (let i = 0; i < list.length; i++) {
      const piece = list[i];
      if (Math.abs(wrapDelta(x, piece.x + piece.w / 2)) <= piece.w / 2 + margin) return true;
    }
    return false;
  }

  function createRows(level) {
    const shape = C.floeShape(level);
    return ROW_START.map(function (offset, index) {
      return {
        index: index,
        lane: index + 1,
        offset: offset,
        dir: index % 2 === 0 ? -1 : 1,
        speed: C.floeSpeed(level),
        shape: shape,
        gap: startGap(shape),
        white: true,
        shift: 0,
      };
    });
  }

  // The floe layout a level starts with (rows 1 and 3; rows 2 and 4 sit at ROW_START[1]).
  function pattern(level) {
    const row = createRows(level)[0];
    return { shape: row.shape, gap: row.gap, pieces: pieces(row) };
  }

  // `round` counts the lives started in this game, so each attempt meets a different schedule.
  function createLanes(level, round) {
    const lanes = [];
    for (let row = 0; row < 4; row++) {
      const seed = level * 7919 + row * 104729 + (round || 0) * 7331 + 17;
      const lane = { row: row, seed: seed, serial: 0, go: true, goClock: 0, wait: 0 };
      lane.wait = T.creatureLead + random(lane) * 2.4;
      lane.goClock = random(lane) * T.stopGoTime;
      lanes.push(lane);
    }
    return lanes;
  }

  function featuredKind(level) {
    return FEATURED[(Math.max(1, level) - 1) % FEATURED.length];
  }

  function kindWeight(kind, level) {
    if (kind !== featuredKind(level)) return 1;
    return level >= 8 ? 1.5 : 2.5;
  }

  function pickKind(lane, level) {
    const kinds = C.creatureKinds(level);
    let total = 0;
    const weights = kinds.map(function (kind) {
      const weight = kindWeight(kind, level);
      total += weight;
      return weight;
    });
    let roll = random(lane) * total;
    for (let i = 0; i < kinds.length; i++) {
      roll -= weights[i];
      if (roll < 0) return kinds[i];
    }
    return kinds[kinds.length - 1];
  }

  // A new group enters from the edge it moves away from; the leader is just off-screen.
  function spawnGroup(lane, level, kind, dir, count) {
    const type = kind || pickKind(lane, level);
    const heading = dir || (random(lane) < 0.5 ? -1 : 1);
    const size = count || C.groupSize(level);
    const spacing = C.groupSpacing(size);
    const entry = heading > 0 ? -4 : PERIOD + 4;
    const group = [];
    lane.serial += 1;
    for (let i = 0; i < size; i++) {
      group.push({
        type: type,
        row: lane.row,
        x: entry - heading * i * spacing,
        dir: heading,
        speed: C.creatureSpeed(level),
        group: lane.serial,
        phase: random(lane),
        moving: true,
      });
    }
    return group;
  }

  function nextWait(lane) {
    return T.creatureGapMin + random(lane) * (T.creatureGapMax - T.creatureGapMin);
  }

  function offscreen(creature) {
    return creature.dir > 0 ? creature.x > PERIOD + 8 : creature.x < -8;
  }

  function createBear(level) {
    if (!C.hasBear(level)) return null;
    return { x: T.bearStartX, dir: -1, speed: C.bearSpeed(level), idle: T.bearIdle, walk: 0 };
  }

  function create(level, round) {
    return {
      rows: createRows(level),
      lanes: createLanes(level, round),
      enemies: [],
      fish: [],
      bear: createBear(level),
      period: PERIOD,
    };
  }

  return {
    PERIOD: PERIOD,
    ROW_START: ROW_START,
    SLANT: SLANT,
    wrap: wrap,
    wrapDelta: wrapDelta,
    random: random,
    breathGap: breathGap,
    pieces: pieces,
    supportAt: supportAt,
    createRows: createRows,
    pattern: pattern,
    createLanes: createLanes,
    featuredKind: featuredKind,
    kindWeight: kindWeight,
    pickKind: pickKind,
    spawnGroup: spawnGroup,
    nextWait: nextWait,
    offscreen: offscreen,
    createBear: createBear,
    create: create,
  };
})();

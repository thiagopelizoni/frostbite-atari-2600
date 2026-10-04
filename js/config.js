window.FB = window.FB || {};

// Native Atari coordinates: the 160×192 frame is the cartridge picture from scanline 7 to 198.
// Lanes: 0 is the snowy shore under the HUD; 1..4 are the ice rows from top to bottom.
// rows[i] belongs to lane i + 1. UP moves toward the shore (lane - 1), DOWN toward the sea.
// Horizontal positions are sprite centres. Ice rows wrap every 160 px; the shore does not.
window.FB.Config = (function () {
  'use strict';

  // Colours sampled from the NTSC cartridge.
  const DAY = {
    night: false,
    sky: '#2D32B8',
    ink: '#8490FC',
    horizon: [
      ['#956FE3', '#7F5CD5'], ['#B56CE0', '#A459D0'], ['#D46CC3', '#C659B3'],
      ['#E46F6F', '#D65C5C'], ['#E39759', '#D5824A'], ['#E39759', '#D5824A'],
      ['#D2A44A', '#C3903D'], ['#D2A44A', '#C3903D'], ['#D2D240', '#BBBB35'],
    ],
    shore: '#C0C0C0',
    water: '#001C88',
    ice: '#D6D6D6',
    iceUsed: '#548AD2',
    igloo: '#8E8E8E',
    door: '#000000',
    hat: '#A26221',
    face: '#C66C3A',
    coat: '#8E8E8E',
    boots: '#A2A22A',
    player2: '#5C7CD8',
    frozen: ['#183B9D', '#2D57B0', '#4272C2', '#548AD2'],
    bear: '#6F6F6F',
    goose: '#8490FC',
    fish: '#6FD26F',
    crab: '#D5824A',
    clam: '#D2D240',
    card: 'rgba(0, 0, 40, 0.86)',
    text: '#D2D240',
    textDim: '#8490FC',
    signature: { r: '#B83232', o: '#B47A30', y: '#D2D240', g: '#6E9C42', b: '#2D32B8', w: '#D6D6D6' },
  };

  const NIGHT = Object.assign({}, DAY, {
    night: true,
    sky: '#000094',
    shore: '#4A4A4A',
    bear: '#D6D6D6',
  });

  const TUNE = {
    period: 160,
    hmove: 8,
    startX: 64,
    shoreMin: 20,
    shoreMax: 150,
    // A floe carries Bailey only as far as the screen edge, then slides out from under him.
    // The right limit is measured in the cartridge; the left one mirrors shoreMin until measured.
    iceMin: 20,
    iceMax: 151,
    walkSpeed: 30,
    walkFrame: 0.1,
    jumpTime: 28 / 60,
    // The feet line may hang this far past an edge; 8 px chunks then stay standable.
    footTolerance: 5,
    floeHold: 66 / 60,
    floeSlot: 32,
    floeWidth: 16,
    breathPeriod: 256 / 60,
    breathGap: 8,
    startDegrees: 45,
    degreeTime: 64 / 60,
    blocksNeeded: 16,
    doorMin: 120,
    doorMax: 127,
    // The hideout and shoreMin are the cartridge's left edges plus 4, so they sit where the ROM draws
    // Bailey relative to the HMOVE comb. Only a jump from the ice reaches the hideout, and the landing
    // stops where the whole sprite still clears the 8 px comb (left edge 8, not measured in the ROM).
    hideout: 14,
    shoreEdge: 12,
    bearStartX: 140,
    bearIdle: 64 / 60,
    bearReach: 10,
    bearSlack: 20,
    bearMaxX: 152,
    bearFromLevel: 4,
    creatureReach: 8,
    pushGap: 6,
    creatureLead: 0.6,
    creatureGapMin: 0.7,
    creatureGapMax: 2.6,
    stopGoTime: 64 / 60,
    stopGoFrom: 6,
    startLives: 4,
    maxLives: 10,
    extraLifeEvery: 5000,
    fishScore: 200,
    scoreWrap: 1000000,
    architectScore: 40000,
    magicFishLevel: 21,
    deathTime: 200 / 60,
    readyTime: 2.5,
    clear: { enter: 8, pause: 65, block: 7, gap: 7, degree: 3, tail: 52 },
  };
  // The bear reaches just past the hideout edge but parks 2 px further out while Bailey hides there.
  TUNE.bearEdge = TUNE.hideout + TUNE.bearReach;
  TUNE.bearMinX = TUNE.bearEdge + 2;

  const LAYOUT = {
    hud: 26,
    horizon: 26,
    shoreTop: 35,
    shoreBottom: 70,
    waterTop: 71,
    waterBottom: 178,
    signatureTop: 185,
    iglooX: 108,
    iglooY: 28,
    scoreX: 23,
    scoreY: 3,
    lineY: 15,
  };

  // feet: the scanline Bailey's feet stand on. top: first floe scanline. water: creature waterline.
  const LANES = [0, 1, 2, 3, 4].map(function (lane) {
    const feet = 66 + lane * 26;
    if (lane === 0) return { lane: 0, kind: 'shore', feet: feet, top: LAYOUT.shoreTop, height: LAYOUT.shoreBottom - LAYOUT.shoreTop };
    return { lane: lane, kind: 'ice', feet: feet, top: feet - 3, height: 7, water: feet - 9 };
  });

  function tier(level) {
    return Math.min(Math.max(1, level), 9);
  }

  function icePoints(level) {
    return tier(level) * 10;
  }

  function enterPoints(level) {
    return tier(level) * 160;
  }

  function degreePoints(level, degrees) {
    return 10 * tier(level) * degrees;
  }

  function startDegrees() {
    return TUNE.startDegrees;
  }

  function degreeRate() {
    return 1 / TUNE.degreeTime;
  }

  function startingLevel(mode) {
    return mode >= 3 ? 5 : 1;
  }

  function twoPlayers(mode) {
    return mode === 2 || mode === 4;
  }

  function isNight(level) {
    return Math.floor((level - 1) / 4) % 2 === 1;
  }

  function palette(level) {
    return isNight(level) ? NIGHT : DAY;
  }

  // The cartridge's speed step: one per level, falling back three steps every seven levels from level 12.
  function pace(level) {
    const n = Math.max(1, level);
    return n - 3 * Math.max(0, Math.floor((n - 5) / 7));
  }

  function floeSpeed(level) {
    return 7.5 + 3.75 * Math.floor((pace(level) - 1) / 2);
  }

  function creatureSpeed(level) {
    return 11.25 + 3.75 * (pace(level) - 1);
  }

  function airSpeed(level) {
    return 15 + 3.75 * (pace(level) - 1);
  }

  function bearSpeed(level) {
    return 22.5 + 3.75 * Math.max(0, pace(level) - TUNE.bearFromLevel);
  }

  // 'solid': three 16 px floes. 'chunks': six 8 px pieces. 'breathing': floes that split and rejoin.
  function floeShape(level) {
    if (level % 2 === 1) return 'solid';
    return level <= 4 ? 'chunks' : 'breathing';
  }

  function creatureKinds(level) {
    if (level <= 1) return ['goose'];
    if (level === 2) return ['goose', 'fish'];
    if (level === 3) return ['goose', 'fish', 'crab'];
    return ['goose', 'fish', 'crab', 'clam'];
  }

  function groupSize(level) {
    if (level <= 4) return [1, 2, 2, 1][Math.max(1, level) - 1];
    return [1, 2, 2, 3][(level - 5) % 4];
  }

  function groupSpacing(count) {
    return count >= 3 ? 16 : 32;
  }

  function hasBear(level) {
    return level >= TUNE.bearFromLevel;
  }

  const C = {
    W: 160,
    H: 192,
    HUD: LAYOUT.hud,
    LANES: LANES,
    LAYOUT: LAYOUT,
    TUNE: TUNE,
    DAY: DAY,
    NIGHT: NIGHT,
    palette: palette,
    isNight: isNight,
    tier: tier,
    icePoints: icePoints,
    enterPoints: enterPoints,
    degreePoints: degreePoints,
    startDegrees: startDegrees,
    degreeRate: degreeRate,
    startingLevel: startingLevel,
    twoPlayers: twoPlayers,
    pace: pace,
    floeSpeed: floeSpeed,
    creatureSpeed: creatureSpeed,
    enemySpeed: creatureSpeed,
    airSpeed: airSpeed,
    bearSpeed: bearSpeed,
    floeShape: floeShape,
    creatureKinds: creatureKinds,
    groupSize: groupSize,
    groupSpacing: groupSpacing,
    hasBear: hasBear,
  };

  return C;
})();

window.FB.config = window.FB.Config;

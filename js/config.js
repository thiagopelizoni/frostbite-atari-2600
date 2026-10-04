window.FB = window.FB || {};

// Native Atari coordinates. CSS stretches the 160×192 frame into a 4:3 television.
window.FB.Config = (function () {
  'use strict';

  const DAY = {
    water: '#2A38C8',
    waterDeep: '#1A228C',
    snow: '#F4F7FF',
    snowShadow: '#C5D2E6',
    alcove: '#8EA4C4',
    ice: '#F7FBFF',
    iceEdge: '#8EACD4',
    iceUsed: '#5C92F0',
    iceUsedEdge: '#2A58B0',
    hud: '#12141C',
    hudLine: '#07080C',
    score: '#F6E27A',
    temp: '#73F2B2',
    tempLow: '#FF5C48',
    text: '#F6E27A',
    textDim: '#D5D2C0',
    bailey: '#F4F7FF',
    skin: '#F0C090',
    boot: '#1A1A1A',
    bear: '#F7F7F7',
    bearDark: '#1C1C1C',
    fish: '#3DDC6A',
    fishBelly: '#E8FFF0',
    goose: '#F4F7FF',
    beak: '#F0A030',
    crab: '#E24B3A',
    crabDark: '#6A140C',
    clam: '#D06AD8',
    clamDark: '#5A2060',
    igloo: '#F4F7FF',
    iglooEdge: '#7E96B4',
    door: '#1A1208',
    splash: '#D6E4FF',
    player2: '#8FD0FF',
    night: false,
  };

  const NIGHT = {
    water: '#14183A',
    waterDeep: '#0C1024',
    snow: '#D4D2E4',
    snowShadow: '#8E8CA4',
    alcove: '#3A3C58',
    ice: '#E4E2F4',
    iceEdge: '#6A7098',
    iceUsed: '#4A62B0',
    iceUsedEdge: '#243468',
    hud: '#0C0C14',
    hudLine: '#050508',
    score: '#F6E27A',
    temp: '#9AF0C8',
    tempLow: '#FF6A58',
    text: '#F6E27A',
    textDim: '#C8C6D4',
    bailey: '#F4F4FF',
    skin: '#E8B888',
    boot: '#0C0C10',
    bear: '#E4E4F0',
    bearDark: '#101018',
    fish: '#4AE07A',
    fishBelly: '#E8FFF0',
    goose: '#E4E4F4',
    beak: '#F0A030',
    crab: '#E05040',
    crabDark: '#401008',
    clam: '#C060D0',
    clamDark: '#401848',
    igloo: '#E8E6F4',
    iglooEdge: '#5A6080',
    door: '#100C08',
    splash: '#A8B4D8',
    player2: '#80C8FF',
    night: true,
  };

  // Bottom shore, four ice rows, top shore. `top` is the surface the feet stand on.
  const LANES = [
    { top: 168, height: 24, kind: 'shore' },
    { top: 142, height: 14, kind: 'ice' },
    { top: 116, height: 14, kind: 'ice' },
    { top: 90, height: 14, kind: 'ice' },
    { top: 64, height: 14, kind: 'ice' },
    { top: 16, height: 34, kind: 'shore' },
  ];

  const TUNE = {
    period: 160,
    walkSpeed: 46,
    airSpeed: 62,
    airPerLevel: 3,
    jumpTime: 0.3,
    half: 3,
    floeSpeed: [26, 34, 30, 40],
    floePerLevel: 3.1,
    floeMax: 86,
    enemySpeed: 18,
    enemyPerLevel: 2.1,
    enemyMax: 52,
    bearSpeed: 16,
    bearPerLevel: 1.8,
    bearMax: 46,
    bearMinX: 36,
    bearMaxX: 152,
    hideout: 26,
    iglooX: 116,
    iglooY: 18,
    iglooCell: 8,
    doorX: 120,
    doorW: 24,
    blocksNeeded: 16,
    startLives: 4,
    maxLives: 10,
    extraLifeEvery: 5000,
    fishScore: 200,
    magicFishScore: 100000,
    scoreCap: 999999,
    deathTime: 1.05,
    clearTime: 1.45,
    startX: 78,
  };

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
    return 10 * degrees * level;
  }

  function startDegrees(level) {
    return Math.max(20, 50 - (level - 1) * 2);
  }

  function degreeRate(level) {
    return 0.82 + (level - 1) * 0.1;
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

  function floeSpeed(row, level) {
    return Math.min(TUNE.floeMax, TUNE.floeSpeed[row] + (level - 1) * TUNE.floePerLevel);
  }

  function enemySpeed(level) {
    return Math.min(TUNE.enemyMax, TUNE.enemySpeed + (level - 1) * TUNE.enemyPerLevel);
  }

  function bearSpeed(level) {
    return Math.min(TUNE.bearMax, TUNE.bearSpeed + Math.max(0, level - 4) * TUNE.bearPerLevel);
  }

  const C = {
    W: 160,
    H: 192,
    HUD: 16,
    LANES: LANES,
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
    floeSpeed: floeSpeed,
    enemySpeed: enemySpeed,
    bearSpeed: bearSpeed,
  };

  return C;
})();

window.FB.config = window.FB.Config;

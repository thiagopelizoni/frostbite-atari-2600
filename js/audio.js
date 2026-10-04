(function () {
  'use strict';

  var FB = window.FB = window.FB || {};
  var context = null;
  var master = null;
  var resuming = false;
  var lastChill = -1;
  var Audio = { muted: false, available: true };

  function oscillator(frequency, type) {
    var source = context.createOscillator();
    source.type = type || 'square';
    source.frequency.value = frequency;
    return source;
  }

  function initialize() {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      Audio.available = false;
      return;
    }
    try {
      context = new Context({ latencyHint: 'interactive' });
      master = context.createGain();
      master.gain.value = Audio.muted ? 0 : 0.28;
      master.connect(context.destination);
    } catch (error) {
      context = null;
      Audio.available = false;
    }
  }

  function unlock() {
    if (!context && Audio.available) initialize();
    if (context && context.state === 'suspended' && !resuming) {
      resuming = true;
      context.resume().then(function () { resuming = false; }, function () { resuming = false; });
    }
  }

  function setMuted(muted) {
    Audio.muted = !!muted;
    if (master && context) master.gain.setTargetAtTime(Audio.muted ? 0 : 0.28, context.currentTime, 0.015);
  }

  function ready() {
    return !!(context && context.state === 'running' && !Audio.muted);
  }

  function tone(frequency, endFrequency, duration, gain, offset) {
    if (!ready()) return;
    var start = context.currentTime + (offset || 0);
    var source = oscillator(frequency, 'square');
    var volume = context.createGain();
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(gain, start + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(volume);
    volume.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
    source.onended = function () { source.disconnect(); volume.disconnect(); };
  }

  function jump() { tone(190, 340, 0.07, 0.12); }
  function block() { tone(480, 360, 0.06, 0.14); }
  function fish() {
    tone(560, 560, 0.07, 0.13);
    tone(760, 640, 0.1, 0.12, 0.07);
  }
  function reverse() { tone(110, 70, 0.09, 0.12); }
  function door() {
    [330, 440, 554].forEach(function (frequency, index) {
      tone(frequency, frequency, 0.09, 0.12, index * 0.08);
    });
  }
  function clear() {
    [262, 330, 392, 523].forEach(function (frequency, index) {
      tone(frequency, frequency, 0.12, 0.13, index * 0.1);
    });
  }
  function fall() { tone(360, 55, 0.42, 0.18); }
  function freeze() { tone(180, 40, 0.7, 0.14); }
  function caught() { tone(240, 70, 0.36, 0.16); }
  function extraLife() {
    [523, 659, 784].forEach(function (frequency, index) {
      tone(frequency, frequency, 0.1, 0.12, index * 0.09);
    });
  }
  function chill(active) {
    if (!ready()) return;
    var tick = Math.floor(context.currentTime * 2.5);
    if (active && tick !== lastChill) {
      lastChill = tick;
      tone(720, 540, 0.05, 0.07);
    }
    if (!active) lastChill = -1;
  }
  function stop() { lastChill = -1; }

  Audio.unlock = unlock;
  Audio.setMuted = setMuted;
  Audio.jump = jump;
  Audio.block = block;
  Audio.fish = fish;
  Audio.reverse = reverse;
  Audio.door = door;
  Audio.clear = clear;
  Audio.fall = fall;
  Audio.freeze = freeze;
  Audio.caught = caught;
  Audio.extraLife = extraLife;
  Audio.chill = chill;
  Audio.stop = stop;
  FB.Audio = Audio;
})();

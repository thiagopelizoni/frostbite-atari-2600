(function () {
  'use strict';

  var FB = window.FB = window.FB || {};
  var context = null;
  var master = null;
  var resuming = false;
  var buffers = {};
  // Every scheduled source, so stop() can silence sounds that are still playing or yet to start.
  var playing = new Set();
  var Audio = { muted: false, available: true };
  // Polynomial counters like the TIA's: 9 bits for hiss, 5 bits for a coarse buzz.
  var POLY = { hiss: { bits: 9, tap: 4 }, buzz: { bits: 5, tap: 2 } };
  var CLOCK = 15700;

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

  function noiseBuffer(kind) {
    if (buffers[kind]) return buffers[kind];
    var poly = POLY[kind];
    var length = Math.floor(context.sampleRate);
    var buffer = context.createBuffer(1, length, context.sampleRate);
    var data = buffer.getChannelData(0);
    var mask = (1 << poly.bits) - 1;
    var state = mask;
    var hold = context.sampleRate / CLOCK;
    var count = 0;
    var value = 1;
    for (var i = 0; i < length; i++) {
      count += 1;
      if (count >= hold) {
        count -= hold;
        var feedback = (state ^ (state >> poly.tap)) & 1;
        state = ((state >> 1) | (feedback << (poly.bits - 1))) & mask;
        value = state & 1 ? 0.8 : -0.8;
      }
      data[i] = value;
    }
    buffers[kind] = buffer;
    return buffer;
  }

  function envelope(gain, start, duration) {
    var volume = context.createGain();
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(gain, start + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    volume.connect(master);
    return volume;
  }

  function track(source, volume) {
    playing.add(source);
    source.onended = function () {
      playing.delete(source);
      source.disconnect();
      volume.disconnect();
    };
  }

  function tone(frequency, endFrequency, duration, gain, offset) {
    if (!ready()) return;
    var start = context.currentTime + (offset || 0);
    var source = oscillator(frequency, 'square');
    var volume = envelope(gain, start, duration);
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
    source.connect(volume);
    source.start(start);
    source.stop(start + duration + 0.02);
    track(source, volume);
  }

  // Noise channel: the LFSR buffer replayed faster or slower bends the pitch like AUDF.
  function noise(kind, duration, gain, rate, endRate, offset) {
    if (!ready()) return;
    var start = context.currentTime + (offset || 0);
    var source = context.createBufferSource();
    var volume = envelope(gain, start, duration);
    source.buffer = noiseBuffer(kind);
    source.loop = true;
    source.playbackRate.setValueAtTime(rate, start);
    if (endRate && endRate !== rate) source.playbackRate.exponentialRampToValueAtTime(endRate, start + duration);
    source.connect(volume);
    source.start(start);
    source.stop(start + duration + 0.03);
    track(source, volume);
  }

  function arpeggio(notes, step, length, gain) {
    notes.forEach(function (frequency, index) {
      tone(frequency, frequency, length, gain, index * step);
    });
  }

  function jump() { tone(190, 340, 0.07, 0.12); }
  function block() { tone(480, 360, 0.06, 0.14); }
  function fish() {
    tone(560, 560, 0.07, 0.13);
    tone(760, 640, 0.1, 0.12, 0.07);
  }
  function reverse() { tone(110, 70, 0.09, 0.12); }
  function door() { arpeggio([330, 440, 554], 0.08, 0.09, 0.12); }
  function enter() { arpeggio([262, 330, 392, 523], 0.05, 0.08, 0.12); }
  function tally(left) { tone(220 + (16 - left) * 22, 220 + (16 - left) * 22, 0.05, 0.1); }
  function degree(left) { tone(880 - Math.min(left, 45) * 8, 700, 0.035, 0.08); }
  function fall() {
    noise('hiss', 0.5, 0.24, 1.2, 0.3);
    tone(330, 60, 0.55, 0.08);
  }
  function freeze() {
    noise('hiss', 1.1, 0.12, 2.4, 0.5);
    tone(160, 45, 1, 0.08);
  }
  function caught() {
    noise('buzz', 0.7, 0.2, 0.6, 0.25);
    tone(140, 55, 0.7, 0.1);
  }
  function extraLife() { arpeggio([523, 659, 784], 0.09, 0.1, 0.12); }
  function stop() {
    playing.forEach(function (source) {
      try { source.stop(); } catch (error) { /* Already stopped. */ }
    });
  }

  Audio.unlock = unlock;
  Audio.setMuted = setMuted;
  Audio.jump = jump;
  Audio.block = block;
  Audio.fish = fish;
  Audio.reverse = reverse;
  Audio.door = door;
  Audio.enter = enter;
  Audio.tally = tally;
  Audio.degree = degree;
  Audio.fall = fall;
  Audio.freeze = freeze;
  Audio.caught = caught;
  Audio.extraLife = extraLife;
  Audio.noise = noise;
  Audio.stop = stop;
  FB.Audio = Audio;
})();

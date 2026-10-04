(function () {
  'use strict';

  var FB = window.FB = window.FB || {};
  var keys = Object.create(null);
  var buttonKeys = Object.create(null);
  var pointers = new Map();
  // Presses seen since the last poll, so a tap released before the next frame still counts once.
  var tapped = Object.create(null);
  var callback = function () {};
  var initialized = false;
  var active = true;
  var padStart = false;
  var skipPadAction = false;
  var state = { left: false, right: false, up: false, down: false, fire: false };
  var keyDirections = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'fire', KeyZ: 'fire', KeyX: 'fire', KeyK: 'fire'
  };
  var actions = {
    Enter: 'start', KeyP: 'pause', KeyR: 'reset', KeyM: 'mute',
    KeyC: 'color', KeyL: 'difficulty', KeyF: 'fullscreen',
    Digit1: 'select1', Digit2: 'select2', Digit3: 'select3', Digit4: 'select4',
    Numpad1: 'select1', Numpad2: 'select2', Numpad3: 'select3', Numpad4: 'select4'
  };

  function unlockAudio() {
    if (FB.Audio) FB.Audio.unlock();
  }

  function editable(target) {
    return !!(target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)));
  }

  function nativeButtonKey(event) {
    return (event.code === 'Enter' || event.code === 'Space') && event.target.closest && event.target.closest('button, a, [role="button"]');
  }

  function heldClasses() {
    document.querySelectorAll('#pad [data-dir], #pad [data-control="fire"]').forEach(function (button) {
      var control = button.dataset.dir || 'fire';
      var held = false;
      pointers.forEach(function (pointer) { if (pointer.control === control) held = true; });
      Object.keys(buttonKeys).forEach(function (code) { if (buttonKeys[code] === control) held = true; });
      button.classList.toggle('held', held);
    });
  }

  function releasePointer(event) {
    if (pointers.delete(event.pointerId)) heldClasses();
  }

  function pointerControl(element, control) {
    element.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      unlockAudio();
      // A mouse click on the TV only gives it the keyboard; tapping it is fire on touch screens.
      if (element.id === 'screen' && event.pointerType === 'mouse') {
        element.focus({ preventScroll: true });
        return;
      }
      if (event.pointerType !== 'mouse') document.body.classList.add('touch');
      // While paused, the TV and the red button resume, as the card says; the press is spent on that,
      // so it is not also fire the moment the game runs again.
      if (control === 'fire' && FB.game && FB.game.phase === 'paused') {
        callback('pause');
        if (element.id === 'screen') element.focus({ preventScroll: true });
        return;
      }
      pointers.set(event.pointerId, { control: control, direction: control !== 'fire' });
      tapped[control] = true;
      try { element.setPointerCapture(event.pointerId); } catch (error) { /* A canceled pointer cannot be captured. */ }
      if (element.id === 'screen') element.focus({ preventScroll: true });
      heldClasses();
    });
    element.addEventListener('pointermove', function (event) {
      var pointer = pointers.get(event.pointerId);
      if (!pointer || !pointer.direction) return;
      var hovered = document.elementFromPoint(event.clientX, event.clientY);
      var direction = hovered && hovered.closest('#pad [data-dir]');
      pointer.control = direction ? direction.dataset.dir : null;
      heldClasses();
    });
    element.addEventListener('pointerup', releasePointer);
    element.addEventListener('pointercancel', releasePointer);
    element.addEventListener('lostpointercapture', releasePointer);
    element.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    if (element.id !== 'screen') {
      element.addEventListener('keydown', function (event) {
        if (event.code !== 'Space' && event.code !== 'Enter') return;
        event.preventDefault();
        unlockAudio();
        buttonKeys[control + event.code] = control;
        tapped[control] = true;
        heldClasses();
      });
      element.addEventListener('keyup', function (event) { delete buttonKeys[control + event.code]; heldClasses(); });
      element.addEventListener('blur', function () {
        delete buttonKeys[control + 'Space'];
        delete buttonKeys[control + 'Enter'];
        heldClasses();
      });
    }
  }

  function init(onAction) {
    callback = typeof onAction === 'function' ? onAction : callback;
    if (initialized) return;
    initialized = true;
    active = !document.hidden;
    if (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    window.addEventListener('keydown', function (event) {
      if (editable(event.target) || nativeButtonKey(event) || event.altKey || event.ctrlKey || event.metaKey) return;
      var direction = keyDirections[event.code];
      var action = actions[event.code];
      if (!direction && !action) return;
      event.preventDefault();
      unlockAudio();
      if (direction) {
        keys[event.code] = true;
        tapped[direction] = true;
      }
      if (action && !event.repeat && !keys[event.code]) {
        keys[event.code] = true;
        callback(action);
      }
    });
    window.addEventListener('keyup', function (event) {
      if (keys[event.code]) delete keys[event.code];
    });
    window.addEventListener('blur', function () {
      active = false;
      clear();
    });
    window.addEventListener('focus', function () { active = true; skipPadAction = true; });
    document.addEventListener('visibilitychange', function () {
      active = !document.hidden;
      if (!active) clear();
      else skipPadAction = true;
    });
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('gamepaddisconnected', function () { padStart = false; });
    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        unlockAudio();
        callback(button.dataset.action);
        // Hand the keyboard back to the game, or Enter and Space would press this button again.
        var screen = document.getElementById('screen');
        if (screen) screen.focus({ preventScroll: true });
      });
    });
    document.querySelectorAll('#pad [data-dir]').forEach(function (button) { pointerControl(button, button.dataset.dir); });
    document.querySelectorAll('[data-control="fire"]').forEach(function (button) { pointerControl(button, 'fire'); });
    var canvas = document.getElementById('screen');
    if (canvas) pointerControl(canvas, 'fire');
  }

  function poll() {
    state.left = state.right = state.up = state.down = state.fire = false;
    var taps = tapped;
    tapped = Object.create(null);
    if (!active || document.hidden) return state;
    Object.keys(taps).forEach(function (control) { state[control] = true; });
    Object.keys(keys).forEach(function (code) {
      if (keyDirections[code]) state[keyDirections[code]] = true;
    });
    Object.keys(buttonKeys).forEach(function (code) { state[buttonKeys[code]] = true; });
    pointers.forEach(function (pointer) { if (pointer.control) state[pointer.control] = true; });
    var start = false;
    var gamepads = [];
    try { gamepads = (navigator.getGamepads && navigator.getGamepads()) || []; } catch (error) { /* Blocked by a permissions policy. */ }
    for (var i = 0; i < gamepads.length; i++) {
      var pad = gamepads[i];
      if (!pad || !pad.connected) continue;
      var pressed = function (index) { return !!(pad.buttons[index] && pad.buttons[index].pressed); };
      var x = pad.axes[0] || 0;
      var y = pad.axes[1] || 0;
      state.left = state.left || x < -0.22 || pressed(14);
      state.right = state.right || x > 0.22 || pressed(15);
      state.up = state.up || y < -0.22 || pressed(12);
      state.down = state.down || y > 0.22 || pressed(13);
      state.fire = state.fire || pressed(0) || pressed(1) || pressed(2) || pressed(7);
      start = start || pressed(9);
    }
    if (start && !padStart && !skipPadAction) {
      unlockAudio();
      callback('start');
    }
    if (state.fire) unlockAudio();
    padStart = start;
    skipPadAction = false;
    return state;
  }

  function clear() {
    keys = Object.create(null);
    buttonKeys = Object.create(null);
    tapped = Object.create(null);
    pointers.clear();
    state.left = state.right = state.up = state.down = state.fire = false;
    padStart = false;
    skipPadAction = true;
    heldClasses();
  }

  FB.Input = { state: state, init: init, poll: poll, clear: clear };
})();

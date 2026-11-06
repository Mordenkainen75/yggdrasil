import './style.css';
import { Sound } from './audio.ts';
import { BLOCK, OFFLINE, TICK } from './game/config.ts';
import { applyOffline } from './game/economy.ts';
import { clearStorage, loadFromStorage, saveToStorage } from './game/save.ts';
import { setWaypoint, step } from './game/sim.ts';
import { newGame, type GameState } from './game/state.ts';
import { Renderer } from './render/renderer.ts';
import { Ui } from './ui/ui.ts';

// Test helper: add ?speed=20 to the address to run the game faster.
const params = new URLSearchParams(location.search);
const speed = Math.max(0.1, Number(params.get('speed')) || 1);

let state: GameState = loadFromStorage() ?? newGame();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const sound = new Sound();

const ui = new Ui(state, {
  onBuy: () => sound.buy(),
  onCarve: () => sound.carve(),
  onSagaPassed: () => {
    sound.core();
    saveToStorage(state);
  },
  toggleView: () => renderer.toggleOverview(),
  toggleSound: () => {
    sound.muted = !sound.muted;
    return !sound.muted;
  },
  hardReset: () => {
    clearStorage();
    state = newGame();
    ui.setState(state);
    renderer.showTitle(state.region.name, 'Midgard, region 1');
  },
});

renderer.onEvent = (e) => {
  if (e.t === 'mine' && e.kind !== 0) {
    if (e.kind === BLOCK.GOLD) sound.gold();
    else sound.crunch();
  } else if (e.t === 'burst') {
    sound.blast();
  } else if (e.t === 'core') {
    sound.core();
    navigator.vibrate?.(60);
    saveToStorage(state);
  } else if (e.t === 'berserk') {
    sound.berserk();
  }
};

function checkAway(): void {
  const report = applyOffline(state, Date.now(), OFFLINE.minSeconds);
  if (report) ui.showWelcomeBack(report.seconds, report.gained);
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  const rect = canvas.getBoundingClientRect();
  const world = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (state.phase === 'mining') setWaypoint(state, world.x, world.y);
});
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.lastSeen = Date.now();
    saveToStorage(state);
  } else {
    checkAway();
  }
});
window.addEventListener('pagehide', () => {
  state.lastSeen = Date.now();
  saveToStorage(state);
});
setInterval(() => saveToStorage(state), 10_000);
setInterval(() => ui.update(), 150);

let last = performance.now();
let backlog = 0;

function loop(now: number): void {
  // After a pause, drop the backlog instead of fast-forwarding through it.
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  backlog += elapsed * speed;
  let steps = 0;
  while (backlog >= TICK && steps < 600) {
    step(state, TICK);
    backlog -= TICK;
    steps += 1;
  }
  if (steps === 600) backlog = 0;
  renderer.frame(state, elapsed);
  requestAnimationFrame(loop);
}

renderer.showTitle(state.region.name, `Midgard, region ${state.regionIndex + 1}`);
checkAway();
state.lastSeen = Date.now();
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Only offline play depends on this. The game still runs online.
  });
}

// Dev-only hook so automated playtests can inspect and set up game states.
if (import.meta.env.DEV) {
  (window as unknown as { game: () => GameState }).game = () => state;
}

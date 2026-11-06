// The rules of the game. Nothing here touches the screen, so the same code
// runs in the browser and in the headless balance simulator.
import { GAS, BLOCK, RAVENS, REGION, THUNDER, SHIP } from './config.ts';
import { autoBuy, computeStats, type Stats } from './economy.ts';
import { cellAt, forEachInRange, makeRegion, neighbourOf } from './region.ts';
import { placeShip, pushTrail, segmentPos, type GameState } from './state.ts';

const pos = { x: 0, y: 0 };
const blastQueue: number[] = [];

function earn(s: GameState, amount: number): void {
  s.silver += amount;
  s.runSilver += amount;
  s.lifetimeSilver += amount;
  s.rateWindow += amount;
}

function collapseRegion(s: GameState, st: Stats): void {
  const p = s.region;
  let leftover = 0;
  for (const i of p.cells) {
    if (p.kind[i] !== BLOCK.EMPTY) {
      leftover += p.value[i];
      s.events.push({ t: 'mine', x: p.wx[i], y: p.wy[i], kind: 0, value: 0, hue: p.hue });
      p.kind[i] = BLOCK.EMPTY;
    }
  }
  p.remaining = 0;
  const bonus = leftover * st.collapseValue * st.silverMul;
  earn(s, bonus);
  s.events.push({ t: 'core', x: p.wx[p.core], y: p.wy[p.core], bonus });
  s.phase = 'collapse';
  s.phaseLeft = REGION.collapseSeconds;
  s.regionsMined += 1;
  s.runePicks += 1;
  s.ravens.forEach((b) => (b.target = -1));
}

function killCell(s: GameState, st: Stats, i: number): void {
  const p = s.region;
  const kind = p.kind[i];
  if (kind === BLOCK.EMPTY) return;
  p.kind[i] = BLOCK.EMPTY;
  p.remaining -= 1;
  const kindPay = kind === BLOCK.GOLD ? st.goldPayMul : kind === BLOCK.CORE ? st.corePayMul : st.rockPayMul;
  const value = p.value[i] * st.silverMul * kindPay * st.berserkPayMul;
  earn(s, value);
  s.events.push({ t: 'mine', x: p.wx[i], y: p.wy[i], kind, value, hue: p.hue });
  if (kind === BLOCK.MEAD) {
    s.berserkCharge = Math.min(1, s.berserkCharge + st.berserkCharge);
    if (st.meadBursts) {
      blastQueue.push(i);
      s.events.push({ t: 'burst', x: p.wx[i], y: p.wy[i] });
    }
  } else if (kind === BLOCK.GAS) {
    blastQueue.push(i);
    s.events.push({ t: 'burst', x: p.wx[i], y: p.wy[i] });
  } else if (kind === BLOCK.CORE) {
    blastQueue.length = 0;
    collapseRegion(s, st);
  }
}

function damageCell(s: GameState, st: Stats, i: number, amount: number): void {
  const p = s.region;
  if (p.kind[i] === BLOCK.EMPTY) return;
  p.hp[i] -= amount;
  if (p.hp[i] <= 0) killCell(s, st, i);
  else s.events.push({ t: 'hit', cell: i });
}

function runBlasts(s: GameState, st: Stats): void {
  while (blastQueue.length > 0 && s.phase === 'mining') {
    const centre = blastQueue.pop() as number;
    const p = s.region;
    forEachInRange(p, centre, st.blastRings, (cell) => {
      if (p.kind[cell] === BLOCK.EMPTY) return;
      // The core shrugs off the percentage part, or gass would one-shot it.
      const amount = p.kind[cell] === BLOCK.CORE
        ? st.drillDamage * GAS.drillShare * st.blastMul
        : (p.maxHp[cell] * GAS.hpShare + st.drillDamage) * st.blastMul;
      damageCell(s, st, cell, amount);
    });
  }
}

function pickTarget(s: GameState, st: Stats): void {
  const p = s.region;
  const w = s.ship;
  const fromX = s.waypoint ? s.waypoint.x : w.x;
  const fromY = s.waypoint ? s.waypoint.y : w.y;
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);
  const coreOpen = s.waypoint !== null || p.remaining <= p.total * st.coreSeekAt;
  const wander = Math.floor(s.time / 2);
  let best = -1;
  let bestScore = Infinity;
  for (const i of p.cells) {
    const kind = p.kind[i];
    if (kind === BLOCK.EMPTY || (kind === BLOCK.CORE && !coreOpen)) continue;
    const dx = p.wx[i] - fromX;
    const dy = p.wy[i] - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Prefer what lies ahead so the ship sweeps through instead of jittering.
    const ahead = s.waypoint ? 0 : (dx * cos + dy * sin) / (dist + 1);
    let score = dist * (1.4 - 0.6 * ahead);
    if (kind === BLOCK.GOLD) score -= st.goldPull;
    else if (kind === BLOCK.MEAD) score -= 25;
    else if (kind === BLOCK.CORE && !s.waypoint) score -= 100000;
    score += (Math.imul(i + wander, 2654435761) >>> 24) * 0.12;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Only the core left, and the gate above did not open: go for it anyway.
  w.target = best === -1 && p.kind[p.core] === BLOCK.CORE ? p.core : best;
}

function updateShip(s: GameState, st: Stats, dt: number): void {
  const w = s.ship;
  const p = s.region;

  let tx: number;
  let ty: number;
  if (s.phase === 'collapse') {
    // Coast outward through the wreckage.
    tx = w.x + Math.cos(w.angle + 0.6) * 100;
    ty = w.y + Math.sin(w.angle + 0.6) * 100;
  } else {
    w.retarget -= dt;
    if (w.retarget <= 0 || w.target < 0 || p.kind[w.target] === BLOCK.EMPTY) {
      pickTarget(s, st);
      w.retarget = 0.35;
    }
    if (w.target < 0) return;
    tx = p.wx[w.target];
    ty = p.wy[w.target];
  }

  let delta = Math.atan2(ty - w.y, tx - w.x) - w.angle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const turn = SHIP.turnRate * dt;
  w.angle += Math.max(-turn, Math.min(turn, delta));
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);

  const front = s.phase === 'mining' ? cellAt(p, w.x + cos * SHIP.lookAhead, w.y + sin * SHIP.lookAhead) : -1;
  if (front >= 0 && p.kind[front] !== BLOCK.EMPTY) {
    w.drilling = true;
    w.drillTimer -= dt;
    while (w.drillTimer <= 0 && s.phase === 'mining') {
      w.drillTimer += 1 / st.drillRate;
      damageCell(s, st, front, st.drillDamage);
    }
    return;
  }

  w.drilling = false;
  w.drillTimer = Math.min(w.drillTimer, 1 / st.drillRate);
  const move = st.speed * dt;
  w.x += cos * move;
  w.y += sin * move;
  w.sinceSample += move;
  while (w.sinceSample >= SHIP.trailSampleDist) {
    w.sinceSample -= SHIP.trailSampleDist;
    pushTrail(w);
  }
}

function updateGrind(s: GameState, st: Stats, dt: number): void {
  const w = s.ship;
  w.grindTimer -= dt;
  if (w.grindTimer > 0) return;
  w.grindTimer += SHIP.grindEvery;
  const p = s.region;
  for (let seg = 0; seg < st.segments && s.phase === 'mining'; seg++) {
    segmentPos(w, seg, pos);
    const at = cellAt(p, pos.x, pos.y);
    if (at < 0) continue;
    for (let dir = 0; dir < 6; dir++) {
      const n = neighbourOf(p, at, (dir + seg) % 6);
      if (n >= 0 && p.kind[n] !== BLOCK.EMPTY && p.kind[n] !== BLOCK.CORE) {
        damageCell(s, st, n, st.grindDamage);
        break;
      }
    }
  }
}

function updateThunder(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.thunder === 0) return;
  const w = s.ship;
  w.thunderTimer -= dt;
  if (w.thunderTimer > 0) return;
  w.thunderTimer = st.thunderCooldown;
  const p = s.region;
  let best = -1;
  let bestDist = 0;
  for (const i of p.cells) {
    const kind = p.kind[i];
    if (kind === BLOCK.EMPTY || kind === BLOCK.CORE) continue;
    const d = Math.hypot(p.wx[i] - w.x, p.wy[i] - w.y);
    // Farthest cell still in range: thunder opens new fronts for the ship.
    if (d <= THUNDER.range && d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return;
  s.events.push({ t: 'bolt', x0: w.x, y0: w.y, x1: p.wx[best], y1: p.wy[best] });
  forEachInRange(p, best, st.thunderRings, (cell) => {
    if (s.phase === 'mining' && p.kind[cell] !== BLOCK.CORE) damageCell(s, st, cell, st.thunderDamage);
  });
}

function randomSolid(s: GameState): number {
  const p = s.region;
  for (let tries = 0; tries < 8; tries++) {
    const i = p.cells[Math.floor(Math.random() * p.cells.length)];
    if (p.kind[i] !== BLOCK.EMPTY && p.kind[i] !== BLOCK.CORE) return i;
  }
  return -1;
}

function updateRavens(s: GameState, st: Stats, dt: number): void {
  const w = s.ship;
  while (s.ravens.length < st.ravenCount) {
    s.ravens.push({ x: w.x, y: w.y, target: -1, cooldown: 0 });
  }
  const p = s.region;
  for (const b of s.ravens) {
    if (s.phase === 'mining' && (b.target < 0 || p.kind[b.target] === BLOCK.EMPTY)) b.target = randomSolid(s);
    const homeward = b.target < 0 || s.phase !== 'mining';
    const tx = homeward ? w.x : p.wx[b.target];
    const ty = homeward ? w.y : p.wy[b.target];
    const dist = Math.hypot(tx - b.x, ty - b.y);
    if (!homeward && dist < 6) {
      b.cooldown -= dt;
      if (b.cooldown <= 0) {
        b.cooldown = RAVENS.strikeEvery;
        damageCell(s, st, b.target, st.ravenDamage);
      }
    } else if (dist > 1) {
      const move = Math.min(dist, RAVENS.speed * dt);
      b.x += ((tx - b.x) / dist) * move;
      b.y += ((ty - b.y) / dist) * move;
    }
  }
}

function nextRegion(s: GameState): void {
  s.regionIndex += 1;
  s.runBestRegion = Math.max(s.runBestRegion, s.regionIndex);
  s.bestRegion = Math.max(s.bestRegion, s.regionIndex);
  s.region = makeRegion(s.regionIndex, (s.seed + s.regionIndex * 104729) | 0);
  placeShip(s.ship, s.region, s.seed + s.regionIndex);
  s.phase = 'mining';
  s.events.push({ t: 'region', name: s.region.name, index: s.regionIndex });
}

export function triggerBerserk(s: GameState): boolean {
  if (s.berserkCharge < 1 || s.berserkLeft > 0) return false;
  s.berserkCharge = 0;
  s.berserkLeft = computeStats(s).berserkSeconds;
  s.events.push({ t: 'berserk' });
  return true;
}

export function setWaypoint(s: GameState, x: number, y: number): void {
  s.waypoint = { x, y, left: 4 };
  s.ship.retarget = 0;
  s.events.push({ t: 'waypoint', x, y });
}

export function step(s: GameState, dt: number): void {
  s.time += dt;
  const st = computeStats(s);

  if (s.berserkLeft > 0) s.berserkLeft = Math.max(0, s.berserkLeft - dt);
  if (s.waypoint) {
    s.waypoint.left -= dt;
    if (s.waypoint.left <= 0) s.waypoint = null;
  }

  updateShip(s, st, dt);
  if (s.phase === 'mining') {
    updateGrind(s, st, dt);
    updateThunder(s, st, dt);
    runBlasts(s, st);
  }
  updateRavens(s, st, dt);
  runBlasts(s, st);

  if (s.phase === 'collapse') {
    s.phaseLeft -= dt;
    if (s.phaseLeft <= 0) nextRegion(s);
  }

  s.rateTimer -= dt;
  if (s.rateTimer <= 0) {
    s.rateTimer += 1;
    s.rate = s.rate * 0.9 + s.rateWindow * 0.1;
    s.rateWindow = 0;
  }

  s.autoTimer -= dt;
  if (s.autoTimer <= 0) {
    s.autoTimer += 1;
    if (s.perks.foreman > 0) {
      autoBuy(s);
      triggerBerserk(s);
    }
  }

  // The renderer empties this every frame; the cap protects headless runs.
  if (s.events.length > 2000) s.events.length = 0;
}

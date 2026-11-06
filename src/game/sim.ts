// The rules of the game. Nothing here touches the screen, so the same code
// runs in the browser and in the headless balance simulator.
import { BLOCK, GAS, RAVENS, REGION, SHIP, TOOL_SHAPES } from './config.ts';
import { autoBuy, computeStats, type Stats } from './economy.ts';
import { cellAt, forEachInRange, makeRegion, neighbourOf, regionSeed } from './region.ts';
import { placeShip, pushTrail, segmentPos, type GameState, type Raven } from './state.ts';

const pos = { x: 0, y: 0 };
const blastQueue: number[] = [];

function earn(s: GameState, amount: number): void {
  s.silver += amount;
  s.runSilver += amount;
  s.lifetimeSilver += amount;
  s.rateWindow += amount;
}

/** The Worldheart has fallen: queue what's left to pop in rings, nearest first. */
function startCollapse(s: GameState, st: Stats): void {
  const p = s.region;
  const cx = p.wx[p.core];
  const cy = p.wy[p.core];
  const dist = (i: number) => Math.hypot(p.wx[i] - cx, p.wy[i] - cy);
  const order: number[] = [];
  let leftover = 0;
  for (const i of p.cells) {
    if (p.kind[i] !== BLOCK.EMPTY) {
      order.push(i);
      leftover += p.value[i];
    }
  }
  order.sort((a, b) => dist(a) - dist(b));
  const pay = st.collapseValue * st.silverMul;
  s.sweep = { order, next: 0, elapsed: 0, tick: 0, pay, maxDist: order.length ? dist(order[order.length - 1]) : 1 };
  s.events.push({ t: 'core', x: cx, y: cy, bonus: leftover * pay });
  s.phase = 'collapse';
  s.phaseLeft = REGION.collapseSeconds;
  s.regionsMined += 1;
  s.runePicks += 1;
  s.reveal.length = 0;
}

function updateSweep(s: GameState, dt: number): void {
  const sw = s.sweep;
  if (!sw) return;
  const p = s.region;
  sw.elapsed += dt;
  const progress = Math.min(1, sw.elapsed / (REGION.collapseSeconds * 0.8));
  const reach = progress * sw.maxDist;
  const cx = p.wx[p.core];
  const cy = p.wy[p.core];
  while (sw.next < sw.order.length) {
    const i = sw.order[sw.next];
    if (Math.hypot(p.wx[i] - cx, p.wy[i] - cy) > reach) break;
    sw.next += 1;
    earn(s, p.value[i] * sw.pay);
    s.events.push({ t: 'mine', x: p.wx[i], y: p.wy[i], kind: 0, value: 0, hue: p.hue });
    p.kind[i] = BLOCK.EMPTY;
    p.remaining -= 1;
  }
  sw.tick -= dt;
  if (sw.tick <= 0 && progress < 1) {
    sw.tick = 0.12;
    s.events.push({ t: 'wave', progress });
  }
}

function killCell(s: GameState, st: Stats, i: number): void {
  const p = s.region;
  const kind = p.kind[i];
  if (kind === BLOCK.EMPTY) return;
  p.kind[i] = BLOCK.EMPTY;
  p.remaining -= 1;
  const kindPay = kind === BLOCK.GOLD ? st.goldPayMul : kind === BLOCK.CORE ? st.corePayMul : st.rockPayMul;
  // The Worldheart paid part of its value on the way down, so only the rest is left.
  const share = kind === BLOCK.CORE ? 1 - REGION.corePaidAsMined : 1;
  const value = p.value[i] * share * st.silverMul * kindPay * st.berserkPayMul;
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
    startCollapse(s, st);
  }
}

function damageCell(s: GameState, st: Stats, i: number, amount: number, drill = false): void {
  const p = s.region;
  if (p.kind[i] === BLOCK.EMPTY) return;
  if (p.kind[i] === BLOCK.CORE) {
    const before = Math.max(0, p.hp[i] / p.maxHp[i]);
    const after = Math.max(0, (p.hp[i] - amount) / p.maxHp[i]);
    earn(s, p.value[i] * REGION.corePaidAsMined * (before - after) * st.silverMul * st.corePayMul * st.berserkPayMul);
  }
  p.hp[i] -= amount;
  if (p.hp[i] <= 0) killCell(s, st, i);
  else s.events.push({ t: 'hit', cell: i, drill });
}

function runBlasts(s: GameState, st: Stats): void {
  while (blastQueue.length > 0 && s.phase === 'mining') {
    const centre = blastQueue.pop() as number;
    const p = s.region;
    forEachInRange(p, centre, st.blastRings, (cell) => {
      if (p.kind[cell] === BLOCK.EMPTY || s.phase !== 'mining') return;
      // The core shrugs off the percentage part, or gas would one-shot it.
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
  const coreDue = p.remaining <= p.total * st.coreSeekAt;
  const coreOpen = coreDue || (s.waypoint !== null && p.seen[p.core] === 1);
  const wander = Math.floor(s.time / 2);

  const scan = (seenOnly: boolean): number => {
    let best = -1;
    let bestScore = Infinity;
    for (const i of p.cells) {
      const kind = p.kind[i];
      if (kind === BLOCK.EMPTY || (kind === BLOCK.CORE && !coreOpen)) continue;
      if (seenOnly && p.seen[i] === 0 && kind !== BLOCK.CORE) continue;
      const dx = p.wx[i] - fromX;
      const dy = p.wy[i] - fromY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Prefer what lies ahead so the ship sweeps through instead of jittering.
      const ahead = s.waypoint ? 0 : (dx * cos + dy * sin) / (dist + 1);
      let score = dist * (1.4 - 0.6 * ahead);
      if (kind === BLOCK.GOLD) score -= st.goldPull;
      else if (kind === BLOCK.FIND) score -= st.goldPull * 1.5;
      else if (kind === BLOCK.MEAD) score -= 18;
      else if (kind === BLOCK.CORE && !s.waypoint) score -= 100000;
      score += (Math.imul(i + wander, 2654435761) >>> 24) * 0.06;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };

  // The ship works what it can see. A tap can send it into the fog on purpose.
  let best = scan(s.waypoint === null);
  if (best === -1) best = scan(false);
  // Only the core left, and the gate above did not open: go for it anyway.
  w.target = best === -1 && p.kind[p.core] === BLOCK.CORE ? p.core : best;
}

function updateLamp(s: GameState): void {
  const w = s.ship;
  const p = s.region;
  const at = cellAt(p, w.x + Math.cos(w.angle) * SHIP.lookAhead, w.y + Math.sin(w.angle) * SHIP.lookAhead);
  if (at < 0 || at === w.lampCell) return;
  w.lampCell = at;
  forEachInRange(p, at, SHIP.lampRings, (cell) => {
    p.seen[cell] = 1;
  });
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
  if (s.phase === 'mining') updateLamp(s);

  const front = s.phase === 'mining' ? cellAt(p, w.x + cos * SHIP.lookAhead, w.y + sin * SHIP.lookAhead) : -1;
  if (front >= 0 && p.kind[front] !== BLOCK.EMPTY) {
    w.drilling = true;
    w.drillTimer -= dt;
    while (w.drillTimer <= 0 && s.phase === 'mining') {
      w.drillTimer += 1 / st.drillRate;
      damageCell(s, st, front, st.drillDamage, true);
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

function updateCutters(s: GameState, st: Stats, dt: number): void {
  if (st.pods === 0) return;
  const w = s.ship;
  w.grindTimer -= dt;
  if (w.grindTimer > 0) return;
  w.grindTimer += st.cutEvery;
  const p = s.region;
  for (let seg = 0; seg < st.pods && s.phase === 'mining'; seg++) {
    segmentPos(w, seg, pos);
    const at = cellAt(p, pos.x, pos.y);
    if (at < 0) continue;
    for (let dir = 0; dir < 6; dir++) {
      const n = neighbourOf(p, at, (dir + seg) % 6);
      if (n >= 0 && p.kind[n] !== BLOCK.EMPTY && p.kind[n] !== BLOCK.CORE) {
        damageCell(s, st, n, st.cutDamage);
        break;
      }
    }
  }
}

function updateSweepArms(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.sweep === 0) return;
  const w = s.ship;
  w.sweepTimer -= dt;
  if (w.sweepTimer > 0 || !w.drilling) return;
  w.sweepTimer = st.sweepEvery;
  const p = s.region;
  s.events.push({ t: 'swing', x: w.x, y: w.y, angle: w.angle });
  for (const side of [-1, 0, 1]) {
    const a = w.angle + side * TOOL_SHAPES.sweepSpread;
    const cell = cellAt(p, w.x + Math.cos(a) * TOOL_SHAPES.sweepReach, w.y + Math.sin(a) * TOOL_SHAPES.sweepReach);
    if (cell >= 0 && s.phase === 'mining') damageCell(s, st, cell, st.sweepDamage);
  }
}

function updateLance(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.lance === 0) return;
  const w = s.ship;
  w.lanceTimer -= dt;
  if (w.lanceTimer > 0 || !w.drilling) return;
  w.lanceTimer = st.lanceEvery;
  const p = s.region;
  const reach = TOOL_SHAPES.lanceHexes * 10;
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);
  s.events.push({ t: 'lance', x0: w.x, y0: w.y, x1: w.x + cos * reach, y1: w.y + sin * reach });
  for (let k = 1; k <= TOOL_SHAPES.lanceHexes; k++) {
    const cell = cellAt(p, w.x + cos * k * 10, w.y + sin * k * 10);
    if (cell >= 0 && s.phase === 'mining') damageCell(s, st, cell, st.lanceDamage);
  }
}

function updateThunder(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.thunder === 0) return;
  const w = s.ship;
  w.thunderTimer -= dt;
  if (w.thunderTimer > 0) return;
  w.thunderTimer = st.thunderEvery;
  const p = s.region;
  let best = -1;
  let bestDist = 0;
  for (const i of p.cells) {
    const kind = p.kind[i];
    if (kind === BLOCK.EMPTY || kind === BLOCK.CORE || p.seen[i] === 0) continue;
    const d = Math.hypot(p.wx[i] - w.x, p.wy[i] - w.y);
    // Farthest cell still in range: thunder opens new fronts for the ship.
    if (d <= TOOL_SHAPES.thunderRange && d > bestDist) {
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

function updatePulse(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.pulse === 0) return;
  const w = s.ship;
  w.pulseTimer -= dt;
  if (w.pulseTimer > 0) return;
  const p = s.region;
  const at = cellAt(p, w.x, w.y);
  if (at < 0) return;
  w.pulseTimer = st.pulseEvery;
  s.events.push({ t: 'pulse', x: w.x, y: w.y });
  forEachInRange(p, at, TOOL_SHAPES.pulseRings, (cell) => {
    if (s.phase === 'mining' && p.kind[cell] !== BLOCK.CORE) damageCell(s, st, cell, st.pulseDamage);
  });
}

function launchRaven(s: GameState, st: Stats, r: Raven): void {
  const p = s.region;
  const w = s.ship;
  let best = -1;
  let bestDist = 0;
  // A few random picks is plenty: this only needs a direction worth scouting.
  for (let tries = 0; tries < 40; tries++) {
    const i = p.cells[Math.floor(Math.random() * p.cells.length)];
    if (p.seen[i] === 1) continue;
    const d = Math.hypot(p.wx[i] - w.x, p.wy[i] - w.y);
    if (d <= st.ravenRange && d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) {
    r.wait = 3;
    return;
  }
  r.tx = p.wx[best];
  r.ty = p.wy[best];
  r.state = 'out';
  r.path.clear();
  r.lastCell = -1;
}

function updateRavens(s: GameState, st: Stats, dt: number): void {
  const w = s.ship;
  const p = s.region;
  while (s.ravens.length < st.ravenCount) {
    s.ravens.push({ x: w.x, y: w.y, state: 'rest', wait: s.ravens.length * RAVENS.restSeconds, tx: 0, ty: 0, path: new Set(), lastCell: -1 });
  }
  for (const r of s.ravens) {
    if (r.state === 'rest') {
      r.x = w.x;
      r.y = w.y;
      r.wait -= dt;
      if (r.wait <= 0 && s.phase === 'mining') launchRaven(s, st, r);
      continue;
    }
    const homeward = r.state === 'back' || s.phase !== 'mining';
    const tx = homeward ? w.x : r.tx;
    const ty = homeward ? w.y : r.ty;
    const dist = Math.hypot(tx - r.x, ty - r.y);
    const move = st.ravenSpeed * dt * (s.phase === 'mining' ? 1 : 4);
    if (dist <= Math.max(move, 3)) {
      if (!homeward) {
        r.state = 'back';
      } else {
        // Home with the report: what it saw appears now, nearest first.
        if (s.phase === 'mining') s.reveal.push(...r.path);
        r.path.clear();
        r.state = 'rest';
        r.wait = RAVENS.restSeconds;
      }
      continue;
    }
    r.x += ((tx - r.x) / dist) * move;
    r.y += ((ty - r.y) / dist) * move;
    if (r.state === 'out') {
      const at = cellAt(p, r.x, r.y);
      if (at >= 0 && at !== r.lastCell) {
        r.lastCell = at;
        forEachInRange(p, at, st.ravenWidth, (cell) => {
          if (p.seen[cell] === 0 && p.kind[cell] !== BLOCK.EMPTY) r.path.add(cell);
        });
      }
    }
  }
}

/** Reveals reported hexes a few at a time. Rare ore exists only if a raven finds it. */
function updateReveal(s: GameState, st: Stats): void {
  const p = s.region;
  for (let n = 0; n < RAVENS.revealPerTick && s.reveal.length > 0; n++) {
    const cell = s.reveal.shift() as number;
    if (p.seen[cell] === 1) continue;
    p.seen[cell] = 1;
    s.events.push({ t: 'reveal', cell });
    if (p.kind[cell] === BLOCK.ROCK && Math.random() < st.findChance) {
      p.kind[cell] = BLOCK.FIND;
      p.value[cell] *= RAVENS.findValue;
      s.events.push({ t: 'find', x: p.wx[cell], y: p.wy[cell] });
    }
  }
}

function nextRegion(s: GameState): void {
  s.regionIndex += 1;
  s.runBestRegion = Math.max(s.runBestRegion, s.regionIndex);
  s.bestRegion = Math.max(s.bestRegion, s.regionIndex);
  s.region = makeRegion(s.regionIndex, regionSeed(s.seed, s.regionIndex));
  placeShip(s.ship, s.region, s.seed + s.regionIndex);
  s.sweep = null;
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
    updateCutters(s, st, dt);
    updateSweepArms(s, st, dt);
    updateLance(s, st, dt);
    updateThunder(s, st, dt);
    updatePulse(s, st, dt);
    runBlasts(s, st);
    updateReveal(s, st);
  }
  updateRavens(s, st, dt);

  if (s.phase === 'collapse') {
    updateSweep(s, dt);
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
  if (s.events.length > 4000) s.events.length = 0;
}

// The rules of the game. Nothing here touches the screen, so the same code
// runs in the browser and in the headless balance simulator.
import { BERSERK, BLOCK, GAS, RAVENS, REGION, SHIP, TARGETING, TOOL_SHAPES } from './config.ts';
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
      leftover += p.value[i] * (p.kind[i] === BLOCK.FIND ? st.findValue : 1);
    }
  }
  order.sort((a, b) => dist(a) - dist(b));
  const pay = st.collapseValue * st.silverMul;
  s.sweep = { order, next: 0, elapsed: 0, tick: 0, pay, findValue: st.findValue, maxDist: order.length ? dist(order[order.length - 1]) : 1 };
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
    earn(s, p.value[i] * sw.pay * (p.kind[i] === BLOCK.FIND ? sw.findValue : 1));
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
  p.seen[i] = 1;
  p.remaining -= 1;
  const kindPay = kind === BLOCK.GOLD ? st.goldPayMul
    : kind === BLOCK.CORE ? st.corePayMul
      : kind === BLOCK.FIND ? st.rockPayMul * st.findValue
        : st.rockPayMul;
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
    if (!p.coreOpen) return; // sealed: nothing can touch it yet
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

/**
 * How much the ship wants a block; lower wins. Nearby, damaged beats special beats
 * normal, and open sides break the ties, so it finishes what it started and clears
 * a face instead of boring tunnels.
 */
function scoreCell(s: GameState, st: Stats, i: number, cos: number, sin: number): number {
  const p = s.region;
  const w = s.ship;
  const kind = p.kind[i];
  const dx = p.wx[i] - w.x;
  const dy = p.wy[i] - w.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ahead = (dx * cos + dy * sin) / (dist + 1);
  let open = 0;
  for (let dir = 0; dir < 6; dir++) {
    const n = neighbourOf(p, i, dir);
    if (n < 0 || p.kind[n] === BLOCK.EMPTY) open += 1;
  }
  let bonus = 0;
  if (p.hp[i] < p.maxHp[i]) bonus = TARGETING.damaged;
  else if (kind === BLOCK.FIND) bonus = st.goldPull * TARGETING.gemMul;
  else if (kind === BLOCK.GOLD) bonus = st.goldPull;
  else if (kind === BLOCK.MEAD) bonus = TARGETING.mead;
  else if (kind === BLOCK.GAS) bonus = TARGETING.gas;
  if (open === 0) bonus *= TARGETING.buriedShare;
  return dist * (1.4 - TARGETING.aheadWeight * ahead) - bonus - open * TARGETING.openSide;
}

/**
 * Chooses the next block, only once the last one is gone. Priority: the player's
 * tap, then the Worldheart once it's open and the region is nearly done, then the
 * best block the crew can see.
 */
function pickTarget(s: GameState, st: Stats): void {
  const p = s.region;
  const w = s.ship;
  if (s.waypoint) {
    if (p.kind[s.waypoint.cell] !== BLOCK.EMPTY) {
      w.target = s.waypoint.cell;
      return;
    }
    s.waypoint = null;
  }
  const coreLive = p.coreOpen && p.kind[p.core] === BLOCK.CORE;
  if (coreLive && p.remaining <= p.total * st.coreHuntAt) {
    w.target = p.core;
    return;
  }
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);
  const scan = (seenOnly: boolean): number => {
    let best = -1;
    let bestScore = Infinity;
    for (const i of p.cells) {
      const kind = p.kind[i];
      if (kind === BLOCK.EMPTY || kind === BLOCK.CORE || (seenOnly && p.seen[i] === 0)) continue;
      const score = scoreCell(s, st, i, cos, sin);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };
  w.target = scan(true);
  if (w.target === -1) w.target = scan(false);
  if (w.target === -1 && coreLive) w.target = p.core;
}

/** Sight lines from the ship: they cross open space and stop at the first solid hex. */
function updateSight(s: GameState, dt: number): void {
  const w = s.ship;
  w.sightTimer -= dt;
  if (w.sightTimer > 0) return;
  w.sightTimer = SHIP.sightEvery;
  const p = s.region;
  const reach = SHIP.sightHexes * 10;
  for (let ray = 0; ray < SHIP.sightRays; ray++) {
    const a = (ray / SHIP.sightRays) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let solids = 0;
    let last = -1;
    for (let d = 5; d <= reach && solids < SHIP.sightSolids; d += 4) {
      const cell = cellAt(p, w.x + cos * d, w.y + sin * d);
      if (cell < 0 || cell === last) continue;
      last = cell;
      p.seen[cell] = 1;
      if (p.kind[cell] !== BLOCK.EMPTY) solids += 1;
    }
  }
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
    if (w.target < 0 || p.kind[w.target] === BLOCK.EMPTY) pickTarget(s, st);
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
  // The Worldheart only stops the ship when it's the target; otherwise it passes over.
  const passable = front < 0 || p.kind[front] === BLOCK.EMPTY || (p.kind[front] === BLOCK.CORE && front !== w.target);
  if (!passable) {
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
  // Turn on the spot for a close target, or the ship can circle it forever.
  if (s.phase === 'mining' && Math.abs(delta) > 0.7 && Math.hypot(tx - w.x, ty - w.y) < 18) return;
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

/** Uncharted hexes along a straight flight from the ship. */
function unchartedAlong(s: GameState, angle: number, reach: number): number {
  const p = s.region;
  const w = s.ship;
  let count = 0;
  for (let d = 10; d <= reach; d += 10) {
    const cell = cellAt(p, w.x + Math.cos(angle) * d, w.y + Math.sin(angle) * d);
    if (cell >= 0 && p.seen[cell] === 0 && p.kind[cell] !== BLOCK.EMPTY) count += 1;
  }
  return count;
}

function launchRaven(s: GameState, st: Stats, r: Raven): void {
  const w = s.ship;
  let angle = Math.random() * Math.PI * 2;
  // A smarter raven compares a few headings and takes the most uncharted one.
  if (Math.random() < st.ravenSmart) {
    let most = -1;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const count = unchartedAlong(s, a, st.ravenRange);
      if (count > most) {
        most = count;
        angle = a;
      }
    }
  }
  r.tx = w.x + Math.cos(angle) * st.ravenRange;
  r.ty = w.y + Math.sin(angle) * st.ravenRange;
  r.state = 'out';
  r.path.clear();
  r.lastCell = -1;
}

/** A trip finds at most one gem. Rare ore exists only if a raven finds it. */
function reportTrip(s: GameState, st: Stats, r: Raven): void {
  const p = s.region;
  const cells = [...r.path];
  r.path.clear();
  s.reveal.push(...cells);
  if (Math.random() >= st.findChance) return;
  const rock = cells.filter((cell) => p.kind[cell] === BLOCK.ROCK);
  if (rock.length > 0) p.kind[rock[Math.floor(Math.random() * rock.length)]] = BLOCK.FIND;
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
        if (s.phase === 'mining') reportTrip(s, st, r);
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

/** Reveals reported hexes a few at a time, nearest first. */
function updateReveal(s: GameState): void {
  const p = s.region;
  for (let n = 0; n < RAVENS.revealPerTick && s.reveal.length > 0; n++) {
    const cell = s.reveal.shift() as number;
    if (p.seen[cell] === 1) continue;
    p.seen[cell] = 1;
    s.events.push({ t: 'reveal', cell });
    if (p.kind[cell] === BLOCK.FIND) s.events.push({ t: 'find', x: p.wx[cell], y: p.wy[cell] });
  }
}

function updateSeal(s: GameState, st: Stats): void {
  const p = s.region;
  if (p.coreOpen || p.remaining > p.total * st.coreOpenAt) return;
  p.coreOpen = true;
  s.events.push({ t: 'unseal', x: p.wx[p.core], y: p.wy[p.core] });
}

function nextRegion(s: GameState): void {
  s.regionIndex += 1;
  s.runBestRegion = Math.max(s.runBestRegion, s.regionIndex);
  s.bestRegion = Math.max(s.bestRegion, s.regionIndex);
  s.region = makeRegion(s.regionIndex, regionSeed(s.seed, s.regionIndex));
  placeShip(s.ship, s.region, s.seed + s.regionIndex);
  s.sweep = null;
  s.waypoint = null;
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

/** A tap holds until that block is gone. Open space means the nearest block to the tap. */
export function setWaypoint(s: GameState, x: number, y: number): void {
  const p = s.region;
  const usable = (i: number) => p.kind[i] !== BLOCK.EMPTY && (p.kind[i] !== BLOCK.CORE || p.coreOpen);
  let cell = cellAt(p, x, y);
  if (cell < 0 || !usable(cell)) {
    cell = -1;
    let nearest = Infinity;
    for (const i of p.cells) {
      if (!usable(i)) continue;
      const d = Math.hypot(p.wx[i] - x, p.wy[i] - y);
      if (d < nearest) {
        nearest = d;
        cell = i;
      }
    }
  }
  if (cell < 0) return;
  s.waypoint = { x: p.wx[cell], y: p.wy[cell], cell };
  s.ship.target = cell;
  s.events.push({ t: 'waypoint', x: p.wx[cell], y: p.wy[cell] });
}

export function step(s: GameState, dt: number): void {
  s.time += dt;
  const st = computeStats(s);

  if (s.berserkLeft > 0) s.berserkLeft = Math.max(0, s.berserkLeft - dt);
  else if (s.berserkCharge < 1) s.berserkCharge = Math.min(1, s.berserkCharge + dt / BERSERK.rechargeSeconds);
  if (s.waypoint && s.region.kind[s.waypoint.cell] === BLOCK.EMPTY) s.waypoint = null;
  if (s.phase === 'mining') {
    updateSeal(s, st);
    updateSight(s, dt);
  }

  updateShip(s, st, dt);
  if (s.phase === 'mining') {
    updateCutters(s, st, dt);
    updateSweepArms(s, st, dt);
    updateLance(s, st, dt);
    updateThunder(s, st, dt);
    updatePulse(s, st, dt);
    runBlasts(s, st);
    updateReveal(s);
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

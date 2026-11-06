// The rules of the game. Nothing here touches the screen, so the same code
// runs in the browser and in the headless balance simulator.
import { BLISTER, BLOCK, BROOD, PLANET, SPIT, WORM } from './config.ts';
import { autoBuy, computeStats, type Stats } from './economy.ts';
import { cellAt, forEachInRange, makePlanet, neighbourOf } from './planet.ts';
import { placeWorm, pushTrail, segmentPos, type GameState } from './state.ts';

const pos = { x: 0, y: 0 };
const blastQueue: number[] = [];

function earn(s: GameState, amount: number): void {
  s.biomass += amount;
  s.runBiomass += amount;
  s.lifetimeBiomass += amount;
  s.rateWindow += amount;
}

function collapsePlanet(s: GameState, st: Stats): void {
  const p = s.planet;
  let leftover = 0;
  for (const i of p.cells) {
    if (p.kind[i] !== BLOCK.EMPTY) {
      leftover += p.value[i];
      s.events.push({ t: 'eat', x: p.wx[i], y: p.wy[i], kind: 0, value: 0, hue: p.hue });
      p.kind[i] = BLOCK.EMPTY;
    }
  }
  p.remaining = 0;
  const bonus = leftover * st.collapseValue * st.biomassMul;
  earn(s, bonus);
  s.events.push({ t: 'heart', x: p.wx[p.heart], y: p.wy[p.heart], bonus });
  s.phase = 'collapse';
  s.phaseLeft = PLANET.collapseSeconds;
  s.planetsEaten += 1;
  s.mutationPicks += 1;
  s.brood.forEach((b) => (b.target = -1));
}

function killCell(s: GameState, st: Stats, i: number): void {
  const p = s.planet;
  const kind = p.kind[i];
  if (kind === BLOCK.EMPTY) return;
  p.kind[i] = BLOCK.EMPTY;
  p.remaining -= 1;
  const kindPay = kind === BLOCK.NECTAR ? st.nectarPayMul : kind === BLOCK.HEART ? st.heartPayMul : st.crustPayMul;
  const value = p.value[i] * st.biomassMul * kindPay * st.frenzyPayMul;
  earn(s, value);
  s.events.push({ t: 'eat', x: p.wx[i], y: p.wy[i], kind, value, hue: p.hue });
  if (kind === BLOCK.PULSE) {
    s.frenzyCharge = Math.min(1, s.frenzyCharge + st.frenzyCharge);
    if (st.pulseBursts) {
      blastQueue.push(i);
      s.events.push({ t: 'burst', x: p.wx[i], y: p.wy[i] });
    }
  } else if (kind === BLOCK.BLISTER) {
    blastQueue.push(i);
    s.events.push({ t: 'burst', x: p.wx[i], y: p.wy[i] });
  } else if (kind === BLOCK.HEART) {
    blastQueue.length = 0;
    collapsePlanet(s, st);
  }
}

function damageCell(s: GameState, st: Stats, i: number, amount: number): void {
  const p = s.planet;
  if (p.kind[i] === BLOCK.EMPTY) return;
  p.hp[i] -= amount;
  if (p.hp[i] <= 0) killCell(s, st, i);
  else s.events.push({ t: 'hit', cell: i });
}

function runBlasts(s: GameState, st: Stats): void {
  while (blastQueue.length > 0 && s.phase === 'eating') {
    const centre = blastQueue.pop() as number;
    const p = s.planet;
    forEachInRange(p, centre, st.blastRings, (cell) => {
      if (p.kind[cell] === BLOCK.EMPTY) return;
      // The heart shrugs off the percentage part, or blisters would one-shot it.
      const amount = p.kind[cell] === BLOCK.HEART
        ? st.jawDamage * BLISTER.jawShare * st.blastMul
        : (p.maxHp[cell] * BLISTER.hpShare + st.jawDamage) * st.blastMul;
      damageCell(s, st, cell, amount);
    });
  }
}

function pickTarget(s: GameState, st: Stats): void {
  const p = s.planet;
  const w = s.worm;
  const fromX = s.lure ? s.lure.x : w.x;
  const fromY = s.lure ? s.lure.y : w.y;
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);
  const heartOpen = s.lure !== null || p.remaining <= p.total * st.heartScentAt;
  const wander = Math.floor(s.time / 2);
  let best = -1;
  let bestScore = Infinity;
  for (const i of p.cells) {
    const kind = p.kind[i];
    if (kind === BLOCK.EMPTY || (kind === BLOCK.HEART && !heartOpen)) continue;
    const dx = p.wx[i] - fromX;
    const dy = p.wy[i] - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Prefer what lies ahead so the worm sweeps through instead of jittering.
    const ahead = s.lure ? 0 : (dx * cos + dy * sin) / (dist + 1);
    let score = dist * (1.4 - 0.6 * ahead);
    if (kind === BLOCK.NECTAR) score -= st.nectarScent;
    else if (kind === BLOCK.PULSE) score -= 25;
    else if (kind === BLOCK.HEART && !s.lure) score -= 100000;
    score += (Math.imul(i + wander, 2654435761) >>> 24) * 0.12;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Only the heart left, and the scent gate above did not open: go for it anyway.
  w.target = best === -1 && p.kind[p.heart] === BLOCK.HEART ? p.heart : best;
}

function updateWorm(s: GameState, st: Stats, dt: number): void {
  const w = s.worm;
  const p = s.planet;

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
  const turn = WORM.turnRate * dt;
  w.angle += Math.max(-turn, Math.min(turn, delta));
  const cos = Math.cos(w.angle);
  const sin = Math.sin(w.angle);

  const front = s.phase === 'eating' ? cellAt(p, w.x + cos * WORM.lookAhead, w.y + sin * WORM.lookAhead) : -1;
  if (front >= 0 && p.kind[front] !== BLOCK.EMPTY) {
    w.biting = true;
    w.biteTimer -= dt;
    while (w.biteTimer <= 0 && s.phase === 'eating') {
      w.biteTimer += 1 / st.biteRate;
      damageCell(s, st, front, st.jawDamage);
    }
    return;
  }

  w.biting = false;
  w.biteTimer = Math.min(w.biteTimer, 1 / st.biteRate);
  const move = st.speed * dt;
  w.x += cos * move;
  w.y += sin * move;
  w.sinceSample += move;
  while (w.sinceSample >= WORM.trailSampleDist) {
    w.sinceSample -= WORM.trailSampleDist;
    pushTrail(w);
  }
}

function updateGrind(s: GameState, st: Stats, dt: number): void {
  const w = s.worm;
  w.grindTimer -= dt;
  if (w.grindTimer > 0) return;
  w.grindTimer += WORM.grindEvery;
  const p = s.planet;
  for (let seg = 0; seg < st.segments && s.phase === 'eating'; seg++) {
    segmentPos(w, seg, pos);
    const at = cellAt(p, pos.x, pos.y);
    if (at < 0) continue;
    for (let dir = 0; dir < 6; dir++) {
      const n = neighbourOf(p, at, (dir + seg) % 6);
      if (n >= 0 && p.kind[n] !== BLOCK.EMPTY && p.kind[n] !== BLOCK.HEART) {
        damageCell(s, st, n, st.grindDamage);
        break;
      }
    }
  }
}

function updateSpit(s: GameState, st: Stats, dt: number): void {
  if (s.upgrades.spit === 0) return;
  const w = s.worm;
  w.spitTimer -= dt;
  if (w.spitTimer > 0) return;
  w.spitTimer = st.spitCooldown;
  const p = s.planet;
  let best = -1;
  let bestDist = 0;
  for (const i of p.cells) {
    const kind = p.kind[i];
    if (kind === BLOCK.EMPTY || kind === BLOCK.HEART) continue;
    const d = Math.hypot(p.wx[i] - w.x, p.wy[i] - w.y);
    // Farthest cell still in range: spit opens new fronts for the worm.
    if (d <= SPIT.range && d > bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return;
  s.events.push({ t: 'spit', x0: w.x, y0: w.y, x1: p.wx[best], y1: p.wy[best] });
  forEachInRange(p, best, st.spitRings, (cell) => {
    if (s.phase === 'eating' && p.kind[cell] !== BLOCK.HEART) damageCell(s, st, cell, st.spitDamage);
  });
}

function randomSolid(s: GameState): number {
  const p = s.planet;
  for (let tries = 0; tries < 8; tries++) {
    const i = p.cells[Math.floor(Math.random() * p.cells.length)];
    if (p.kind[i] !== BLOCK.EMPTY && p.kind[i] !== BLOCK.HEART) return i;
  }
  return -1;
}

function updateBrood(s: GameState, st: Stats, dt: number): void {
  const w = s.worm;
  while (s.brood.length < st.broodCount) {
    s.brood.push({ x: w.x, y: w.y, target: -1, cooldown: 0 });
  }
  const p = s.planet;
  for (const b of s.brood) {
    if (s.phase === 'eating' && (b.target < 0 || p.kind[b.target] === BLOCK.EMPTY)) b.target = randomSolid(s);
    const homeward = b.target < 0 || s.phase !== 'eating';
    const tx = homeward ? w.x : p.wx[b.target];
    const ty = homeward ? w.y : p.wy[b.target];
    const dist = Math.hypot(tx - b.x, ty - b.y);
    if (!homeward && dist < 6) {
      b.cooldown -= dt;
      if (b.cooldown <= 0) {
        b.cooldown = BROOD.biteEvery;
        damageCell(s, st, b.target, st.broodDamage);
      }
    } else if (dist > 1) {
      const move = Math.min(dist, BROOD.speed * dt);
      b.x += ((tx - b.x) / dist) * move;
      b.y += ((ty - b.y) / dist) * move;
    }
  }
}

function nextPlanet(s: GameState): void {
  s.planetIndex += 1;
  s.runBestPlanet = Math.max(s.runBestPlanet, s.planetIndex);
  s.bestPlanet = Math.max(s.bestPlanet, s.planetIndex);
  s.planet = makePlanet(s.planetIndex, (s.seed + s.planetIndex * 104729) | 0);
  placeWorm(s.worm, s.planet, s.seed + s.planetIndex);
  s.phase = 'eating';
  s.events.push({ t: 'planet', name: s.planet.name, index: s.planetIndex });
}

export function triggerFrenzy(s: GameState): boolean {
  if (s.frenzyCharge < 1 || s.frenzyLeft > 0) return false;
  s.frenzyCharge = 0;
  s.frenzyLeft = computeStats(s).frenzySeconds;
  s.events.push({ t: 'frenzy' });
  return true;
}

export function setLure(s: GameState, x: number, y: number): void {
  s.lure = { x, y, left: 4 };
  s.worm.retarget = 0;
  s.events.push({ t: 'lure', x, y });
}

export function step(s: GameState, dt: number): void {
  s.time += dt;
  const st = computeStats(s);

  if (s.frenzyLeft > 0) s.frenzyLeft = Math.max(0, s.frenzyLeft - dt);
  if (s.lure) {
    s.lure.left -= dt;
    if (s.lure.left <= 0) s.lure = null;
  }

  updateWorm(s, st, dt);
  if (s.phase === 'eating') {
    updateGrind(s, st, dt);
    updateSpit(s, st, dt);
    runBlasts(s, st);
  }
  updateBrood(s, st, dt);
  runBlasts(s, st);

  if (s.phase === 'collapse') {
    s.phaseLeft -= dt;
    if (s.phaseLeft <= 0) nextPlanet(s);
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
    if (s.perks.instinct > 0) {
      autoBuy(s);
      triggerFrenzy(s);
    }
  }

  // The renderer empties this every frame; the cap protects headless runs.
  if (s.events.length > 2000) s.events.length = 0;
}

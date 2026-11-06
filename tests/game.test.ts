import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK, LEVELS, MAX_LEVEL, REGION, SAGA, SHIP, TICK, UPGRADES } from '../src/game/config.ts';
import {
  applyOffline, buyUpgrade, chooseRune, computeStats, gloryPreview, isOpenChoice, isUnlocked, levelPower, maxAffordable,
  openRuneOffer, passSaga, rankLevel, rankOf, upgradeCost, upgradeDef,
} from '../src/game/economy.ts';
import { hexToWorldX, hexToWorldY, worldToHex } from '../src/game/hex.ts';
import { cellAt, forEachInRange, makeRegion } from '../src/game/region.ts';
import { deserialize, serialize } from '../src/game/save.ts';
import { setWaypoint, step, triggerBerserk } from '../src/game/sim.ts';
import { newGame, type GameState } from '../src/game/state.ts';

function run(s: GameState, seconds: number): void {
  for (let i = 0; i < 30 * seconds; i++) {
    step(s, TICK);
    s.events.length = 0;
  }
}

test('hex coordinates round-trip through world space', () => {
  const out = { q: 0, r: 0 };
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      worldToHex(hexToWorldX(q, r) + 1, hexToWorldY(r) - 1, out);
      assert.deepEqual(out, { q, r });
    }
  }
});

test('regions are deterministic and have one core', () => {
  const a = makeRegion(3, 42);
  const b = makeRegion(3, 42);
  assert.deepEqual(a.kind, b.kind);
  assert.equal(a.name, b.name);
  assert.equal(a.kind.filter((k) => k === BLOCK.CORE).length, 1);
  assert.equal(a.remaining, a.total);
  assert.equal(cellAt(a, 0, 0), a.core);
});

test('regions grow to the planned sizes', () => {
  const first = makeRegion(0, 1).total;
  const ninth = makeRegion(8, 1).total;
  assert.ok(first > 500 && first < 900, `region 1 has ${first} hexes`);
  assert.ok(ninth > 2000 && ninth < 3200, `region 9 has ${ninth} hexes`);
});

test('range lookup covers a full hex ring', () => {
  const p = makeRegion(0, 1);
  let count = 0;
  forEachInRange(p, p.core, 1, () => count++);
  assert.equal(count, 7);
});

test('levels are small and ranks are big', () => {
  assert.equal(rankOf(25), 0);
  assert.equal(rankOf(26), 1);
  assert.equal(rankLevel(25), 25);
  assert.equal(rankLevel(26), 1);
  assert.ok(levelPower(2) / levelPower(1) < 1.05);
  assert.ok(levelPower(26) / levelPower(25) > 2);
});

test('a rank-up step costs more than the level before it', () => {
  const s = newGame(1);
  const last = upgradeCost(s, 'drill', 24);
  const crossing = upgradeCost(s, 'drill', 25);
  assert.ok(crossing > last * LEVELS.rankCostStep);
});

test('bulk cost matches buying one at a time, across a rank', () => {
  const s = newGame(1);
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += upgradeCost(s, 'drill', 20 + i);
  assert.ok(Math.abs(sum - upgradeCost(s, 'drill', 20, 10)) < 1e-6);
});

test('max-buy never overspends and respects the rank cap', () => {
  const s = newGame(1);
  s.silver = 1e6;
  const n = maxAffordable(s, 'drill');
  assert.ok(buyUpgrade(s, 'drill', n));
  assert.ok(s.silver >= 0);
  assert.equal(maxAffordable(s, 'drill'), 0);
  s.silver = 1e300;
  assert.equal(s.upgrades.drill + maxAffordable(s, 'drill'), MAX_LEVEL);
});

test('only the drill is owned at the start, and upgrades open in stages', () => {
  const s = newGame(1);
  assert.equal(s.upgrades.drill, 1);
  const open = UPGRADES.filter((u) => isUnlocked(s, u)).map((u) => u.id);
  assert.deepEqual(open, ['drill', 'ravens']);
  s.upgrades.drill = 10;
  assert.ok(isUnlocked(s, upgradeDef('smelter')));
  assert.ok(isUnlocked(s, upgradeDef('forge')));
  assert.equal(isUnlocked(s, upgradeDef('haulers')), false);
});

test('the second of a pair arrives later, stronger and pricier, still at level 1', () => {
  const s = newGame(1);
  s.upgrades.drill = 10;
  s.silver = 1000;
  assert.ok(isOpenChoice(s, upgradeDef('smelter')));
  const before = upgradeCost(s, 'forge', 0);
  assert.ok(buyUpgrade(s, 'smelter', 1));
  assert.equal(isUnlocked(s, upgradeDef('forge')), false, 'forge waits');
  s.upgrades.drill = 26;
  assert.ok(isUnlocked(s, upgradeDef('forge')), 'forge arrives at the next drill rank');
  assert.ok(upgradeCost(s, 'forge', 0) > before, 'and costs more');
  const plain = computeStats(s).drillRate;
  s.upgrades.forge = 1;
  assert.ok(computeStats(s).drillRate > plain * 1.4, 'level 1 is already strong');
});

test('later tools hit harder at level 1 than the ones before them', () => {
  const tools = UPGRADES.filter((u) => u.group === 'tool' && u.id !== 'lance');
  for (let i = 1; i < tools.length; i++) {
    const dps = (u: typeof tools[number]) => u.power / u.period;
    assert.ok(dps(tools[i]) > dps(tools[i - 1]), `${tools[i].id} beats ${tools[i - 1].id}`);
  }
});

test('the first block takes about 5 seconds', () => {
  const s = newGame(1);
  const st = computeStats(s);
  const seconds = REGION.hpBase / (st.drillDamage * st.drillRate);
  assert.ok(seconds >= 4 && seconds <= 6, `${seconds} seconds`);
});

test('a ship left alone keeps earning, and never touches what it cannot see', () => {
  const s = newGame(7);
  run(s, 120);
  assert.ok(s.silver > 0);
  const p = s.region;
  for (const i of p.cells) {
    if (p.kind[i] === BLOCK.EMPTY) assert.equal(p.seen[i], 1, 'every mined hex was seen');
  }
});

test('the fog starts closed and the crew sees only a little of it', () => {
  const s = newGame(9);
  assert.equal(s.region.seen.reduce((a, b) => a + b, 0), 0);
  run(s, 60);
  const seen = s.region.seen.reduce((a, b) => a + b, 0);
  assert.ok(seen > 0 && seen < s.region.total / 2);
  assert.equal(s.region.seen[s.region.core], 0, 'the Worldheart is still hidden');
});

test('sight crosses open space and stops at the first solid hex', () => {
  const s = newGame(21);
  const p = s.region;
  // A single hollow chamber around the middle, 2 hexes wide, walled by solid rock.
  const cx = p.wx[p.core] + 60;
  for (const i of p.cells) {
    if (Math.hypot(p.wx[i] - cx, p.wy[i]) < 22) p.kind[i] = BLOCK.EMPTY;
  }
  s.ship.x = cx;
  s.ship.y = 0;
  s.ship.target = -1;
  step(s, TICK);
  let deep = 0;
  let wall = 0;
  for (const i of p.cells) {
    const d = Math.hypot(p.wx[i] - cx, p.wy[i]);
    if (p.kind[i] === BLOCK.EMPTY) continue;
    if (p.seen[i] === 1 && d < 36) wall += 1;
    if (p.seen[i] === 1 && d > 42) deep += 1;
  }
  assert.ok(wall > 0, 'the chamber wall is visible');
  assert.equal(deep, 0, 'nothing behind that wall is');
  assert.equal(SHIP.sightSolids, 1);
});

test('the ship keeps its target until the block is gone', () => {
  const s = newGame(22);
  s.ship.x = 0;
  s.ship.y = -60;
  run(s, 1);
  const target = s.ship.target;
  assert.ok(target >= 0);
  for (let i = 0; i < 30 * 2 && s.region.kind[target] !== BLOCK.EMPTY; i++) {
    step(s, TICK);
    s.events.length = 0;
    if (s.region.kind[target] !== BLOCK.EMPTY) assert.equal(s.ship.target, target);
  }
});

test('a tap holds through other blocks until its block is gone', () => {
  const s = newGame(23);
  const p = s.region;
  s.upgrades.drill = 60;
  s.ship.x = 0;
  s.ship.y = -60;
  const tap = cellAt(p, 40, -60);
  assert.notEqual(p.kind[tap], BLOCK.EMPTY);
  setWaypoint(s, p.wx[tap], p.wy[tap]);
  let guard = 0;
  while (p.kind[tap] !== BLOCK.EMPTY && guard++ < 30 * 120) {
    assert.equal(s.ship.target, tap, 'still heading for the tapped block');
    step(s, TICK);
    s.events.length = 0;
  }
  assert.equal(p.kind[tap], BLOCK.EMPTY);
  step(s, TICK);
  assert.equal(s.waypoint, null, 'the tap ends when its block is gone');
});

test('the Worldheart is sealed until enough of the region is mined', () => {
  const s = newGame(24);
  const p = s.region;
  p.seen.fill(1);
  const full = p.hp[p.core];
  s.ship.x = p.wx[p.core] - 8;
  s.ship.y = p.wy[p.core];
  s.ship.angle = 0;
  s.upgrades.drill = 60;
  run(s, 3);
  assert.equal(p.coreOpen, false);
  assert.equal(p.hp[p.core], full, 'nothing can touch it');
  p.remaining = Math.floor(p.total * 0.3);
  run(s, 1);
  assert.equal(p.coreOpen, true);
  assert.notEqual(s.ship.target, p.core, 'open, but the ship leaves it for later');
  setWaypoint(s, p.wx[p.core], p.wy[p.core]);
  assert.equal(s.ship.target, p.core, 'a tap can go for it as soon as it opens');
  s.waypoint = null;
  p.remaining = Math.floor(p.total * 0.08);
  s.ship.target = -1;
  step(s, TICK);
  assert.equal(s.ship.target, p.core, 'with 10% left the ship goes on its own');
});

test('ravens deal no damage, and their report reveals hexes when they get home', () => {
  const s = newGame(10);
  s.upgrades.ravens = 1;
  s.upgrades.drill = 0;
  const seenAt = () => s.region.seen.reduce((a, b) => a + b, 0);
  s.ship.x = 0;
  s.ship.y = 0;
  const total = s.region.remaining;
  let flew = false;
  let reported = false;
  for (let i = 0; i < 30 * 240 && !reported; i++) {
    const before = seenAt();
    step(s, TICK);
    s.events.length = 0;
    flew ||= s.ravens[0]?.state === 'back';
    reported = flew && s.ravens[0]?.state === 'rest' && seenAt() > before;
  }
  assert.ok(flew && reported, 'a raven came home and reported');
  assert.equal(s.region.remaining, total, 'no hex was damaged');
});

test('ravens improve every third level, one trait at a time, and ranks raise gem value', () => {
  const s = newGame(25);
  const at = (level: number) => {
    s.upgrades.ravens = level;
    return computeStats(s);
  };
  const start = at(1);
  assert.equal(Math.round(start.ravenRange / 10), 3);
  assert.equal(start.findValue, 2);
  assert.deepEqual(at(3), start, 'levels 2 and 3 are quiet');
  assert.ok(at(4).ravenSpeed > start.ravenSpeed);
  assert.equal(at(4).ravenRange, start.ravenRange);
  assert.ok(at(7).findChance > start.findChance);
  assert.equal(Math.round(at(10).ravenRange / 10), 4, 'reach comes third');
  assert.ok(at(13).ravenSmart > start.ravenSmart);
  assert.equal(Math.round(at(75).ravenRange / 10), 9, 'reach stays modest through Midgard');
  assert.equal(at(26).findValue, 5);
  assert.equal(at(26).ravenCount, 2);
  assert.equal(at(51).findValue, 10);
});

test('the ship prefers damaged blocks, then special ones, then normal ones', () => {
  const s = newGame(27);
  const p = s.region;
  p.seen.fill(1);
  s.ship.x = 0;
  s.ship.y = 0;
  s.ship.angle = 0;
  const cleared = [...p.cells].filter((i) => Math.hypot(p.wx[i], p.wy[i]) < 30);
  for (const i of cleared) {
    if (i !== p.core) p.kind[i] = BLOCK.EMPTY;
  }
  const ring = [...p.cells].filter((i) => p.kind[i] === BLOCK.ROCK && Math.hypot(p.wx[i], p.wy[i]) < 36);
  const damaged = ring[3];
  const gold = ring[Math.floor(ring.length / 2)];
  p.kind[gold] = BLOCK.GOLD;
  step(s, TICK);
  assert.equal(s.ship.target, gold, 'special beats normal');
  p.hp[damaged] = p.maxHp[damaged] * 0.5;
  s.ship.target = -1;
  step(s, TICK);
  assert.equal(s.ship.target, damaged, 'damaged beats special');
});

test('berserk refills on its own, slowly, and mead speeds it up', () => {
  const s = newGame(28);
  s.berserkCharge = 0;
  run(s, 18);
  assert.ok(Math.abs(s.berserkCharge - 0.1) < 0.02, `${s.berserkCharge}`);
});

test('a raven trip finds at most one gem, and gems exist only if found', () => {
  assert.equal(makeRegion(0, 3).kind.filter((k) => k === BLOCK.FIND).length, 0, 'none are generated');
  const s = newGame(11);
  const p = s.region;
  s.upgrades.ravens = 1;
  const rock = [...p.cells].filter((i) => p.kind[i] === BLOCK.ROCK).slice(0, 30);
  s.ravens.push({ x: s.ship.x, y: s.ship.y, state: 'back', wait: 0, tx: 0, ty: 0, path: new Set(rock), lastCell: -1 });
  const chance = Math.random;
  Math.random = () => 0;
  step(s, TICK);
  Math.random = chance;
  const gems = rock.filter((i) => p.kind[i] === BLOCK.FIND);
  assert.equal(gems.length, 1);
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.region.kind[gems[0]], BLOCK.FIND);
});

test('a gem pays by the ravens rank, and the same hex unfound pays as rock', () => {
  const s = newGame(26);
  const p = s.region;
  const cell = p.cells.find((i) => p.kind[i] === BLOCK.ROCK) as number;
  const other = p.cells.find((i) => p.kind[i] === BLOCK.ROCK && p.value[i] === p.value[cell] && i !== cell) as number;
  s.upgrades.ravens = 26;
  p.kind[cell] = BLOCK.FIND;
  p.hp[cell] = 0.001;
  p.hp[other] = 0.001;
  s.ship.x = p.wx[other] - 8;
  s.ship.y = p.wy[other];
  s.ship.angle = 0;
  s.ship.target = other;
  const before = s.silver;
  let guard = 0;
  while (p.kind[other] !== BLOCK.EMPTY && guard++ < 30) step(s, TICK);
  const plain = s.silver - before;
  s.ship.x = p.wx[cell] - 8;
  s.ship.y = p.wy[cell];
  s.ship.angle = 0;
  s.ship.target = cell;
  const mid = s.silver;
  guard = 0;
  while (p.kind[cell] !== BLOCK.EMPTY && guard++ < 30) step(s, TICK);
  assert.ok(Math.abs(s.silver - mid - plain * 5) < 1e-6);
});

test('the Worldheart pays half as it falls and the rest when it dies', () => {
  const s = newGame(12);
  const p = s.region;
  p.seen.fill(1);
  const value = p.value[p.core];
  p.hp[p.core] = p.maxHp[p.core] * 0.02;
  // Clear everything else, then park the ship on the Worldheart.
  for (const i of p.cells) {
    if (i !== p.core) p.kind[i] = BLOCK.EMPTY;
  }
  p.remaining = 1;
  s.upgrades.drill = 1;
  s.ship.x = p.wx[p.core] - 8;
  s.ship.y = p.wy[p.core];
  s.ship.angle = 0;
  const start = s.silver;
  let guard = 0;
  while (s.phase === 'mining' && guard++ < 30 * 3000) {
    step(s, TICK);
    s.events.length = 0;
  }
  assert.equal(s.phase, 'collapse');
  const paid = s.silver - start;
  assert.ok(Math.abs(paid - value * (0.5 + 0.5 * 0.02)) < value * 0.001, `paid ${paid} of ${value}`);
});

test('the collapse pops what is left in rings, pays it, then moves on', () => {
  const s = newGame(13);
  const p = s.region;
  p.seen.fill(1);
  p.hp[p.core] = 0.001;
  p.coreOpen = true;
  setWaypoint(s, p.wx[p.core], p.wy[p.core]);
  s.ship.x = p.wx[p.core] - 8;
  s.ship.y = p.wy[p.core];
  s.ship.angle = 0;
  const cell = cellAt(p, -8, 0);
  if (cell >= 0 && cell !== p.core) p.kind[cell] = BLOCK.EMPTY;
  let guard = 0;
  while (s.phase === 'mining' && guard++ < 300) {
    step(s, TICK);
    s.events.length = 0;
  }
  assert.equal(s.phase, 'collapse');
  const left = p.remaining;
  assert.ok(left > 0, 'blocks are still standing as the collapse begins');
  const silver = s.silver;
  step(s, TICK);
  assert.ok(p.remaining > 0 && p.remaining <= left, 'it spreads, not instant');
  run(s, 5);
  assert.equal(s.regionIndex, 1);
  assert.ok(s.silver > silver);
  assert.equal(s.runePicks >= 1, true);
});

test('saving during a collapse continues in the next region', () => {
  const s = newGame(14);
  s.phase = 'collapse';
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.regionIndex, 1);
  assert.equal(loaded.phase, 'mining');
});

test('runes offer three choices, apply, and clear when the saga passes on', () => {
  const s = newGame(6);
  const rings = computeStats(s).blastRings;
  s.runePicks = 2;
  openRuneOffer(s, () => 0.3);
  const offer = s.runeOffer ?? [];
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer).size, 3);
  assert.equal(chooseRune(s, offer[0]), true);
  assert.equal(s.runePicks, 1);
  assert.equal(s.runeOffer, null);
  s.runes.kenaz = 1;
  assert.equal(computeStats(s).blastRings, rings + 1);
  s.runBestRegion = 5;
  passSaga(s);
  assert.equal(s.runes.kenaz, 0);
  assert.equal(s.runePicks, 0);
});

test('a choice the player has not made never expires or blocks play', () => {
  const s = newGame(8);
  s.runePicks = 3;
  run(s, 60);
  assert.ok(s.runePicks >= 3);
  assert.ok(s.silver > 0);
});

test('berserk needs a full charge', () => {
  const s = newGame(2);
  assert.equal(triggerBerserk(s), false);
  s.berserkCharge = 1;
  assert.equal(triggerBerserk(s), true);
  assert.equal(s.berserkCharge, 0);
});

test('glory grows with the square root of silver earned', () => {
  const s = newGame(3);
  s.runBestRegion = 5;
  s.runSilver = 1e6;
  const one = gloryPreview(s);
  s.runSilver = 4e6;
  assert.equal(gloryPreview(s), Math.floor(Math.sqrt(4e6 / SAGA.gloryBase)));
  assert.ok(gloryPreview(s) >= one * 2 - 1);
});

test('passing the saga is gated, pays glory and keeps perks', () => {
  const s = newGame(3);
  assert.equal(passSaga(s), false);
  s.runBestRegion = 5;
  s.regionIndex = 5;
  s.runSilver = 1e7;
  s.upgrades.drill = 50;
  s.firstChoice.bellows = 'forge';
  s.perks.hoard = 2;
  const gain = gloryPreview(s);
  assert.ok(gain > 0);
  assert.equal(passSaga(s), true);
  assert.equal(s.glory, gain);
  assert.equal(s.upgrades.drill, 1);
  assert.deepEqual(s.firstChoice, {});
  assert.equal(s.perks.hoard, 2);
  assert.equal(s.regionIndex, 0);
});

test('save round-trips progress, including mined cells and fog', () => {
  const s = newGame(4);
  run(s, 40);
  s.upgrades.smelter = 9;
  s.firstChoice.bellows = 'smelter';
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.silver, s.silver);
  assert.equal(loaded.upgrades.smelter, 9);
  assert.equal(loaded.firstChoice.bellows, 'smelter');
  assert.equal(loaded.region.remaining, s.region.remaining);
  assert.deepEqual(loaded.region.kind, s.region.kind);
  for (const i of s.region.cells) assert.equal(loaded.region.seen[i], s.region.seen[i]);
});

test('bad save text is rejected, not fatal', () => {
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{"v":99}'), null);
  assert.equal(deserialize('null'), null);
});

test('offline pay respects the cap, the minimum, and a backwards clock', () => {
  const s = newGame(5);
  s.rate = 10;
  s.lastSeen = 0;
  assert.equal(applyOffline(s, 10_000, 45), null, 'too short');
  s.lastSeen = 0;
  const report = applyOffline(s, 100 * 3600 * 1000, 45);
  assert.ok(report);
  assert.equal(report.seconds, 8 * 3600);
  assert.equal(report.gained, 10 * 0.4 * 8 * 3600);
  s.lastSeen = 5_000_000;
  assert.equal(applyOffline(s, 1000, 45), null, 'clock moved backwards');
});

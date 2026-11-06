import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK, LEVELS, MAX_LEVEL, RAVENS, REGION, SAGA, TICK, UPGRADES } from '../src/game/config.ts';
import {
  applyOffline, buyUpgrade, chooseRune, computeStats, gloryPreview, isOpenChoice, isUnlocked, levelPower, maxAffordable,
  openRuneOffer, passSaga, rankLevel, rankOf, upgradeCost, upgradeDef,
} from '../src/game/economy.ts';
import { hexToWorldX, hexToWorldY, worldToHex } from '../src/game/hex.ts';
import { cellAt, forEachInRange, makeRegion } from '../src/game/region.ts';
import { deserialize, serialize } from '../src/game/save.ts';
import { step, triggerBerserk } from '../src/game/sim.ts';
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

test('the fog starts closed and the lamp opens a little of it', () => {
  const s = newGame(9);
  assert.equal(s.region.seen.reduce((a, b) => a + b, 0), 0);
  run(s, 60);
  const seen = s.region.seen.reduce((a, b) => a + b, 0);
  assert.ok(seen > 0 && seen < s.region.total / 2);
  assert.equal(s.region.seen[s.region.core], 0, 'the Worldheart is still hidden');
});

test('ravens deal no damage, and their report reveals hexes when they get home', () => {
  const s = newGame(10);
  s.upgrades.ravens = 1;
  const seenAt = () => s.region.seen.reduce((a, b) => a + b, 0);
  const noDrill = () => {
    s.upgrades.drill = 0;
    s.ship.x = 9999;
    s.ship.y = 9999;
  };
  noDrill();
  s.ship.x = 0;
  s.ship.y = 0;
  const total = s.region.remaining;
  let reported = false;
  for (let i = 0; i < 30 * 240 && !reported; i++) {
    const before = seenAt();
    s.ship.target = -1;
    s.ship.retarget = 99;
    step(s, TICK);
    s.events.length = 0;
    reported = seenAt() > before;
  }
  assert.ok(reported, 'a raven came home and reported');
  assert.equal(s.region.remaining, total, 'no hex was damaged');
});

test('rare ore exists only if a raven finds it', () => {
  const p = makeRegion(0, 3);
  assert.equal(p.kind.filter((k) => k === BLOCK.FIND).length, 0, 'none are generated');
  const s = newGame(11);
  s.upgrades.ravens = 1;
  const cell = s.region.cells.find((i) => s.region.kind[i] === BLOCK.ROCK) as number;
  const base = s.region.value[cell];
  const chance = Math.random;
  Math.random = () => 0;
  s.reveal.push(cell);
  step(s, TICK);
  Math.random = chance;
  assert.equal(s.region.kind[cell], BLOCK.FIND);
  assert.equal(s.region.value[cell], base * RAVENS.findValue);
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.region.kind[cell], BLOCK.FIND);
  assert.equal(loaded.region.value[cell], base * RAVENS.findValue, 'a find keeps its value through a reload');
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

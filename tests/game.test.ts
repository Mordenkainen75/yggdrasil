import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK, TICK } from '../src/game/config.ts';
import { applyOffline, buyUpgrade, gloryPreview, chooseRune, computeStats, maxAffordable, passSaga, openRuneOffer, upgradeCost } from '../src/game/economy.ts';
import { hexToWorldX, hexToWorldY, worldToHex } from '../src/game/hex.ts';
import { cellAt, forEachInRange, makeRegion } from '../src/game/region.ts';
import { deserialize, serialize } from '../src/game/save.ts';
import { step, triggerBerserk } from '../src/game/sim.ts';
import { newGame } from '../src/game/state.ts';

test('hex coordinates round-trip through world space', () => {
  const out = { q: 0, r: 0 };
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      worldToHex(hexToWorldX(q, r) + 2, hexToWorldY(r) - 2, out);
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

test('range lookup covers a full hex ring', () => {
  const p = makeRegion(0, 1);
  let count = 0;
  forEachInRange(p, p.core, 1, () => count++);
  assert.equal(count, 7);
});

test('bulk cost matches buying one at a time', () => {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += upgradeCost('drill', 5 + i);
  assert.ok(Math.abs(sum - upgradeCost('drill', 5, 10)) < 1e-6);
});

test('max-buy never overspends and respects the level cap', () => {
  const s = newGame(1);
  s.silver = 1e6;
  const n = maxAffordable(s, 'drill');
  assert.ok(buyUpgrade(s, 'drill', n));
  assert.ok(s.silver >= 0);
  assert.equal(maxAffordable(s, 'drill'), 0);
  s.silver = 1e300;
  assert.equal(maxAffordable(s, 'ravens'), 0, 'ravens is locked on the first region');
  s.upgrades.forge = 119;
  assert.equal(maxAffordable(s, 'forge'), 1);
});

test('a ship left alone mines out the first region and moves on', () => {
  const s = newGame(7);
  let guard = 0;
  while (s.regionIndex === 0 && guard++ < 30 * 900) {
    step(s, TICK);
    s.events.length = 0;
  }
  assert.equal(s.regionIndex, 1, 'region 1 should fall within 15 game minutes with no upgrades');
  assert.ok(s.silver > 0);
});

test('runes offer three choices, apply, and clear when the saga passes on', () => {
  const s = newGame(6);
  assert.equal(computeStats(s).blastRings, 2);
  s.runePicks = 2;
  openRuneOffer(s, () => 0.3);
  const offer = s.runeOffer ?? [];
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer).size, 3);
  assert.equal(chooseRune(s, offer[0]), true);
  assert.equal(s.runePicks, 1);
  assert.equal(s.runeOffer, null);
  s.runes.kenaz = 1;
  assert.equal(computeStats(s).blastRings, 3);
  s.runBestRegion = 5;
  passSaga(s);
  assert.equal(s.runes.kenaz, 0);
  assert.equal(s.runePicks, 0);
});

test('a choice the player has not made never expires or blocks play', () => {
  const s = newGame(8);
  s.runePicks = 3;
  for (let i = 0; i < 30 * 60; i++) {
    step(s, TICK);
    s.events.length = 0;
  }
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

test('passing the saga is gated, pays glory and keeps perks', () => {
  const s = newGame(3);
  assert.equal(passSaga(s), false);
  s.runBestRegion = 5;
  s.regionIndex = 5;
  s.runSilver = 1e7;
  s.upgrades.drill = 50;
  s.perks.hoard = 2;
  const gain = gloryPreview(s);
  assert.ok(gain > 0);
  assert.equal(passSaga(s), true);
  assert.equal(s.glory, gain);
  assert.equal(s.upgrades.drill, 0);
  assert.equal(s.perks.hoard, 2);
  assert.equal(s.regionIndex, 0);
});

test('save round-trips progress, including mined cells', () => {
  const s = newGame(4);
  for (let i = 0; i < 30 * 40; i++) {
    step(s, TICK);
    s.events.length = 0;
  }
  s.upgrades.smelter = 9;
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.silver, s.silver);
  assert.equal(loaded.upgrades.smelter, 9);
  assert.equal(loaded.region.remaining, s.region.remaining);
  assert.deepEqual(loaded.region.kind, s.region.kind);
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
  assert.equal(report.seconds, 4 * 3600);
  assert.equal(report.gained, 10 * 0.4 * 4 * 3600);
  s.lastSeen = 5_000_000;
  assert.equal(applyOffline(s, 1000, 45), null, 'clock moved backwards');
});

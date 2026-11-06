import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK, TICK } from '../src/game/config.ts';
import { applyOffline, buyUpgrade, chitinPreview, chooseMutation, computeStats, maxAffordable, molt, openMutationOffer, upgradeCost } from '../src/game/economy.ts';
import { hexToWorldX, hexToWorldY, worldToHex } from '../src/game/hex.ts';
import { cellAt, forEachInRange, makePlanet } from '../src/game/planet.ts';
import { deserialize, serialize } from '../src/game/save.ts';
import { step, triggerFrenzy } from '../src/game/sim.ts';
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

test('planets are deterministic and have one heart', () => {
  const a = makePlanet(3, 42);
  const b = makePlanet(3, 42);
  assert.deepEqual(a.kind, b.kind);
  assert.equal(a.name, b.name);
  assert.equal(a.kind.filter((k) => k === BLOCK.HEART).length, 1);
  assert.equal(a.remaining, a.total);
  assert.equal(cellAt(a, 0, 0), a.heart);
});

test('range lookup covers a full hex ring', () => {
  const p = makePlanet(0, 1);
  let count = 0;
  forEachInRange(p, p.heart, 1, () => count++);
  assert.equal(count, 7);
});

test('bulk cost matches buying one at a time', () => {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += upgradeCost('jaws', 5 + i);
  assert.ok(Math.abs(sum - upgradeCost('jaws', 5, 10)) < 1e-6);
});

test('max-buy never overspends and respects the level cap', () => {
  const s = newGame(1);
  s.biomass = 1e6;
  const n = maxAffordable(s, 'jaws');
  assert.ok(buyUpgrade(s, 'jaws', n));
  assert.ok(s.biomass >= 0);
  assert.equal(maxAffordable(s, 'jaws'), 0);
  s.biomass = 1e300;
  assert.equal(maxAffordable(s, 'brood'), 0, 'brood is locked on the first planet');
  s.upgrades.metabolism = 119;
  assert.equal(maxAffordable(s, 'metabolism'), 1);
});

test('a worm left alone eats the first planet and moves on', () => {
  const s = newGame(7);
  let guard = 0;
  while (s.planetIndex === 0 && guard++ < 30 * 900) {
    step(s, TICK);
    s.events.length = 0;
  }
  assert.equal(s.planetIndex, 1, 'planet 1 should fall within 15 game minutes with no upgrades');
  assert.ok(s.biomass > 0);
});

test('mutations offer three choices, apply, and clear on molt', () => {
  const s = newGame(6);
  assert.equal(computeStats(s).blastRings, 2);
  s.mutationPicks = 2;
  openMutationOffer(s, () => 0.3);
  const offer = s.mutationOffer ?? [];
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer).size, 3);
  assert.equal(chooseMutation(s, offer[0]), true);
  assert.equal(s.mutationPicks, 1);
  assert.equal(s.mutationOffer, null);
  s.mutations.volatile = 1;
  assert.equal(computeStats(s).blastRings, 3);
  s.runBestPlanet = 5;
  molt(s);
  assert.equal(s.mutations.volatile, 0);
  assert.equal(s.mutationPicks, 0);
});

test('a choice the player has not made never expires or blocks play', () => {
  const s = newGame(8);
  s.mutationPicks = 3;
  for (let i = 0; i < 30 * 60; i++) {
    step(s, TICK);
    s.events.length = 0;
  }
  assert.ok(s.mutationPicks >= 3);
  assert.ok(s.biomass > 0);
});

test('frenzy needs a full charge', () => {
  const s = newGame(2);
  assert.equal(triggerFrenzy(s), false);
  s.frenzyCharge = 1;
  assert.equal(triggerFrenzy(s), true);
  assert.equal(s.frenzyCharge, 0);
});

test('molt is gated, pays chitin and keeps perks', () => {
  const s = newGame(3);
  assert.equal(molt(s), false);
  s.runBestPlanet = 5;
  s.planetIndex = 5;
  s.runBiomass = 1e7;
  s.upgrades.jaws = 50;
  s.perks.hide = 2;
  const gain = chitinPreview(s);
  assert.ok(gain > 0);
  assert.equal(molt(s), true);
  assert.equal(s.chitin, gain);
  assert.equal(s.upgrades.jaws, 0);
  assert.equal(s.perks.hide, 2);
  assert.equal(s.planetIndex, 0);
});

test('save round-trips progress, including chewed cells', () => {
  const s = newGame(4);
  for (let i = 0; i < 30 * 40; i++) {
    step(s, TICK);
    s.events.length = 0;
  }
  s.upgrades.gut = 9;
  const loaded = deserialize(serialize(s, 1000));
  assert.ok(loaded);
  assert.equal(loaded.biomass, s.biomass);
  assert.equal(loaded.upgrades.gut, 9);
  assert.equal(loaded.planet.remaining, s.planet.remaining);
  assert.deepEqual(loaded.planet.kind, s.planet.kind);
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

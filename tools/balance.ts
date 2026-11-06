// Headless playthrough: a simple bot buys upgrades and molts, and we print how
// long everything takes. Run with `npm run balance`. Game seconds, not real ones.
import { MOLT, TICK } from '../src/game/config.ts';
import { autoBuy, buyPerk, chitinPreview, chooseMutation, computeStats, molt, openMutationOffer, perkCost } from '../src/game/economy.ts';
import { step } from '../src/game/sim.ts';
import { MOLT_READY, newGame, type GameState } from '../src/game/state.ts';

const clock = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
};

function spendChitin(s: GameState): string {
  const bought: string[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const order = ['instinct', 'hide', 'fangs'] as const;
    const pick = order.find((id) => id === 'instinct' ? s.perks.instinct === 0 && perkCost(id, 0) <= s.chitin : true);
    const id = pick === 'hide' && s.perks.fangs < s.perks.hide ? 'fangs' : pick;
    if (!id || !buyPerk(s, id)) break;
    bought.push(id);
  }
  return `${bought.length} perks`;
}

const runs = Number(process.argv[2] ?? 4);
const maxRunSeconds = Number(process.argv[3] ?? 3600);
const s = newGame(12345);
let totalSeconds = 0;

for (let run = 1; run <= runs; run++) {
  let runSeconds = 0;
  let planetStart = 0;
  let lastPlanet = s.planetIndex;
  let moltReadyAt = -1;
  const line = (n: number, dur: number) => {
    const st = computeStats(s);
    const u = s.upgrades;
    console.log(
      `  planet ${String(n + 1).padStart(2)} ${clock(dur).padStart(9)}   total ${clock(runSeconds).padStart(9)}` +
      `   dmg ${st.jawDamage.toExponential(1)}  J${u.jaws} G${u.gut} M${u.metabolism} L${u.length} S${u.spit} B${u.brood}`,
    );
  };

  console.log(`\nRUN ${run}  (chitin ${s.chitin}, molts ${s.molts})`);
  while (runSeconds < maxRunSeconds) {
    for (let i = 0; i < 30; i++) {
      step(s, TICK);
      s.events.length = 0;
    }
    runSeconds += 1;
    autoBuy(s);
    while (s.mutationPicks > 0) {
      openMutationOffer(s);
      if (!s.mutationOffer) break;
      chooseMutation(s, s.mutationOffer[0]);
    }
    if (s.planetIndex !== lastPlanet) {
      line(lastPlanet, runSeconds - planetStart);
      planetStart = runSeconds;
      lastPlanet = s.planetIndex;
    }
    if (moltReadyAt < 0 && MOLT_READY(s)) moltReadyAt = runSeconds;
    // The bot molts once the current planet is taking more than 3 minutes.
    if (MOLT_READY(s) && chitinPreview(s) > 0 && runSeconds - planetStart > 180) break;
  }
  totalSeconds += runSeconds;
  console.log(`  reached planet ${s.planetIndex + 1} (molt unlocks at ${MOLT.unlockPlanet + 1}, ready at ${moltReadyAt < 0 ? 'never' : clock(moltReadyAt)})`);
  const gain = chitinPreview(s);
  if (!molt(s)) {
    console.log('  could not molt, stopping');
    break;
  }
  console.log(`  MOLT at ${clock(runSeconds)}, +${gain} chitin, spent: ${spendChitin(s)}, hide ${s.perks.hide} fangs ${s.perks.fangs}`);
}
console.log(`\nTotal game time: ${clock(totalSeconds)}`);

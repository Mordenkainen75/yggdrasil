// Headless playthrough: a simple bot buys upgrades and passes on the saga, and we print how
// long everything takes. Run with `npm run balance`. Game seconds, not real ones.
import { SAGA, TICK } from '../src/game/config.ts';
import { autoBuy, buyPerk, gloryPreview, chooseRune, computeStats, passSaga, openRuneOffer, perkCost } from '../src/game/economy.ts';
import { step } from '../src/game/sim.ts';
import { SAGA_READY, newGame, type GameState } from '../src/game/state.ts';

const clock = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
};

function spendGlory(s: GameState): string {
  const bought: string[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const order = ['foreman', 'hoard', 'steel'] as const;
    const pick = order.find((id) => id === 'foreman' ? s.perks.foreman === 0 && perkCost(id, 0) <= s.glory : true);
    const id = pick === 'hoard' && s.perks.steel < s.perks.hoard ? 'steel' : pick;
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
  let regionStart = 0;
  let lastRegion = s.regionIndex;
  let sagaReadyAt = -1;
  const line = (n: number, dur: number) => {
    const st = computeStats(s);
    const u = s.upgrades;
    console.log(
      `  region ${String(n + 1).padStart(2)} ${clock(dur).padStart(9)}   total ${clock(runSeconds).padStart(9)}` +
      `   dmg ${st.drillDamage.toExponential(1)}  J${u.drill} G${u.smelter} M${u.forge} L${u.haulers} S${u.thunder} B${u.ravens}`,
    );
  };

  console.log(`\nRUN ${run}  (glory ${s.glory}, sagas ${s.sagas})`);
  while (runSeconds < maxRunSeconds) {
    for (let i = 0; i < 30; i++) {
      step(s, TICK);
      s.events.length = 0;
    }
    runSeconds += 1;
    autoBuy(s);
    while (s.runePicks > 0) {
      openRuneOffer(s);
      if (!s.runeOffer) break;
      chooseRune(s, s.runeOffer[0]);
    }
    if (s.regionIndex !== lastRegion) {
      line(lastRegion, runSeconds - regionStart);
      regionStart = runSeconds;
      lastRegion = s.regionIndex;
    }
    if (sagaReadyAt < 0 && SAGA_READY(s)) sagaReadyAt = runSeconds;
    // The bot passes on the saga once the current region is taking more than 3 minutes.
    if (SAGA_READY(s) && gloryPreview(s) > 0 && runSeconds - regionStart > 180) break;
  }
  totalSeconds += runSeconds;
  console.log(`  reached region ${s.regionIndex + 1} (saga unlocks at ${SAGA.unlockRegion + 1}, ready at ${sagaReadyAt < 0 ? 'never' : clock(sagaReadyAt)})`);
  const gain = gloryPreview(s);
  if (!passSaga(s)) {
    console.log('  could not pass on the saga, stopping');
    break;
  }
  console.log(`  SAGA at ${clock(runSeconds)}, +${gain} glory, spent: ${spendGlory(s)}, hoard ${s.perks.hoard} steel ${s.perks.steel}`);
}
console.log(`\nTotal game time: ${clock(totalSeconds)}`);

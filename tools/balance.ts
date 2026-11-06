// Headless playthrough: a simple bot buys upgrades and passes on the saga, and we
// print how long everything takes. Run with `npm run balance`. Game seconds, not real ones.
import { BLOCK, REGION, TICK } from '../src/game/config.ts';
import { autoBuy, buyPerk, chooseRune, computeStats, gloryPreview, openRuneOffer, passSaga, perkCost } from '../src/game/economy.ts';
import { step, triggerBerserk } from '../src/game/sim.ts';
import { SAGA_READY, newGame, type GameState } from '../src/game/state.ts';
import { fmt } from '../src/ui/format.ts';

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
  return `${bought.length} sagas`;
}

const runs = Number(process.argv[2] ?? 3);
const maxRunSeconds = Number(process.argv[3] ?? 3600);
const stallSeconds = Number(process.argv[4] ?? 420); // pass on the saga once a region takes this long
const s = newGame(12345);
let totalSeconds = 0;

for (let run = 1; run <= runs; run++) {
  let runSeconds = 0;
  let regionStart = 0;
  let lastRegion = s.regionIndex;
  const line = (n: number, dur: number) => {
    const u = s.upgrades;
    const st = computeStats(s);
    console.log(
      `  region ${String(n + 1).padStart(2)} ${clock(dur).padStart(9)}   total ${clock(runSeconds).padStart(9)}` +
      `   silver/s ${fmt(s.rate).padStart(7)}  dmg ${fmt(st.drillDamage).padStart(6)}` +
      `  Dr${u.drill} Rv${u.ravens} Sm${u.smelter} Fg${u.forge} Hl${u.haulers} Sw${u.sweep} Ln${u.lance} Th${u.thunder} Pu${u.pulse}`,
    );
  };

  console.log(`\nRUN ${run}  (glory ${s.glory}, generations ${s.sagas})`);
  while (runSeconds < maxRunSeconds) {
    for (let i = 0; i < 30; i++) {
      step(s, TICK);
      s.events.length = 0;
    }
    runSeconds += 1;
    autoBuy(s);
    triggerBerserk(s);
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
    if (SAGA_READY(s) && gloryPreview(s) > 0 && runSeconds - regionStart > stallSeconds) break;
  }
  totalSeconds += runSeconds;
  const p = s.region;
  const left = Math.round((p.remaining / p.total) * 100);
  const core = p.kind[p.core] === BLOCK.CORE ? Math.round((p.hp[p.core] / p.maxHp[p.core]) * 100) : 0;
  console.log(`  stopped in region ${s.regionIndex + 1}: ${left}% of hexes left, Worldheart at ${core}%`);
  const gain = gloryPreview(s);
  if (!passSaga(s)) {
    console.log('  could not pass on the saga, stopping');
    break;
  }
  console.log(`  PASSED at ${clock(runSeconds)}, +${gain} glory, bought ${spendGlory(s)}, hoard ${s.perks.hoard} steel ${s.perks.steel}`);
}
console.log(`\nTotal game time: ${clock(totalSeconds)}  (goal: Midgard in about 2 hours over 3 generations, ${REGION.baseRadius}-ring start)`);

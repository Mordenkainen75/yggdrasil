# Yggdrasil: design notes

*Yggdrasil is a working title.*

A human mining clan works through the rock of Midgard in a dragon-jawed drill
ship, towing a growing convoy of haulers and raven drones. The long-term plan is
a climb through the nine realms of the world tree, with a real ending.

The reference for the *mechanics* (not the look or content) is the idle
planet-mining genre. Yggdrasil has its own world, art and systems.

## The pledge

This game is the opposite of an exploitative mobile game. These are rules, not
goals. Any future feature has to pass all of them.

- **No ads**, of any kind, ever.
- **No real money.** No store, no premium currency, no "pay to skip".
- **No pressure to come back.** No daily rewards, streaks, limited-time events,
  or energy timers. Nothing is lost by being away.
- **Away time is a gift.** Your crew keeps earning while you're gone, and you
  never have to collect anything by hand.
- **Your choices wait for you.** Runes never expire and never stop play.
- **No busywork.** If tapping something 40 times is never a decision, it gets a
  button ("Buy all I can") or an automation (the Old Foreman saga).
- **No accounts or tracking.** The save lives on the device.

The fun has to come from steady progress, satisfying effects, and real choices.

## The loop

1. The ship mines blocks on its own, earning **hacksilver**. Tap to steer it.
2. Spend silver on upgrades (**Forge** tab).
3. Drill out the region's **Worldheart** to collapse it. Leftovers pay out at 50%.
4. Carve 1 of 3 **runes**, kept until the saga passes on.
5. Tougher regions slow you down until the wall makes a new generation worthwhile.
6. **Pass on the saga** (unlocks on region 5): the next generation restarts at
   region 1 and keeps **glory**, spent on permanent **sagas**.

## Blocks

| Block | Effect |
|---|---|
| Rock | Plain. Deeper cells are tougher and worth more. |
| Gold | Runs in veins. Worth 7x. |
| Mead cask | Charges Berserk. |
| Gas pocket | Explodes and can chain. |
| Worldheart | Worth a lot. Destroying it ends the region. |

## Builds

Runes are where the choices live. Many carry a real cost, and they push towards
a build: Blast, Grind, Thunder, Ravens, Harvest, Berserk or Drill. A worthwhile
test for any new rune: is there a player who would turn it down?

## The planned arc (not built yet)

Only Midgard exists today, and it has no end. The agreed direction is below, to
be built one realm at a time. None of it is final.

1. **Midgard:** the clan mines the world until it collapses with them on it.
2. **Hel:** miners get no heroes' afterlife, so the climb starts from the roots.
3. **The climb:** each realm adds its own rules and a unique upgrade. Dwarven
   tech arrives in Svartalfheim.
4. **The twist:** Naglfar, the ship of the dead, sails against the gods at
   Ragnarök. The clan's climb out of Hel turns out to be how Ragnarök begins.
5. **The ending:** Ragnarök is the finale. Credits roll, and the reborn world
   opens as New Game+, with bigger numbers. Later expansions could add twists to
   it.

Design rules for that arc:

- Ragnarök stays the finale, so it can't also be the regular prestige. Passing on
  the saga restarts the current realm. Finishing a realm is permanent.
- Aim for about nine regions per realm, not 50 or 100. A hundred regions of the
  same thing is filler.

## Progression plan (partly built)

Every number here is a starting point, to be tuned with `npm run balance` and
real play.

**Built:** tools, ranks, staged unlocks and hidden baselines; smaller hexes and
damage colors; fog, recon ravens and rare finds; Worldheart pay and the collapse
sweep; square-root Glory; weaker runes.

**Not built yet:** the stone map and tunnel, cargo and junk, Clean Sweep, the
treasure chest, the realm ending, and new ranks past Midgard's three. Gold, mead
and gas placement also hasn't been tuned for the bigger regions by hand.

**Latest bot pacing:** generation 1 stalls in region 5 at about 64 minutes,
generation 2 in region 5 at about 37, and generation 3 in region 7 at about 35.
That's about 2 hours 16 minutes without finishing Midgard, so it's running long.
Tuning waits for real play, because the bot buys the cheapest upgrade, spends its
first Glory on Old Foreman, and takes the first rune offered.

**Open balance questions:** whether Forge Heat is now about right, whether Berserk
feels good at x1.8 with a 3-minute refill, and whether passing the saga pays off
strongly enough.

What matters most: satisfying clearing, like popping bubble wrap. Numbers exist
to serve that feeling.

### Pacing

- Midgard: about 2 hours of play over 3 generations. The pattern is established
  in an evening or two.
- Each later realm runs about 1.4x longer, for roughly 100 hours in total.
- The ship is always visibly doing something. Early blocks can take up to 5
  seconds, because every hit shows as sparks, a tick of sound and a color step.
  What slows down is regions and ranks, never the feedback on screen.

### Map

- Hexes shrink from size 10 to about 6, fitting nearly 3x as many on screen.
- Each realm has 9 regions: region 1 has about 800 mineable hexes, region 9 about
  3,000.
- Regions are bigger still in stone, which costs no time: the convoy enters by
  tunnel into deposits set in a large field of worthless rock.
- Mining speed starts at about 5 seconds per hex, reaches about 1 per second
  during region 1, and hits 10 or more per second by the end of the realm.
  Multi-hex tools carry that growth.
- Hexes start in full color and fade paler in a few steps as they weaken, with no
  crack lines. Hits show as soft particles in the block's color.
- Early phone test needed: this many hexes is the main performance risk.

### Clearing

- The Worldheart no longer deletes what's left. Its destruction starts a collapse
  that pops the remaining hexes in rings outward, with rising pitch, over a few
  seconds.
- Clearing a whole region by hand earns a Clean Sweep bonus.
- The Worldheart is sealed until 65% of the region is mined, and nothing can
  touch it before then. A mark on the progress bar shows where it opens.
- The Worldheart pays as it's mined: 0.5% of its value per 1% of its health, up
  to 49% just before it falls, with the rest paid at collapse.
- Blocks never respawn, so each region's total value is predictable, apart from
  upgrades, finds and boons. If the Worldheart is too slow, that's the signal to
  pass on the saga. Its health is finite, so waiting also works.
- Away silver is a bonus on top of the map's value, not taken from it, and it's
  based on recent income, so a slow trickle at the Worldheart pays little.

### Tools and clan upgrades

Two groups, each with a line-art icon.

- **Tools** deal damage, each with its own hex pattern:
  - Drillhead: the hex in front
  - Sweep Arms: an arc of 3 in front
  - Hauler Cutters: hexes beside the pods
  - Gungnir Lance: a straight line, piercing
  - Thunder Charges: a slow strike on a distant cluster
  - Mjölnir Pulse: a ring around the ship
- **Clan upgrades** do everything else: Smelter, Forge Heat, Cargo Hold, Return
  Speed and Ravens.

Unlocking:

- You start with Drillhead and Ravens. Each later upgrade opens when an earlier
  one reaches a set tier, usually as a choice of which comes first.
- Every tool starts at a displayed level 1, but with a higher hidden baseline in
  both power and price, about 4x the power of the one before. A new tool is
  useful the moment you buy it.

Ranks:

- Each upgrade runs 1/25 to 25/25, then ranks up and starts again.
- Each realm adds about 3 new ranks in its own material, with its own color,
  capped until you reach that realm. That gives about 27 ranks by Asgard, ending
  in Godforged. Midgard's are Iron, Steel and Silver.
- Upgrades and ranks reset when the saga passes on, so the cap can't be outrun.
- A level adds about 2%. Levels cost about 8% more each, and a rank-up step costs
  more again.
- Berserk fills from mead, and slowly on its own over about 3 minutes.
- A rank-up gives x2 or a unique perk, a new icon color, and a moment on screen.

### Ravens

- Two only: Huginn and Muninn. They deal no damage.
- The map starts under fog, apart from a small area around the ship. Ravens fly
  out, scouting the hexes they cross and their neighbors, then hurry home (three
  times as fast) to report, and launch again after a short rest. Only the flight
  out scouts.
- They start with a reach of 4 hexes. Recon is slow, and it's meant to feel
  like an expedition.
- Ravens grow slowly, because their abilities are strong at any stage. Most levels
  are quiet, and every third level improves one trait in turn: speed, gem odds,
  reach, then smarter scouting (how often a raven heads for uncharted hexes rather
  than a random direction). Ranks add the second raven and gem value; the scouted
  path stays one hex either side.
- Idea for later realms: unfamiliar land. A new realm subtracts levels from the
  ravens (Hel might take 50, two ranks), so they rebuild there. The penalty should
  show on screen, with a reason, and fall as the clan learns the realm.
- Each uncharted rock hex a trip reports has a small gem chance (2% at first),
  so one trip can find several. Gems exist only if found: mined undiscovered, that
  hex pays as plain rock. Gems pay x2, x5, x10, then x15 by raven rank.

### Vision and targeting

- The crew sees 4 hexes across open space, and a sight line stops at the first
  solid hex. Stonesight, a later upgrade, could let sight lines pass through rock.
- The ship finishes its current block before choosing another.
- Priority: the player's tap, then the Worldheart once it's open and 10% of the
  region is left, then the best visible block: damaged beats special beats normal,
  nearby, with open sides breaking ties.
- A tap holds until that block is gone.

### Haulers and cargo

- One pod per Haulers rank, capped at 9. Pods carry first and cut second.
- Cargo is measured in tons, not silver, so capacity keeps its meaning as values
  grow.
- Silver is banked when cargo gets home. A full pod leaves, takes about 10 seconds
  round trip, then rejoins.
- If every pod is away, the ship waits. Cargo Hold and Return Speed ease this.

### Junk

- Automation never damages stone: not the ship, not pods, not any tool.
- Only a player steering the ship into stone makes junk, which fills pods and pays
  nothing. Later upgrades can reject it.
- Ravens can spot rich finds out in the stone that only steering can reach. This
  is an active-play reward.

### Glory

- Glory comes from a square root of the silver earned this generation, so idling
  counts.
- Region 9 is a soft wall. Without sagas it takes far too long, and about 3
  generations make it comfortable. Nothing is locked.

### Treasure chest

- A chest drifts in every few minutes of play, and tapping it gives a random boon:
  silver, full mead, pods home at once, a fog patch revealed, or a short boost.
- It never expires and only one can be waiting, so idle play loses nothing.
- Every result is good. No near-miss animations or fake rarity.

### Runes

- Power drops to about x1.3 to x1.5, since current values are a main cause of
  runaway speed.
- Ansuz can't boost raven damage any more. It becomes a scouting rune.
- Costs stay real: a rune should still be something a player might turn down.

### Build order

1. Tools, ranks, unlocks, numbers and Glory.
2. Smaller hexes, stone map, tunnel, fog and ravens, with a phone test.
3. Cargo, junk, collapse sweep and chests.

## Ideas parked for later

- Special regions (armoured, hollow, all-gold, boss regions)
- Ship cosmetics earned by play, such as colour and prow shapes
- A rune codex: which combinations you've discovered
- Draupnir, Odin's self-copying gold ring, as a late-game idle upgrade
- Save export and import
- A real Android package (APK), built by GitHub Actions

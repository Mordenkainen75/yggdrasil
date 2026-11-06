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
6. **Pass on the saga** (unlocks on region 6): the next generation restarts at
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

## Pacing targets

Checked with `npm run balance`, a bot that plays in fast-forward.

- Region 1 takes about 45 seconds.
- First run hits a soft wall around regions 10 to 12, after 10 to 20 minutes.
- Each generation gets you back there faster, and a little further.

## The planned arc (not built yet)

Only Midgard exists today, and it has no end. The agreed direction is below, to
be built one realm at a time. None of it is final.

1. **Midgard:** the clan mines the world until it collapses with them on it.
2. **Hel:** miners get no heroes' afterlife, so the climb starts from the roots.
3. **The climb:** each realm adds its own rules and a unique upgrade. Dwarven
   tech arrives in Svartalfheim.
4. **The twist:** Naglfar, the ship of the dead, sails against the gods at
   Ragnarök. The clan's climb out of Hel turns out to be how Ragnarök begins.
5. **The ending:** Ragnarök is the finale. Credits roll, and the reborn world can
   be an optional replay.

Design rules for that arc:

- Ragnarök stays the finale, so it can't also be the regular prestige. Passing on
  the saga restarts the current realm. Finishing a realm is permanent.
- Aim for about nine regions per realm, not 50 or 100. A hundred regions of the
  same thing is filler.

## Ideas parked for later

- Special regions (armoured, hollow, all-gold, boss regions)
- Ship cosmetics earned by play, such as colour and prow shapes
- A rune codex: which combinations you've discovered
- Draupnir, Odin's self-copying gold ring, as a late-game idle upgrade
- Save export and import
- A real Android package (APK), built by GitHub Actions

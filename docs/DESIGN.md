# Wyrmhole: design notes

You are a cosmic larva. You burrow through hexagonal hive-planets, eat their
hearts, grow, shed your skin, and go again.

The reference for the *mechanics* (not the look or content) is the idle
planet-mining genre. Wyrmhole has its own creature, world, art and systems.

## The pledge

This game is the opposite of an exploitative mobile game. These are rules, not
goals. Any future feature has to pass all of them.

- **No ads**, of any kind, ever.
- **No real money.** No store, no premium currency, no "pay to skip".
- **No pressure to come back.** No daily rewards, streaks, limited-time events,
  or energy timers. Nothing is lost by being away.
- **Away time is a gift.** Your wyrm keeps earning while you're gone, and you
  never have to collect anything by hand.
- **Your choices wait for you.** Mutations never expire and never stop play.
- **No busywork.** If tapping something 40 times is never a decision, it gets a
  button ("Buy all I can") or an automation (the Instinct perk).
- **No accounts or tracking.** The save lives on the device.

The fun has to come from steady progress, satisfying effects, and real choices.

## The loop

1. The wyrm eats blocks on its own, earning **biomass**. Tap to lure it.
2. Spend biomass on upgrades (**Grow** tab).
3. Eat the planet's **heart** to collapse the world. Leftovers pay out at 50%.
4. Choose 1 of 3 **mutations**, kept until the next molt.
5. Tougher planets slow you down until the wall makes a molt worthwhile.
6. **Molt** (unlocks on world 6): restart at world 1, keep **chitin**, and spend
   it on permanent perks.

## Blocks

| Block | Effect |
|---|---|
| Crust | Plain. Deeper cells are tougher and worth more. |
| Nectar | Runs in veins. Worth 7x. |
| Pulse | Charges Frenzy. |
| Blister | Explodes and can chain. |
| Heart | Worth a lot. Killing it ends the planet. |

## Builds

Mutations are where the choices live. Many carry a real cost, and they push
towards a build: Blast, Grind, Acid, Swarm, Harvest, Frenzy or Bite. A
worthwhile test for any new mutation: is there a player who would turn it down?

## Pacing targets

Checked with `npm run balance`, a bot that plays in fast-forward.

- World 1 takes about 45 seconds.
- First run hits a soft wall around world 10 to 12, after 10 to 20 minutes.
- Each molt gets you back there faster, and a little further.

## Ideas parked for later

- Special planets (armoured, hollow, all-nectar, boss worlds)
- Wyrm cosmetics earned by play, such as colour and head shapes
- A build codex: which mutation combinations you've discovered
- Second prestige layer once molting feels solved
- Save export and import
- A real Android package (APK), built by GitHub Actions

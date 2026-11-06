# Yggdrasil (working title)

A personal Android idle game, built as an installable web app (PWA). Read
`docs/DESIGN.md` first. Its pledge (no ads, no real money, no pressure tactics)
is a hard requirement for every feature.

## Commands

- `npm run dev`: play locally. Add `?speed=20` to the address to fast-forward.
- `npm test`: game logic tests, using Node's built-in runner.
- `npm run balance -- 4 3600`: headless bot plays 4 runs, max 3600 game seconds each.
- `npm run build`: type-check and build to `dist/`.
- `npm run icons`: regenerate the app icons.

## Publishing

- Live at https://mordenkainen75.github.io/yggdrasil/, from the public repo
  `Mordenkainen75/yggdrasil`. Renaming the repo later changes that address, so
  the phone would need the game reinstalled.
- This is Daniel's personal project: it belongs to the GitHub account
  `Mordenkainen75`, not the work account `DriveraECSD`, which stays the default
  on this laptop. Never publish this repo from the work account. This repo's local
  git config makes pushes use the personal account's token whichever is active.
- Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds and
  publishes to GitHub Pages. Local edits don't reach the phone until pushed.
- An installed game shows an update on the launch after it downloads it, so a
  new version can take two launches to appear.
- This repo commits with the personal account's GitHub noreply address, set in
  its local git config, so a work email doesn't appear in public history.

## How the code is laid out

- `src/game/`: the rules. No DOM or canvas allowed here, so the same code runs
  in the browser, in tests and in the balance simulator.
- `src/game/config.ts`: every balance number, upgrade, perk and rune.
- `src/render/renderer.ts`: canvas drawing and effects. It reads state and
  consumes `state.events`. It must never change game rules.
- `src/ui/ui.ts`: HUD, tabs and modals (plain DOM).
- `src/main.ts`: wires it together: game loop, saving, input.

## Rules of thumb

- Files run directly in Node through type stripping: import with `.ts`
  extensions, and no enums or parameter properties.
- After changing a balance number, run `npm run balance` and compare to the
  pacing targets in `docs/DESIGN.md`.
- New saved fields must have defaults in `deserialize`, so old saves keep working.
- In dev builds `window.game()` returns live state for automated playtests.
- The ship and block symbols are line art. Blocks are solid color and fade paler as
  they take damage; hits show as soft particles, not lines. Don't use `shadowBlur`:
  it hurts phone frame rates. Fake glow with a wide, faint stroke under a crisp one.

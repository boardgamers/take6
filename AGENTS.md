# AGENTS.md

Guidance for AI agents working in this monorepo.

## What this is
Take 6 (6nimmt-like) — game engine + three web viewers. pnpm workspace, TypeScript ESM.
- `engine/` (take6-engine) — game logic + `wrapper.ts` (the boardgamers.space contract: init/move/moveAI/logSlice/stripSecret/…)
- `viewer/` — canvas viewer (Hex Engine)
- `viewer-svg/` (@gaia-project/take6-viewer) — Vue 2 SVG viewer
- `viewer-3d/` (take6-viewer-3d) — three.js viewer

## Rules
- **No defensive code. Fail loud.** Don't try/catch-and-continue, don't silently resync, don't clamp/normalize invalid data to "safe" values. If a contract is violated, throw / let it throw — a loud error in the console is how bugs get found and fixed. Validate at boundaries only, and validate by throwing.
- Comments: default to none; comment only the non-obvious why.
- Commits: gitmoji (🐛 fix, ✨ feature, ♻️ refactor, 🔥 removal, 👷 CI, 🔖 release).
- Checks before committing: `pnpm --filter <pkg> check` (and `pnpm test` for engine changes).

## Viewers & the platform contract
Each viewer exposes `window.<topLevelVariable>.launch(selector)` returning an EventEmitter; the boardgamers.space iframe wraps it (postMessage bridge). Documented in `viewer-3d/src/launch.ts` — keep the in/out event list accurate when you change it.

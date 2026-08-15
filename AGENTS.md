# AGENTS.md

Guidance for AI agents working in this monorepo.

## What this is
Take 6 (6nimmt-like) — game engine + three web viewers. pnpm workspace, TypeScript ESM.
- `engine/` (take6-engine) — game logic + `wrapper.ts` (the boardgamers.space contract: init/move/moveAI/logSlice/stripSecret/…)
- `viewer/` — canvas viewer (Hex Engine), archived
- `viewer-svg/` (@gaia-project/take6-viewer) — Vue 2 SVG viewer, archived
- `viewer-3d/` (take6-viewer-3d) — three.js viewer

## Rules
- **No defensive code. Fail loud.** Don't try/catch-and-continue, don't silently resync, don't clamp/normalize invalid data to "safe" values. If a contract is violated, throw / let it throw — a loud error in the console is how bugs get found and fixed. Validate at boundaries only, and validate by throwing.
- Comments: default to none; comment only the non-obvious why.
- Commits: gitmoji (🐛 fix, ✨ feature, ♻️ refactor, 🔥 removal, 👷 CI, 🔖 release).
- Checks before committing: `pnpm --filter <pkg> check` (and `pnpm test` for engine changes).

## Viewers & the platform contract
Each viewer exposes `window.<topLevelVariable>.launch(selector)` returning an EventEmitter; the boardgamers.space iframe wraps it (postMessage bridge). Documented in `viewer-3d/src/launch.ts` — keep the in/out event list accurate when you change it.

## Publishing the 3D viewer to boardgamers.space
No npm publish needed — the bundle is uploaded straight to the platform's object storage via the admin API, and the gameinfo doc is pointed at the returned URL. take6 is game `take6`, version `1`; the 3D viewer is the **alternate** viewer (`topLevelVariable: take63d`, the default is still the archived SVG viewer).

```sh
# 1. Build the UMD bundle (needs the engine built first)
pnpm --filter take6-engine build
pnpm --filter take6-viewer-3d build:lib     # → viewer-3d/dist-lib/take6-viewer-3d.umd.js

# 2. Upload the bundle (raw bytes → S3, returns { url })
TOKEN="bgs_admin_…"   # admin token, minted in the BGS admin panel (Admin Tokens)
curl -X POST "https://boardgamers.space/api/admin/gameinfo/take6/1/viewer/file?filename=take6-viewer-3d.umd.js&alternate=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @viewer-3d/dist-lib/take6-viewer-3d.umd.js

# 3. Point the alternate viewer at the returned url
curl -X PUT "https://boardgamers.space/api/admin/gameinfo/take6/1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"viewer":{"alternate":{"url":"<url from step 2>","topLevelVariable":"take63d","dependencies":{"scripts":[],"stylesheets":[]},"fullScreen":true,"replayable":true,"trusted":false}}}'
```

Notes:
- Use `https://boardgamers.space` (no `www` — that host 308-redirects and drops the auth context).
- The upsert `$set`-merges, so sending only `viewer.alternate` leaves the default viewer untouched. To promote the 3D viewer to default, send the same object under `viewer` (top-level) instead and keep the SVG one as the alternate.
- The sourcemap (`*.umd.js.map`) is optional; nginx rejects it if it exceeds its body-size limit.
- Read the current doc first with `GET /api/admin/gameinfo/take6/1` to see the live viewer/engine config.

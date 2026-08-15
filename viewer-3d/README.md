# take6-viewer-3d

A 3D viewer for Take 6, built with [three.js](https://threejs.org) and bundled with Vite. Playable on desktop and mobile.

## Features

- A physical game table (felt, wooden rim) with textured cards whose faces are painted on canvas.
- A timeline-based animation system for deal / reveal / place / take-row.
- Springy pointer drag & drop for selecting and placing cards.
- Auto-framing of the table for any screen size.
- Follows the host page's light/dark theme via the `dark` class on `<html>`.

## Running locally

From the repo root:

```sh
pnpm install
pnpm --filter take6-viewer-3d dev
```

This serves a standalone demo that plays a local game against five AI opponents. Add `?points=2&handSize=2` to shorten a game while testing.

## Building

```sh
pnpm --filter take6-viewer-3d build        # static site (dist/)
pnpm --filter take6-viewer-3d build:lib    # embeddable UMD bundle (dist-lib/)
```

## Embedding

The viewer follows the boardgamers.space iframe contract: load the UMD bundle via `<script>`, then call `window.take63d.launch(selector)`. It returns an [`EventEmitter`](https://nodejs.org/api/events.html).

```js
const emitter = window.take63d.launch("#app");
```

### Inbound events (host → viewer)

| Event | Payload |
| --- | --- |
| `state` | `GameState` |
| `player` | `{ index }` |
| `gamelog` | `{ log, availableMoves }` after a `fetchLog`, or `{ start, data: { log, availableMoves } }` after a move |
| `preferences` | `{ dark?: boolean }` |
| `replay:start` | — |
| `replay:to` | `index` |
| `replay:end` | — |

### Outbound events (viewer → host)

| Event | Payload |
| --- | --- |
| `move` | the player's move |
| `fetchState` | — |
| `fetchLog` | — |
| `ready` | — |
| `addLog` | `string[]` |
| `replaceLog` | `string[]` |
| `replay:info` | `{ start, current, end }` |
| `player:clicked` | `{ index, name }` — host navigates to `/user/<name>` |

The returned emitter also exposes a `dispose()` method to clean up the controller.

> The authoritative source for the in/out event list is `src/launch.ts` — keep it accurate if you change the contract.

# take6

Monorepo for [Take 6](https://en.wikipedia.org/wiki/6_Nimmt!) (a card game similar to 6nimmt): the game engine and three web viewers, consolidated from the former `take6-engine`, `take6-viewer` and `take6-viewer-svg` repositories.

## Repository layout

- **`engine/`** (`take6-engine`) — TypeScript engine for Take 6, a game similar to 6nimmt. It implements the full game logic: setup, moves, AI moves, state serialization (`stripSecret`), state reconstruction and scoring, plus a mocha/chai test suite. Published as an ES module (`tsc`, NodeNext), TypeScript 5.

- **`viewer/`** (`take6-viewer`) — A canvas-based viewer for the game built on [Hex Engine](https://hex-engine.dev) (`@hex-engine/2d`). It renders cards, placeholders and player labels with drag & drop and simple animations, and can run a local game against the AI. Built with `hex-engine-scripts`.

- **`viewer-svg/`** (`@gaia-project/take6-viewer`) — An SVG-based viewer written with Vue 2 (class components). It displays the game state and log as SVG/DOM elements with drag & drop, and is also publishable as a reusable library (`vue-cli-service build --target lib`). Built with `vue-cli-service`.

- **`viewer-3d/`** (`take6-viewer-3d`) — A 3D viewer built with [three.js](https://threejs.org) and bundled with Vite. It renders a physical game table (felt, wooden rim), textured cards with canvas-painted faces, a timeline-based animation system (deal / reveal / place / take-row), and springy pointer drag & drop. It auto-frames the table for any screen size, works on mobile and desktop, and follows the host page's light/dark theme via the `dark` class on `<html>`. Run it standalone with `pnpm --filter take6-viewer-3d dev` (plays a local game against 5 AIs), or embed it via `launch(selector)` like the other viewers.

## Setup

This repo uses [pnpm](https://pnpm.io) workspaces:

```sh
pnpm install
```

## Build

```sh
pnpm build        # runs "build" in every package that defines it
```

## Test

```sh
pnpm test         # runs "test" in every package that defines it
```

`pnpm test` runs the engine's mocha/chai suite. The two viewers have no meaningful automated tests (`viewer/`'s `hex-engine-scripts test` runs in watch mode; `viewer-svg/` has only a placeholder unit test).

### Notes / caveats

- `viewer-svg/` is a Vue 2 project on an old toolchain. Its build disables the redundant `fork-ts-checker` type-check pass (see `viewer-svg/vue.config.js`), because that plugin's SFC shim is incompatible with the `@vue/compiler-sfc@2.7.16` the toolchain is pinned to via a pnpm override; TypeScript is still transpiled by babel + ts-loader.
- `viewer/` declares `lodash` as a dependency now (it previously relied on yarn's hoisting to resolve it transitively).

## License

MIT (see [LICENSE](LICENSE)).

# take6

Monorepo for [Take 6](https://en.wikipedia.org/wiki/6_Nimmt!) (a card game similar to 6nimmt): the game engine and two web viewers, consolidated from the former `take6-engine`, `take6-viewer` and `take6-viewer-svg` repositories.

## Repository layout

- **`engine/`** (`take6-engine`) — TypeScript engine for Take 6, a game similar to 6nimmt. It implements the full game logic: setup, moves, AI moves, state serialization (`stripSecret`), state reconstruction and scoring, plus a mocha/chai test suite. Built with `tsc`.

- **`viewer/`** (`take6-viewer`) — A canvas-based viewer for the game built on [Hex Engine](https://hex-engine.dev) (`@hex-engine/2d`). It renders cards, placeholders and player labels with drag & drop and simple animations, and can run a local game against the AI. Built with `hex-engine-scripts`.

- **`viewer-svg/`** (`@gaia-project/take6-viewer`) — An SVG-based viewer written with Vue 2 (class components). It displays the game state and log as SVG/DOM elements with drag & drop, and is also publishable as a reusable library (`vue-cli-service build --target lib`). Built with `vue-cli-service`.

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

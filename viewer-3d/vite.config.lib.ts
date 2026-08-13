import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Library build for embedding the 3D viewer in the Boardgamers iframe.
// Produces a single self-contained UMD bundle exposing `window.take63d.launch`.
// The iframe contract loads the bundle via <script> then calls
// `window.<topLevelVariable>.launch('#app')` (topLevelVariable = "take63d").
export default defineConfig({
  resolve: {
    alias: {
      // take6-engine imports node's `assert`; provide a tiny browser shim.
      assert: fileURLToPath(new URL("./src/shims/assert.ts", import.meta.url))
    }
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1200,
    outDir: "dist-lib",
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "take63d",
      formats: ["umd"],
      fileName: () => "take6-viewer-3d.umd.js"
    }
  }
});

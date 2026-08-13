import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // take6-engine imports node's `assert`; provide a tiny browser shim.
      assert: fileURLToPath(new URL("./src/shims/assert.ts", import.meta.url))
    }
  },
  server: {
    host: true,
    port: 5203
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1200
  }
});

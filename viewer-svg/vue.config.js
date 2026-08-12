// Disable the fork-ts-checker-webpack-plugin type-check pass. The Vue 2 toolchain's
// fork-ts-checker (via @vue/cli-plugin-typescript) uses a `vue-compiler-sfc-shim` that
// expects the Vue 3-style `{ descriptor }` result from @vue/compiler-sfc.parse(), but
// under pnpm @vue/compiler-sfc resolves to the 2.7 shim (which returns the raw SFC
// object), so the type checker crashes. TypeScript is still transpiled by
// babel + ts-loader, so the production build works without the redundant check.
module.exports = {
  chainWebpack: (config) => {
    config.plugins.delete("fork-ts-checker");
  },
};

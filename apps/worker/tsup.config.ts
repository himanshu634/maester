import { defineConfig } from "tsup";
export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: [/^@maester\//],
  // Workspace deps (e.g. @maester/db) pull in CJS libs like `pg` that call
  // `require(...)` internally. Bundled into ESM output, esbuild's fallback
  // `__require` shim throws "Dynamic require of ... is not supported"
  // because there is no ambient `require` in an ESM module. Defining one via
  // `createRequire` makes esbuild's shim resolve through it instead.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

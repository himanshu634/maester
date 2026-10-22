import { defineConfig } from "tsup";
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: [/^@maester\//],
  // @maester/api/read reaches @maester/jobs, which imports @google-cloud/tasks. Bundled, its google-gax reads __dirname,
  // which ESM output lacks; it stays external (and a dependency of this app), as in apps/api. No tool here dispatches a job.
  external: ["@google-cloud/tasks"],
  // Workspace deps (e.g. @maester/db) pull in CJS libs like `pg` that call `require(...)` internally. Bundled into
  // ESM output, esbuild's fallback `__require` shim throws "Dynamic require of ... is not supported" because there is
  // no ambient `require` in an ESM module. Defining one via `createRequire` makes the shim resolve through it.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

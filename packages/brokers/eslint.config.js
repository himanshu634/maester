import shared from "@maester/config/eslint.config.js";

const MESSAGE = "Plugins reach the network only through ctx.http (spec §5.5)";

/** Names a plugin must not use; each carries the same message. */
const bannedGlobals = ["fetch", "XMLHttpRequest", "WebSocket", "process"];
const bannedModules = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:fs",
  "node:child_process",
  "http",
  "https",
  "fs",
  "undici",
];

export default [
  ...shared,
  {
    // Spec §5.5: a plugin reaches the network only through the ctx.http the host gives it.
    files: ["src/plugins/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...bannedGlobals.map((name) => ({ name, message: MESSAGE }))],
      "no-restricted-imports": ["error", { paths: bannedModules.map((name) => ({ name, message: MESSAGE })) }],
    },
  },
];

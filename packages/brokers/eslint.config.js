import shared from "@maester/config/eslint.config.js";

const MESSAGE = "Plugins reach the network only through ctx.http (spec §5.5)";

/** Names a plugin must not use; each carries the same message. `globalThis` and `global` are here so neither can be aliased. */
const bannedGlobals = ["fetch", "XMLHttpRequest", "WebSocket", "process", "globalThis", "global"];
/**
 * Modules named for their message. The allow-list below refuses them as well, with every other
 * bare specifier; this list keeps a clear message on the ones a plugin would reach for first.
 */
const bannedModules = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "http",
  "https",
  "net",
  "tls",
  "fs",
  "fs/promises",
  "child_process",
  "undici",
];

/**
 * Import sources a plugin may not use, as regular expressions over the specifier as written (lint
 * does not resolve a path, so one written to get round these is for review to catch).
 * - Anything but a relative path or `@maester/contracts`: every package and every Node module,
 *   `node:http2`, `dns` or `worker_threads` included, without listing them.
 * - `kit/http`, where `createBrokerHttp` lives: a plugin gets `ctx.http`, never the factory.
 * - `host`, and an `index` reached by `..` (the package's own, or the plugin list): the host's
 *   functions make a client from whatever manifest they are given, and the index exports them.
 */
const bannedPatterns = [
  "^(?!\\.{1,2}/)(?!@maester/contracts$)",
  "(^|/)kit/http(\\.(js|ts))?$",
  "(^|/)host(\\.(js|ts))?$",
  "(^|/)\\.\\.(/\\.\\.)*/?(index(\\.(js|ts))?)?$",
];

/** Syntax a plugin may not use: a dynamic import, `require`, anything off `globalThis`, and the factory by name from any module. */
const bannedSyntax = [
  "ImportExpression",
  "CallExpression[callee.name='require']",
  "MemberExpression[object.name='globalThis']",
  "ImportSpecifier[imported.name='createBrokerHttp']",
];

export default [
  ...shared,
  {
    // Spec §5.5: a plugin reaches the network only through the ctx.http the host gives it.
    files: ["src/plugins/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...bannedGlobals.map((name) => ({ name, message: MESSAGE }))],
      "no-restricted-imports": [
        "error",
        {
          paths: bannedModules.map((name) => ({ name, message: MESSAGE })),
          patterns: bannedPatterns.map((regex) => ({ regex, message: MESSAGE })),
        },
      ],
      "no-restricted-syntax": ["error", ...bannedSyntax.map((selector) => ({ selector, message: MESSAGE }))],
    },
  },
];

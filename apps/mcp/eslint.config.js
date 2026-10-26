import base from "@maester/config/eslint.config.js";

const WHY = "Figures leave this server as the decimal strings the database holds; they are never parsed into numbers (spec section 8).";

export default [
  ...base,
  {
    // Tests may build fixtures however they like; the server's code may not touch a figure as a number.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", { name: "parseFloat", message: WHY }, { name: "parseInt", message: WHY }],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: WHY },
        { object: "Number", property: "parseInt", message: WHY },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='Number']", message: WHY },
        { selector: "NewExpression[callee.name='Number']", message: WHY },
        { selector: "CallExpression[callee.name=/^(parseFloat|parseInt)$/]", message: WHY },
        // Unary plus, BigInt and toFixed also turn a figure's string into a number, or a number into a rounded string.
        { selector: "UnaryExpression[operator='+']", message: WHY },
        { selector: "CallExpression[callee.name='BigInt']", message: WHY },
        { selector: "MemberExpression[property.name='toFixed']", message: WHY },
      ],
      "no-restricted-imports": ["error", { paths: [{ name: "decimal.js", message: WHY }, { name: "decimal.js-light", message: WHY }], patterns: ["decimal.js/*"] }],
    },
  },
];

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["tests/e2e/**/*.js", "tests/e2e/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        describe: "readonly",
        it: "readonly",
        performance: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["tests/release/**/*.mjs", "tools/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
);

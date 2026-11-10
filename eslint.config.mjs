import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  { ignores: ["**/dist/**", "**/cdk.out/**", "**/.next/**", "**/next-env.d.ts", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["infra/lambda/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", Buffer: "readonly", console: "readonly", TextDecoder: "readonly" } },
  },
];

import { defineConfig } from "vitest/config";

// tsconfig.json keeps "jsx": "preserve" for Next.js, which compiles JSX itself with the automatic runtime. Tests
// that render components need the same runtime, or every JSX element fails with "React is not defined".
export default defineConfig({
  esbuild: { jsx: "automatic" },
});

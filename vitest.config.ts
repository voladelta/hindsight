import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/routes/**/*.test.ts"],
    exclude: [".delta/**", "dist/**", "node_modules/**"],
    sequence: { concurrent: false },
  },
});

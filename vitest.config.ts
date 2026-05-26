import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["core/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});

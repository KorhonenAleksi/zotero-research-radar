import { defineConfig } from "vitest/config";

// Unit tests for the pure core (src/core). These run in plain Node, without Zotero.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});

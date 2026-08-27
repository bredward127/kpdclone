import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: process.cwd(),
  test: {
    include: ["tests/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "client/src"),
    },
  },
});

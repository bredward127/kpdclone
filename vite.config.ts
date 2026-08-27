import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(process.cwd(), "client"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "client/src"),
    },
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});

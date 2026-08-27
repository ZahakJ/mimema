/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Dev API server sits on 5900 (prod runs on 8001 so the live site keeps
// serving while you develop). Vite dev 5901, preview 6901 — family scheme.
const API = "http://127.0.0.1:5900"

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5901,
    strictPort: true,
    // WHITEPAPER.md stays canonical at the repo root; the paper view imports
    // it with ?raw, which is above the vite root
    fs: { allow: [".."] },
    proxy: {
      "/api": API,
      "/m": API,
      "/t": API,
      "/healthz": API,
    },
  },
  preview: { port: 6901, strictPort: true },
  test: {
    environment: "node",
    include: ["../server/**/*.test.ts", "../shared/**/*.test.ts", "../client/**/*.test.ts"],
  },
})

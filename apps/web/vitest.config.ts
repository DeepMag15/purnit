import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Performance pass 2 (CONTEXT.md §48): the default `forks` pool started
    // crashing both worker processes outright (zero tests run, no useful
    // error surfaced) once @tanstack/react-query's larger import tree landed
    // — reproduced reliably, gone immediately under `threads`. A resource/
    // environment quirk of the fork pool under this heavier dependency load,
    // not a test or app bug.
    pool: "threads",
  },
});

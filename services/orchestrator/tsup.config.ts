import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/daemon.ts"],
  format: ["esm"],
  dts: false, // Temporarily disabled - will fix TypeScript errors later
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@neuro/shared"],
});

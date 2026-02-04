import { defineConfig } from "tsup";
import type { Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: [
    "src/index.ts",
    "src/schemas/index.ts",
    "src/security/index.ts",
    "src/logger/index.ts",
    "src/constants/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  // Don't clean in watch mode to prevent race conditions with services
  clean: !options.watch,
  treeshake: true,
}));

import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.mjs",
  sourcemap: true,
  packages: "external",
  banner: {
    js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
    `.trim(),
  },
});

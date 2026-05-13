// esbuild script: bundles src/app.ts + xterm into dist/app.js
import * as esbuild from "esbuild";
import { argv } from "process";

const watch = argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/app.ts"],
  bundle:      true,
  outfile:     "dist/app.js",
  format:      "iife",
  platform:    "browser",
  sourcemap:   true,
  minify:      !watch,
});

if (watch) {
  await ctx.watch();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("build done");
}

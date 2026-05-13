// esbuild script: bundles everything into dist/ as a self-contained deployment unit
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { argv } from "process";

const watch = argv.includes("--watch");

mkdirSync("dist", { recursive: true });

// Copy static files into dist so it's a fully self-contained folder
copyFileSync("index.html", "dist/index.html");
copyFileSync("style.css",  "dist/style.css");

const ctx = await esbuild.context({
  entryPoints: {
    app:   "src/app.ts",
    xterm: "node_modules/@xterm/xterm/css/xterm.css",  // bundle xterm CSS to dist/xterm.css
  },
  bundle:    true,
  outdir:    "dist",
  format:    "iife",
  platform:  "browser",
  sourcemap: true,
  minify:    !watch,
});

if (watch) {
  await ctx.watch();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("build done → dist/");
}

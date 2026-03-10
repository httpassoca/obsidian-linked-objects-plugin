import esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    format: "cjs",
    target: "es2020",
    outfile: "main.js",
    sourcemap: "inline",
    logLevel: "info",
    treeShaking: true,
  })
  .catch(() => process.exit(1));

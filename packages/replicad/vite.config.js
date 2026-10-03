import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vitest/config";
import dts from "vite-plugin-dts";

const src = (path) => resolve(import.meta.dirname, path);

// The package is built in three passes that append to the same `dist`:
//
// 1. `vite build`: the main `replicad` entry (ES and CJS). It is a single,
//    self-contained file with its source map, with no shared chunk, so that
//    stack frames from replicad code always map through `replicad.js.map`.
// 2. `REPLICAD_SHAPE_FUNCTIONS=true vite build`: the `shape-functions` entry.
//    It bundles the shape function modules and imports the stateful modules
//    they share with the main entry (the OpenCascade instance, garbage
//    collection, geometry classes) from `replicad.js`, so both entries use
//    one instance of them.
// 3. `REPLICAD_UMD=true vite build`: the UMD build of the main entry.
const umdOnly = process.env.REPLICAD_UMD?.toLowerCase() === "true";
const shapeFunctionsOnly =
  process.env.REPLICAD_SHAPE_FUNCTIONS?.toLowerCase() === "true";

const entries = {
  replicad: src("src/index.ts"),
  "shape-functions": src("src/shapeFunctions/index.ts"),
};

// The types of both entries are bundled during the main pass, which reads the
// entries from `lib.entry`, while `rollupOptions.input` limits the JavaScript
// output to the main entry.
const mainLib = {
  entry: entries,
  formats: ["es", "cjs"],
};

const shapeFunctionsLib = {
  entry: { "shape-functions": entries["shape-functions"] },
  formats: ["es", "cjs"],
};

const umdLib = {
  entry: src("src/index.ts"),
  name: "replicad",
  fileName: "replicad",
  formats: ["umd"],
};

// Modules the shape functions import from outside their directory and that
// the main entry re-exports in full. The shape-functions build imports them
// from the main entry instead of bundling a second copy.
const MAIN_ENTRY = "replicad:main-entry";
const sharedModules = ["constants", "geom", "geomHelpers", "oclib", "register"];

const importSharedModulesFromMain = () => {
  const index = readFileSync(src("src/index.ts"), "utf8");
  for (const name of sharedModules) {
    if (!index.includes(`export * from "./${name}";`)) {
      throw new Error(`src/index.ts must re-export all of ./${name}`);
    }
  }
  const sharedIds = new Set(sharedModules.map((name) => src(`src/${name}.ts`)));

  return {
    name: "replicad-import-shared-modules-from-main",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith(".")) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved && sharedIds.has(resolved.id)) {
        return { id: MAIN_ENTRY, external: true };
      }
      return null;
    },
    outputOptions(options) {
      const mainFile =
        options.format === "cjs" ? "replicad.cjs" : "replicad.js";
      return { ...options, paths: { [MAIN_ENTRY]: `./${mainFile}` } };
    },
  };
};

const lib = umdOnly ? umdLib : shapeFunctionsOnly ? shapeFunctionsLib : mainLib;

export default defineConfig({
  build: {
    lib,
    rollupOptions:
      lib === mainLib ? { input: { replicad: entries.replicad } } : undefined,
    emptyOutDir: lib === mainLib,
    sourcemap: true,
    minify: false,
  },
  plugins: [
    shapeFunctionsOnly ? importSharedModulesFromMain() : null,
    lib !== mainLib || process.env.NO_TYPES?.toLowerCase() === "true"
      ? null
      : dts({
          bundleTypes: true,
        }),
  ].filter((a) => !!a),
  test: {
    setupFiles: ["./__tests__/setup.ts"],
  },
});

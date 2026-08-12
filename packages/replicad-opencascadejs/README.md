# `replicad-opencascadejs`

An opencascadejs build containing only the APIs necessary to run replicad.

## Usage

```js
import oc from "replicad-opencascadejs";
```

The root is a ready-to-use instance. Consumers that own initialization timing
or need a fixed build should import an initializer explicitly:

```js
import { createInstance } from "replicad-opencascadejs/single/init";
import wasmUrl from "replicad-opencascadejs/single/wasm?url";

const oc = await createInstance({ locateFile: () => wasmUrl });
```

Use `./init` for lazy automatic selection, `./single/init` or `./multi/init` for
a fixed variant, and the matching `./single/wasm` or `./multi/wasm` URL. The
`./single` and `./multi` subpaths expose raw Emscripten factories.

## Building

The build is driven by [`@libcascade/toolchain`][toolchain] from the typed
`libcascade.config.ts` in this directory. Docker must be installed on the host
and its daemon must be running before any `libcascade build` command. The
toolchain pins the image by digest, so no tags need manual syncing.

```
pnpm build          # both variants, then assemble the packaging surface
pnpm buildSingle    # libcascade build --variant single
pnpm buildMulti     # libcascade build --variant multi
pnpm assemble       # regenerate dist/{types,init,index,variant}.d.ts + entries
```

To iterate against a locally built image instead of the pinned digest, set
`LIBCASCADE_IMAGE` (the CLI prints a provenance warning when it is active):

```
LIBCASCADE_IMAGE=ocjs-local:single-threaded pnpm buildSingle
LIBCASCADE_IMAGE=ocjs-local:multi-threaded pnpm buildMulti
```

Custom C++ bindings live in `build-config/wrappers/` and are declared, with the
symbols each file provides, in `libcascade.config.ts`.

[toolchain]: https://github.com/taucad/opencascade.js/tree/main/packages/toolchain

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

## Replicad entry points

Besides the OCCT bindings, the build carries Replicad's own C++ helpers
(`build-config/wrappers/`). The `...WithOptions` forms extend the original entry
points without changing them; with the defaults shown they return the same
bytes.

| Entry point | Adds |
| --- | --- |
| `ReplicadBinaryBrep.Write(shape, withTriangles, withNormals)` | Binary BRep in memory (`ReplicadBinaryBrepData`: `getPtr()`, `getSize()`), with or without the cached triangulation. `Write(shape, true, false)` equals `BinTools.Write(shape, path, progress)`. |
| `ReplicadBinaryBrep.Allocate(size)`, `ReplicadBinaryBrep.Read(data)` | Read binary BRep from a buffer filled at `getPtr()`. |
| `ReplicadBinaryBrep.IdentityHash(shape)` | 64-bit FNV-1a (16 hex digits) of the BRep without triangulation; meshing or cleaning never changes it. |
| `ReplicadMeshExtractor.meshWithOptions(shape, tol, angTol, clean, userBreak)`, `extractWithOptions(shape, tol, angTol, skipNormals, clean, userBreak)` | `clean: true` is `mesh`/`extract`; `clean: false` keeps an existing triangulation that is at least as fine as requested. |
| `ReplicadBooleanBatch.{Fuse,Cut,Common}WithOptions(..., useOBB, userBreak)` | `useOBB` turns on BOPAlgo's oriented-bounding-box prefilter (the plain forms pass `false`). |
| `new ReplicadUserBreak(wordAddress, expectedValue, useHook)` | A cooperative stop. `new ReplicadUserBreak(0, 0, false)` is disabled and attaches no progress indicator. |

A `ReplicadUserBreak` stops the operation once the 32-bit integer at
`wordAddress` differs from `expectedValue`, or once `oc.replicadUserBreak()`
(called on the main runtime thread only, and never allowed to throw) returns a
truthy value. The word suits the `multi` variant, whose memory another thread
can write (`ReplicadAbortWord` allocates one); the hook works in both variants,
for example by reading a host `SharedArrayBuffer` with `Atomics.load`. A stopped
Boolean returns a result with `IsUserBreak()` true, errors and no shape; a
stopped mesh throws `ReplicadUserBreakError` (message `ReplicadUserBreak`,
readable with `oc.getExceptionMessage`).

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

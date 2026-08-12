# OCCT 8.0.1 migration

This document covers the Replicad-specific parts of the OCCT 8.0.1 migration.

## Runtime builds

Replicad now ships two builds with the same generated binding surface:

| Build             | Purpose                                             | Exception handling            |
| ----------------- | --------------------------------------------------- | ----------------------------- |
| `replicad_single` | Default browser and Node runtime                    | Native WebAssembly exceptions |
| `replicad_multi`  | Cross-origin-isolated runtimes with pthread support | Native WebAssembly exceptions |

The former `replicad_with_exceptions` build is removed. Both remaining builds use `-fwasm-exceptions`, so callers no longer need to choose between an exception-enabled and exception-disabled artifact.

Consumers calling OpenCascade.js directly can decode a caught `WebAssembly.Exception` with `oc.getExceptionMessage(error)`, which returns the OCCT exception type and message. `replicad-evaluator` applies this decoding automatically when reporting failed geometry operations.

The multi build remains available for consumers that provide the browser isolation and worker environment required by Emscripten pthreads. Replicad's normal API is identical between the single and multi entry points.

The ESM root exports a ready OpenCascade instance. Consumers that own startup timing use `./init`, while `./single/init` and `./multi/init` load one fixed variant without pulling the other variant into the bundle. Raw glue and WASM subpaths remain available for custom loaders. Small CommonJS compatibility shims preserve the existing root and `/multi` factories for `require()` consumers.

## OCCT 8 binding changes

OCCT 8 and the updated generated bindings consolidate numbered overload classes into their public class names. Replicad therefore calls overloads such as `gp_Pnt(...)` directly instead of selecting generated names such as `gp_Pnt_2`.

Reference-counted OCCT handles are also returned through their resolved wrapper type. Callers no longer invoke `.get()` merely to unwrap a generated handle. This changes the JavaScript binding surface, not OCCT's reference-counted ownership model.

The migration includes the corresponding changes across geometry construction, curves, projections, import/export, XCAF assembly export, sketches, measurements, and shape operations.

### Progress ranges

The generated bindings now make the trailing `Message_ProgressRange` optional for `TransferRoots` and most `Build` and `Perform` methods. Omitting it materializes OCCT's default progress range internally, so this migration removes 15 manual progress-range allocations.

Two writer APIs still require an explicit range: `STEPControl_Writer.Transfer(..., theProgress)` and `STEPCAFControl_Writer.Perform(..., theProgress)`. Replicad retains progress-range allocations at exactly those two callsites.

## Native rendering extractors

The face and edge rendering paths use Replicad-maintained C++ wrappers compiled into both WASM variants. The wrappers traverse OCCT topology and tessellation in native code, then return packed buffers for bulk JavaScript reads.

This replaces the historical edge path's per-face, per-edge, and per-point Embind calls with one extraction call. The final direct A/B benchmark against that historical JavaScript implementation measured a 71.92× median speedup on its 32-instance premeshed fixture while preserving line geometry, group ranges, and bounded edge hashes.

The native implementation also preserves Replicad's existing topology-label contract:

- public shape hashes and face/edge group hashes use the same bounded `[1, 2^31 - 1]` function;
- shared edges are deduplicated with exact OCCT shape identity rather than hash equality;
- face occurrences are not deduplicated;
- located face triangulations use their actual `TopLoc_Location`; and
- free edges use the requested angular and linear deflection tolerances in OCCT's expected order.

These wrappers are part of the required `replicad-opencascadejs` module contract. An OCCT 7 module is not compatible with the broader OCCT 8 Replicad API, so the removed JavaScript extractor is not retained as a compatibility fallback.

## Build inputs

The build source is the typed `packages/replicad-opencascadejs/libcascade.config.ts`, driven by the `@libcascade/toolchain` CLI. Docker must be installed and its daemon running. Build both artifacts and regenerate the packaging surface with:

```sh
pnpm --dir packages/replicad-opencascadejs run buildSingle
pnpm --dir packages/replicad-opencascadejs run buildMulti
pnpm --dir packages/replicad-opencascadejs run assemble
```

This migration is built with `@libcascade/toolchain@3.0.0-beta.3` from the immutable OCCT 8.0.1 beta inputs:

| Image                                                        | OCI index digest                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `ghcr.io/taucad/opencascade.js:3.0.0-beta.3-single-threaded` | `sha256:f4ebf133b6fcd508e34ea239b7c07514fb8920d566f3ca0601f7275f8e88227a` |
| `ghcr.io/taucad/opencascade.js:3.0.0-beta.3-multi-threaded`  | `sha256:687b97bd12348988ebfc724a3f3c3d95d48b07b547b60f0dc7ce1fee4dc743ee` |

Adopting the stable libcascade 3.0.0 images is a separate follow-up. It is not part of this migration branch.

The generated package contains only the runtime artifacts listed in `package.json`: JavaScript glue and WebAssembly for both variants, the assembled `index`, `init`, and variant entries, and the shared `types.d.ts` surface. Per-variant declarations remain checked-in build inputs to `libcascade assemble` but are not packed. Build manifests, provenance JSON, and linker symbol maps remain local diagnostics and are not versioned or packed.

## Verification

The migration is covered at three levels:

- direct `replicad-opencascadejs` tests exercise the generated single and multi modules, native face/edge extraction, located and free edges, bounded hash parity, and pthread startup;
- Replicad tests cover the high-level mesh contract; and
- package and consumer builds verify the generated artifacts through the public APIs.

Run the package checks from the repository root after building the WASM artifacts:

```sh
pnpm --filter replicad-opencascadejs test
pnpm --filter replicad typecheck
pnpm --filter replicad test -- --run
pnpm --filter replicad build
```

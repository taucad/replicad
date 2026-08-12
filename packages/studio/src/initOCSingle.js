import { createInstance } from "replicad-opencascadejs/single/init";
import opencascadeWasm from "replicad-opencascadejs/single/wasm?url";

export default async () =>
  createInstance({
    locateFile: () => opencascadeWasm,
  });

import assert from "node:assert/strict";
import { test } from "vitest";

import initSingle from "../dist/replicad_single.js";

// libcascade before 3.1.0 generated an empty destructor for every class using
// OCCT's DEFINE_STANDARD_ALLOC, so delete() released nothing and repeated
// create-and-delete cycles grew the heap without bound.
test("delete() releases memory across repeated create-and-delete cycles", async () => {
  const oc = await initSingle({ print: () => {}, printErr: () => {} });
  const heap = () => oc.wasmMemory.buffer.byteLength;
  const box = new oc.BRepPrimAPI_MakeBox(4, 4, 4);
  const shape = box.Shape();
  const cycle = () => {
    new oc.gp_Pnt(1, 2, 3).delete();
    new oc.GProp_GProps().delete();
    const explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );
    explorer.delete();
  };

  for (let i = 0; i < 1_000; i++) cycle();
  const before = heap();
  for (let i = 0; i < 300_000; i++) cycle();
  assert.equal(heap() - before, 0);

  shape.delete();
  box.delete();
}, 120_000);

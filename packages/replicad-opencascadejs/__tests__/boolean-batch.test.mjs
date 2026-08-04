import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import initMulti from "../dist/replicad_multi.js";
import initSingle from "../dist/replicad_single.js";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const multiGluePath = join(distDir, "replicad_multi.js");
const runtimes = [
  {
    name: "single",
    wasmPath: join(distDir, "replicad_single.wasm"),
    initialize: (wasmPath) => initSingle({ locateFile: () => wasmPath }),
  },
  {
    name: "pthread",
    wasmPath: join(distDir, "replicad_multi.wasm"),
    initialize: (wasmPath) =>
      initMulti({
        locateFile: () => wasmPath,
        mainScriptUrlOrBlob: multiGluePath,
      }),
  },
];

const listOf = (oc, shapes) => {
  const list = new oc.NCollection_List_TopoDS_Shape();
  for (const shape of shapes) list.Append(shape);
  return list;
};

const volume = (oc, shape) => {
  const properties = new oc.GProp_GProps();
  try {
    oc.BRepGProp.VolumeProperties(shape, properties, true, false, false);
    return properties.Mass();
  } finally {
    properties.delete();
  }
};

const translatedBox = (oc, size, offset) => {
  const maker = new oc.BRepPrimAPI_MakeBox(...size);
  const source = maker.Shape();
  const transform = new oc.gp_Trsf();
  const vector = new oc.gp_Vec(...offset);
  transform.SetTranslation(vector);
  const operation = new oc.BRepBuilderAPI_Transform(
    source,
    transform,
    false,
    false
  );
  const shape = operation.Shape();

  return {
    shape,
    delete: () => {
      shape.delete();
      operation.delete();
      vector.delete();
      transform.delete();
      source.delete();
      maker.delete();
    },
  };
};

const assertSuccess = (result) => {
  assert.equal(result.IsDone(), true, result.Errors());
  assert.equal(result.HasErrors(), false, result.Errors());
  assert.equal(result.HasWarnings(), false, result.Warnings());
  assert.equal(result.Errors(), "");
  assert.equal(result.Warnings(), "");
};

const assertVolume = (actual, expected) => {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    `${actual} differs from ${expected}`
  );
};

for (const runtime of runtimes) {
  test(`${runtime.name}: native Boolean batches preserve exact geometry and ownership`, async () => {
    assert.ok(
      existsSync(runtime.wasmPath),
      `Missing ${runtime.wasmPath}; run pnpm build first`
    );
    const oc = await runtime.initialize(runtime.wasmPath);
    assert.equal(typeof oc.ReplicadBooleanBatch, "function");

    const first = translatedBox(oc, [10, 10, 10], [0, 0, 0]);
    const second = translatedBox(oc, [10, 10, 10], [5, 0, 0]);
    const fuseList = listOf(oc, [first.shape, second.shape]);
    const fuse = oc.ReplicadBooleanBatch.Fuse(
      fuseList,
      false,
      0,
      true,
      1e-3,
      0
    );

    const base = translatedBox(oc, [30, 30, 10], [0, 0, 0]);
    const holeA = translatedBox(oc, [4, 4, 20], [8, 8, -5]);
    const holeB = translatedBox(oc, [4, 4, 20], [18, 8, -5]);
    const argumentsList = listOf(oc, [base.shape]);
    const toolsList = listOf(oc, [holeA.shape, holeB.shape]);
    const cut = oc.ReplicadBooleanBatch.Cut(
      argumentsList,
      toolsList,
      false,
      0,
      true,
      1e-3,
      0
    );

    const commonA = translatedBox(oc, [20, 20, 20], [0, 0, 0]);
    const commonB = translatedBox(oc, [20, 20, 20], [10, 0, 0]);
    const commonC = translatedBox(oc, [20, 20, 20], [10, 10, 0]);
    const commonList = listOf(oc, [
      commonA.shape,
      commonB.shape,
      commonC.shape,
    ]);
    const common = oc.ReplicadBooleanBatch.Common(
      commonList,
      false,
      0,
      true,
      1e-3,
      0
    );

    let fusedShape;
    let cutShape;
    let commonShape;
    try {
      assertSuccess(fuse);
      assertSuccess(cut);
      assertSuccess(common);
      fusedShape = fuse.Shape();
      cutShape = cut.Shape();
      commonShape = common.Shape();
    } finally {
      common.delete();
      cut.delete();
      fuse.delete();
      commonList.delete();
      toolsList.delete();
      argumentsList.delete();
      fuseList.delete();
      commonC.delete();
      commonB.delete();
      commonA.delete();
      holeB.delete();
      holeA.delete();
      base.delete();
      second.delete();
      first.delete();
    }

    try {
      assertVolume(volume(oc, fusedShape), 1500);
      assertVolume(volume(oc, cutShape), 8680);
      assertVolume(volume(oc, commonShape), 2000);
    } finally {
      commonShape.delete();
      cutShape.delete();
      fusedShape.delete();
    }
  });

  test(`${runtime.name}: Boolean batch validation and options are functional`, async () => {
    const oc = await runtime.initialize(runtime.wasmPath);
    const empty = listOf(oc, []);
    const box = translatedBox(oc, [10, 10, 10], [0, 0, 0]);
    const boxList = listOf(oc, [box.shape]);
    const invalidFuse = oc.ReplicadBooleanBatch.Fuse(
      empty,
      false,
      0,
      true,
      1e-3,
      0
    );
    const invalidCut = oc.ReplicadBooleanBatch.Cut(
      boxList,
      empty,
      false,
      0,
      true,
      1e-3,
      0
    );
    const invalidCommon = oc.ReplicadBooleanBatch.Common(
      boxList,
      false,
      0,
      true,
      1e-3,
      0
    );

    try {
      assert.equal(invalidFuse.IsDone(), false);
      assert.equal(invalidFuse.HasErrors(), true);
      assert.equal(invalidFuse.Errors(), "Fuse requires at least two shapes");
      assert.equal(invalidCut.IsDone(), false);
      assert.equal(invalidCut.HasErrors(), true);
      assert.equal(
        invalidCut.Errors(),
        "Cut requires at least one argument and one tool"
      );
      assert.equal(invalidCommon.IsDone(), false);
      assert.equal(invalidCommon.HasErrors(), true);
      assert.equal(
        invalidCommon.Errors(),
        "Common requires at least two shapes"
      );
    } finally {
      invalidCommon.delete();
      invalidCut.delete();
      invalidFuse.delete();
      boxList.delete();
      box.delete();
      empty.delete();
    }

    for (const glue of [1, 2]) {
      const left = translatedBox(oc, [10, 10, 10], [0, 0, 0]);
      const right = translatedBox(oc, [10, 10, 10], [10, 0, 0]);
      const list = listOf(oc, [left.shape, right.shape]);
      const result = oc.ReplicadBooleanBatch.Fuse(
        list,
        false,
        glue,
        false,
        1e-3,
        0.01
      );
      const shape = result.Shape();
      try {
        assertSuccess(result);
        assertVolume(volume(oc, shape), 2000);
      } finally {
        shape.delete();
        result.delete();
        list.delete();
        right.delete();
        left.delete();
      }
    }
  });
}

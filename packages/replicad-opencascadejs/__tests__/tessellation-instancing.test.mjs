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

const readArray = (oc, ArrayType, pointer, size) => {
  const heap = new ArrayType(oc.wasmMemory.buffer);
  const width = ArrayType.BYTES_PER_ELEMENT;
  return Array.from(heap.subarray(pointer / width, pointer / width + size));
};

const readFaceMesh = (oc, result, ArrayType) => ({
  vertices: readArray(
    oc,
    ArrayType,
    result.getVerticesPtr(),
    result.getVerticesSize()
  ),
  normals: readArray(
    oc,
    ArrayType,
    result.getNormalsPtr(),
    result.getNormalsSize()
  ),
  triangles: readArray(
    oc,
    Uint32Array,
    result.getTrianglesPtr(),
    result.getTrianglesSize()
  ),
  groups: readArray(
    oc,
    Int32Array,
    result.getFaceGroupsPtr(),
    result.getFaceGroupsSize()
  ),
});

const readEdgeMesh = (oc, result, ArrayType) => ({
  lines: readArray(oc, ArrayType, result.getLinesPtr(), result.getLinesSize()),
  groups: readArray(
    oc,
    Int32Array,
    result.getEdgeGroupsPtr(),
    result.getEdgeGroupsSize()
  ),
});

const transformPoints = (values, matrix) => {
  const transformed = [];
  for (let index = 0; index < values.length; index += 3) {
    const x = values[index];
    const y = values[index + 1];
    const z = values[index + 2];
    transformed.push(
      Math.fround(matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]),
      Math.fround(matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]),
      Math.fround(matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11])
    );
  }
  return transformed;
};

const assertFloatArraysClose = (actual, expected, tolerance = 1e-6) => {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `value ${index} differs: ${actual[index]} !== ${expected[index]}`
    );
  }
};

const assertGroupParity = (current, prototype, ids) => {
  assert.equal(current.length, prototype.length);
  assert.equal(ids.length, current.length / 3);
  for (let index = 0; index < current.length; index += 3) {
    assert.equal(prototype[index], current[index]);
    assert.equal(prototype[index + 1], current[index + 1]);
    assert.equal(ids[index / 3], current[index + 2]);
  }
};

for (const runtime of runtimes) {
  test(`${runtime.name}: identity and prototype meshes preserve occurrence geometry and groups`, async (t) => {
    if (
      runtime.name === "pthread" &&
      typeof SharedArrayBuffer === "undefined"
    ) {
      return t.skip("SharedArrayBuffer is required for the pthread OCJS build");
    }
    assert.ok(
      existsSync(runtime.wasmPath),
      `Missing ${runtime.wasmPath}; run pnpm build first`
    );
    const oc = await runtime.initialize(runtime.wasmPath);
    const owned = [];
    const track = (value) => {
      if (value && typeof value.delete === "function") owned.push(value);
      return value;
    };

    try {
      const box = track(new oc.BRepPrimAPI_MakeBox(10, 20, 30));
      const source = track(box.Shape());
      const translation = track(new oc.gp_Trsf());
      const vector = track(new oc.gp_Vec(40, 50, 60));
      translation.SetTranslation(vector);
      const moved = track(
        new oc.BRepBuilderAPI_Transform(source, translation, false, false)
      );
      const shape = track(moved.Shape());

      const sourceInfo = track(oc.ReplicadShapeIdentity.Inspect(source));
      const movedInfo = track(oc.ReplicadShapeIdentity.Inspect(shape));
      assert.equal(oc.ReplicadShapeIdentity.IsPartner(source, shape), true);
      assert.equal(sourceInfo.PartnerKey(), movedInfo.PartnerKey());
      assert.notEqual(sourceInfo.PartnerKey(), "");
      assert.equal(sourceInfo.PrototypeHash(), movedInfo.PrototypeHash());
      assert.equal(sourceInfo.PrototypeHash().length, 64);
      for (const character of sourceInfo.PrototypeHash()) {
        assert.ok("0123456789abcdef".includes(character));
      }
      assert.equal(
        movedInfo.PrototypeHash(),
        oc.ReplicadShapeIdentity.PrototypeHash(shape)
      );
      assert.equal(movedInfo.Orientation(), "forward");
      assert.equal(movedInfo.Determinant(), 1);
      assert.equal(movedInfo.CanPrototypeMesh(), true);
      assert.equal(movedInfo.MatrixSize(), 16);
      const matrix = Array.from({ length: 16 }, (_, index) =>
        movedInfo.MatrixValue(index)
      );
      assert.deepEqual(
        matrix,
        [1, 0, 0, 40, 0, 1, 0, 50, 0, 0, 1, 60, 0, 0, 0, 1]
      );

      const scale = track(new oc.gp_Trsf());
      const center = track(new oc.gp_Pnt(0, 0, 0));
      scale.SetScale(center, 2);
      const scaled = track(
        new oc.BRepBuilderAPI_Transform(source, scale, false, false)
      );
      const scaledShape = track(scaled.Shape());
      assert.equal(
        oc.ReplicadShapeIdentity.IsPartner(source, scaledShape),
        false
      );

      const currentFaces = track(
        oc.ReplicadMeshExtractor.extract(shape, 0.1, 0.5, false)
      );
      const prototypeFaces = track(
        oc.ReplicadPrototypeMeshExtractor.ExtractFaces(shape, 0.1, 0.5, false)
      );
      const faceIdsResult = track(
        oc.ReplicadPrototypeMeshExtractor.ExtractFaceIds(shape)
      );
      const currentFaceMesh = readFaceMesh(oc, currentFaces, Float32Array);
      const prototypeFaceMesh = readFaceMesh(oc, prototypeFaces, Float64Array);
      const faceIds = readArray(
        oc,
        Int32Array,
        faceIdsResult.getIdsPtr(),
        faceIdsResult.getIdsSize()
      );

      assert.deepEqual(
        transformPoints(prototypeFaceMesh.vertices, matrix),
        currentFaceMesh.vertices
      );
      assertFloatArraysClose(
        prototypeFaceMesh.normals.map(Math.fround),
        currentFaceMesh.normals
      );
      assert.deepEqual(prototypeFaceMesh.triangles, currentFaceMesh.triangles);
      assertGroupParity(
        currentFaceMesh.groups,
        prototypeFaceMesh.groups,
        faceIds
      );

      const currentEdges = track(
        oc.ReplicadEdgeMeshExtractor.extract(shape, 0.1, 0.5)
      );
      const prototypeEdges = track(
        oc.ReplicadPrototypeMeshExtractor.ExtractEdges(shape, 0.1, 0.5)
      );
      const edgeIdsResult = track(
        oc.ReplicadPrototypeMeshExtractor.ExtractEdgeIds(shape, 0.1, 0.5)
      );
      const currentEdgeMesh = readEdgeMesh(oc, currentEdges, Float32Array);
      const prototypeEdgeMesh = readEdgeMesh(oc, prototypeEdges, Float64Array);
      const edgeIds = readArray(
        oc,
        Int32Array,
        edgeIdsResult.getIdsPtr(),
        edgeIdsResult.getIdsSize()
      );

      assert.deepEqual(
        transformPoints(prototypeEdgeMesh.lines, matrix),
        currentEdgeMesh.lines
      );
      assertGroupParity(
        currentEdgeMesh.groups,
        prototypeEdgeMesh.groups,
        edgeIds
      );
    } finally {
      for (let index = owned.length - 1; index >= 0; index--) {
        owned[index].delete();
      }
    }
  });
}

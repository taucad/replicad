import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import initSingle from "../dist/replicad_single.js";
import initMulti from "../dist/replicad_multi.js";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const singleWasmPath = join(distDir, "replicad_single.wasm");
const multiWasmPath = join(distDir, "replicad_multi.wasm");
const multiGluePath = join(distDir, "replicad_multi.js");

const assertRuntimeInfoShape = (oc) => {
  assert.equal(typeof oc.ReplicadRuntimeInfo, "function");
  assert.equal(typeof oc.ReplicadRuntimeInfo.IsMultiThreaded, "function");
  assert.equal(typeof oc.ReplicadRuntimeInfo.ThreadCount, "function");
  assert.equal(typeof oc.ReplicadRuntimeInfo.ConfigureThreadPool, "function");
};

const assertExtractorCanMesh = (oc) => {
  const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
  const shape = box.Shape();
  oc.ReplicadMeshExtractor.mesh(shape, 0.1, 0.5);
  const mesh = oc.ReplicadMeshExtractor.extract(shape, 0.1, 0.5, true);
  const edgeMesh = oc.ReplicadEdgeMeshExtractor.extract(shape, 0.1, 0.5);

  try {
    assert.ok(mesh.getVerticesSize() > 0);
    assert.ok(mesh.getTrianglesSize() > 0);
    assert.ok(edgeMesh.getLinesSize() > 0);
  } finally {
    edgeMesh.delete();
    mesh.delete();
    shape.delete();
    box.delete();
  }
};

test("single-threaded build exposes runtime info and remains serial", async () => {
  assert.ok(
    existsSync(singleWasmPath),
    `Missing ${singleWasmPath}; run pnpm build first`
  );

  const oc = await initSingle({
    locateFile: () => singleWasmPath,
  });

  assertRuntimeInfoShape(oc);
  assert.equal(oc.ReplicadRuntimeInfo.IsMultiThreaded(), false);
  assert.equal(oc.ReplicadRuntimeInfo.ThreadCount(), 1);
  assert.equal(oc.ReplicadRuntimeInfo.ConfigureThreadPool(), 1);
  assertExtractorCanMesh(oc);
});

test("pthread build exposes runtime info, configures the thread pool, and meshes", async (t) => {
  if (typeof SharedArrayBuffer === "undefined") {
    return t.skip("SharedArrayBuffer is required for the pthread OCJS build");
  }

  assert.ok(
    existsSync(multiWasmPath),
    `Missing ${multiWasmPath}; run pnpm build first`
  );
  assert.ok(
    existsSync(multiGluePath),
    `Missing ${multiGluePath}; run pnpm build first`
  );

  const oc = await initMulti({
    locateFile: () => multiWasmPath,
    mainScriptUrlOrBlob: multiGluePath,
  });

  assertRuntimeInfoShape(oc);
  assert.equal(oc.ReplicadRuntimeInfo.IsMultiThreaded(), true);
  const threadCount = oc.ReplicadRuntimeInfo.ThreadCount();
  assert.ok(threadCount > 1);
  assert.equal(oc.ReplicadRuntimeInfo.ConfigureThreadPool(), threadCount);
  assertExtractorCanMesh(oc);
});

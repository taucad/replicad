import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import initMulti from "../dist/replicad_multi.js";
import initSingle from "../dist/replicad_single.js";
import { createInstance as createMulti } from "../dist/init.multi.js";

// Covers the additive entry points: binary BRep without triangulation and its
// identity hash, the mesh extractor's explicit clean, the Boolean batch's OBB
// flag, and the user break for batch Booleans and both mesh extractors. Each default path
// must stay byte-identical to the entry point it extends.

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const runtimes = [
  {
    name: "single",
    initialize: () =>
      initSingle({ locateFile: () => join(distDir, "replicad_single.wasm") }),
  },
  {
    name: "pthread",
    initialize: () =>
      initMulti({
        locateFile: () => join(distDir, "replicad_multi.wasm"),
        mainScriptUrlOrBlob: join(distDir, "replicad_multi.js"),
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

const moved = (oc, source, offset) => {
  const transform = new oc.gp_Trsf();
  const vector = new oc.gp_Vec(...offset);
  transform.SetTranslation(vector);
  const operation = new oc.BRepBuilderAPI_Transform(source, transform, false, false);
  const shape = operation.Shape();
  operation.delete();
  vector.delete();
  transform.delete();
  return shape;
};

const box = (oc, size, offset) => {
  const maker = new oc.BRepPrimAPI_MakeBox(...size);
  const source = maker.Shape();
  const shape = moved(oc, source, offset);
  source.delete();
  maker.delete();
  return shape;
};

const sphere = (oc, radius) => {
  const maker = new oc.BRepPrimAPI_MakeSphere(radius);
  const shape = maker.Shape();
  maker.delete();
  return shape;
};

// A plate with a grid of cylindrical holes: enough Boolean work for OCCT to
// poll the progress indicator many times.
const holeyPlate = (oc, count) => {
  const plate = box(oc, [count * 4 + 4, count * 4 + 4, 4], [0, 0, 0]);
  const tools = [];
  for (let x = 0; x < count; x++) {
    for (let y = 0; y < count; y++) {
      const maker = new oc.BRepPrimAPI_MakeCylinder(1.2, 6);
      const source = maker.Shape();
      tools.push(moved(oc, source, [4 + x * 4, 4 + y * 4, -1]));
      source.delete();
      maker.delete();
    }
  }
  return { plate, tools };
};

const bytesOf = (oc, data) => {
  const copy = new Uint8Array(oc.wasmMemory.buffer, data.getPtr(), data.getSize()).slice();
  data.delete();
  return copy;
};

const readBrep = (oc, bytes) => {
  const data = oc.ReplicadBinaryBrep.Allocate(bytes.length);
  new Uint8Array(oc.wasmMemory.buffer, data.getPtr(), bytes.length).set(bytes);
  try {
    return oc.ReplicadBinaryBrep.Read(data);
  } finally {
    data.delete();
  }
};

const meshBytes = (oc, raw) => {
  const buffer = oc.wasmMemory.buffer;
  const part = (ptr, size) => new Uint8Array(buffer, ptr, size * 4).slice();
  const out = [
    part(raw.getVerticesPtr(), raw.getVerticesSize()),
    part(raw.getNormalsPtr(), raw.getNormalsSize()),
    part(raw.getTrianglesPtr(), raw.getTrianglesSize()),
    part(raw.getFaceGroupsPtr(), raw.getFaceGroupsSize()),
  ];
  raw.delete();
  return out;
};

// The prototype extractor returns doubles for vertices and normals.
const prototypeMeshBytes = (oc, raw) => {
  const buffer = oc.wasmMemory.buffer;
  const part = (ptr, size, width) => new Uint8Array(buffer, ptr, size * width).slice();
  const out = [
    part(raw.getVerticesPtr(), raw.getVerticesSize(), 8),
    part(raw.getNormalsPtr(), raw.getNormalsSize(), 8),
    part(raw.getTrianglesPtr(), raw.getTrianglesSize(), 4),
    part(raw.getFaceGroupsPtr(), raw.getFaceGroupsSize(), 4),
  ];
  raw.delete();
  return out;
};

const triangulatedFaces = (oc, shape) => {
  let count = 0;
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) {
    const location = new oc.TopLoc_Location();
    const triangulation = oc.BRep_Tool.Triangulation(oc.TopoDS.Face(explorer.Current()), location, 0);
    if (triangulation && !triangulation.isNull()) count++;
    triangulation?.delete();
    location.delete();
  }
  explorer.delete();
  return count;
};

const writeFileBrep = (oc, shape) => {
  const path = "/tmp/native-options.bin";
  const progress = new oc.Message_ProgressRange();
  assert.equal(oc.BinTools.Write(shape, path, progress), true);
  progress.delete();
  const bytes = oc.FS.readFile(path);
  oc.FS.unlink(path);
  return bytes;
};

const disabledBreak = (oc) => new oc.ReplicadUserBreak(0, 0, false);

// Shared by both variants and by the pthread variant with a one-thread pool.
const breakBeforeSimplifyResult = (oc) => {
  const { plate, tools } = holeyPlate(oc, 4);
  const argumentsList = listOf(oc, [plate]);
  const toolsList = listOf(oc, tools);
  const writeBare = (shape) => bytesOf(oc, oc.ReplicadBinaryBrep.Write(shape, false, false));
  const cut = (simplify, userBreak) =>
    oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, simplify, 1e-3, 0, false, userBreak);

  // A disabled break is the plain entry point, bytes included.
  const disabled = disabledBreak(oc);
  const plain = oc.ReplicadBooleanBatch.Cut(argumentsList, toolsList, false, 0, true, 1e-3, 0);
  const unbroken = cut(true, disabled);
  assert.equal(unbroken.IsDone(), true, unbroken.Errors());
  assert.equal(unbroken.IsUserBreak(), false);
  assert.deepEqual(writeBare(unbroken.Shape()), writeBare(plain.Shape()));

  // A hook that never breaks changes nothing either.
  let polls = 0;
  oc.replicadUserBreak = () => {
    polls++;
    return false;
  };
  const byHook = new oc.ReplicadUserBreak(0, 0, true);
  const asked = cut(true, byHook);
  assert.equal(asked.IsDone(), true, asked.Errors());
  assert.deepEqual(writeBare(asked.Shape()), writeBare(plain.Shape()));
  const withSimplify = polls;
  polls = 0;
  const raw = cut(false, byHook);
  assert.equal(raw.IsDone(), true, raw.Errors());
  const withoutSimplify = polls;

  if (oc.ReplicadRuntimeInfo.ConfigureThreadPool() === 1) {
    // The Boolean runs on one thread (the single variant, or the pthread variant with a one-thread
    // pool), so the polls come in a fixed order: the Boolean's, then one more before
    // SimplifyResult, and none for a call that does not simplify.
    assert.equal(withSimplify, withoutSimplify + 1);
    // Break at that last poll only: the Boolean has finished, SimplifyResult must not run, and the
    // result has the shape of a break inside the Boolean.
    polls = 0;
    oc.replicadUserBreak = () => ++polls >= withSimplify;
    const stopped = cut(true, byHook);
    assert.equal(polls, withSimplify);
    assert.equal(stopped.IsUserBreak(), true);
    assert.equal(stopped.IsDone(), false);
    assert.equal(stopped.HasErrors(), true);
    assert.equal(stopped.Errors(), "ReplicadUserBreak");
    assert.equal(stopped.Shape().IsNull(), true);
    stopped.delete();
  } else {
    // A parallel Boolean: the hook runs on the main thread only, and how many polls the main thread
    // makes depends on how the pool shares the work, so no poll can be named as the last one. This
    // branch asserts only that the hook was polled with and without simplify and (above) that a
    // hook that never breaks leaves the bytes unchanged; it does not show the check before
    // SimplifyResult. The one-thread-pool pthread test below covers that check in this variant.
    assert.ok(withSimplify > 0 && withoutSimplify > 0);
  }

  delete oc.replicadUserBreak;
  for (const item of [raw, asked, byHook, unbroken, plain, disabled, toolsList, argumentsList, plate, ...tools]) {
    item.delete();
  }
};

for (const runtime of runtimes) {
  test(`${runtime.name}: binary BRep writes and reads with and without triangulation`, async () => {
    const oc = await runtime.initialize();
    const shape = sphere(oc, 10);
    oc.ReplicadMeshExtractor.mesh(shape, 0.05, 0.2);
    assert.equal(triangulatedFaces(oc, shape), 1);

    const withTriangles = bytesOf(oc, oc.ReplicadBinaryBrep.Write(shape, true, false));
    assert.deepEqual(withTriangles, writeFileBrep(oc, shape), "matches BinTools.Write(path)");

    const hashMeshed = oc.ReplicadBinaryBrep.IdentityHash(shape);
    const bare = bytesOf(oc, oc.ReplicadBinaryBrep.Write(shape, false, false));
    assert.ok(bare.length < withTriangles.length);
    assert.equal(triangulatedFaces(oc, shape), 1, "writing never cleans the shape");

    const restored = readBrep(oc, bare);
    assert.equal(restored.IsNull(), false);
    assert.equal(triangulatedFaces(oc, restored), 0);
    assert.ok(Math.abs(volume(oc, restored) - volume(oc, shape)) < 1e-9);
    // Reading can turn a +0.0 direction component into -0.0, so a restored
    // shape is compared with its own round trip, not with its source.
    const restoredHash = oc.ReplicadBinaryBrep.IdentityHash(restored);
    const again = readBrep(oc, bytesOf(oc, oc.ReplicadBinaryBrep.Write(restored, false, false)));
    assert.equal(oc.ReplicadBinaryBrep.IdentityHash(again), restoredHash);
    oc.ReplicadMeshExtractor.mesh(restored, 0.05, 0.2);
    assert.equal(oc.ReplicadBinaryBrep.IdentityHash(restored), restoredHash);
    again.delete();

    const restoredMeshed = readBrep(oc, withTriangles);
    assert.equal(triangulatedFaces(oc, restoredMeshed), 1);
    assert.equal(oc.ReplicadBinaryBrep.IdentityHash(restoredMeshed), restoredHash);

    oc.BRepTools.Clean(shape, false);
    assert.equal(oc.ReplicadBinaryBrep.IdentityHash(shape), hashMeshed, "mesh state does not move the hash");
    assert.match(hashMeshed, /^[0-9a-f]{16}$/);
    const other = sphere(oc, 11);
    assert.notEqual(oc.ReplicadBinaryBrep.IdentityHash(other), hashMeshed);

    other.delete();
    restoredMeshed.delete();
    restored.delete();
    shape.delete();
  });

  test(`${runtime.name}: extractWithOptions defaults match extract and keep is honoured`, async () => {
    const oc = await runtime.initialize();
    const shape = sphere(oc, 10);
    const reference = meshBytes(oc, oc.ReplicadMeshExtractor.extract(shape, 0.1, 0.5, false));
    const userBreak = disabledBreak(oc);
    const cleaned = meshBytes(oc, oc.ReplicadMeshExtractor.extractWithOptions(shape, 0.1, 0.5, false, true, userBreak));
    assert.deepEqual(cleaned, reference);

    // An enabled break that never fires leaves the bytes unchanged too.
    const word = new oc.ReplicadAbortWord();
    const armed = new oc.ReplicadUserBreak(word.Address(), 0, false);
    const armedMesh = meshBytes(oc, oc.ReplicadMeshExtractor.extractWithOptions(shape, 0.1, 0.5, false, true, armed));
    assert.deepEqual(armedMesh, reference);

    // Keep: a finer cached mesh serves a coarser request; clean re-meshes.
    const fine = meshBytes(oc, oc.ReplicadMeshExtractor.extract(shape, 0.01, 0.1, false));
    const kept = meshBytes(oc, oc.ReplicadMeshExtractor.extractWithOptions(shape, 0.1, 0.5, false, false, userBreak));
    assert.deepEqual(kept, fine);
    const recleaned = meshBytes(oc, oc.ReplicadMeshExtractor.extractWithOptions(shape, 0.1, 0.5, false, true, userBreak));
    assert.deepEqual(recleaned, reference);

    armed.delete();
    word.delete();
    userBreak.delete();
    shape.delete();
  });

  test(`${runtime.name}: Boolean WithOptions matches the plain batch and OBB is a flag`, async () => {
    const oc = await runtime.initialize();
    const { plate, tools } = holeyPlate(oc, 4);
    const argumentsList = listOf(oc, [plate]);
    const toolsList = listOf(oc, tools);
    const userBreak = disabledBreak(oc);

    const plain = oc.ReplicadBooleanBatch.Cut(argumentsList, toolsList, false, 0, true, 1e-3, 0);
    const same = oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, true, 1e-3, 0, false, userBreak);
    const obb = oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, true, 1e-3, 0, true, userBreak);
    for (const result of [plain, same, obb]) {
      assert.equal(result.IsDone(), true, result.Errors());
      assert.equal(result.IsUserBreak(), false);
    }
    const shapes = [plain.Shape(), same.Shape(), obb.Shape()];
    const writeBare = (shape) => bytesOf(oc, oc.ReplicadBinaryBrep.Write(shape, false, false));
    assert.deepEqual(writeBare(shapes[1]), writeBare(shapes[0]));
    assert.ok(Math.abs(volume(oc, shapes[2]) - volume(oc, shapes[0])) < 1e-6);

    const fuseList = listOf(oc, [box(oc, [10, 10, 10], [0, 0, 0]), box(oc, [10, 10, 10], [5, 0, 0])]);
    const fuse = oc.ReplicadBooleanBatch.FuseWithOptions(fuseList, false, 0, true, 1e-3, 0, false, userBreak);
    assert.ok(Math.abs(volume(oc, fuse.Shape()) - 1500) < 1e-9);
    const common = oc.ReplicadBooleanBatch.CommonWithOptions(fuseList, false, 0, true, 1e-3, 0, true, userBreak);
    assert.ok(Math.abs(volume(oc, common.Shape()) - 500) < 1e-9);

    for (const item of [common, fuse, fuseList, ...shapes, obb, same, plain, userBreak, toolsList, argumentsList, plate, ...tools]) {
      item.delete();
    }
  });

  test(`${runtime.name}: an abort word or hook breaks Booleans and meshing distinguishably`, async () => {
    const oc = await runtime.initialize();
    const { plate, tools } = holeyPlate(oc, 4);
    const argumentsList = listOf(oc, [plate]);
    const toolsList = listOf(oc, tools);

    const word = new oc.ReplicadAbortWord();
    assert.notEqual(word.Address(), 0);
    word.Store(7);
    assert.equal(new Int32Array(oc.wasmMemory.buffer)[word.Address() / 4], 7);
    assert.equal(word.Load(), 7);

    // The word already differs from the expected value: break at the first poll.
    const byWord = new oc.ReplicadUserBreak(word.Address(), 0, false);
    const broken = oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, true, 1e-3, 0, false, byWord);
    assert.equal(broken.IsUserBreak(), true);
    assert.equal(broken.IsDone(), false);
    assert.equal(broken.HasErrors(), true);
    assert.equal(broken.Shape().IsNull(), true);

    // A matching word does not break.
    const matching = new oc.ReplicadUserBreak(word.Address(), 7, false);
    const intact = oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, true, 1e-3, 0, false, matching);
    assert.equal(intact.IsUserBreak(), false);
    assert.equal(intact.IsDone(), true, intact.Errors());

    // The hook: count polls, then break.
    let polls = 0;
    oc.replicadUserBreak = () => ++polls > 3;
    const byHook = new oc.ReplicadUserBreak(0, 0, true);
    const hooked = oc.ReplicadBooleanBatch.CutWithOptions(argumentsList, toolsList, false, 0, true, 1e-3, 0, false, byHook);
    assert.equal(hooked.IsUserBreak(), true);
    assert.ok(polls >= 4);

    // Meshing throws a ReplicadUserBreakError.
    const shape = sphere(oc, 10);
    let caught;
    try {
      oc.ReplicadMeshExtractor.extractWithOptions(shape, 0.01, 0.1, false, true, byWord);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "meshing must throw on a break");
    const [type, message] = oc.getExceptionMessage(caught);
    assert.match(type, /ReplicadUserBreakError/);
    assert.equal(message, "ReplicadUserBreak");

    delete oc.replicadUserBreak;
    for (const item of [shape, hooked, byHook, intact, matching, broken, byWord, word, toolsList, argumentsList, plate, ...tools]) {
      item.delete();
    }
  });

  test(`${runtime.name}: a break asked after the Boolean's last poll stops before SimplifyResult`, async () => {
    breakBeforeSimplifyResult(await runtime.initialize());
  });

  test(`${runtime.name}: the prototype extractor's ExtractFacesWithOptions matches ExtractFaces and a break stops it`, async () => {
    const oc = await runtime.initialize();
    // A located shape, so the prototype path strips a real location.
    const source = sphere(oc, 10);
    const shape = moved(oc, source, [5, -3, 2]);
    const extractor = oc.ReplicadPrototypeMeshExtractor;

    const reference = prototypeMeshBytes(oc, extractor.ExtractFaces(shape, 0.1, 0.5, false));
    const userBreak = disabledBreak(oc);
    const disabled = prototypeMeshBytes(oc, extractor.ExtractFacesWithOptions(shape, 0.1, 0.5, false, true, userBreak));
    assert.deepEqual(disabled, reference, "a disabled break gives the bytes of ExtractFaces");

    // An armed break whose word never moves attaches an indicator but must not change the mesh.
    const word = new oc.ReplicadAbortWord();
    const armed = new oc.ReplicadUserBreak(word.Address(), 0, false);
    const armedMesh = prototypeMeshBytes(oc, extractor.ExtractFacesWithOptions(shape, 0.1, 0.5, false, true, armed));
    assert.deepEqual(armedMesh, reference, "an armed break that never fires gives the same bytes");

    const skipped = prototypeMeshBytes(oc, extractor.ExtractFaces(shape, 0.1, 0.5, true));
    const skippedWithOptions = prototypeMeshBytes(oc, extractor.ExtractFacesWithOptions(shape, 0.1, 0.5, true, true, userBreak));
    assert.deepEqual(skippedWithOptions, skipped, "skipNormals passes through");

    // A set word stops the prototype mesh with the same error the regular extractor throws.
    word.Store(7);
    const stop = (userBreakSource) => {
      try {
        extractor.ExtractFacesWithOptions(shape, 0.01, 0.1, false, true, userBreakSource);
      } catch (error) {
        return oc.getExceptionMessage(error);
      }
      return undefined;
    };
    const byWord = stop(armed);
    assert.ok(byWord, "a set word must stop the prototype mesh");
    assert.match(byWord[0], /ReplicadUserBreakError/);
    assert.equal(byWord[1], "ReplicadUserBreak");

    // The hook source stops it too, after a few polls.
    let polls = 0;
    oc.replicadUserBreak = () => ++polls > 3;
    const byHook = new oc.ReplicadUserBreak(0, 0, true);
    const hooked = stop(byHook);
    assert.ok(hooked, "the hook must stop the prototype mesh");
    assert.match(hooked[0], /ReplicadUserBreakError/);
    assert.ok(polls >= 4);
    delete oc.replicadUserBreak;

    // After a break the shape still meshes normally, to the reference bytes.
    const after = prototypeMeshBytes(oc, extractor.ExtractFacesWithOptions(shape, 0.1, 0.5, false, true, userBreak));
    assert.deepEqual(after, reference, "a stopped mesh leaves nothing that changes the next clean mesh");

    for (const item of [byHook, armed, word, userBreak, shape, source]) {
      item.delete();
    }
  });
}

// The pthread variant's check before SimplifyResult, made deterministic: with a one-thread pool
// (`threadCount: 1`, a supported configuration of the multi init entry) the Boolean does not run in
// parallel, so every poll is on the main thread and the last one can be named. The code under test
// is the pthread build's; what this does not cover is pool threads polling during the Boolean.
test("pthread with a one-thread pool: a break asked after the Boolean's last poll stops before SimplifyResult", async () => {
  const oc = await createMulti({
    locateFile: () => join(distDir, "replicad_multi.wasm"),
    threadCount: 1,
  });
  assert.equal(oc.ReplicadRuntimeInfo.IsMultiThreaded(), true);
  assert.equal(oc.ReplicadRuntimeInfo.ConfigureThreadPool(), 1);
  breakBeforeSimplifyResult(oc);
});

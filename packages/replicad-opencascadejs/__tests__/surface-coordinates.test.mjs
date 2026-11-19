import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import initMulti from "../dist/replicad_multi.js";
import initSingle from "../dist/replicad_single.js";

// ReplicadSurfaceCoordinates.Extract must return, element for element
// (Object.is), the doubles of Tau's JavaScript loop over the generated
// bindings (packages/plugins/replicad/src/utils/surface-coordinates.ts), which
// is mirrored below. Normals come from the face extractor as float32 and are
// passed as doubles, as Tau passes them.

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

const shapeOf = (maker) => {
  const shape = maker.Shape();
  maker.delete();
  return shape;
};

const located = (oc, shape) => {
  const transform = new oc.gp_Trsf();
  const axis = new oc.gp_Ax1(new oc.gp_Pnt(1, 2, 3), new oc.gp_Dir(1, 1, 1));
  transform.SetRotation(axis, 0.6);
  transform.SetTranslationPart(new oc.gp_Vec(30, -5, 7));
  const location = new oc.TopLoc_Location(transform);
  const moved = shape.Moved(location, false);
  location.delete();
  axis.delete();
  transform.delete();
  return moved;
};

// Blend surfaces: a box with every edge filleted.
const filleted = (oc) => {
  const box = shapeOf(new oc.BRepPrimAPI_MakeBox(10, 6, 4));
  const fillet = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const explorer = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) fillet.Add(1.5, oc.TopoDS.Edge(explorer.Current()));
  explorer.delete();
  const shape = fillet.Shape();
  fillet.delete();
  box.delete();
  return shape;
};

const fixtures = (oc) => [
  ["box", shapeOf(new oc.BRepPrimAPI_MakeBox(10, 6, 4))],
  ["cylinder", shapeOf(new oc.BRepPrimAPI_MakeCylinder(3, 8))],
  ["sphere", shapeOf(new oc.BRepPrimAPI_MakeSphere(4))],
  ["torus", shapeOf(new oc.BRepPrimAPI_MakeTorus(6, 1.5))],
  ["filleted box", filleted(oc)],
];

const meshNormals = (oc, shape) => {
  const result = oc.ReplicadMeshExtractor.extract(shape, 0.05, 0.2, false);
  try {
    return Float64Array.from(
      new Float32Array(
        oc.wasmMemory.buffer,
        result.getNormalsPtr(),
        result.getNormalsSize()
      )
    );
  } finally {
    result.delete();
  }
};

// Tau's loop, statement for statement.
const javascriptCoordinates = (oc, shape, normals, prototype) => {
  const coordinates = [];
  const tangents = [];
  const rootLocation = shape.Location();
  const inverseLocation = rootLocation.Transformation();
  inverseLocation.Invert();
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
  for (; explorer.More(); ) {
    const current = explorer.Current();
    explorer.Next();
    const face = oc.TopoDS.Face(current);
    const location = new oc.TopLoc_Location();
    const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);
    const surface = new oc.BRepAdaptor_Surface(face, false);
    try {
      if (triangulation.isNull()) continue;
      if (!triangulation.HasUVNodes()) throw new Error("no UV nodes");
      const bounds = oc.BRepTools.UVBounds(face);
      const nodeCount = triangulation.NbNodes();
      const width = bounds.UMax - bounds.UMin;
      const height = bounds.VMax - bounds.VMin;
      for (let index = 1; index <= nodeCount; index++) {
        const point = triangulation.UVNode(index);
        const vertex = coordinates.length / 2;
        coordinates.push(width > 0 ? (point.X() - bounds.UMin) / width : 0);
        coordinates.push(height > 0 ? (point.Y() - bounds.VMin) / height : 0);
        const derivatives = surface.EvalD1(point.X(), point.Y());
        if (prototype) {
          derivatives.D1U.Transform(inverseLocation);
          derivatives.D1V.Transform(inverseLocation);
        }
        const nx = normals[vertex * 3];
        const ny = normals[vertex * 3 + 1];
        const nz = normals[vertex * 3 + 2];
        let tx = derivatives.D1U.X();
        let ty = derivatives.D1U.Y();
        let tz = derivatives.D1U.Z();
        const projection = tx * nx + ty * ny + tz * nz;
        tx -= projection * nx;
        ty -= projection * ny;
        tz -= projection * nz;
        let length = Math.hypot(tx, ty, tz);
        if (length === 0) {
          [tx, ty, tz] = Math.abs(nx) < 0.9 ? [0, nz, -ny] : [-nz, 0, nx];
          length = Math.hypot(tx, ty, tz);
        }
        tx /= length;
        ty /= length;
        tz /= length;
        const handedness =
          (ny * tz - nz * ty) * derivatives.D1V.X() +
          (nz * tx - nx * tz) * derivatives.D1V.Y() +
          (nx * ty - ny * tx) * derivatives.D1V.Z();
        tangents.push(tx, ty, tz, handedness < 0 ? -1 : 1);
        derivatives.Point.delete();
        derivatives.D1U.delete();
        derivatives.D1V.delete();
        point.delete();
      }
    } finally {
      surface.delete();
      triangulation.delete();
      location.delete();
      face.delete();
      current.delete();
    }
  }
  explorer.delete();
  inverseLocation.delete();
  rootLocation.delete();
  return { texCoords: coordinates, tangents };
};

const nativeCoordinates = (oc, shape, normals, prototype) => {
  const extractor = oc.ReplicadSurfaceCoordinates;
  const buffer = extractor.AllocateNormals(normals.length);
  try {
    new Float64Array(oc.wasmMemory.buffer, buffer.getPtr(), normals.length).set(normals);
    const data = extractor.Extract(shape, buffer.getPtr(), buffer.getSize(), prototype);
    try {
      const memory = oc.wasmMemory.buffer;
      return {
        status: data.getStatus(),
        texCoords: Array.from(
          new Float64Array(memory, data.getTexCoordsPtr(), data.getTexCoordsSize())
        ),
        tangents: Array.from(
          new Float64Array(memory, data.getTangentsPtr(), data.getTangentsSize())
        ),
      };
    } finally {
      data.delete();
    }
  } finally {
    buffer.delete();
  }
};

const assertSame = (label, native, javascript) => {
  for (const key of ["texCoords", "tangents"]) {
    assert.equal(native[key].length, javascript[key].length, `${label} ${key} length`);
    for (let index = 0; index < native[key].length; index++) {
      assert.ok(
        Object.is(native[key][index], javascript[key][index]),
        `${label} ${key}[${index}]: native ${native[key][index]}, JavaScript ${javascript[key][index]}`
      );
    }
  }
};

for (const runtime of runtimes) {
  test(
    `${runtime.name}: Extract returns the JavaScript loop's doubles`,
    async () => {
      const oc = await runtime.initialize();
      for (const [name, base] of fixtures(oc)) {
        for (const [placement, shape] of [
          ["unplaced", base],
          ["placed", located(oc, base)],
        ]) {
          const normals = meshNormals(oc, shape);
          for (const prototype of [false, true]) {
            const native = nativeCoordinates(oc, shape, normals, prototype);
            assert.equal(native.status, 0);
            assert.ok(native.texCoords.length > 0, `${name} has UVs`);
            assert.equal(native.texCoords.length, (normals.length / 3) * 2);
            assertSame(
              `${name} ${placement} prototype=${prototype}`,
              native,
              javascriptCoordinates(oc, shape, normals, prototype)
            );
          }
          // Past the end of the normals both read NaN.
          const short = normals.slice(0, normals.length - 7);
          assertSame(
            `${name} ${placement} short normals`,
            nativeCoordinates(oc, shape, short, false),
            javascriptCoordinates(oc, shape, short, false)
          );
          shape.delete();
        }
      }
    },
    120_000
  );

  test(`${runtime.name}: Extract on an unmeshed shape returns nothing`, async () => {
    const oc = await runtime.initialize();
    const shape = shapeOf(new oc.BRepPrimAPI_MakeBox(1, 2, 3));
    const native = nativeCoordinates(oc, shape, new Float64Array(0), false);
    assert.deepEqual(native, { status: 0, texCoords: [], tangents: [] });
    shape.delete();
  });
}

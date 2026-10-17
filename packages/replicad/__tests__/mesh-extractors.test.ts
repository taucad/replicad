import { expect, test } from "vitest";
import { makeBaseBox } from "../src/index";
import { mesh, meshEdges, triangulateFace } from "../src/shapeFunctions/index";

test("native mesh groups preserve public shape hashes", () => {
  const shape = makeBaseBox(10, 20, 30);
  const shapeMesh = shape.mesh();
  const edgeMesh = shape.meshEdges();

  expect(shapeMesh.faceGroups.map(({ faceId }) => faceId)).toEqual(
    shape.faces.map(({ hashCode }) => hashCode)
  );
  expect(edgeMesh.edgeGroups.map(({ edgeId }) => edgeId)).toEqual(
    shape.edges.map(({ hashCode }) => hashCode)
  );
  expect(edgeMesh.edgeGroups).toHaveLength(12);
  expect(
    edgeMesh.edgeGroups.every(
      ({ start, count }) =>
        start >= 0 && count >= 2 && start + count <= edgeMesh.lines.length / 3
    )
  ).toBe(true);

  expect(mesh(shape)).toEqual(mesh(shape.wrapped));
  expect(meshEdges(shape)).toEqual(meshEdges(shape.wrapped));

  const face = shape.faces[0];
  expect(triangulateFace(face)).toEqual(face.triangulation());
  face.delete();
  shape.delete();
});

test("meshes come back as typed arrays copied out of the WASM heap", () => {
  const shape = makeBaseBox(10, 20, 30);
  const shapeMesh = shape.mesh();
  const edgeMesh = shape.meshEdges();

  expect(shapeMesh.vertices).toBeInstanceOf(Float32Array);
  expect(shapeMesh.normals).toBeInstanceOf(Float32Array);
  expect(shapeMesh.triangles).toBeInstanceOf(Uint32Array);
  expect(edgeMesh.lines).toBeInstanceOf(Float32Array);

  // Copies, not views: a later memory.grow() must not detach them.
  for (const array of [
    shapeMesh.vertices,
    shapeMesh.normals,
    shapeMesh.triangles,
    edgeMesh.lines,
  ]) {
    expect(array.byteOffset).toBe(0);
    expect(array.buffer.byteLength).toBe(array.byteLength);
  }

  expect(shapeMesh.vertices.length).toBe(shapeMesh.normals.length);
  expect(shapeMesh.triangles.length).toBe(
    shapeMesh.faceGroups.reduce((total, { count }) => total + count, 0)
  );
  shape.delete();
});

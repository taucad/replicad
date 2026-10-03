import { expect, test } from "vitest";
import { EdgeFinder, FaceFinder, makeBaseBox } from "../src/index";

const deleteAll = (shapes: { delete(): void }[]) =>
  shapes.forEach((shape) => shape.delete());

test("withinDistance keeps the exact result when the bounding box pre-check applies", () => {
  const shape = makeBaseBox(10, 10, 10);

  const far = new EdgeFinder().withinDistance(1, [100, 100, 100]).find(shape);
  expect(far).toHaveLength(0);

  // The four top edges are sqrt(50) away from a point 5 above the top face
  // centre; vertical edges are sqrt(75) away and the bottom ones farther.
  const top = new EdgeFinder().withinDistance(7.1, [0, 0, 15]).find(shape);
  expect(top).toHaveLength(4);

  deleteAll([...far, ...top]);
  shape.delete();
});

test("atDistance pre-check honours a tolerance larger than the target distance", () => {
  const shape = makeBaseBox(10, 10, 10);

  // The top face is 10 away from the point. With a distance of 5 the bounding
  // box separation alone (10) exceeds the distance, but the tolerance of 6
  // still accepts it, so the pre-check must not reject it.
  const faces = new FaceFinder().atDistance(5, [0, 0, 20], 6).find(shape);
  expect(faces).toHaveLength(1);

  const none = new FaceFinder().atDistance(5, [0, 0, 20]).find(shape);
  expect(none).toHaveLength(0);

  deleteAll([...faces, ...none]);
  shape.delete();
});

test("shape topology listing deduplicates shared sub shapes", () => {
  const shape = makeBaseBox(10, 10, 10);
  const edges = shape.edges;
  const faces = shape.faces;

  expect(edges).toHaveLength(12);
  expect(faces).toHaveLength(6);
  expect(new Set(edges.map(({ hashCode }) => hashCode)).size).toBe(12);

  deleteAll([...edges, ...faces]);
  shape.delete();
});

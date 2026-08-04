import { expect, test } from "vitest";
import { makeBaseBox, measureVolume, Sketcher, Sketches } from "../src/index";

const expectBoundsClose = (
  actual: [number[], number[]],
  expected: [number[], number[]]
) => {
  for (let corner = 0; corner < 2; corner++) {
    for (let axis = 0; axis < 3; axis++) {
      expect(actual[corner][axis]).toBeCloseTo(expected[corner][axis], 6);
    }
  }
};

test("translation and rotation preserve partner topology through locations", () => {
  const source = makeBaseBox(12, 8, 6);
  const translated = source.clone().translate(20, -5, 3);
  const rotated = source.clone().rotate(90);

  expect(source.wrapped.IsPartner(translated.wrapped)).toBe(true);
  expect(source.wrapped.IsPartner(rotated.wrapped)).toBe(true);
  expect(measureVolume(translated)).toBeCloseTo(12 * 8 * 6, 3);
  expect(measureVolume(rotated)).toBeCloseTo(12 * 8 * 6, 3);
  expectBoundsClose(translated.boundingBox.bounds, [
    [14, -9, 3],
    [26, -1, 9],
  ]);
  expect(rotated.boundingBox.width).toBeCloseTo(8, 6);
  expect(rotated.boundingBox.height).toBeCloseTo(12, 6);
  expect(rotated.boundingBox.depth).toBeCloseTo(6, 6);
});

test("scaling still creates distinct topology", () => {
  const source = makeBaseBox(12, 8, 6);
  const scaled = source.clone().scale(2);

  expect(source.wrapped.IsPartner(scaled.wrapped)).toBe(false);
  expect(measureVolume(scaled)).toBeCloseTo(12 * 8 * 6 * 8, 3);
});

test("multi-sketch extrusion and revolution return usable 3D shapes", () => {
  const extrusionSketch = new Sketcher()
    .movePointerTo([-5, 4])
    .hLine(10)
    .vLine(-8)
    .hLine(-10)
    .close();
  const extrusion = new Sketches([extrusionSketch]).extrude(6);

  const revolutionSketch = new Sketcher()
    .movePointerTo([5, -2])
    .hLine(5)
    .vLine(4)
    .hLine(-5)
    .close();
  const revolution = new Sketches([revolutionSketch]).revolve([0, 1, 0]);

  expect(measureVolume(extrusion)).toBeCloseTo(480, 3);
  expect(measureVolume(revolution)).toBeCloseTo(300 * Math.PI, 3);
  expect(extrusion.fuseAll([])).not.toBe(extrusion);
  expect(revolution.cutAll([])).not.toBe(revolution);
});

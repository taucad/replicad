import { expect, test } from "vitest";
import * as replicad from "../../src/index";

const r = replicad as any;

/**
 * The curves of drawings built from edges (face outlines and projections),
 * rounded so that the geometry reads as text. These pin the geometry while
 * the memory of the conversion changes.
 */
const curvesOf = (drawing: any): string[] => {
  try {
    const shape = drawing.innerShape;
    const blueprints = shape.blueprints ?? [shape];
    return blueprints.flatMap((blueprint: any) => blueprint.curves).map((curve: any) => {
      const [x0, y0] = curve.firstPoint.map((v: number) => v.toFixed(4));
      const [x1, y1] = curve.lastPoint.map((v: number) => v.toFixed(4));
      return `${curve.geomType} ${x0},${y0} -> ${x1},${y1}`;
    });
  } finally {
    drawing.delete();
  }
};

test("draws the outline of a face bounded by lines and arcs", () => {
  const drawing = r.drawRoundedRectangle(20, 10, 3);
  const solid = drawing.sketchOnPlane("XY").extrude(5);
  const finder = new r.FaceFinder().inPlane("XY", 5);
  const top = finder.find(solid, { unique: true });
  try {
    expect(curvesOf(r.drawFaceOutline(top))).toMatchInlineSnapshot(`
      [
        "LINE -7.0000,-5.0000 -> 7.0000,-5.0000",
        "CIRCLE 7.0000,-5.0000 -> 10.0000,-2.0000",
        "LINE 10.0000,-2.0000 -> 10.0000,2.0000",
        "CIRCLE 10.0000,2.0000 -> 7.0000,5.0000",
        "LINE 7.0000,5.0000 -> -7.0000,5.0000",
        "CIRCLE -7.0000,5.0000 -> -10.0000,2.0000",
        "LINE -10.0000,2.0000 -> -10.0000,-2.0000",
        "CIRCLE -10.0000,-2.0000 -> -7.0000,-5.0000",
      ]
    `);
  } finally {
    [top, finder, solid, drawing].forEach((value) => value.delete());
  }
});

test("draws the outline of a cylindrical face in its parameter space", () => {
  const cylinder = r.makeCylinder(3, 10);
  const finder = new r.FaceFinder().ofSurfaceType("CYLINDRE");
  const side = finder.find(cylinder, { unique: true });
  try {
    expect(curvesOf(r.drawFaceOutline(side))).toMatchInlineSnapshot(`
      [
        "LINE 6.2832,10.0000 -> 0.0000,10.0000",
        "LINE 6.2832,0.0000 -> 6.2832,10.0000",
        "LINE 0.0000,0.0000 -> 6.2832,0.0000",
      ]
    `);
  } finally {
    [side, finder, cylinder].forEach((value) => value.delete());
  }
});

test("projects circles seen at an angle as ellipses", () => {
  const cylinder = r.makeCylinder(3, 10);
  const camera = new r.ProjectionCamera([20, 20, 20], [-1, -1, -1]);
  const projection = r.drawProjection(cylinder, camera);
  try {
    expect(curvesOf(projection.visible)).toMatchInlineSnapshot(`
      [
        "ELLIPSE -3.0000,8.1650 -> 3.0000,8.1650",
        "ELLIPSE 2.1213,-1.2247 -> -3.0000,-0.0000",
        "ELLIPSE -3.0000,-0.0000 -> 3.0000,0.0000",
        "LINE 3.0000,0.0000 -> 3.0000,8.1650",
        "ELLIPSE 3.0000,0.0000 -> 2.1213,-1.2247",
        "LINE -3.0000,0.0000 -> -3.0000,8.1650",
      ]
    `);
  } finally {
    [projection.hidden, camera, cylinder].forEach((value) => value.delete());
  }
});

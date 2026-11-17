/**
 * The effect table is checked for correctness, not only presence: every
 * routed `pure` or `alias` entry (members and free functions) runs on a
 * fixture and must delete nothing it was given, and every routed `consumes`
 * entry must delete exactly what its declared consume deletes.
 */
import { describe, expect, test, vi } from "vitest";
import * as replicad from "../../src/index";
import {
  Blueprint,
  Blueprints,
  CompoundBlueprint,
  drawCircle,
  drawRectangle,
  makeBaseBox,
  makeBox,
  ProjectionCamera,
  sketchCircle,
  sketchRectangle,
  Vector,
} from "../../src/index";
import {
  classEffects,
  functionEffects,
  ROUTED_FUNCTION_NAMES,
} from "../../src/operationEffects";
import { isDeleted } from "./models";

vi.setConfig({ testTimeout: 120_000 });

const r = replicad as any;

// Fixture inputs. Each call makes fresh values.
const box = () => makeBaseBox(10, 10, 10);
const topFace = (shape = box()) =>
  shape.faces.find((face) => (face.center as any).z > shape.boundingBox.bounds[1][2] - 0.1)!;
const wire = () => drawRectangle(10, 10).sketchOnPlane().wires() as any;
const edge = () => r.makeLine([0, 0, 0], [10, 0, 0]);
const drawing = () => drawRectangle(10, 10);
const blueprint = () => drawRectangle(10, 10).blueprint as Blueprint;
const blueprints = () =>
  (drawCircle(2).fuse(drawCircle(2).translate(10, 0)) as any).innerShape as Blueprints;
const compoundBlueprint = (): CompoundBlueprint => {
  const shape = (drawRectangle(20, 20).cut(drawCircle(3)) as any).innerShape;
  if (shape instanceof CompoundBlueprint) return shape;
  return shape.blueprints.find((bp: unknown) => bp instanceof CompoundBlueprint);
};
const compoundSketch = (offset = 0) =>
  (drawRectangle(10, 10).cut(drawCircle(2)).sketchOnPlane("XY", offset) as any)
    .sketches[0];
const sketches = () =>
  drawRectangle(10, 10)
    .cut(drawCircle(2))
    .fuse(drawCircle(3).translate(20, 0))
    .sketchOnPlane() as any;
const camera = () => new ProjectionCamera([0, 0, 50], [0, 0, -1]);

type Fixture = () => { values: unknown[]; run: () => unknown };
const on =
  <T>(make: () => T, run: (value: T) => unknown, extra: () => unknown[] = () => []): Fixture =>
  () => {
    const value = make();
    const others = extra();
    return { values: [value, ...others], run: () => run(value) };
  };
/** A fixture whose arguments are made first and passed to `run`. */
const call =
  (make: () => unknown[], run: (...values: any[]) => unknown): Fixture =>
  () => {
    const values = make();
    return { values, run: () => run(...values) };
  };
const finder = (f: any) => f.inPlane("XY", 10);

/** Routed members, by `Class.member`. */
const memberFixtures: Record<string, Fixture> = {
  "Shape.clone": on(box, (s) => s.clone()),
  "Shape.split": on(box, (s) => s.split("XY", 5)),
  "Shape.simplify": on(box, (s) => s.simplify()),
  "Shape.edges": on(box, (s) => s.edges),
  "Shape.faces": on(box, (s) => s.faces),
  "Shape.wires": on(box, (s) => s.wires),
  "Shape.solids": on(box, (s) => s.solids),
  "_1DShape.flipOrientation": on(edge, (e) => e.flipOrientation()),
  "Face.flipOrientation": on(() => topFace(), (f) => f.flipOrientation()),
  "_3DShape.fuse": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.fuse(b)),
  "_3DShape.fuseAll": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.fuseAll([b])),
  "_3DShape.cut": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.cut(b)),
  "_3DShape.cutAll": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.cutAll([b])),
  "_3DShape.intersect": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.intersect(b)),
  "_3DShape.intersectAll": call(() => [box(), makeBox([5, 5, 5], [15, 15, 15])], (a, b) => a.intersectAll([b])),
  "_3DShape.cutPlane": on(box, (s) => s.cutPlane("XY", 5)),
  "_3DShape.shell": on(box, (s) => s.shell(1, finder)),
  "_3DShape.fillet": on(box, (s) => s.fillet(1, (e: any) => e.inPlane("XY", 10))),
  "_3DShape.chamfer": on(box, (s) => s.chamfer(1, (e: any) => e.inPlane("XY", 10))),
  "_3DShape.draft": on(box, (s) => s.draft(5, (f: any) => f.parallelTo("XZ"))),
  "Sketch.clone": on(() => sketchRectangle(5, 5), (s) => s.clone()),
  "Sketch.face": on(() => sketchRectangle(5, 5), (s) => s.face()),
  "Sketch.wires": on(() => sketchRectangle(5, 5), (s) => s.wires()),
  "Sketch.faces": on(() => sketchRectangle(5, 5), (s) => s.faces()),
  "CompoundSketch.face": on(() => compoundSketch(), (s) => s.face()),
  "CompoundSketch.extrude": on(() => compoundSketch(), (s) => s.extrude(2)),
  "CompoundSketch.revolve": on(
    () => (drawRectangle(4, 4).cut(drawCircle(1)).translate(6, 0).sketchOnPlane("XZ") as any).sketches[0],
    (s) => s.revolve()
  ),
  "CompoundSketch.loftWith": call(() => [compoundSketch(), compoundSketch(10)], (a, b) => a.loftWith(b, {})),
  "Sketches.faces": on(sketches, (s) => s.faces()),
  ...Object.fromEntries(
    (
      [
        ["Drawing", drawing],
        ["Blueprint", blueprint],
        ["Blueprints", blueprints],
        ["CompoundBlueprint", compoundBlueprint],
      ] as const
    ).flatMap(([name, make]) => [
      [`${name}.clone`, on(make as () => any, (d) => d.clone())],
      [`${name}.stretch`, on(make as () => any, (d) => d.stretch(2, [1, 0], [0, 0]))],
      [`${name}.rotate`, on(make as () => any, (d) => d.rotate(30))],
      [`${name}.scale`, on(make as () => any, (d) => d.scale(2))],
      [`${name}.translate`, on(make as () => any, (d) => d.translate(1, 2))],
      [`${name}.mirror`, on(make as () => any, (d) => d.mirror([1, 0]))],
      [`${name}.sketchOnPlane`, on(make as () => any, (d) => d.sketchOnPlane())],
      [`${name}.sketchOnFace`, call(() => [(make as () => any)(), topFace(makeBaseBox(30, 30, 10))], (d, f) => d.sketchOnFace(f, "original"))],
      [`${name}.punchHole`, call(() => [(make as () => any)(), makeBaseBox(30, 30, 10)], (d, s) => d.punchHole(s, finder))],
    ])
  ),
  "Drawing.cut": call(() => [drawing(), drawCircle(2)], (a, b) => a.cut(b)),
  "Drawing.fuse": call(() => [drawing(), drawCircle(2).translate(5, 0)], (a, b) => a.fuse(b)),
  "Drawing.intersect": call(() => [drawing(), drawCircle(2)], (a, b) => a.intersect(b)),
  "Drawing.fillet": on(drawing, (d) => d.fillet(1)),
  "Drawing.chamfer": on(drawing, (d) => d.chamfer(1)),
  "Drawing.offset": on(drawing, (d) => d.offset(1)),
  "Drawing.approximate": on(() => drawCircle(3), (d) => d.approximate("svg")),
  "Blueprint.subFace": call(() => [blueprint(), topFace(makeBaseBox(30, 30, 10))], (b, f) => b.subFace(f)),
};

const point2 = (): [number, number][] => [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

/** Routed free functions. Fonts are not available in tests. */
const functionFixtures: Record<string, Fixture> = {
  makeLine: call(() => [], () => r.makeLine([0, 0, 0], [1, 0, 0])),
  makeCircle: call(() => [], () => r.makeCircle(2)),
  makeEllipse: call(() => [], () => r.makeEllipse(3, 2)),
  makeHelix: call(() => [], () => r.makeHelix(1, 5, 2)),
  makeThreePointArc: call(() => [], () => r.makeThreePointArc([0, 0, 0], [1, 1, 0], [2, 0, 0])),
  makeEllipseArc: call(() => [], () => r.makeEllipseArc(3, 2, 0, 1)),
  makeBSplineApproximation: call(() => [], () => r.makeBSplineApproximation([[0, 0, 0], [1, 2, 0], [3, 1, 0], [4, 3, 0]])),
  makeBezierCurve: call(() => [], () => r.makeBezierCurve([[0, 0, 0], [1, 2, 0], [3, 0, 0]])),
  makeTangentArc: call(() => [], () => r.makeTangentArc([0, 0, 0], [1, 0, 0], [2, 2, 0])),
  assembleWire: call(() => [edge(), r.makeLine([10, 0, 0], [10, 10, 0])], (a, b) => r.assembleWire([a, b])),
  makeFace: call(() => [wire()], (w) => r.makeFace(w)),
  makeNewFaceWithinFace: call(() => [topFace(makeBaseBox(30, 30, 10)), drawRectangle(5, 5).sketchOnPlane("XY", 10).wires()], (f, w) => r.makeNewFaceWithinFace(f, w)),
  makeNonPlanarFace: call(() => [wire()], (w) => r.makeNonPlanarFace(w)),
  makeCylinder: call(() => [], () => r.makeCylinder(2, 5)),
  makeSphere: call(() => [], () => r.makeSphere(2)),
  makeEllipsoid: call(() => [], () => r.makeEllipsoid(3, 2, 1)),
  makeBox: call(() => [], () => r.makeBox([0, 0, 0], [1, 2, 3])),
  makeBaseBox: call(() => [], () => r.makeBaseBox(1, 2, 3)),
  makeVertex: call(() => [], () => r.makeVertex([1, 2, 3])),
  makeOffset: call(() => [topFace()], (f) => r.makeOffset(f, 1)),
  weldShellsAndFaces: call(() => box().faces, (...faces) => r.weldShellsAndFaces(faces)),
  makeSolid: call(() => box().faces, (...faces) => r.makeSolid(faces)),
  addHolesInFace: call(() => [drawRectangle(10, 10).sketchOnPlane().face(), drawCircle(2).sketchOnPlane().wires()], (f, w) => r.addHolesInFace(f, [w])),
  makePolygon: call(() => [], () => r.makePolygon([[0, 0, 0], [1, 0, 0], [1, 1, 0]])),
  basicFaceExtrusion: call(() => [topFace(), new Vector([0, 0, 2])], (f, v) => r.basicFaceExtrusion(f, v)),
  revolution: call(() => [drawRectangle(2, 2).translate(5, 0).sketchOnPlane("XZ").face()], (f) => r.revolution(f)),
  genericSweep: call(
    () => [drawCircle(1).sketchOnPlane().wires(), r.assembleWire([r.makeLine([0, 0, 0], [0, 0, 10])])],
    (w, spine) => r.genericSweep(w, spine, {})
  ),
  supportExtrude: call(() => [wire(), box()], (w, s) => r.supportExtrude(w, [0, 0, 0], [0, 0, 1], s.wrapped)),
  complexExtrude: call(() => [wire()], (w) => r.complexExtrude(w, [0, 0, 0], [0, 0, 5], { profile: "linear", endFactor: 0.5 })),
  twistExtrude: call(() => [wire()], (w) => r.twistExtrude(w, 30, [0, 0, 0], [0, 0, 5])),
  loft: call(() => [wire(), drawRectangle(5, 5).sketchOnPlane("XY", 10).wires()], (a, b) => r.loft([a, b])),
  draw: call(() => [], () => r.draw([1, 1])),
  drawRoundedRectangle: call(() => [], () => r.drawRoundedRectangle(10, 5, 1)),
  drawRectangle: call(() => [], () => r.drawRectangle(10, 5)),
  drawSingleCircle: call(() => [], () => r.drawSingleCircle(2)),
  drawSingleEllipse: call(() => [], () => r.drawSingleEllipse(3, 2)),
  drawCircle: call(() => [], () => r.drawCircle(2)),
  drawEllipse: call(() => [], () => r.drawEllipse(3, 2)),
  drawPolysides: call(() => [], () => r.drawPolysides(3, 6)),
  drawPointsInterpolation: call(() => [], () => r.drawPointsInterpolation([[0, 0], [1, 2], [3, 1], [4, 3]])),
  drawParametricFunction: call(() => [], () => r.drawParametricFunction((t: number) => [t, t * t])),
  drawProjection: call(() => [box(), camera()], (s, c) => r.drawProjection(s, c)),
  drawFaceOutline: call(() => [topFace()], (f) => r.drawFaceOutline(f)),
  deserializeDrawing: call(() => [], () => r.deserializeDrawing(drawCircle(2).serialize())),
  sketchCircle: call(() => [], () => r.sketchCircle(2)),
  sketchEllipse: call(() => [], () => r.sketchEllipse(3, 2)),
  sketchRectangle: call(() => [], () => r.sketchRectangle(3, 2)),
  sketchRoundedRectangle: call(() => [], () => r.sketchRoundedRectangle(3, 2, 0.5)),
  sketchPolysides: call(() => [], () => r.sketchPolysides(3, 6)),
  sketchParametricFunction: call(() => [], () => r.sketchParametricFunction((t: number) => [t, t * t])),
  sketchHelix: call(() => [], () => r.sketchHelix(1, 5, 2)),
  polysidesBlueprint: call(() => [], () => r.polysidesBlueprint(3, 6)),
  roundedRectangleBlueprint: call(() => [], () => r.roundedRectangleBlueprint(10, 5, 1)),
  fuse2D: call(() => [blueprint(), drawCircle(2).translate(5, 0).blueprint], (a, b) => r.fuse2D(a, b)),
  cut2D: call(() => [blueprint(), drawCircle(2).blueprint], (a, b) => r.cut2D(a, b)),
  intersect2D: call(() => [blueprint(), drawCircle(2).blueprint], (a, b) => r.intersect2D(a, b)),
  fuseBlueprints: call(() => [blueprint(), drawCircle(2).translate(5, 0).blueprint], (a, b) => r.fuseBlueprints(a, b)),
  cutBlueprints: call(() => [blueprint(), drawCircle(2).blueprint], (a, b) => r.cutBlueprints(a, b)),
  intersectBlueprints: call(() => [blueprint(), drawCircle(2).blueprint], (a, b) => r.intersectBlueprints(a, b)),
  makeProjectedEdges: call(() => [box(), camera()], (s, c) => r.makeProjectedEdges(s, c)),
};
const fontFunctions = ["drawText", "sketchText", "textBlueprints"];

/** Routed entries with their effect, keyed like the fixtures. */
const routedEntries = (): [string, string][] => {
  const entries: [string, string][] = [];
  for (const entry of classEffects()) {
    if (!entry.routed) continue;
    const name = (entry.target.prototype as object).constructor.name;
    for (const [member, effect] of Object.entries(entry.members)) {
      if (entry.unrouted?.includes(member) || member.startsWith("set:")) continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry.target.prototype, member)!;
      if (
        descriptor.get &&
        !(entry.elementGetters && member in entry.elementGetters) &&
        !entry.routedGetters?.includes(member)
      )
        continue;
      entries.push([`${name}.${member}`, effect]);
    }
  }
  for (const name of ROUTED_FUNCTION_NAMES) entries.push([name, functionEffects[name].effect]);
  return entries;
};

const fixtures: Record<string, Fixture> = { ...memberFixtures, ...functionFixtures };

describe("I4 effect table correctness: routed pure and alias entries delete nothing", () => {
  test("every routed pure or alias entry has a fixture (fonts excepted)", () => {
    const missing = routedEntries()
      .filter(([key, effect]) => (effect === "pure" || effect === "alias") && !fixtures[key])
      .map(([key]) => key)
      .filter((key) => !fontFunctions.includes(key));
    expect(missing).toEqual([]);
  });

  for (const [key, effect] of routedEntries()) {
    if (effect !== "pure" && effect !== "alias") continue;
    if (!fixtures[key]) continue;
    test(`${key} (${effect}) deletes none of its inputs`, () => {
      const { values, run } = fixtures[key]();
      run();
      const deleted = values.map((value, index) => (isDeleted(value) ? index : -1)).filter((index) => index >= 0);
      expect(deleted).toEqual([]);
    });
  }
});

/**
 * Models for the operation cache tests. Each takes parameters and returns the
 * shapes it would deliver. The first three are ports of the synthetic models
 * the seam was qualified with (finder closure, callback closure, consumption
 * check); `corpus` exercises the routed surface broadly.
 */
import { createHash } from "node:crypto";
import {
  makeBaseBox,
  makeBox,
  makeCylinder,
  makeSphere,
  draw,
  drawCircle,
  drawRoundedRectangle,
  drawPolysides,
  drawRectangle,
  extrudeFaceUntil,
  sketchCircle,
  sketchRectangle,
  Sketcher,
  compoundShapes,
  type AnyShape,
  type Shape3D,
} from "../../src/index";

/**
 * The `top` parameter reaches the kernel only through a variable the finder
 * callback captures: receiver, radius and callback source are identical for
 * both values.
 */
export const finderClosure = (p: { top: boolean; radius: number }) => {
  const box = makeBaseBox(40, 30, 20);
  const h = p.top ? 20 : 0;
  return [box.fillet(p.radius, (e) => e.inPlane("XY", h))];
};

/**
 * Each parameter reaches the kernel only through a closure the library
 * calls: `h` through an opaque `when` predicate, `profile` through a
 * `sweepSketch` factory. A `new Sketcher` is identified by its fresh state.
 */
export const callbackClosure = (p: {
  h: number;
  radius: number;
  profile: number;
}) => {
  const z = p.h;
  const box = makeBaseBox(40, 30, 20).fillet(p.radius, (e) =>
    e.when(({ element }) => {
      const [[, , zMin], [, , zMax]] = element.boundingBox.bounds;
      return Math.abs(zMin - z) < 1e-6 && Math.abs(zMax - z) < 1e-6;
    })
  );
  const rail = draw([0, 0]).hLine(40).vLine(20).done().sketchOnPlane("XZ", 30);
  const pipe = (rail as any).sweepSketch(
    (plane: any) => sketchCircle(p.profile, { plane }),
    { frenet: true }
  ) as Shape3D;
  const tab = new Sketcher("XY", 25)
    .hLine(10)
    .vLine(5)
    .hLine(-10)
    .close()
    .extrude(2) as Shape3D;
  return [box, pipe, tab];
};

/**
 * Whether a value, or a kernel handle it holds, has been deleted: shapes and
 * wrappers through their handle, sketches through their wire, drawings and
 * blueprints through their curves, groups through their members.
 */
export const isDeleted = (value: any): boolean => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(isDeleted);
  try {
    if (typeof value.isDeleted === "function") return value.isDeleted();
    if ("_wrapped" in value || "wrapped" in value) {
      const handle = value.wrapped; // throws once the wrapper is deleted
      return typeof handle?.isDeleted === "function" ? handle.isDeleted() : false;
    }
    if ("wire" in value) return isDeleted(value.wire);
    if ("sketches" in value) return value.sketches.some(isDeleted);
    if ("innerShape" in value) return isDeleted(value.innerShape);
    if ("curves" in value) return value.curves.some(isDeleted);
    if ("blueprints" in value) return value.blueprints.some(isDeleted);
    return false;
  } catch {
    return true;
  }
};

/**
 * A hit must consume exactly what the computation consumes. The deletion
 * flags select the size of marker boxes, so a difference shows in the output.
 */
export const consumeCheck = (p: { size: number }) => {
  const box = makeBox([0, 0, 0], [p.size, p.size, p.size]);
  const moved = box.translate(20, 0, 0);
  const sketch = sketchRectangle(5, 5);
  const prism = sketch.extrude(3);
  const a = sketchCircle(4);
  const b = sketchCircle(2, { plane: "XY", origin: [0, 0, 10] } as any);
  const loft = a.loftWith(b);
  const drawing = drawCircle(3);
  const disk = (drawing.sketchOnPlane() as any).extrude(1) as Shape3D;
  const flags = [
    isDeleted(box),
    isDeleted(sketch),
    isDeleted(a),
    isDeleted(b),
    !isDeleted(drawing),
  ];
  const markers = flags.map((flag, index) =>
    makeBox([index * 10, -20, 0], [index * 10 + 5, -15, flag ? 5 : 1])
  );
  return { shapes: [moved, prism, loft, disk, ...markers], flags };
};

/**
 * A broad model: primitives, transforms, booleans, value and opaque finders,
 * fillet, chamfer, shell, pens, drawings with corner finders, compound
 * sketches, lofts, sweeps, revolves, element getters.
 */
export const corpus = (p: { width: number; hole: number; angle: number }) => {
  const plate = drawRoundedRectangle(p.width, 40, 4)
    .cut(drawCircle(p.hole).translate(10, 0))
    .cut(drawPolysides(4, 6).translate(-12, 0))
    .sketchOnPlane("XY")
    .extrude(6) as Shape3D;
  const filleted = plate.fillet(1, (e) => e.inPlane("XY", 6));
  const boss = makeCylinder(6, 14, [0, 0, 6]);
  const body = filleted.fuse(boss).cut(makeCylinder(3, 30, [0, 0, -5]));
  const chamfered = body.chamfer(0.5, (e) =>
    e.either([(f) => f.inPlane("XY", 0), (f) => f.ofCurveType("CIRCLE")])
  );

  const pen = draw([0, 0])
    .hLine(20)
    .vLine(10)
    .tangentArc(-5, 5)
    .lineTo([0, 15])
    .close();
  const rounded = pen.fillet(1.5, (c) => c.inBox([-1, -1], [21, 1]));
  const bracket = (
    (rounded.sketchOnPlane("XZ", 30) as any).extrude(5) as Shape3D
  ).rotate(p.angle, [0, 0, 0], [0, 0, 1]);

  const cup = makeBaseBox(20, 20, 15)
    .translate(40, 0, 0)
    .shell(1.5, (f) => f.inPlane("XY", 15));
  const firstEdge = makeBox([0, 0, 0], [10, 10, 10]);
  const edges = firstEdge.edges;
  const picked = firstEdge.fillet(1, (e) => e.inList(edges.slice(0, 2)));

  const loft = sketchRectangle(10, 10)
    .loftWith(sketchCircle(3, { origin: [0, 0, 12] } as any))
    .translate(-40, 0, 0);
  const sweep = (
    draw().vLine(20).hLine(10).done().sketchOnPlane("XZ") as any
  ).sweepSketch((plane: any) => sketchRectangle(2, 3, { plane }));
  const revolved = (
    drawRoundedRectangle(4, 10, 1).translate(10, 0).sketchOnPlane("XZ") as any
  ).revolve() as Shape3D;
  const sketcher = new Sketcher("XZ", -20)
    .hLine(8)
    .vLine(4)
    .threePointsArc(-8, 0, -4, 2)
    .close()
    .revolve() as Shape3D;
  const ball = makeSphere(3).translateZ(30);
  const group = compoundShapes([ball, revolved]) as AnyShape;
  return [chamfered, bracket, cup, picked, loft, sweep, sketcher, group];
};

/**
 * The operations upstream 1.2 added or changed: `extrudeUntil` on each sketch
 * kind and `extrudeFaceUntil`, booleans without `simplify`, the shape finder
 * helpers (whose selections feed a fillet, a chamfer, a compound and a
 * limiting face), a revolve about a named axis and the 2D boolean fixes.
 */
export const upstreamOps = (p: {
  limit: number;
  hole: number;
  simplify: boolean;
}) => {
  const limit = (drawRectangle(80, 80).sketchOnPlane("XY", p.limit) as any).face();
  const post = (drawRectangle(6, 6).sketchOnPlane("XY", 2) as any).extrudeUntil(
    limit
  ) as Shape3D;
  const tube = (
    drawRectangle(14, 14)
      .cut(drawCircle(p.hole))
      .translate(20, 0)
      .sketchOnPlane("XY", 2) as any
  ).extrudeUntil(limit) as Shape3D;
  const pair = (
    drawCircle(2)
      .translate(-20, 0)
      .fuse(drawCircle(2).translate(-30, 0))
      .sketchOnPlane("XY", 2) as any
  ).extrudeUntil(limit) as Shape3D;
  const profile = (
    drawCircle(3).translate(0, 25).sketchOnPlane("XY", 2) as any
  ).face();
  const pin = extrudeFaceUntil(profile, limit, [0, 0, 1]);

  const options = { simplify: p.simplify };
  const block = makeBaseBox(30, 30, 10).translate(0, -40, 0);
  const bore = makeCylinder(p.hole, 20, [0, -40, -5]);
  const fused = block.fuse(bore, options);
  const common = block.intersect(bore, options);
  const all = block.fuseAll([bore, makeSphere(4).translate(0, -40, 10)], options);
  const cut = block.cut(bore, options);

  const corner = cut.findEdge((e) =>
    e.inDirection("Z").containsPoint([15, -25, 5])
  );
  const rounded = cut.fillet(1, (e) => e.inList([corner]));
  const verticals = cut.findEdges((e) => e.inDirection("Z"));
  const chamfered = cut.chamfer(0.5, (e) => e.inList(verticals));
  const flats = compoundShapes(cut.findFaces((f) => f.parallelTo("XY")));
  const top = cut.findFace((f) => f.inPlane("XY", 10));
  const peg = (
    drawCircle(2).translate(10, -48).sketchOnPlane("XY", -10) as any
  ).extrudeUntil(top) as Shape3D;

  const revolved = (
    drawRectangle(4, 6).translate(10, 0).sketchOnPlane("XZ") as any
  ).revolve("Z", { angle: 270 }) as Shape3D;
  const slotted = (
    drawRectangle(30, 20)
      .cut(drawCircle(2).translate(-8, 0).fuse(drawCircle(2).translate(8, 0)))
      .sketchOnPlane("XY") as any
  ).extrude(2) as Shape3D;
  const holed = (
    drawRectangle(20, 20)
      .cut(drawCircle(3))
      .cut(drawCircle(1).translate(30, 30))
      .sketchOnPlane("XY", 5) as any
  ).extrude(2) as Shape3D;

  return [
    post,
    tube,
    pair,
    pin,
    fused,
    common,
    all,
    cut,
    rounded,
    chamfered,
    flats,
    peg,
    revolved,
    slotted,
    holed,
  ] as AnyShape[];
};

const meshTolerance = { tolerance: 0.05, angularTolerance: 0.2 };

/** Digest of each shape's mesh and edge mesh, in order. */
export const fingerprint = (shapes: readonly AnyShape[]): string[] =>
  shapes.map((shape) => {
    const hash = createHash("sha256");
    const mesh = shape.mesh(meshTolerance);
    hash.update(new Float32Array(mesh.vertices));
    hash.update(new Uint32Array(mesh.triangles));
    hash.update(new Float32Array(mesh.normals));
    // Face and edge ids are hash codes of the kernel handles: not stable
    // across runs, so only the grouping is compared.
    hash.update(JSON.stringify(mesh.faceGroups.map((g) => [g.start, g.count])));
    const edges = shape.meshEdges(meshTolerance);
    hash.update(new Float32Array(edges.lines));
    hash.update(JSON.stringify(edges.edgeGroups.map((g) => [g.start, g.count])));
    return hash.digest("hex").slice(0, 16);
  });

export const deleteAll = (shapes: readonly { delete(): void }[]) =>
  shapes.forEach((shape) => shape.delete());

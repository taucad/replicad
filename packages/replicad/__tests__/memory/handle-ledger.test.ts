/**
 * T1, the handle ledger table. Each public operation runs a few times after
 * warming up, and the caller deletes every object it is given. Afterwards no
 * OpenCascade handle the operation created may still be alive, without
 * running the garbage collector: a handle that only the finalization registry
 * would free is a leak too, because a synchronous model build never yields to
 * it.
 *
 * A failure lists the leaked handles by the replicad source line that created
 * them.
 */
import { beforeAll, describe, expect, test, vi } from "vitest";
import * as replicad from "../../src/index";
import { getOC } from "../../src/index";
import { edgeToCurveOnPlane } from "../../src/curves";
import {
  installHandleLedger,
  summarizeLeaks,
  type HandleLedger,
} from "../support/handleLedger";

const WARM_UP = 2;
const ITERATIONS = 3;

let ledger: HandleLedger;
beforeAll(() => {
  ledger = installHandleLedger(getOC());
});

const del = (...values: any[]) =>
  values.forEach((value) => {
    if (Array.isArray(value)) del(...value);
    else if (value && typeof value.delete === "function") value.delete();
  });

const r = replicad as any;
const box = () => r.makeBaseBox(10, 10, 10);
/** A square face of side `size` at height `z`, and a function deleting it. */
const planarLimit = (size: number, z: number): [any, () => void] => {
  const drawing = r.drawRectangle(size, size);
  const sketch = drawing.sketchOnPlane("XY", z);
  const face = sketch.face();
  return [face, () => del(face, sketch, drawing)];
};

/** Operations, each deleting everything it was given. */
const ledgerCases: Record<string, () => void> = {
  makeBaseBox: () => del(box()),
  makeBox: () => del(r.makeBox([0, 0, 0], [10, 10, 10])),
  makeCylinder: () => del(r.makeCylinder(3, 20)),
  makeSphere: () => del(r.makeSphere(5)),
  makeEllipsoid: () => del(r.makeEllipsoid(5, 4, 3)),
  drawRectangle: () => del(r.drawRectangle(10, 5)),
  "drawRectangle.sketchOnPlane": () => {
    const drawing = r.drawRectangle(10, 5);
    del(drawing.sketchOnPlane("XY"), drawing);
  },
  "sketch.extrude": () => {
    const drawing = r.drawRectangle(10, 5);
    del(drawing.sketchOnPlane("XY").extrude(5), drawing);
  },
  "sketch.revolve": () => {
    const drawing = r.drawRectangle(4, 5);
    const moved = drawing.translate(5, 0);
    del(moved.sketchOnPlane("XZ").revolve(), moved, drawing);
  },
  "sketchCircle.loftWith": () =>
    del(r.sketchCircle(5).loftWith(r.sketchCircle(3, { origin: 10 }))),
  "drawRoundedRectangle.extrude": () => {
    const drawing = r.drawRoundedRectangle(20, 10, 2);
    del(drawing.sketchOnPlane().extrude(5), drawing);
  },
  "drawPolysides.extrude": () => {
    const drawing = r.drawPolysides(10, 6);
    del(drawing.sketchOnPlane().extrude(5), drawing);
  },
  "drawing.fuse": () => {
    const a = r.drawRectangle(10, 5);
    const b = r.drawCircle(4);
    del(a.fuse(b), a, b);
  },
  "drawing.cut": () => {
    const a = r.drawRectangle(10, 5);
    const b = r.drawCircle(2);
    del(a.cut(b), a, b);
  },
  "drawing.offset": () => {
    const a = r.drawRoundedRectangle(10, 5, 1);
    del(a.offset(1), a);
  },
  "draw.lines.close": () => del(r.draw().hLine(10).vLine(5).hLine(-10).close()),
  "draw.sagittaArc": () =>
    del(r.draw().hLine(10).sagittaArc(0, 5, 2).hLine(-10).close()),
  "shape.translate": () => del(box().translate([1, 2, 3])),
  "shape.rotate": () => del(box().rotate(30, [0, 0, 0], [0, 0, 1])),
  "shape.mirror": () => del(box().mirror("XY")),
  "shape.scale": () => del(box().scale(2)),
  "shape.clone": () => {
    const b = box();
    del(b.clone(), b);
  },
  "shape.cut": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    del(b.cut(c), b, c);
  },
  "shape.fuse": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    del(b.fuse(c), b, c);
  },
  "shape.intersect": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    del(b.intersect(c), b, c);
  },
  "shape.fuseAll": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    const d = r.makeSphere(4);
    del(b.fuseAll([c, d]), b, c, d);
  },
  "shape.fillet(all)": () => {
    const b = box();
    del(b.fillet(1), b);
  },
  "shape.fillet(finder)": () => {
    const b = box();
    del(b.fillet(1, (e: any) => e.inDirection("Z")), b);
  },
  "shape.chamfer": () => {
    const b = box();
    del(b.chamfer(1), b);
  },
  "shape.shell": () => {
    const b = box();
    del(b.shell(1, (f: any) => f.inPlane("XY", 10)), b);
  },
  "shape.split": () => {
    const b = box();
    const result = b.split("XY", 5);
    del(result.positive, result.negative, result.on, b);
  },
  "shape.cutPlane": () => {
    const b = box();
    del(b.cutPlane("XY", 5), b);
  },
  "shape.edges": () => {
    const b = box();
    del(b.edges, b);
  },
  "shape.faces": () => {
    const b = box();
    del(b.faces, b);
  },
  "EdgeFinder.find": () => {
    const b = box();
    const finder = new r.EdgeFinder().inDirection("Z");
    del(finder.find(b), finder, b);
  },
  "FaceFinder.find": () => {
    const b = box();
    const finder = new r.FaceFinder().inPlane("XY", 10);
    del(finder.find(b), finder, b);
  },
  "face.center/normal": () => {
    const b = box();
    const faces = b.faces;
    for (const face of faces) del(face.center, face.normalAt());
    del(faces, b);
  },
  "edge.startPoint/tangent": () => {
    const b = box();
    const edges = b.edges;
    for (const edge of edges) {
      del(edge.startPoint, edge.endPoint, edge.tangentAt(0.5));
      void edge.length;
    }
    del(edges, b);
  },
  "shape.boundingBox": () => {
    const b = box();
    const bbox = b.boundingBox;
    void bbox.center;
    del(bbox, b);
  },
  measureVolume: () => {
    const b = box();
    r.measureVolume(b);
    del(b);
  },
  measureArea: () => {
    const b = box();
    r.measureArea(b);
    del(b);
  },
  measureVolumeProperties: () => {
    const b = box();
    const properties = r.measureShapeVolumeProperties(b);
    del(properties.centerOfMass, properties, b);
  },
  measureDistanceBetween: () => {
    const b = box();
    const c = r.makeSphere(2).translate([20, 0, 0]);
    r.measureDistanceBetween(b, c);
    del(b, c);
  },
  "shape.mesh": () => {
    const b = r.makeCylinder(3, 20);
    b.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
    del(b);
  },
  "shape.meshEdges": () => {
    const b = r.makeCylinder(3, 20);
    b.meshEdges({ tolerance: 0.01, angularTolerance: 0.1 });
    del(b);
  },
  "shape.blobSTL": () => {
    const b = r.makeCylinder(3, 20);
    b.blobSTL({ tolerance: 0.01 });
    del(b);
  },
  "shape.blobSTEP": () => {
    const b = r.makeCylinder(3, 20);
    b.blobSTEP();
    del(b);
  },
  "makeLine/makeCircle": () =>
    del(r.makeLine([0, 0, 0], [1, 2, 3]), r.makeCircle(5)),
  makeHelix: () => del(r.makeHelix(2, 10, 5)),
  makeBSplineApproximation: () =>
    del(
      r.makeBSplineApproximation([
        [0, 0, 0],
        [1, 2, 0],
        [3, 1, 1],
        [5, 4, 2],
      ])
    ),
  makeOffset: () => {
    const b = box();
    del(r.makeOffset(b, 1), b);
  },
  makeCompound: () => del(r.makeCompound([r.makeBaseBox(1, 1, 1), r.makeSphere(1)])),
  drawProjection: () => {
    const b = box();
    const projection = r.drawProjection(b, "front");
    del(projection.visible, projection.hidden, b);
  },
  "drawFaceOutline(curved edges)": () => {
    const drawing = r.drawRoundedRectangle(20, 10, 3);
    const solid = drawing.sketchOnPlane("XY").extrude(5);
    const finder = new r.FaceFinder().inPlane("XY", 5);
    const top = finder.find(solid, { unique: true });
    del(r.drawFaceOutline(top), top, finder, solid, drawing);
  },
  "drawFaceOutline(cylindrical face)": () => {
    const cylinder = r.makeCylinder(3, 10);
    const finder = new r.FaceFinder().ofSurfaceType("CYLINDRE");
    const side = finder.find(cylinder, { unique: true });
    del(r.drawFaceOutline(side), side, finder, cylinder);
  },
  "drawProjection(curved edges)": () => {
    const cylinder = r.makeCylinder(3, 10);
    const camera = new r.ProjectionCamera([20, 20, 20], [-1, -1, -1]);
    const projection = r.drawProjection(cylinder, camera);
    del(projection.visible, projection.hidden, camera, cylinder);
  },
  "edgeToCurveOnPlane(curved edges)": () => {
    const edges = [
      r.makeCircle(5),
      r.makeEllipse(5, 3),
      r.makeBezierCurve([
        [0, 0, 0],
        [1, 2, 0],
        [3, 1, 0],
      ]),
      r.makeBSplineApproximation([
        [0, 0, 0],
        [1, 2, 0],
        [3, 1, 0],
        [5, 4, 0],
      ]),
    ];
    for (const edge of edges) del(edgeToCurveOnPlane(edge), edge);
  },
  "serialize/deserialize": () => {
    const b = box();
    del(r.deserializeShape(b.serialize()), b);
  },
  "drawing.toSVG": () => {
    const drawing = r.drawRoundedRectangle(10, 5, 1);
    drawing.toSVG();
    del(drawing);
  },
  "drawing.sketchOnFace": () => {
    const b = box();
    const face = new r.FaceFinder().inPlane("XY", 10);
    const top = face.find(b, { unique: true });
    const drawing = r.drawRectangle(2, 2);
    del(drawing.sketchOnFace(top, "original"), drawing, top, face, b);
  },
  "drawing.punchHole": () => {
    const b = box();
    const drawing = r.drawCircle(1);
    del(
      drawing.punchHole(b, (f: any) => f.inPlane("XY", 10)),
      drawing,
      b
    );
  },
  // Upstream 1.2: boolean options, shape finders, extrudeUntil, named revolve
  // axes and the 2D boolean fixes.
  "shape.fuse/cut/intersect(simplify: false)": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    del(
      b.fuse(c, { simplify: false }),
      b.cut(c, { simplify: false }),
      b.intersect(c, { simplify: false }),
      b,
      c
    );
  },
  "shape.fuseAll/cutAll(simplify: false)": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    const d = r.makeSphere(4);
    del(
      b.fuseAll([c, d], { simplify: false }),
      b.cutAll([c, d], { simplify: false }),
      b,
      c,
      d
    );
  },
  "shape.findEdge/findEdges": () => {
    const b = box();
    del(
      b.findEdge((e: any) => e.inDirection("Z").containsPoint([5, 5, 5])),
      b.findEdges((e: any) => e.inDirection("Z")),
      b
    );
  },
  "shape.findFace/findFaces": () => {
    const b = box();
    del(
      b.findFace((f: any) => f.inPlane("XY", 10)),
      b.findFaces((f: any) => f.parallelTo("XY")),
      b
    );
  },
  "sketch.revolve(named axis)": () => {
    const drawing = r.drawRectangle(4, 5);
    const moved = drawing.translate(5, 0);
    del(moved.sketchOnPlane("XZ").revolve("Z", { angle: 90 }), moved, drawing);
  },
  "sketch.extrudeUntil": () => {
    const [limit, dropLimit] = planarLimit(40, 20);
    const drawing = r.drawRectangle(4, 4);
    del(drawing.sketchOnPlane("XY", 5).extrudeUntil(limit), drawing);
    dropLimit();
  },
  "compoundSketch.extrudeUntil": () => {
    const [limit, dropLimit] = planarLimit(40, 20);
    const outer = r.drawRectangle(10, 10);
    const hole = r.drawCircle(2);
    const drawing = outer.cut(hole);
    del(drawing.sketchOnPlane("XY", 5).extrudeUntil(limit), drawing, hole, outer);
    dropLimit();
  },
  "sketches.extrudeUntil": () => {
    const [limit, dropLimit] = planarLimit(40, 20);
    const square = r.drawRectangle(4, 4);
    const left = square.translate(-5, 0);
    const right = square.translate(5, 0);
    const drawing = left.fuse(right);
    del(
      drawing.sketchOnPlane("XY", 5).extrudeUntil(limit),
      drawing,
      left,
      right,
      square
    );
    dropLimit();
  },
  extrudeFaceUntil: () => {
    const [limit, dropLimit] = planarLimit(40, 20);
    const [profile, dropProfile] = planarLimit(4, 5);
    del(r.extrudeFaceUntil(profile, limit, [0, 0, 1]));
    dropProfile();
    dropLimit();
  },
  "drawing.cut(several cutters)": () => {
    const piece = r.drawRectangle(20, 10);
    const circle = r.drawCircle(2);
    const left = circle.translate(-5, 0);
    const right = circle.translate(5, 0);
    const cutters = left.fuse(right);
    del(piece.cut(cutters), cutters, left, right, circle, piece);
  },
  "drawing.cut(outside an existing hole)": () => {
    const outer = r.drawRectangle(20, 20);
    const hole = r.drawCircle(3);
    const holed = outer.cut(hole);
    const circle = r.drawCircle(1);
    const cutter = circle.translate(30, 30);
    del(holed.cut(cutter), cutter, circle, holed, hole, outer);
  },
  "workload: cut + fillet + meshEdges": () => {
    const b = box();
    const c = r.makeCylinder(3, 20);
    const cut = b.cut(c);
    const filleted = cut.fillet(0.5);
    filleted.meshEdges();
    del(filleted, cut, b, c);
  },
};

const leaksOf = (operation: () => void): string[] => {
  for (let i = 0; i < WARM_UP; i++) operation();
  const snapshot = ledger.snapshot();
  for (let i = 0; i < ITERATIONS; i++) operation();
  return summarizeLeaks(ledger.since(snapshot), ITERATIONS).map(
    ({ perIteration, via, stack }) => `${perIteration}/run ${via} @ ${stack}`
  );
};

describe("T1 handle ledger: no operation leaves a handle behind", () => {
  for (const [name, operation] of Object.entries(ledgerCases)) {
    test(name, () => {
      const before = ledger.stats().doubleDeletes;
      const leaks = leaksOf(operation);
      if (leaks.length > 0)
        throw new Error(`Leaked handles:\n${leaks.join("\n")}`);
      expect(ledger.stats().doubleDeletes - before, "double deletes").toBe(0);
    });
  }
});

/** T4: operations driven into a failure leave nothing behind either. */
const throwCases: Record<string, () => void> = {
  "Wire.offset2D that fails": () => {
    const drawing = r.drawRectangle(10, 10);
    const sketch = drawing.sketchOnPlane();
    const wire = sketch.wires();
    try {
      wire.offset2D(-20);
    } catch {
      // expected
    }
    del(wire, sketch, drawing);
  },
  "Finder.find({ unique }) that fails": () => {
    const b = box();
    const finder = new r.EdgeFinder().inDirection("Z");
    try {
      finder.find(b, { unique: true });
    } catch {
      // expected
    }
    del(finder, b);
  },
  "shape.findEdge that fails": () => {
    const b = box();
    try {
      b.findEdge((e: any) => e.inDirection("Z"));
    } catch {
      // expected
    }
    del(b);
  },
  "sketch.extrudeUntil that fails": () => {
    // The limit misses part of the profile: the sketch is retained.
    const [limit, dropLimit] = planarLimit(2, 20);
    const drawing = r.drawRectangle(4, 4);
    const sketch = drawing.sketchOnPlane("XY", 5);
    try {
      sketch.extrudeUntil(limit);
    } catch {
      // expected
    }
    del(sketch, drawing);
    dropLimit();
  },
  "sketches.extrudeUntil whose compound fails": () => {
    // Both extrusions succeed (and consume their sketches); building the
    // compound from them then fails on the second solid.
    const [limit, dropLimit] = planarLimit(40, 20);
    const square = r.drawRectangle(4, 4);
    const left = square.translate(-5, 0);
    const right = square.translate(5, 0);
    const drawing = left.fuse(right);
    const sketches = drawing.sketchOnPlane("XY", 5);
    const builder = (getOC() as any).TopoDS_Builder.prototype;
    const add = builder.Add;
    let calls = 0;
    builder.Add = function (this: unknown, ...args: unknown[]) {
      calls += 1;
      if (calls === 2) throw new Error("injected compound failure");
      return add.apply(this, args);
    };
    try {
      sketches.extrudeUntil(limit);
    } catch {
      // expected
    } finally {
      builder.Add = add;
    }
    del(sketches.sketches, drawing, left, right, square);
    dropLimit();
  },
};

describe("T4 throw paths: a failed operation leaves no handle behind", () => {
  for (const [name, operation] of Object.entries(throwCases)) {
    test(name, () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      let threw = 0;
      const counting = () => {
        try {
          operation();
        } catch {
          threw += 1;
        }
      };
      try {
        const before = ledger.stats().doubleDeletes;
        const leaks = leaksOf(counting);
        if (leaks.length > 0)
          throw new Error(`Leaked handles:\n${leaks.join("\n")}`);
        expect(threw).toBe(0);
        expect(ledger.stats().doubleDeletes - before, "double deletes").toBe(0);
      } finally {
        errors.mockRestore();
      }
    });
  }
});

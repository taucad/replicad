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
import { beforeAll, describe, expect, test } from "vitest";
import * as replicad from "../../src/index";
import { getOC } from "../../src/index";
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
  "sketch.extrude": () =>
    del(r.drawRectangle(10, 5).sketchOnPlane("XY").extrude(5)),
  "sketch.revolve": () =>
    del(r.drawRectangle(4, 5).translate(5, 0).sketchOnPlane("XZ").revolve()),
  "sketchCircle.loftWith": () =>
    del(r.sketchCircle(5).loftWith(r.sketchCircle(3, { origin: 10 }))),
  "drawRoundedRectangle.extrude": () =>
    del(r.drawRoundedRectangle(20, 10, 2).sketchOnPlane().extrude(5)),
  "drawPolysides.extrude": () =>
    del(r.drawPolysides(10, 6).sketchOnPlane().extrude(5)),
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
  "serialize/deserialize": () => {
    const b = box();
    del(r.deserializeShape(b.serialize()), b);
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

import { makePlane } from "../geomHelpers";
import {
  curvesAsEdgesOnFace,
  curvesAsEdgesOnPlane,
  curvesBoundingBox,
  transformCurvesWith,
  mirrorTransform2d,
  rotateTransform2d,
  ScaleMode,
  stretchTransform2d,
  scaleTransform2d,
  translationTransform2d,
} from "../curves";
import {
  adaptedCurveToPathElem,
  make2dSegmentCurve,
  Point2D,
  BoundingBox2d,
  Curve2D,
  samePoint,
  isPoint2D,
  approximateAsSvgCompatibleCurve,
} from "../lib2d";
import { assembleWire } from "../shapeHelpers";
import { AnyShape, cast, Face } from "../shapes";
import Sketch from "../sketches/Sketch";

import { getOC } from "../oclib.js";
import { Plane, PlaneName, Point } from "../geom";
import { DEG2RAD } from "../constants";
import { DrawingInterface } from "./lib";
import round5 from "../utils/round5";
import { asSVG, viewbox } from "./svg";
import { ocScope } from "../register";
import { getSingleFace, SingleFace } from "../finders";

/**
 * A Blueprint is an abstract Sketch, a 2D set of curves that can then be
 * sketched on different surfaces (faces or planes)
 *
 * You should create them by "sketching" with a `BlueprintSketcher`
 */
export default class Blueprint implements DrawingInterface {
  curves: Curve2D[];
  protected _boundingBox: null | BoundingBox2d;
  private _orientation: null | "clockwise" | "counterClockwise";
  private _guessedOrientation: null | "clockwise" | "counterClockwise";
  constructor(curves: Curve2D[]) {
    this.curves = curves;
    this._boundingBox = null;

    this._orientation = null;
    this._guessedOrientation = null;
  }

  delete() {
    this.curves.forEach((c) => c.delete());
    if (this._boundingBox) this._boundingBox.delete();
    this._boundingBox = null;
  }

  /** A copy with its own curves: deleting one leaves the other intact. */
  clone() {
    return new Blueprint(this.curves.map((curve) => curve.clone()));
  }

  get repr() {
    return ["Blueprint", ...this.curves.map((c) => c.repr)].join("\n");
  }

  get boundingBox(): BoundingBox2d {
    if (!this._boundingBox) {
      this._boundingBox = curvesBoundingBox(this.curves);
    }
    return this._boundingBox;
  }

  get orientation(): "clockwise" | "counterClockwise" {
    if (this._orientation) return this._orientation;
    if (this._guessedOrientation) return this._guessedOrientation;

    const vertices = this.curves.flatMap((c) => {
      if (c.geomType !== "LINE") {
        // We just go with a simple approximation here, we should use some extrema
        // points instead, but this is quick (and good enough for now)
        return [c.firstPoint, c.value(0.5)];
      }
      return [c.firstPoint];
    });

    const approximateArea = vertices
      .map((v1, i) => {
        const v2 = vertices[(i + 1) % vertices.length];
        return (v2[0] - v1[0]) * (v2[1] + v1[1]);
      })
      .reduce((a, b) => a + b, 0);

    this._guessedOrientation =
      approximateArea > 0 ? "clockwise" : "counterClockwise";
    return this._guessedOrientation;
  }

  stretch(
    ratio: number,
    direction: Point2D,
    origin: Point2D = [0, 0]
  ): Blueprint {
    const curves = transformCurvesWith(
      stretchTransform2d(ratio, direction, origin),
      this.curves
    );
    return new Blueprint(curves);
  }

  scale(scaleFactor: number, center?: Point2D): Blueprint {
    const centerPoint = center || this.boundingBox.center;
    const curves = transformCurvesWith(
      scaleTransform2d(scaleFactor, centerPoint),
      this.curves
    );
    return new Blueprint(curves);
  }

  rotate(angle: number, center?: Point2D): Blueprint {
    const curves = transformCurvesWith(
      rotateTransform2d(angle * DEG2RAD, center),
      this.curves
    );
    return new Blueprint(curves);
  }

  translate(xDist: number, yDist: number): Blueprint;
  translate(translationVector: Point2D): Blueprint;
  translate(xDistOrPoint: number | Point2D, yDist = 0): Blueprint {
    const translationVector = isPoint2D(xDistOrPoint)
      ? xDistOrPoint
      : ([xDistOrPoint, yDist] as Point2D);
    const curves = transformCurvesWith(
      translationTransform2d(translationVector),
      this.curves
    );
    return new Blueprint(curves);
  }

  mirror(
    centerOrDirection: Point2D,
    origin: Point2D = [0, 0],
    mode: "center" | "plane" = "center"
  ): Blueprint {
    const curves = transformCurvesWith(
      mirrorTransform2d(centerOrDirection, origin, mode),
      this.curves
    );
    return new Blueprint(curves);
  }

  sketchOnPlane(
    inputPlane?: PlaneName | Plane,
    origin?: Point | number
  ): Sketch {
    const plane =
      inputPlane instanceof Plane
        ? makePlane(inputPlane)
        : makePlane(inputPlane, origin);

    try {
      const edges = curvesAsEdgesOnPlane(this.curves, plane);
      let wire;
      try {
        wire = assembleWire(edges);
      } finally {
        edges.forEach((edge) => edge.delete());
      }

      return new Sketch(wire, {
        defaultOrigin: plane.origin,
        defaultDirection: plane.zDir,
      });
    } finally {
      plane.delete();
    }
  }

  sketchOnFace(face: Face, scaleMode?: ScaleMode): Sketch {
    const oc = getOC();

    const edges = curvesAsEdgesOnFace(this.curves, face, scaleMode);
    let wire;
    try {
      wire = assembleWire(edges);
    } finally {
      edges.forEach((edge) => edge.delete());
    }

    oc.BRepLib.BuildCurves3d(wire.wrapped);

    const wireFixer = new oc.ShapeFix_Wire(wire.wrapped, face.wrapped, 1e-9);
    wireFixer.FixEdgeCurves();
    wireFixer.delete();

    const sketch = new Sketch(wire);

    // The setters keep copies of the vectors they are given.
    const r = ocScope();
    try {
      if (wire.isClosed) {
        const outline = r(sketch.clone());
        const baseFace = r(outline.face());
        sketch.defaultOrigin = r(baseFace.pointOnSurface(0.5, 0.5));
        sketch.defaultDirection = r(baseFace.normalAt());
        if (baseFace.orientation !== face.orientation) {
          sketch.defaultDirection = r(sketch.defaultDirection.multiply(-1));
        }
        sketch.baseFace = face;
      } else {
        const startPoint = r(wire.startPoint);
        sketch.defaultOrigin = startPoint;
        sketch.defaultDirection = r(face.normalAt(startPoint));
        sketch.baseFace = face;
      }
    } finally {
      r.dispose();
    }
    return sketch;
  }

  subFace(face: Face, origin?: Point | null): Face {
    const r = ocScope();
    try {
      const center = origin || r(face.center);
      const moved = r(this.translate(face.uvCoordinates(center)));
      const sketch = r(moved.sketchOnFace(face, "original"));
      const subFace = sketch.face();

      if (subFace.orientation !== face.orientation) {
        r(subFace);
        return subFace.flipOrientation();
      }
      return subFace;
    } finally {
      r.dispose();
    }
  }

  punchHole(
    shape: AnyShape,
    face: SingleFace,
    {
      height = null,
      origin = null,
      draftAngle = 0,
    }: {
      height?: number | null;
      origin?: Point | null;
      draftAngle?: number;
    } = {}
  ) {
    const oc = getOC();
    const gc = ocScope();
    try {
      const foundFace = getSingleFace(face, shape);
      // A face the caller gave stays theirs; one a finder found is ours.
      if (foundFace !== face) gc(foundFace);
      const hole = gc(this.subFace(foundFace, origin));

      const maker = gc(
        new oc.BRepFeat_MakeDPrism(
          shape.wrapped,
          hole.wrapped,
          foundFace.wrapped,
          draftAngle * DEG2RAD,
          0,
          false
        )
      );
      if (height) {
        maker.Perform(height);
      } else {
        maker.PerformThruAll();
      }
      return cast(maker.Shape());
    } finally {
      gc.dispose();
    }
  }

  toSVGPathD() {
    const r = ocScope();
    try {
      // mirror returns new curves; this blueprint is left untouched.
      const bp = r(this.mirror([1, 0], [0, 0], "plane"));

      const compatibleCurves = approximateAsSvgCompatibleCurve(bp.curves);
      const mirrored = new Set(bp.curves);
      compatibleCurves.forEach((curve) => {
        if (!mirrored.has(curve)) r(curve);
      });

      const path = compatibleCurves.flatMap((c) => {
        return adaptedCurveToPathElem(r(c.adaptor()), c.lastPoint);
      });

      const [startX, startY] = bp.curves[0].firstPoint;
      return `M ${round5(startX)} ${round5(startY)} ${path.join(" ")}${
        bp.isClosed() ? " Z" : ""
      }`;
    } finally {
      r.dispose();
    }
  }

  toSVGPath() {
    return `<path d="${this.toSVGPathD()}" />`;
  }

  toSVGViewBox(margin = 1) {
    return viewbox(this.boundingBox, margin);
  }

  toSVGPaths() {
    return [this.toSVGPathD()];
  }

  toSVG(margin = 1) {
    return asSVG(this.toSVGPath(), this.boundingBox, margin);
  }

  get firstPoint(): Point2D {
    return this.curves[0].firstPoint;
  }

  get lastPoint(): Point2D {
    return this.curves[this.curves.length - 1].lastPoint;
  }

  isInside(point: Point2D): boolean {
    if (!this.boundingBox.containsPoint(point)) return false;

    const oc = getOC();
    const intersector = new oc.Geom2dAPI_InterCurveCurve();
    const segment = make2dSegmentCurve(point, this.boundingBox.outsidePoint());
    try {
      let crossCounts = 0;

      const onCurve = this.curves.find((c) => c.isOnCurve(point));
      if (onCurve) return false;

      this.curves.forEach((c) => {
        if (c.boundingBox.isOut(segment.boundingBox)) return;
        intersector.Init(segment.wrapped, c.wrapped, 1e-9);
        crossCounts += intersector.NbPoints();
      });

      return !!(crossCounts % 2);
    } finally {
      intersector.delete();
      segment.delete();
    }
  }

  isClosed() {
    return samePoint(this.firstPoint, this.lastPoint);
  }

  intersects(other: Blueprint) {
    if (this.boundingBox.isOut(other.boundingBox)) return false;

    const oc = getOC();
    const intersector = new oc.Geom2dAPI_InterCurveCurve();
    try {
      for (const myCurve of this.curves) {
        for (const otherCurve of other.curves) {
          if (myCurve.boundingBox.isOut(otherCurve.boundingBox)) continue;

          intersector.Init(myCurve.wrapped, otherCurve.wrapped, 1e-9);
          if (intersector.NbPoints() || intersector.NbSegments()) return true;
        }
      }
      return false;
    } finally {
      intersector.delete();
    }
  }
}

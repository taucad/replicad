import { Vector, Plane, Point } from "../geom.js";
import { ocScope, type OcScope } from "../register.js";
import { makeFace, makeNewFaceWithinFace } from "../shapeHelpers.js";
import {
  basicFaceExtrusion,
  complexExtrude,
  twistExtrude,
  revolution,
  genericSweep,
  loft,
  ExtrusionProfile,
  GenericSweepConfig,
  LoftConfig,
} from "../addThickness.js";
import { Face, Shape3D, Wire } from "../shapes.js";
import { SketchInterface } from "./lib.js";
import { _runStep, _stepWanted, _userCallback } from "../operationCacheHook";

/**
 * A line drawing to be acted upon. It defines directions to be acted upon by
 * definition (extrusion direction for instance).
 *
 * Note that all operations will delete the sketch
 *
 * @category Sketching
 */
export default class Sketch implements SketchInterface {
  wire: Wire;
  /**
   * @ignore
   */
  // @ts-expect-error initialised indirectly
  _defaultOrigin: Vector;
  /**
   * @ignore
   */
  // @ts-expect-error initialised indirectly
  _defaultDirection: Vector;
  protected _baseFace?: Face | null;
  constructor(
    wire: Wire,
    {
      defaultOrigin = [0, 0, 0],
      defaultDirection = [0, 0, 1],
    }: {
      defaultOrigin?: Point;
      defaultDirection?: Point;
    } = {}
  ) {
    this.wire = wire;
    this.defaultOrigin = defaultOrigin;
    this.defaultDirection = defaultDirection;
    this.baseFace = null;
  }

  get baseFace(): Face | null | undefined {
    return this._baseFace;
  }

  /** Keeps a copy of `newFace`; the previous base face is deleted. */
  set baseFace(newFace: Face | null | undefined) {
    const previous = this._baseFace;
    if (!newFace) this._baseFace = newFace;
    else this._baseFace = newFace.clone();
    if (previous && previous !== this._baseFace) previous.delete();
  }

  delete(): void {
    this.wire.delete();
    this._defaultOrigin.delete();
    this._defaultDirection.delete();
    this.baseFace && this.baseFace.delete();
  }

  clone(): Sketch {
    const sketch = new Sketch(this.wire.clone(), {
      defaultOrigin: this.defaultOrigin,
      defaultDirection: this.defaultDirection,
    });
    if (this.baseFace) sketch.baseFace = this.baseFace;
    return sketch;
  }

  get defaultOrigin(): Vector {
    return this._defaultOrigin;
  }

  /** Keeps a copy of `newOrigin`; the previous origin is deleted. */
  set defaultOrigin(newOrigin: Point) {
    const previous = this._defaultOrigin;
    this._defaultOrigin = new Vector(newOrigin);
    previous?.delete();
  }

  get defaultDirection(): Vector {
    return this._defaultDirection;
  }

  /** Keeps a copy of `newDirection`; the previous direction is deleted. */
  set defaultDirection(newDirection: Point) {
    const previous = this._defaultDirection;
    this._defaultDirection = new Vector(newDirection);
    previous?.delete();
  }

  /**
   * Transforms the lines into a face. The lines should be closed.
   */
  face(): Face {
    let face;
    if (!this.baseFace) {
      face = makeFace(this.wire);
    } else {
      face = makeNewFaceWithinFace(this.baseFace, this.wire);
    }
    return face;
  }

  wires(): Wire {
    return this.wire.clone();
  }

  faces(): Face {
    return this.face();
  }

  /**
   * Revolves the drawing on an axis (defined by its direction and an origin
   * (defaults to the sketch origin)
   */
  revolve(
    revolutionAxis?: Point,
    { origin, angle }: { origin?: Point; angle?: number } = {}
  ): Shape3D {
    const face = makeFace(this.wire);
    const solid = revolution(
      face,
      origin || this.defaultOrigin,
      revolutionAxis,
      angle
    );
    face.delete();
    this.delete();
    return solid;
  }

  /** Extrudes the sketch to a certain distance.(along the default direction
   * and origin of the sketch).
   *
   * You can define another extrusion direction or origin,
   *
   * It is also possible to twist extrude with an angle (in degrees), or to
   * give a profile to the extrusion (the endFactor will scale the face, and
   * the profile will define how the scale is applied (either linarly or with
   * a s-shape).
   */
  extrude(
    extrusionDistance: number,
    {
      extrusionDirection,
      extrusionProfile,
      twistAngle,
      origin,
    }: {
      extrusionDirection?: Point;
      extrusionProfile?: ExtrusionProfile;
      twistAngle?: number;
      origin?: Point;
    } = {}
  ): Shape3D {
    const r = ocScope();
    try {
      const extrusionVec = r(
        r(
          r(new Vector(extrusionDirection || this.defaultDirection)).normalized()
        ).multiply(extrusionDistance)
      );

      if (extrusionProfile && !twistAngle) {
        const solid = complexExtrude(
          this.wire,
          origin || this.defaultOrigin,
          extrusionVec,
          extrusionProfile
        );
        this.delete();
        return solid;
      }

      if (twistAngle) {
        const solid = twistExtrude(
          this.wire,
          twistAngle,
          origin || this.defaultOrigin,
          extrusionVec,
          extrusionProfile
        );
        this.delete();
        return solid;
      }

      const face = r(makeFace(this.wire));
      const solid = basicFaceExtrusion(face, extrusionVec);
      this.delete();
      return solid;
    } finally {
      r.dispose();
    }
  }

  /**
   * Sweep along this sketch another sketch defined in the function
   * `sketchOnPlane`.
   *
   * TODO: clean the interface of the sweep config to make it more
   * understandable.
   */
  sweepSketch(
    sketchOnPlane: (plane: Plane, origin: Point) => this,
    sweepConfig: GenericSweepConfig = {}
  ): Shape3D {
    const r = ocScope();
    try {
      return this._sweepSketch(r, sketchOnPlane, sweepConfig);
    } finally {
      r.dispose();
    }
  }

  private _sweepSketch(
    r: OcScope,
    sketchOnPlane: (plane: Plane, origin: Point) => this,
    sweepConfig: GenericSweepConfig
  ): Shape3D {
    const startPoint = r(this.wire.startPoint);
    const normal = r(r(this.wire.tangentAt(1e-9)).multiply(-1)).normalize();
    const xDir = r(r(normal.cross(this.defaultDirection)).multiply(-1));

    const stepWanted = _stepWanted();
    const makeSketch = () =>
      sketchOnPlane(r(new Plane(startPoint, xDir, normal)), startPoint);
    // The factory is user code: what it calls is routed as user calls. The
    // sweep consumes the sketch it returns.
    const sketch = r(stepWanted ? _userCallback(makeSketch) : makeSketch());

    const config: GenericSweepConfig = {
      forceProfileSpineOthogonality: true,
      ...sweepConfig,
    };
    if (this.baseFace) {
      config.support = this.baseFace.wrapped;
    }
    const sweep = () => {
      const shape = genericSweep(sketch.wire, this.wire, config);
      this.delete();
      return shape;
    };
    if (!stepWanted) return sweep();
    // Keyed on the sketch the factory returned, not on the factory itself.
    return _runStep({
      op: "Sketch.sweepSketch",
      receiver: this,
      values: () => [sketch, sweepConfig, this.baseFace ?? null],
      compute: sweep,
      consume: () => this.delete(),
    });
  }

  /** Loft between this sketch and another sketch (or an array of them)
   *
   * You can also define a `startPoint` for the loft (that will be placed
   * before this sketch) and an `endPoint` after the last one.
   *
   * You can also define if you want the loft to result in a ruled surface.
   *
   * Note that all sketches will be deleted by this operation
   */
  loftWith(
    otherSketches: this | this[],
    loftConfig: LoftConfig = {},
    returnShell = false
  ): Shape3D {
    const sketchArray = Array.isArray(otherSketches)
      ? [this, ...otherSketches]
      : [this, otherSketches];
    const shape = loft(
      sketchArray.map((s) => s.wire),
      loftConfig,
      returnShell
    );

    sketchArray.forEach((s) => s.delete());
    return shape;
  }
}

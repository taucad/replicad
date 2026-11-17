import { WrappingObj, ocScope } from "./register.js";
import { DEG2RAD, RAD2DEG } from "./constants.js";
import { getOC } from "./oclib.js";

import type {
  gp_Ax1,
  gp_Ax2,
  gp_Ax3,
  gp_Vec,
  gp_XYZ,
  gp_Dir,
  gp_Pnt,
  gp_Pln,
  OpenCascadeInstance,
  gp_Trsf,
  TopoDS_Shape,
  Bnd_Box,
} from "replicad-opencascadejs";

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type SimplePoint = [number, number, number];
export type Point =
  | SimplePoint
  | Vector
  | [number, number]
  | { XYZ: () => gp_XYZ; delete: () => void };

export function isPoint(p: unknown): p is Point {
  if (Array.isArray(p)) return p.length === 3 || p.length === 2;
  else if (p instanceof Vector) return true;
  else if (p && typeof (p as any)?.XYZ === "function") return true;
  return false;
}

export const makeAx3 = (
  center: Point,
  dir: Direction,
  xDir?: Direction
): gp_Ax3 => {
  const oc = getOC();
  const origin = asPnt(center);
  const direction = asDir(dir);

  let axis: gp_Ax3;
  if (xDir) {
    const xDirection = asDir(xDir);
    axis = new oc.gp_Ax3(origin, direction, xDirection);
    xDirection.delete();
  } else {
    axis = new oc.gp_Ax3(origin, direction);
  }
  origin.delete();
  direction.delete();
  return axis;
};

export function makePln(origin: Point, dir: Direction): gp_Pln {
  const orig = asPnt(origin);
  const direction = asDir(dir);

  const oc = getOC();
  const pln = new oc.gp_Pln(orig, direction);

  orig.delete();
  direction.delete();

  return pln;
}

export const makeAx2 = (
  center: Point,
  dir: Direction,
  xDir?: Direction
): gp_Ax2 => {
  const oc = getOC();
  const origin = asPnt(center);
  const direction = asDir(dir);

  let axis: gp_Ax2;
  if (xDir) {
    const xDirection = asDir(xDir);
    axis = new oc.gp_Ax2(origin, direction, xDirection);
    xDirection.delete();
  } else {
    axis = new oc.gp_Ax2(origin, direction);
  }
  origin.delete();
  direction.delete();
  return axis;
};

export const makeAx1 = (center: Point, dir: Direction): gp_Ax1 => {
  const oc = getOC();
  const origin = asPnt(center);
  const direction = asDir(dir);
  const axis = new oc.gp_Ax1(origin, direction);
  origin.delete();
  direction.delete();
  return axis;
};

/** The coordinates of a point given in any accepted form. */
const coordinatesOf = (point: Point): SimplePoint => {
  if (Array.isArray(point)) {
    if (point.length === 3) return [point[0], point[1], point[2]];
    if (point.length === 2) return [point[0], point[1], 0];
  } else if (point instanceof Vector) {
    return point.toTuple();
  } else if (typeof point.XYZ === "function") {
    const xyz = point.XYZ();
    try {
      return [xyz.X(), xyz.Y(), xyz.Z()];
    } finally {
      xyz.delete();
    }
  }
  return [0, 0, 0];
};

const wrappedAccessor = Object.getOwnPropertyDescriptor(
  WrappingObj.prototype,
  "wrapped"
)!;

/**
 * A 3D vector. Its coordinates and arithmetic are plain JavaScript numbers,
 * computed with the same operations, in the same order, as OpenCascade's
 * `gp_Vec`, so the results are the same to the bit. Rotations, angles and
 * comparisons still run in OpenCascade.
 *
 * `wrapped` creates a `gp_Vec` the first time OpenCascade code needs one; the
 * vector owns it and deletes it with itself (or when its coordinates
 * change). Change a vector through its methods, not through `wrapped`.
 */
export class Vector extends WrappingObj<gp_Vec> {
  private _x: number;
  private _y: number;
  private _z: number;
  private _alive = true;

  /** A new vector holding a copy of `vector`'s coordinates. */
  constructor(vector: Point = [0, 0, 0]) {
    super(null as unknown as gp_Vec);
    [this._x, this._y, this._z] = coordinatesOf(vector);
  }

  private _check(): void {
    if (!this._alive) throw new Error("This object has been deleted");
  }

  /** Forgets the materialized `gp_Vec` after the coordinates changed. */
  private _changed(): void {
    wrappedAccessor.set!.call(this, null);
  }

  private _set(x: number, y: number, z: number): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._changed();
    return this;
  }

  /** A temporary `gp_Vec` for an OpenCascade computation. */
  private _vec(): gp_Vec {
    return new this.oc.gp_Vec(this._x, this._y, this._z);
  }

  get wrapped(): gp_Vec {
    this._check();
    const vec = (this as unknown as { _wrapped: gp_Vec | null })._wrapped;
    if (vec) return vec;
    const created = this._vec();
    wrappedAccessor.set!.call(this, created);
    return created;
  }

  set wrapped(newWrapped: gp_Vec) {
    this._check();
    const [x, y, z] = [newWrapped.X(), newWrapped.Y(), newWrapped.Z()];
    wrappedAccessor.set!.call(this, newWrapped);
    this._x = x;
    this._y = y;
    this._z = z;
  }

  delete(): void {
    this._alive = false;
    super.delete();
  }

  get repr(): string {
    return `x: ${round3(this.x)}, y: ${round3(this.y)}, z: ${round3(this.z)}`;
  }

  get x(): number {
    this._check();
    return this._x;
  }

  get y(): number {
    this._check();
    return this._y;
  }

  get z(): number {
    this._check();
    return this._z;
  }

  /** As `gp_Vec::Magnitude`. */
  get Length(): number {
    this._check();
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z);
  }

  toTuple(): [number, number, number] {
    this._check();
    return [this._x, this._y, this._z];
  }

  /** As `gp_Vec::Crossed`. */
  cross(v: Vector): Vector {
    const [x, y, z] = this.toTuple();
    const [vx, vy, vz] = v.toTuple();
    return new Vector([y * vz - z * vy, z * vx - x * vz, x * vy - y * vx]);
  }

  /** As `gp_Vec::Dot`. */
  dot(v: Vector): number {
    const [x, y, z] = this.toTuple();
    const [vx, vy, vz] = v.toTuple();
    return x * vx + y * vy + z * vz;
  }

  sub(v: Vector): Vector {
    const [x, y, z] = this.toTuple();
    const [vx, vy, vz] = v.toTuple();
    return new Vector([x - vx, y - vy, z - vz]);
  }

  add(v: Vector): Vector {
    const [x, y, z] = this.toTuple();
    const [vx, vy, vz] = v.toTuple();
    return new Vector([x + vx, y + vy, z + vz]);
  }

  multiply(scale: number): Vector {
    const [x, y, z] = this.toTuple();
    return new Vector([x * scale, y * scale, z * scale]);
  }

  /** As `gp_Vec::Normalized`: each coordinate divided by the magnitude. */
  normalized(): Vector {
    const length = this._normalizingLength();
    return new Vector([this._x / length, this._y / length, this._z / length]);
  }

  /** As `gp_Vec::Normalize`. */
  normalize(): Vector {
    const length = this._normalizingLength();
    return this._set(this._x / length, this._y / length, this._z / length);
  }

  private _normalizingLength(): number {
    const length = this.Length;
    // gp::Resolution() (the smallest normal double), at or below which
    // OpenCascade refuses to normalize.
    if (length <= 2 ** -1022)
      throw new Error("Cannot normalize a vector with a zero norm");
    return length;
  }

  getCenter(): Vector {
    return this;
  }

  getAngle(v: Vector): number {
    const [a, b] = [this._vec(), v._vec()];
    try {
      return a.Angle(b) * RAD2DEG;
    } finally {
      a.delete();
      b.delete();
    }
  }

  projectToPlane(plane: Plane): Vector {
    const base = plane.origin;
    const normal = plane.zDir;

    const v1 = this.sub(base);

    const v2 = normal.multiply(v1.dot(normal) / normal.Length ** 2);
    const projection = this.sub(v2);

    v1.delete();
    v2.delete();

    return projection;
  }

  equals(other: Vector): boolean {
    this._check();
    const [a, b] = [this._vec(), other._vec()];
    try {
      return a.IsEqual(b, 0.00001, 0.00001);
    } finally {
      a.delete();
      b.delete();
    }
  }

  toPnt(): gp_Pnt {
    this._check();
    return new this.oc.gp_Pnt(this._x, this._y, this._z);
  }

  toDir(): gp_Dir {
    this._check();
    return new this.oc.gp_Dir(this._x, this._y, this._z);
  }

  rotate(
    angle: number,
    center: Point = [0, 0, 0],
    direction: Direction = [0, 0, 1]
  ): Vector {
    this._check();
    const ax = makeAx1(center, direction);
    const vec = this._vec();
    try {
      vec.Rotate(ax, angle * DEG2RAD);
      return this._set(vec.X(), vec.Y(), vec.Z());
    } finally {
      vec.delete();
      ax.delete();
    }
  }
}

export const AXIS_NAMES = ["X", "Y", "Z", "-X", "-Y", "-Z"] as const;
export type AxisName = (typeof AXIS_NAMES)[number];

/** A vector-like point or a named principal axis. */
export type Direction = Point | AxisName;

const DIRECTIONS: Record<AxisName, SimplePoint> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
  "-X": [-1, 0, 0],
  "-Y": [0, -1, 0],
  "-Z": [0, 0, -1],
};

export function resolveDirection(direction: Direction): Point {
  if (typeof direction !== "string") return direction;

  const resolved = DIRECTIONS[direction];
  if (!resolved) {
    throw new Error(
      `Invalid direction "${direction}". Expected one of: ${AXIS_NAMES.join(
        ", "
      )}.`
    );
  }
  return resolved;
}

// Compatibility alias for the original public helper.
export const makeDirection = resolveDirection;

export function makeDirVector(direction: Direction): Vector {
  return new Vector(resolveDirection(direction));
}

export function asPnt(coords: Point): gp_Pnt {
  return new (getOC().gp_Pnt)(...coordinatesOf(coords));
}

export function asDir(direction: Direction): gp_Dir {
  return new (getOC().gp_Dir)(...coordinatesOf(resolveDirection(direction)));
}

type CoordSystem =
  | "reference"
  | { origin: Point; zDir: Direction; xDir: Direction };

export class Transformation extends WrappingObj<gp_Trsf> {
  constructor(transform?: gp_Trsf) {
    const oc = getOC();
    super(transform || new oc.gp_Trsf());
  }

  clone() {
    const clone = this.wrapped.Inverted();
    clone.Invert();
    return new Transformation(clone);
  }

  translate(xDist: number, yDist: number, zDist: number): Transformation;
  translate(vector: Point): Transformation;
  translate(
    xDistOrVector: number | Point,
    yDist = 0,
    zDist = 0
  ): Transformation {
    const translation = new Vector(
      typeof xDistOrVector === "number"
        ? [xDistOrVector, yDist, zDist]
        : xDistOrVector
    );

    try {
      this.wrapped.SetTranslation(translation.wrapped);
    } finally {
      translation.delete();
    }

    return this;
  }

  rotate(
    angle: number,
    position: Point = [0, 0, 0],
    direction: Direction = [0, 0, 1]
  ): Transformation {
    const dir = asDir(direction);
    const origin = asPnt(position);
    const axis = new this.oc.gp_Ax1(origin, dir);

    this.wrapped.SetRotation(axis, angle * DEG2RAD);
    axis.delete();
    dir.delete();
    origin.delete();

    return this;
  }

  mirror(
    inputPlane: Plane | PlaneName | Point = "YZ",
    inputOrigin?: Point
  ): this {
    const r = ocScope();
    try {
      let origin: Point;
      let direction: Point;

      if (typeof inputPlane === "string") {
        const plane = r(createNamedPlane(inputPlane, inputOrigin));
        origin = plane.origin;
        direction = plane.zDir;
      } else if (inputPlane instanceof Plane) {
        origin = inputOrigin || inputPlane.origin;
        direction = inputPlane.zDir;
      } else {
        origin = inputOrigin || [0, 0, 0];
        direction = inputPlane;
      }

      const mirrorAxis = r(makeAx2(origin, direction));
      this.wrapped.SetMirror(mirrorAxis);
    } finally {
      r.dispose();
    }

    return this;
  }

  scale(center: Point, scale: number): this {
    const pnt = asPnt(center);
    this.wrapped.SetScale(pnt, scale);
    pnt.delete();
    return this;
  }

  inverse(): this {
    this.wrapped.Invert();
    return this;
  }

  inverted(): Transformation {
    return new Transformation(this.wrapped.Inverted());
  }

  coordSystemChange(fromSystem: CoordSystem, toSystem: CoordSystem): this {
    const r = ocScope();
    try {
      const fromAx = r(
        fromSystem === "reference"
          ? new this.oc.gp_Ax3()
          : makeAx3(fromSystem.origin, fromSystem.zDir, fromSystem.xDir)
      );

      const toAx = r(
        toSystem === "reference"
          ? new this.oc.gp_Ax3()
          : makeAx3(toSystem.origin, toSystem.zDir, toSystem.xDir)
      );
      this.wrapped.SetTransformation(fromAx, toAx);
    } finally {
      r.dispose();
    }
    return this;
  }

  transformPoint(point: Point): gp_Pnt {
    const pnt = asPnt(point);
    const newPoint = pnt.Transformed(this.wrapped);
    pnt.delete();
    return newPoint;
  }

  transform(shape: TopoDS_Shape): TopoDS_Shape {
    // Rigid transformations only move the shape location (no geometry copy),
    // so the result keeps sharing its TShape with the source. Scaling and
    // mirroring still rebuild the geometry.
    const transformer = new this.oc.BRepBuilderAPI_Transform(
      shape,
      this.wrapped,
      false,
      false
    );
    const transformed = transformer.Shape();
    transformer.delete();
    return transformed;
  }
}

export class Plane {
  oc: OpenCascadeInstance;

  xDir: Vector;
  yDir: Vector;
  zDir: Vector;

  // @ts-expect-error initialised indirectly
  private _origin: Vector;
  // @ts-expect-error initialised indirectly
  private localToGlobal: Transformation;
  // @ts-expect-error initialised indirectly
  private globalToLocal: Transformation;

  constructor(
    origin: Point,
    xDirection: Direction | null = null,
    normal: Direction = [0, 0, 1]
  ) {
    this.oc = getOC();

    const zDir = makeDirVector(normal);
    if (zDir.Length === 0) {
      throw new Error("normal should be non null");
    }
    this.zDir = zDir.normalize();

    let xDir: Vector;
    if (!xDirection) {
      const ax3 = makeAx3(origin, this.zDir);
      const defaultXDirection = ax3.XDirection();
      xDir = makeDirVector(defaultXDirection);
      defaultXDirection.delete();
      ax3.delete();
    } else {
      xDir = makeDirVector(xDirection);
    }

    if (xDir.Length === 0) {
      throw new Error("xDir should be non null");
    }

    this.xDir = xDir.normalize();
    this.yDir = this.zDir.cross(this.xDir).normalize();

    this.origin = new Vector(origin);
  }

  delete(): void {
    this.localToGlobal.delete();
    this.globalToLocal.delete();
    this.xDir.delete();
    this.yDir.delete();
    this.zDir.delete();
    this._origin.delete();
  }

  clone(): Plane {
    return new Plane(this.origin, this.xDir, this.zDir);
  }

  get origin(): Vector {
    return this._origin;
  }

  /** Takes ownership of `newOrigin`; the previous origin is deleted. */
  set origin(newOrigin: Vector) {
    const previous = this._origin;
    this._origin = newOrigin;
    if (previous && previous !== newOrigin) previous.delete();
    this._calcTransforms();
  }

  translateTo(point: Point): Plane {
    const newPlane = this.clone();
    newPlane.origin = new Vector(point);
    return newPlane;
  }

  translate(xDist: number, yDist: number, zDist: number): Plane;
  translate(vector: Point): Plane;
  translate(xDistOrVector: number | Point, yDist = 0, zDist = 0): Plane {
    const translation = new Vector(
      typeof xDistOrVector === "number"
        ? [xDistOrVector, yDist, zDist]
        : xDistOrVector
    );

    const origin = this.origin.add(translation);
    translation.delete();
    try {
      return this.translateTo(origin);
    } finally {
      origin.delete();
    }
  }

  translateX(xDist: number): Plane {
    return this.translate(xDist, 0, 0);
  }

  translateY(yDist: number): Plane {
    return this.translate(0, yDist, 0);
  }

  translateZ(zDist: number): Plane {
    return this.translate(0, 0, zDist);
  }

  pivot(angle: number, direction: Direction = [1, 0, 0]): Plane {
    const zDir = new Vector(this.zDir).rotate(angle, [0, 0, 0], direction);
    const xDir = new Vector(this.xDir).rotate(angle, [0, 0, 0], direction);

    try {
      return new Plane(this.origin, xDir, zDir);
    } finally {
      zDir.delete();
      xDir.delete();
    }
  }

  rotate2DAxes(angle: number): Plane {
    const xDir = new Vector(this.xDir).rotate(angle, [0, 0, 0], this.zDir);

    try {
      return new Plane(this.origin, xDir, this.zDir);
    } finally {
      xDir.delete();
    }
  }

  _calcTransforms(): void {
    this.globalToLocal?.delete();
    this.localToGlobal?.delete();
    this.globalToLocal = new Transformation();
    this.globalToLocal.coordSystemChange("reference", {
      origin: this.origin,
      zDir: this.zDir,
      xDir: this.xDir,
    });

    this.localToGlobal = new Transformation();
    this.localToGlobal.coordSystemChange(
      {
        origin: this.origin,
        zDir: this.zDir,
        xDir: this.xDir,
      },
      "reference"
    );
  }

  setOrigin2d(x: number, y: number): void {
    this.origin = this.toWorldCoords([x, y]);
  }

  toLocalCoords(vec: Vector): Vector {
    const pnt = this.globalToLocal.transformPoint(vec);
    const newVec = new Vector(pnt);
    pnt.delete();
    return newVec;
  }

  toWorldCoords(v: Point): Vector {
    const pnt = this.localToGlobal.transformPoint(v);
    const newVec = new Vector(pnt);
    pnt.delete();
    return newVec;
  }
}

export type PlaneName =
  | "XY"
  | "YZ"
  | "ZX"
  | "XZ"
  | "YX"
  | "ZY"
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

const PLANES_CONFIG: Record<
  PlaneName,
  {
    xDir: [number, number, number];
    normal: [number, number, number];
  }
> = {
  XY: {
    xDir: [1, 0, 0],
    normal: [0, 0, 1],
  },
  YZ: {
    xDir: [0, 1, 0],
    normal: [1, 0, 0],
  },
  ZX: {
    xDir: [0, 0, 1],
    normal: [0, 1, 0],
  },
  XZ: {
    xDir: [1, 0, 0],
    normal: [0, -1, 0],
  },
  YX: {
    xDir: [0, 1, 0],
    normal: [0, 0, -1],
  },
  ZY: {
    xDir: [0, 0, 1],
    normal: [-1, 0, 0],
  },
  front: {
    xDir: [1, 0, 0],
    normal: [0, 0, 1],
  },
  back: {
    xDir: [-1, 0, 0],
    normal: [0, 0, -1],
  },
  left: {
    xDir: [0, 0, 1],
    normal: [-1, 0, 0],
  },
  right: {
    xDir: [0, 0, -1],
    normal: [1, 0, 0],
  },
  top: {
    xDir: [1, 0, 0],
    normal: [0, 1, 0],
  },
  bottom: {
    xDir: [1, 0, 0],
    normal: [0, -1, 0],
  },
};

export const createNamedPlane = (
  plane: PlaneName,
  sourceOrigin: Point | number = [0, 0, 0]
): Plane => {
  const config = PLANES_CONFIG[plane];
  if (!config) throw new Error(`Could not find plane ${plane}`);

  let origin: Point;
  if (typeof sourceOrigin === "number") {
    origin = config.normal.map((v: number) => v * sourceOrigin) as Point;
  } else {
    origin = sourceOrigin;
  }
  return new Plane(origin, config.xDir, config.normal);
};

export class BoundingBox extends WrappingObj<Bnd_Box> {
  constructor(wrapped?: Bnd_Box) {
    const oc = getOC();
    let boundBox = wrapped;
    if (!boundBox) {
      boundBox = new oc.Bnd_Box();
    }
    super(boundBox);
  }

  static fromBounds(min: Point, max: Point): BoundingBox {
    const box = new BoundingBox();
    // @ts-expect-error oc typings don't include Bnd_Box::Update
    box.wrapped.Update(min[0], min[1], min[2], max[0], max[1], max[2]);
    return box;
  }

  get repr(): string {
    const [min, max] = this.bounds;
    const [low, high] = [new Vector(min), new Vector(max)];
    try {
      return `${low.repr} - ${high.repr}`;
    } finally {
      low.delete();
      high.delete();
    }
  }

  get bounds(): [SimplePoint, SimplePoint] {
    const cornerMin = this.wrapped.CornerMin();
    const cornerMax = this.wrapped.CornerMax();
    const result: [SimplePoint, SimplePoint] = [
      [cornerMin.X(), cornerMin.Y(), cornerMin.Z()],
      [cornerMax.X(), cornerMax.Y(), cornerMax.Z()],
    ];
    cornerMin.delete();
    cornerMax.delete();
    return result;
  }

  get center(): SimplePoint {
    const [[xmin, ymin, zmin], [xmax, ymax, zmax]] = this.bounds;
    return [
      xmin + (xmax - xmin) / 2,
      ymin + (ymax - ymin) / 2,
      zmin + (zmax - zmin) / 2,
    ];
  }

  get width(): number {
    const [[xmin], [xmax]] = this.bounds;
    return Math.abs(xmax - xmin);
  }

  get height(): number {
    const [[, ymin], [, ymax]] = this.bounds;
    return Math.abs(ymax - ymin);
  }

  get depth(): number {
    const [[, , zmin], [, , zmax]] = this.bounds;
    return Math.abs(zmax - zmin);
  }

  add(other: BoundingBox) {
    this.wrapped.Add(other.wrapped);
  }

  isOut(other: BoundingBox): boolean {
    return this.wrapped.IsOut(other.wrapped);
  }
}

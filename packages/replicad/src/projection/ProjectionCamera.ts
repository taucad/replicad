import type { gp_Ax2 } from "replicad-opencascadejs";
import {
  asDir,
  asPnt,
  Direction,
  makeAx2,
  makeDirVector,
  Point,
  Vector,
} from "../geom";
import type { BoundingBox } from "../geom";
import { WrappingObj } from "../register";
export type CubeFace = "front" | "back" | "top" | "bottom" | "left" | "right";
export type ProjectionPlane =
  | "XY"
  | "XZ"
  | "YZ"
  | "YX"
  | "ZX"
  | "ZY"
  | "front"
  | "back"
  | "top"
  | "bottom"
  | "left"
  | "right";

const PROJECTION_PLANES: Record<ProjectionPlane, { dir: Point; xAxis: Point }> =
  {
    XY: { dir: [0, 0, 1], xAxis: [1, 0, 0] },
    XZ: { dir: [0, -1, 0], xAxis: [1, 0, 0] },
    YZ: { dir: [1, 0, 0], xAxis: [0, 1, 0] },
    YX: { dir: [0, 0, -1], xAxis: [0, 1, 0] },
    ZX: { dir: [0, 1, 0], xAxis: [0, 0, 1] },
    ZY: { dir: [-1, 0, 0], xAxis: [0, 0, 1] },

    front: { dir: [0, -1, 0], xAxis: [1, 0, 0] },
    back: { dir: [0, 1, 0], xAxis: [-1, 0, 0] },
    right: { dir: [-1, 0, 0], xAxis: [0, -1, 0] },
    left: { dir: [1, 0, 0], xAxis: [0, 1, 0] },
    bottom: { dir: [0, 0, 1], xAxis: [1, 0, 0] },
    top: { dir: [0, 0, -1], xAxis: [1, 0, 0] },
  };

export function isProjectionPlane(plane: unknown): plane is ProjectionPlane {
  return typeof plane === "string" && plane in PROJECTION_PLANES;
}

export function lookFromPlane(projectionPlane: ProjectionPlane) {
  const { dir, xAxis } = PROJECTION_PLANES[projectionPlane];
  return new ProjectionCamera([0, 0, 0], dir, xAxis);
}

/** A Vector copied from an OpenCascade value the caller owns, then deleted. */
const takeVector = (value: { XYZ: () => any; delete: () => void }): Vector => {
  try {
    return new Vector(value);
  } finally {
    value.delete();
  }
};

function defaultXDir(direction: Direction) {
  const dir = makeDirVector(direction);
  let yAxis = new Vector([0, 0, 1]);
  let xAxis = yAxis.cross(dir);
  if (xAxis.Length === 0) {
    yAxis.delete();
    xAxis.delete();
    yAxis = new Vector([0, 1, 0]);
    xAxis = yAxis.cross(dir);
  }
  yAxis.delete();
  dir.delete();
  return xAxis.normalize();
}

export class ProjectionCamera extends WrappingObj<gp_Ax2> {
  constructor(
    position: Point = [0, 0, 0],
    direction: Direction = [0, 0, 1],
    xAxis?: Direction
  ) {
    const xDir = xAxis ? makeDirVector(xAxis) : defaultXDir(direction);
    let ax2;
    try {
      ax2 = makeAx2(position, direction, xDir);
    } finally {
      xDir.delete();
    }
    super(ax2);
  }

  get position() {
    return takeVector(this.wrapped.Location());
  }

  get direction() {
    return takeVector(this.wrapped.Direction());
  }

  get xAxis() {
    return takeVector(this.wrapped.XDirection());
  }

  get yAxis() {
    return takeVector(this.wrapped.YDirection());
  }

  autoAxes() {
    const direction = this.direction;
    const xAxis = defaultXDir(direction);
    const xDir = asDir(xAxis);
    this.wrapped.SetXDirection(xDir);
    xDir.delete();
    xAxis.delete();
    direction.delete();
  }

  setPosition(position: Point) {
    const pnt = asPnt(position);
    this.wrapped.SetLocation(pnt);
    pnt.delete();
    return this;
  }

  setXAxis(xAxis: Direction) {
    const dir = asDir(xAxis);
    this.wrapped.SetYDirection(dir);
    dir.delete();
    return this;
  }

  setYAxis(yAxis: Direction) {
    const dir = asDir(yAxis);
    this.wrapped.SetYDirection(dir);
    dir.delete();
    return this;
  }

  lookAt(shape: { boundingBox: BoundingBox } | Point) {
    const lootAtPoint = new Vector(
      "boundingBox" in shape ? shape.boundingBox.center : shape
    );
    const position = this.position;
    const offset = position.sub(lootAtPoint);
    const direction = offset.normalized();
    const dir = direction.toDir();

    this.wrapped.SetDirection(dir);
    [dir, direction, offset, position, lootAtPoint].forEach((value) =>
      value.delete()
    );
    this.autoAxes();
    return this;
  }
}

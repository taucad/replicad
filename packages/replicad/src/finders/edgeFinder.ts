import { Direction, Point, Plane, PlaneName, Vector } from "../geom";
import { makePlane } from "../geomHelpers";
import { Face, AnyShape, Edge, CurveType } from "../shapes";
import { PLANE_TO_DIR, StandardPlane } from "./definitions";
import { Finder3d } from "./generic3dfinder";

/**
 * With an EdgeFinder you can apply a set of filters to find specific edges
 * within a shape.
 *
 * @category Finders
 */
export class EdgeFinder extends Finder3d<Edge> {
  clone(): EdgeFinder {
    const ef = new EdgeFinder();
    ef.filters = [...this.filters];
    this._shareResourcesWith(ef);
    return ef;
  }

  /**
   * Filter to find edges that are in a certain direction
   *
   * @category Filter
   */
  inDirection(direction: Direction): this {
    return this.atAngleWith(direction, 0);
  }

  /**
   * Filter to find edges of a certain length
   *
   * @category Filter
   */
  ofLength(length: number | ((l: number) => boolean)): this {
    const check = ({ element }: { element: Edge }) => {
      if (typeof length === "number")
        return Math.abs(element.length - length) < 1e-9;
      return length(element.length);
    };
    this.filters.push(check);
    return this;
  }

  /**
   * Filter to find edges that are of a cetain curve type.
   *
   * @category Filter
   */
  ofCurveType(curveType: CurveType): this {
    const check = ({ element }: { element: Edge }) => {
      return element.geomType === curveType;
    };
    this.filters.push(check);
    return this;
  }

  /**
   * Filter to find edges that are parallel to a plane.
   *
   * Note that this will work only in lines (but the method does not
   * check this assumption).
   *
   * @category Filter
   */
  parallelTo(plane: Plane | StandardPlane | Face): this {
    if (typeof plane === "string" && PLANE_TO_DIR[plane])
      return this.atAngleWith(PLANE_TO_DIR[plane], 90);
    if (typeof plane !== "string" && plane instanceof Plane)
      return this.atAngleWith(plane.zDir, 90);
    if (typeof plane !== "string" && plane.normalAt) {
      const normal = this._own(plane.normalAt());
      this.atAngleWith(normal, 90);
      return this;
    }
    return this;
  }

  /**
   * Filter to find edges that within a plane.
   *
   * Note that this will work only in lines (but the method does not
   * check this assumption).
   *
   * @category Filter
   */
  inPlane(inputPlane: PlaneName | Plane, origin?: Point | number): this {
    const plane = this._own(
      inputPlane instanceof Plane
        ? makePlane(inputPlane)
        : makePlane(inputPlane, origin)
    );

    this.parallelTo(plane);

    const firstPointInPlane = ({ element }: { element: Edge }) => {
      const point = element.startPoint;
      const projectedPoint = point.projectToPlane(plane);

      const isSamePoint = point.equals(projectedPoint);
      point.delete();
      projectedPoint.delete();

      return isSamePoint;
    };

    this.filters.push(firstPointInPlane);
    return this;
  }

  shouldKeep(element: Edge): boolean {
    let normal: Vector | null = null;

    try {
      const tangent = element.tangentAt();
      try {
        normal = tangent.normalized();
      } finally {
        tangent.delete();
      }
    } catch (error) {
      console.error("failed to compute a normal", error);
    }

    try {
      return this.filters.every((filter) => filter({ normal, element }));
    } finally {
      normal?.delete();
    }
  }

  protected applyFilter(shape: AnyShape): Edge[] {
    return shape.edges.filter((edge: Edge) => {
      const shouldKeep = this.shouldKeep(edge);
      if (!shouldKeep) edge.delete();
      return shouldKeep;
    });
  }
}

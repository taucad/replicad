import { FaceOrEdge, FilterFcn, Finder } from "./definitions";

import { Direction, makeDirVector, Vector, Point } from "../geom";
import { DEG2RAD } from "../constants";
import { AnyShape } from "../shapes";
import { makeBox, makeVertex } from "../shapeHelpers";
import { DistanceQuery } from "../measureShape";
import type { BoundingBox } from "../geom";

const DISTANCE_EPSILON = 1e-6;
const FLOATING_SAFETY_FACTOR = 32;

/**
 * Cheap pre-check for the point distance filters: returns true only when the
 * element's bounding box proves that it lies farther than `distance` (plus
 * `tolerance`) from `point`, so the exact distance query can be skipped.
 *
 * Any doubt (non finite values, void boxes, kernel errors) returns false and
 * leaves the decision to the exact query.
 */
const isDefinitelyOutsidePointDistance = (
  element: FaceOrEdge,
  distance: number,
  point: [number, number, number],
  tolerance = DISTANCE_EPSILON
): boolean => {
  if (!Number.isFinite(distance) || distance < 0) return false;
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;
  if (!point.every(Number.isFinite)) return false;

  let box: BoundingBox | undefined;
  try {
    box = element.boundingBox;
    if (box.wrapped.IsVoid()) return false;
    const [minimum, maximum] = box.bounds;
    const coordinates = [...point, ...minimum, ...maximum];
    if (!coordinates.every(Number.isFinite)) return false;

    const scale = Math.max(
      1,
      Math.abs(distance),
      ...coordinates.map((coordinate) => Math.abs(coordinate))
    );
    const limit =
      distance +
      Math.max(tolerance, DISTANCE_EPSILON) +
      FLOATING_SAFETY_FACTOR * Number.EPSILON * scale;

    return point.some((coordinate, axis) => {
      const separation = Math.max(
        minimum[axis] - coordinate,
        coordinate - maximum[axis],
        0
      );
      return separation > limit;
    });
  } catch {
    return false;
  } finally {
    box?.delete();
  }
};

export abstract class Finder3d<Type extends FaceOrEdge> extends Finder<
  Type,
  AnyShape
> {
  /**
   * Filter to find elements following a custom function.
   *
   * @category Filter
   */
  when(filter: (filter: FilterFcn<Type>) => boolean): this {
    this.filters.push(filter);
    return this;
  }

  /**
   * Filter to find elements that are in the list.
   *
   * This deletes the elements in the list as the filter deletion.
   *
   * @category Filter
   */
  inList(elementList: Type[]): this {
    const elementInList = ({ element }: { element: Type }) => {
      return !!elementList.find((e) => e.isSame(element));
    };
    this.filters.push(elementInList);
    return this;
  }

  /**
   * Filter to find elements that are at a specified angle (in degrees) with
   * a direction.
   *
   * The element direction corresponds to its normal in the case of a face.
   *
   * @category Filter
   */
  atAngleWith(direction: Direction = "Z", angle = 0): this {
    const myDirection = makeDirVector(direction);

    const checkAngle = ({ normal }: { normal: Vector | null }) => {
      // We do not care about the orientation
      if (!normal) return false;
      const angleOfNormal = Math.acos(Math.abs(normal.dot(myDirection)));

      return Math.abs(angleOfNormal - DEG2RAD * angle) < 1e-6;
    };

    this.filters.push(checkAngle);

    return this;
  }

  /**
   * Filter to find elements that are at a specified distance from a point,
   * within the given tolerance.
   *
   * @category Filter
   */
  atDistance(
    distance: number,
    point: Point = [0, 0, 0],
    tolerance = 1e-6
  ): this {
    const vertex = makeVertex(point);
    const query = new DistanceQuery(vertex);
    const queryPoint = vertex.asTuple();

    const checkPoint = ({ element }: { element: Type }) => {
      if (
        isDefinitelyOutsidePointDistance(
          element,
          distance,
          queryPoint,
          tolerance
        )
      )
        return false;
      return Math.abs(query.distanceTo(element) - distance) < tolerance;
    };

    this.filters.push(checkPoint);
    return this;
  }

  /**
   * Filter to find elements that contain a certain point
   *
   * @category Filter
   */
  containsPoint(point: Point): this {
    return this.near(point);
  }

  /**
   * Filter to find elements that are near a certain point, within the given
   * tolerance.
   *
   * @category Filter
   */
  near(point: Point, tolerance = 1e-6): this {
    return this.atDistance(0, point, tolerance);
  }

  /**
   * Filter to find elements that are within a certain distance from a point.
   *
   * @category Filter
   */
  withinDistance(distance: number, point: Point = [0, 0, 0]): this {
    const vertex = makeVertex(point);
    const query = new DistanceQuery(vertex);
    const queryPoint = vertex.asTuple();

    const checkPoint = ({ element }: { element: Type }) => {
      if (isDefinitelyOutsidePointDistance(element, distance, queryPoint))
        return false;
      return query.distanceTo(element) - distance < 1e-6;
    };

    this.filters.push(checkPoint);
    return this;
  }

  /**
   * Filter to find elements that are within a box
   *
   * The elements that are not fully contained in the box are also found.
   *
   * @category Filter
   */
  inBox(corner1: Point, corner2: Point) {
    const box = makeBox(corner1, corner2);
    return this.inShape(box);
  }

  /**
   * Filter to find elements that are within a generic shape
   *
   * The elements that are not fully contained in the shape are also found.
   *
   * @category Filter
   */
  inShape(shape: AnyShape) {
    const query = new DistanceQuery(shape);

    const checkPoint = ({ element }: { element: Type }) => {
      return query.distanceTo(element) < 1e-6;
    };

    this.filters.push(checkPoint);
    return this;
  }
}

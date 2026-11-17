import { AxisName, Vector } from "../geom";
import { Face, Edge } from "../shapes";
import type { Deletable } from "../register";

/**
 * Kernel values a finder's filters use (directions, planes, distance
 * queries). A finder and its clones share them; the last one deleted deletes
 * them.
 */
class FinderResources {
  private readonly values: Deletable[] = [];
  private users = 1;

  own<T extends Deletable>(value: T): T {
    this.values.push(value);
    return value;
  }

  share(): this {
    this.users += 1;
    return this;
  }

  release(): void {
    this.users -= 1;
    if (this.users > 0) return;
    this.values.splice(0).forEach((value) => value.delete());
  }
}

export type StandardPlane = "XY" | "XZ" | "YZ";
export const PLANE_TO_DIR: Record<StandardPlane, AxisName> = {
  YZ: "X",
  XZ: "Y",
  XY: "Z",
};

export type FaceOrEdge = Face | Edge;

export type FilterFcn<Type> = {
  element: Type;
  normal: Vector | null;
};

export type FinderFunction<FinderType, ShapeType> = (
  finder: FinderType,
  shape: ShapeType
) => FinderType;

export abstract class Finder<Type, FilterType> {
  protected filters: (({ element, normal }: FilterFcn<Type>) => boolean)[];

  protected abstract applyFilter(shape: FilterType): Type[];

  /**
   * Check if a particular element should be filtered or not according to the
   * current finder
   */
  abstract shouldKeep(t: Type): boolean;

  private _resources: FinderResources | null = new FinderResources();

  constructor() {
    this.filters = [];
  }

  /**
   * Deletes the kernel values the filters use. The finder cannot be used
   * afterwards.
   */
  delete() {
    this.filters = [];
    this._resources?.release();
    this._resources = null;
  }

  /** @ignore The finder deletes `value` when it is deleted. */
  protected _own<T extends Deletable>(value: T): T {
    if (!this._resources) {
      value.delete();
      throw new Error("This finder has been deleted");
    }
    return this._resources.own(value);
  }

  /** @ignore Makes `clone` share this finder's kernel values. */
  protected _shareResourcesWith(clone: object): void {
    const target = clone as unknown as { _resources: FinderResources | null };
    target._resources?.release();
    target._resources = this._resources?.share() ?? null;
  }

  /**
   * Combine logically a set of filter with an AND operation.
   *
   * You need to pass an array of functions that take a finder as a argument
   * and return the same finder with some filters applied to it.
   *
   * Note that by default filters are applied with and AND operation, but in
   * some case you might want to create them dynamically and use this method.
   *
   * @category Filter Combination
   */
  and(findersList: ((f: this) => this)[]): this {
    findersList.forEach((f) => f(this));
    return this;
  }

  /**
   * Invert the result of a particular finder
   *
   * You need to pass a function that take a finder as a argument
   * and return the same finder with some filters applied to it.
   *
   * @category Filter Combination
   */
  not(finderFun: (f: this) => this): this {
    const finder = this._own(new (<any>this.constructor)() as this);
    finderFun(finder);

    const notFilter = ({ element }: { element: Type }) =>
      !finder.shouldKeep(element);
    this.filters.push(notFilter);

    return this;
  }

  /**
   * Combine logically a set of filter with an OR operation.
   *
   * You need to pass an array of functions that take a finder as a argument
   * and return the same finder with some filters applied to it.
   *
   * @category Filter Combination
   */
  either(findersList: ((f: this) => this)[]): this {
    const builtFinders = findersList.map((finderFunction) => {
      const finder = this._own(new (<any>this.constructor)() as this);
      finderFunction(finder);
      return finder;
    });

    const eitherFilter = ({ element }: { element: Type }) =>
      builtFinders.some((finder) => finder.shouldKeep(element));
    this.filters.push(eitherFilter);

    return this;
  }

  /**
   * Returns all the elements that fit the set of filters defined on this
   * finder
   *
   * If unique is configured as an option it will either return the unique
   * element found or throw an error.
   */
  find(shape: FilterType, options: { unique: true }): Type;
  find(shape: FilterType): Type[];
  find(shape: FilterType, options: { unique?: false }): Type[];
  find(shape: FilterType, { unique = false } = {}) {
    const elements = this.applyFilter(shape);

    if (unique) {
      if (elements.length !== 1) {
        console.error(elements);
        throw new Error("Finder has not found a unique solution");
      }
      return elements[0];
    }

    return elements;
  }
}

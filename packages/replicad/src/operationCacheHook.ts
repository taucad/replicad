/**
 * Operation cache seam: the contract a host implements and the helpers the
 * library's operations call. `operationCache.ts` installs a cache and routes
 * the public API through it.
 *
 * This module imports no shape class, so every module can import it.
 */
import { iterTopo } from "./shapeFunctions/topology.js";
import { getOC } from "./oclib.js";
import { HASH_CODE_MAX } from "./constants.js";
import type { TopoDS_Shape } from "replicad-opencascadejs";

/**
 * How an operation treats its receiver.
 *
 * - `pure`: the receiver is unchanged; the result may be reused.
 * - `consumes`: the operation deletes its receiver (and possibly some of its
 *   arguments). A cache that reuses a result calls `consume` so the caller
 *   sees the same deletions as when the operation runs.
 * - `mutates`: the operation changes its receiver (pens, sketchers, finders,
 *   setters). It always runs; the receiver's identity advances.
 * - `alias`: the result is a new handle on the receiver's geometry (`clone`).
 */
export type OperationEffect = "pure" | "consumes" | "mutates" | "alias";

/**
 * One public operation, described lazily: the library builds no key, copy or
 * canonical value; the cache reads what it needs.
 */
export interface OperationRequest<T> {
  /**
   * `Class.method`, `set:Class.property` or the exported function name. The
   * class part names the table entry (`Shape` for every shape class, `Pen`
   * for every 2D pen).
   */
  readonly op: string;
  readonly effect: OperationEffect;
  /** `this` of a method; `undefined` for a free function. */
  readonly receiver: object | undefined;
  /** The arguments as passed. Do not mutate them. */
  readonly args: readonly unknown[];
  /** Positions of finder callbacks (`(finder, shape) => finder`) among `args`. */
  readonly finderArgs?: readonly number[];
  /**
   * The operation's errors are a deterministic function of its inputs (it
   * calls no user code that the inputs do not describe), so a cache may
   * reuse a failure. Resource, cancellation and native trap errors never are.
   */
  readonly deterministicErrors?: boolean;
  /**
   * For a builder (pen, sketcher) the cache has not seen: its state while it
   * is still as its constructor left it, so it can be identified by value.
   * `undefined` once it has drawn something.
   */
  readonly freshState?: () => readonly unknown[] | undefined;
  /** Runs the operation. */
  compute(): T;
  /** Deletes what the operation would have deleted. Call it on a reuse. */
  consume?(): void;
}

/**
 * The part of an operation that depends on a callback the cache could not
 * describe up front (a sweep factory, a finder predicate): the library calls
 * it once the callback has run, with the inputs it produced. It always belongs
 * to the innermost `operation` call that is still running.
 */
export interface OperationStep<T> {
  readonly op: string;
  readonly receiver: object | undefined;
  /** See {@link OperationRequest.deterministicErrors}. */
  readonly deterministicErrors?: boolean;
  /**
   * The inputs known after the callback ran (selected element ordinals and
   * radii, the factory's sketch), or `undefined` if they cannot be described
   * (a selected element is not part of the receiver).
   */
  values(): readonly unknown[] | undefined;
  compute(): T;
  consume?(): void;
}

/**
 * A host cache. Replicad never imports an implementation; see
 * `setOperationCache`.
 *
 * The library calls `operation` only for calls made by user code: calls made
 * while an operation runs (internal composition) go straight to the
 * implementation, except inside a user callback that the library invokes
 * (a sweep factory), where user code is routed again. Calls the cache makes
 * itself go through the routing too; wrap them in `bypassOperationCache`.
 */
export interface OperationCache {
  operation<T>(request: OperationRequest<T>): T;
  step<T>(request: OperationStep<T>): T;
  /**
   * Topological elements that user code took from `owner` (the `edges`,
   * `faces`, `wires` and `solids` getters, a finder's `find`). `ordinals`
   * gives each element's position in the owner's enumeration of that kind.
   */
  elements(
    owner: object,
    kind: string,
    elements: readonly object[],
    ordinals: () => readonly number[] | undefined
  ): void;
}

let activeCache: OperationCache | undefined;
let depth = 0;

/** @ignore Used by operationCache.ts. */
export function _setActiveOperationCache(
  cache: OperationCache | undefined
): void {
  activeCache = cache;
  depth = 0;
}

/** The installed operation cache, if any. */
export function getOperationCache(): OperationCache | undefined {
  return activeCache;
}

/**
 * The installed cache if the current call comes from user code (not from
 * inside another operation).
 *
 * @ignore
 */
export function _topLevelCache(): OperationCache | undefined {
  return depth === 0 ? activeCache : undefined;
}

/**
 * Runs `fn` as library-internal work: the routed API it calls passes straight
 * through to the implementation. A cache uses it for its own calls into
 * Replicad (cloning a kept result, reading a value).
 */
export function bypassOperationCache<T>(fn: () => T): T {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}

/**
 * Runs a user callback that an operation invokes and whose result feeds the
 * operation (a sweep factory): the calls it makes are user calls again.
 *
 * @ignore
 */
export function _userCallback<T>(fn: () => T): T {
  const saved = depth;
  depth = 0;
  try {
    return fn();
  } finally {
    depth = saved;
  }
}

/**
 * Calls the cache for an operation made by user code. Calls `compute`
 * directly inside another operation or with no cache installed.
 *
 * @ignore
 */
export function _runOperation<T>(
  request: Omit<OperationRequest<T>, "compute" | "freshState" | "consume"> & {
    compute(): T;
    freshState?: () => readonly unknown[] | undefined;
    consume?: () => void;
  }
): T {
  const cache = activeCache;
  if (!cache) return request.compute();
  if (depth > 0) return bypassOperationCache(request.compute);
  const { compute, freshState, consume } = request;
  return cache.operation({
    ...request,
    compute: () => bypassOperationCache(compute),
    freshState: freshState && (() => bypassOperationCache(freshState)),
    consume: consume && (() => bypassOperationCache(consume)),
  });
}

/**
 * Hands the cache the remainder of the current operation once its callback
 * has run. Calls `compute` directly unless the current operation was called by
 * user code with a cache installed.
 *
 * @ignore
 */
export function _runStep<T>(request: OperationStep<T>): T {
  const cache = activeCache;
  if (!cache || depth !== 1) return request.compute();
  const { values, consume } = request;
  return cache.step({
    ...request,
    values: () => bypassOperationCache(values),
    consume: consume && (() => bypassOperationCache(consume)),
  });
}

/**
 * Whether `_runStep` will hand a step to the cache: lets an operation skip
 * the copies a step needs.
 *
 * @ignore
 */
export function _stepWanted(): boolean {
  return activeCache !== undefined && depth === 1;
}

/**
 * Positions of `elements` in the enumeration of `kind` sub shapes of `owner`
 * (the order of `iterTopo`, which the `edges` and `faces` getters use), or
 * `undefined` if one of them is not a sub shape of `owner`.
 */
export function elementOrdinals(
  owner: TopoDS_Shape,
  kind: "edge" | "face" | "wire" | "solid" | "vertex",
  elements: readonly TopoDS_Shape[]
): number[] | undefined {
  const oc = getOC();
  const index = new Map<number, Array<[TopoDS_Shape, number]>>();
  let position = 0;
  for (const item of iterTopo(owner, kind)) {
    const hash = oc.ReplicadShapeHasher.HashCode(item, HASH_CODE_MAX);
    const bucket = index.get(hash);
    if (bucket) bucket.push([item, position]);
    else index.set(hash, [[item, position]]);
    position += 1;
  }
  const result: number[] = [];
  for (const element of elements) {
    const bucket = index.get(
      oc.ReplicadShapeHasher.HashCode(element, HASH_CODE_MAX)
    );
    const found = bucket?.find(([candidate]) => candidate.IsSame(element));
    if (!found) return undefined;
    result.push(found[1]);
  }
  return result;
}

type Wrapped = { wrapped: TopoDS_Shape };
const raw = (value: TopoDS_Shape | Wrapped): TopoDS_Shape =>
  "wrapped" in value ? value.wrapped : value;

/** @ignore Ordinals of selected sub shapes of `owner`, for a step. */
export function _selectedOrdinals(
  owner: Wrapped,
  kind: "edge" | "face",
  elements: readonly (TopoDS_Shape | Wrapped)[]
): number[] | undefined {
  return elementOrdinals(owner.wrapped, kind, elements.map(raw));
}

/** @ignore Step values of a fillet: selected edge ordinals and their radii. */
export function _selectedEdgeValues(
  owner: Wrapped,
  selected: readonly { edge: TopoDS_Shape; radius: unknown }[]
): unknown[] | undefined {
  const ordinals = _selectedOrdinals(
    owner,
    "edge",
    selected.map(({ edge }) => edge)
  );
  return ordinals && [ordinals, selected.map(({ radius }) => radius)];
}

/**
 * @ignore Step values of a chamfer: edge ordinals, then per edge the face
 * ordinal (or null) and the remaining configuration.
 */
export function _selectedChamferValues(
  owner: Wrapped,
  configs: readonly Record<string, unknown>[]
): unknown[] | undefined {
  const edges = _selectedOrdinals(
    owner,
    "edge",
    configs.map((config) => config.edge as TopoDS_Shape | Wrapped)
  );
  if (!edges) return undefined;
  const values: unknown[] = [edges];
  for (const config of configs) {
    const { edge: _edge, face, ...rest } = config;
    let faceOrdinal: number[] | null = null;
    if (face) {
      const found = _selectedOrdinals(owner, "face", [face as Wrapped]);
      if (!found) return undefined;
      faceOrdinal = found;
    }
    values.push([faceOrdinal, rest]);
  }
  return values;
}

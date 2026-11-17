/**
 * Operation cache seam: installation and routing.
 *
 * Replicad itself caches nothing. A host installs an {@link OperationCache}
 * with {@link setOperationCache}; while it is installed, every routed public
 * operation (see operationEffects.ts) calls it with a lazy description of the
 * operation and a callback that performs it, and the cache decides whether to
 * run the callback or return an equivalent value it computed before.
 *
 * With no cache installed nothing here runs: the prototypes hold their
 * original members (routing is installed by `setOperationCache` and removed
 * when the cache is), and an exported free function reads one module variable
 * before calling its implementation with the same arguments.
 */
import type { TopoDS_Shape } from "replicad-opencascadejs";
import {
  _runOperation,
  _setActiveOperationCache,
  _topLevelCache,
  bypassOperationCache,
  elementOrdinals,
  getOperationCache,
  type OperationCache,
} from "./operationCacheHook";
import {
  classEffects,
  functionEffects,
  ROUTED_FUNCTION_NAMES,
  type ClassEffects,
  type FunctionEffects,
} from "./operationEffects";
import { Shape } from "./shapes";
import { Finder } from "./finders/definitions";
import { EdgeFinder } from "./finders/edgeFinder";
import { FaceFinder } from "./finders/faceFinder";
import * as shapeHelpers from "./shapeHelpers";
import { makeBaseBox } from "./shortcuts";
import * as addThickness from "./addThickness";
import * as drawModule from "./draw";
import * as cannedSketches from "./sketches/cannedSketches";
import * as textModule from "./text";
import * as cannedBlueprints from "./blueprints/cannedBlueprints";
import * as boolean2D from "./blueprints/boolean2D";
import * as booleanOperations from "./blueprints/booleanOperations";
import { makeProjectedEdges } from "./projection/makeProjectedEdges";

type Restore = () => void;
let restores: Restore[] = [];

const deleteReceiver = (receiver: { delete(): void }): void =>
  receiver.delete();

const instrumentClass = (definition: ClassEffects): void => {
  if (!definition.routed) return;
  const prototype = definition.target.prototype as Record<string, unknown>;
  const unrouted = new Set(definition.unrouted ?? []);

  const replace = (key: string, descriptor: PropertyDescriptor): void => {
    const original = Object.getOwnPropertyDescriptor(prototype, key)!;
    Object.defineProperty(prototype, key, descriptor);
    restores.push(() => Object.defineProperty(prototype, key, original));
  };

  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === "constructor" || key.startsWith("_")) continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key)!;

    if (typeof descriptor.value === "function") {
      if (unrouted.has(key)) continue;
      const original = descriptor.value as (...args: unknown[]) => unknown;
      const effect = definition.members[key];
      const op = `${definition.op}.${key}`;
      const finderArgs = definition.finderArgs?.[key];
      const deterministicErrors =
        definition.deterministicErrors?.includes(key) || undefined;
      const consumeMember =
        effect === "consumes"
          ? definition.consume?.[key] ??
            ((receiver: { delete(): void }) => deleteReceiver(receiver))
          : undefined;
      const freshState = definition.freshState;
      const routed = function (this: object, ...args: unknown[]): unknown {
        return _runOperation({
          op,
          effect,
          receiver: this,
          args,
          finderArgs,
          deterministicErrors,
          freshState: freshState && (() => freshState(this)),
          compute: () => original.apply(this, args),
          consume: consumeMember && (() => consumeMember(this, args)),
        });
      };
      replace(key, { ...descriptor, value: routed });
      continue;
    }

    let { get, set } = descriptor;
    let changed = false;
    const kind = definition.elementGetters?.[key];
    if (get && kind) {
      const getter = get;
      get = function (this: object): unknown {
        const elements = getter.call(this) as object[];
        _topLevelCache()?.elements(this, kind, elements, () =>
          bypassOperationCache(() =>
            elementOrdinals(
              (this as Shape<TopoDS_Shape>).wrapped,
              kind as "edge",
              elements.map((element) => (element as Shape<TopoDS_Shape>).wrapped)
            )
          )
        );
        return elements;
      };
      changed = true;
    } else if (get && definition.routedGetters?.includes(key)) {
      const getter = get;
      const op = `get:${definition.op}.${key}`;
      const effect = definition.members[key];
      const consumeGetter = definition.consume?.[key];
      get = function (this: object): unknown {
        return _runOperation({
          op,
          effect,
          receiver: this,
          args: [],
          compute: () => getter.call(this),
          consume: consumeGetter && (() => consumeGetter(this, [])),
        });
      };
      changed = true;
    }
    if (set && !unrouted.has(`set:${key}`)) {
      // A setter changes its receiver: route it so its identity advances.
      const setter = set;
      const op = `set:${definition.op}.${key}`;
      set = function (this: object, value: unknown): void {
        _runOperation({
          op,
          effect: "mutates",
          receiver: this,
          args: [value],
          compute: () => setter.call(this, value),
        });
      };
      changed = true;
    }
    if (changed) replace(key, { ...descriptor, get, set });
  }
};

const instrumentFinders = (): void => {
  const prototype = Finder.prototype as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "find")!;
  const original = descriptor.value as (...args: unknown[]) => unknown;
  const routed = function (this: object, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    const cache = _topLevelCache();
    const owner = args[0];
    const kind =
      this instanceof EdgeFinder
        ? "edge"
        : this instanceof FaceFinder
        ? "face"
        : undefined;
    if (cache && kind && owner instanceof Shape) {
      const elements = (
        Array.isArray(result) ? result : [result]
      ) as Shape<TopoDS_Shape>[];
      cache.elements(owner, kind, elements, () =>
        bypassOperationCache(() =>
          elementOrdinals(
            owner.wrapped,
            kind,
            elements.map((element) => element.wrapped)
          )
        )
      );
    }
    return result;
  };
  Object.defineProperty(prototype, "find", { ...descriptor, value: routed });
  restores.push(() => Object.defineProperty(prototype, "find", descriptor));
};

/**
 * Installs an operation cache, or removes it with `undefined`, and returns the
 * one installed before.
 *
 * Routing is installed on the prototypes of the routed classes when a cache
 * is installed and removed when it is: with no cache, every member is the
 * original function. Replacing one cache with another keeps the routing.
 */
export function setOperationCache(
  cache: OperationCache | undefined
): OperationCache | undefined {
  const previous = getOperationCache();
  // Throws while an operation runs, before anything is changed.
  _setActiveOperationCache(previous);
  if (cache && !previous) {
    classEffects().forEach(instrumentClass);
    instrumentFinders();
  } else if (!cache && previous) {
    restores.reverse().forEach((restore) => restore());
    restores = [];
  }
  _setActiveOperationCache(cache);
  return previous;
}

// ---------------------------------------------------------------------------
// Exported free functions. index.ts exports these under the original names;
// library-internal callers keep calling the implementations.
// ---------------------------------------------------------------------------

/** @ignore Exported for tests. */
export const routeFunction = <F extends (...args: any[]) => any>(
  op: string,
  original: F,
  effects: FunctionEffects = { effect: "pure", routed: true }
): F => {
  const { effect, consume, returnsBuilder } = effects;
  const routed = function (this: unknown): ReturnType<F> {
    // No cache: call the implementation with the same arguments object,
    // without copying them or building a request.
    // eslint-disable-next-line prefer-rest-params
    if (!getOperationCache()) return original.apply(this, arguments as any);
    // eslint-disable-next-line prefer-rest-params
    const args = Array.prototype.slice.call(arguments) as Parameters<F>;
    return _runOperation({
      op,
      effect,
      receiver: undefined,
      args,
      returnsBuilder,
      compute: () => original(...args),
      consume: consume && (() => consume(args)),
    });
  };
  // Keep the implementation's name and arity.
  Object.defineProperty(routed, "name", { value: original.name || op });
  Object.defineProperty(routed, "length", { value: original.length });
  return routed as F;
};

const implementations = {
  ...shapeHelpers,
  ...addThickness,
  ...drawModule,
  ...cannedSketches,
  ...textModule,
  ...cannedBlueprints,
  ...boolean2D,
  ...booleanOperations,
  makeBaseBox,
  makeProjectedEdges,
};

type RoutedName = (typeof ROUTED_FUNCTION_NAMES)[number];

/** @ignore The routed free functions, exported by index.ts. */
export const routedFunctions = Object.fromEntries(
  ROUTED_FUNCTION_NAMES.map((name) => {
    const implementation = implementations[name];
    if (typeof implementation !== "function")
      throw new Error(`No implementation for routed function ${name}`);
    return [name, routeFunction(name, implementation, functionEffects[name])];
  })
) as unknown as { [K in RoutedName]: (typeof implementations)[K] };

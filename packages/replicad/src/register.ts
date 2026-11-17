import { getOC } from "./oclib";
import type { OpenCascadeInstance } from "replicad-opencascadejs";

export interface Deletable {
  delete: () => void;
}

if (!(globalThis as any).FinalizationRegistry) {
  console.log("Garbage collection will not work");

  (globalThis as any).FinalizationRegistry = (() => ({
    register: () => null,
    unregister: () => null,
  })) as any;
}

/** Whether a value is an embind handle that has already been deleted. */
const isDeletedHandle = (value: Deletable): boolean => {
  const handle = value as unknown as { isDeleted?: () => boolean };
  return typeof handle.isDeleted === "function" && handle.isDeleted();
};

const deletetableRegistry = new (globalThis as any).FinalizationRegistry(
  (heldValue: Deletable) => {
    // Empty OCCT handles can resolve to null; never register or finalize them.
    // A handle someone else already deleted is not deleted again.
    if (!heldValue || isDeletedHandle(heldValue)) return;
    try {
      heldValue.delete();
    } catch (e) {
      console.error(e);
    }
  }
);

/**
 * The base of every object that owns an OpenCascade value.
 *
 * A wrapper adopts the value it is constructed with: it is now its only owner
 * and deletes it exactly once, when `delete()` is called or, as a safety net,
 * after the wrapper has been garbage collected. Code that must keep using a
 * value after handing it to a wrapper passes a copy instead.
 *
 * A wrapper whose value has been deleted (by `delete()`, by an operation that
 * consumes it, or from outside, as an evaluation sweep does) throws on use
 * instead of reaching freed memory.
 */
export class WrappingObj<Type extends Deletable> {
  protected oc: OpenCascadeInstance;
  private _wrapped: Type | null;

  constructor(wrapped: Type) {
    this.oc = getOC();
    if (wrapped) {
      deletetableRegistry.register(this, wrapped, wrapped);
    }
    this._wrapped = wrapped;
  }

  get wrapped(): Type {
    const wrapped = this._wrapped;
    if (wrapped === null || (wrapped && isDeletedHandle(wrapped)))
      throw new Error("This object has been deleted");
    return wrapped;
  }

  set wrapped(newWrapped: Type) {
    const previous = this._wrapped;
    if (previous) {
      deletetableRegistry.unregister(previous);
      if (previous !== newWrapped && !isDeletedHandle(previous))
        previous.delete();
    }

    if (newWrapped) {
      deletetableRegistry.register(this, newWrapped, newWrapped);
    }
    this._wrapped = newWrapped;
  }

  delete(): void {
    const wrapped = this._wrapped;
    if (wrapped === null) return;

    // Consider the wrapper deleted even if deleting the underlying object throws.
    this._wrapped = null;
    if (!wrapped) return;
    deletetableRegistry.unregister(wrapped);
    if (!isDeletedHandle(wrapped)) wrapped.delete();
  }
}

export interface WrappingObj<Type extends Deletable> extends Disposable {}

// Do not polyfill Symbol.dispose: unsupported runtimes can continue to use
// replicad's existing explicit deletion and finalization behavior.
if (typeof Symbol.dispose === "symbol") {
  Object.defineProperty(WrappingObj.prototype, Symbol.dispose, {
    configurable: true,
    writable: true,
    value(this: WrappingObj<Deletable>): void {
      this.delete();
    },
  });
}

/**
 * A deterministic ownership scope for OpenCascade values (and other objects
 * with a `delete()` method).
 *
 * `scope(value)` registers a value the scope owns and returns it;
 * `scope.keep(value)` takes it back out (the caller now owns it), and
 * `scope.dispose()` deletes everything still owned, last registered first,
 * skipping values that were already deleted. Dispose a scope in a `finally`
 * block, or declare it with `using` where explicit resource management is
 * available, so that a throw cannot leak what it owns:
 *
 * ```ts
 * const r = ocScope();
 * try {
 *   const builder = r(new oc.BRepBuilderAPI_MakeFace(plane));
 *   return builder.Face();
 * } finally {
 *   r.dispose();
 * }
 * ```
 *
 * Unlike {@link GCWithScope}, nothing waits for the garbage collector, which
 * never runs during a synchronous model build.
 */
export interface OcScope {
  <T extends Deletable | null | undefined>(value: T): T;
  /** Releases a value from the scope: the caller now owns it. */
  keep<T extends Deletable | null | undefined>(value: T): T;
  /** Deletes every value the scope still owns. Safe to call twice. */
  dispose(): void;
}

export function ocScope(): OcScope {
  const owned: Deletable[] = [];
  const scope = (<T extends Deletable | null | undefined>(value: T): T => {
    if (value) owned.push(value);
    return value;
  }) as OcScope;
  scope.keep = <T extends Deletable | null | undefined>(value: T): T => {
    if (value) {
      for (let i = owned.length - 1; i >= 0; i--)
        if (owned[i] === value) owned.splice(i, 1);
    }
    return value;
  };
  scope.dispose = () => {
    const values = owned.splice(0, owned.length);
    const seen = new Set<Deletable>();
    let failure: unknown;
    for (let i = values.length - 1; i >= 0; i--) {
      const value = values[i];
      if (seen.has(value)) continue;
      seen.add(value);
      if (isDeletedHandle(value)) continue;
      try {
        value.delete();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  };
  if (typeof Symbol.dispose === "symbol")
    Object.defineProperty(scope, Symbol.dispose, { value: scope.dispose });
  return scope;
}

/**
 * Runs `fn` with a fresh {@link ocScope} and disposes it afterwards, whether
 * `fn` returns or throws. Keep the result with `scope.keep` if the scope owns
 * it.
 */
export function withOcScope<T>(fn: (scope: OcScope) => T): T {
  const scope = ocScope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}

/**
 * @deprecated Values registered here are deleted only after the returned
 * function has been garbage collected, which never happens during a
 * synchronous model build. Use {@link ocScope}.
 */
export const GCWithScope = () => {
  function gcWithScope<Type extends Deletable>(value: Type): Type {
    if (value) {
      deletetableRegistry.register(gcWithScope, value);
    }
    return value;
  }

  return gcWithScope;
};

export const GCWithObject = (obj: any) => {
  function registerForGC<Type extends Deletable>(value: Type): Type {
    if (value) {
      deletetableRegistry.register(obj, value);
    }
    return value;
  }

  return registerForGC;
};

/**
 * @deprecated Use {@link ocScope}, which also skips values that were already
 * deleted and can release a value with `keep`.
 */
export const localGC = (
  debug?: boolean
): [
  <T extends Deletable>(v: T) => T,
  () => void,
  Set<Deletable> | undefined
] => {
  const cleaner = new Set<Deletable>();

  return [
    <T extends Deletable>(v: T): T => {
      cleaner.add(v);
      return v;
    },

    () => {
      [...cleaner.values()].forEach((d) => {
        if (!isDeletedHandle(d)) d.delete();
      });
      cleaner.clear();
    },
    debug ? cleaner : undefined,
  ];
};

/**
 * A minimal resident operation cache for the seam's tests: live retained
 * clones keyed by lineage identity with occurrence qualification, finder
 * callbacks recorded as clauses (optional), selections keyed after they ran,
 * and qualified negative results. It follows the host contract documented in
 * src/operationCacheHook.ts; it is not a product cache (no eviction).
 */
import { createHash } from "node:crypto";
import {
  bypassOperationCache,
  CompoundSketch,
  Drawing,
  finderClauses,
  getOC,
  Plane,
  Shape,
  Sketch,
  Sketches,
  Vector,
  type OperationCache,
  type OperationRequest,
  type OperationStep,
} from "../../src/index";

type Frame = { partial: string; pending: boolean; stepKey?: string };
type ElementGroup = {
  ownerId: string;
  kind: string;
  ordinals: () => readonly number[] | undefined;
  resolved?: readonly number[] | null;
};
class NegativeResult {
  constructor(readonly error: unknown) {}
}
const FN = Symbol("function");

export interface TestCacheOptions {
  /** Record finder callbacks as clauses (default true). */
  recordFinders?: boolean;
  /** Reuse qualified failures (default true). */
  negatives?: boolean;
}

export interface TestCacheStats {
  calls: number;
  keyed: number;
  hits: number;
  /** Misses whose result the cache keeps (not fresh builders). */
  misses: number;
  /** Computed results the cache does not keep (a pen from `draw()`). */
  transient: number;
  pending: number;
  opaque: number;
  steps: number;
  stepHits: number;
  negativeStored: number;
  negativeHits: number;
  computes: Record<string, number>;
  reasons: Record<string, number>;
}

const freshStats = (): TestCacheStats => ({
  calls: 0,
  keyed: 0,
  hits: 0,
  misses: 0,
  transient: 0,
  pending: 0,
  opaque: 0,
  steps: 0,
  stepHits: 0,
  negativeStored: 0,
  negativeHits: 0,
  computes: {},
  reasons: {},
});

/** Whether a thrown value is a deterministic, reusable failure. */
export const qualifiesNegative = (error: unknown): boolean => {
  if (error instanceof RangeError) return false;
  if (error instanceof Error) return !/memory|abort|cancel/i.test(error.message);
  // An OpenCascade exception (Standard_Failure) thrown through WebAssembly.
  // A trap (WebAssembly.RuntimeError) is an Error and is excluded above only
  // by message, so exclude it explicitly.
  return (
    typeof WebAssembly !== "undefined" &&
    "Exception" in WebAssembly &&
    error instanceof (WebAssembly as any).Exception
  );
};

export function createTestCache(options: TestCacheOptions = {}) {
  const ids = new WeakMap<object, string>();
  const elementOf = new WeakMap<object, { group: ElementGroup; index: number }>();
  const retained = new Map<string, unknown>();
  const tokens = new Map<string, string>();
  const occurrences = new Map<string, number>();
  const frames: Frame[] = [];
  let stats = freshStats();
  let reason = "";

  const idOf = (value: object): string | undefined => {
    const known = ids.get(value);
    if (known !== undefined) return known;
    const element = elementOf.get(value);
    if (!element) return undefined;
    const group = element.group;
    if (group.resolved === undefined) group.resolved = group.ordinals() ?? null;
    if (group.resolved === null) return undefined;
    const id = `${group.ownerId}/${group.kind}#${group.resolved[element.index]}`;
    ids.set(value, id);
    return id;
  };
  const assign = (value: unknown, id: string): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assign(entry, `${id}[${index}]`));
      return;
    }
    ids.set(value, id);
    elementOf.delete(value);
    if (value instanceof Sketch) ids.set(value.wire, `${id}.wire`);
    else if (value instanceof CompoundSketch || value instanceof Sketches)
      (value.sketches as unknown[]).forEach((entry, index) =>
        assign(entry, `${id}.s${index}`)
      );
  };
  const forget = (value: unknown): void => {
    if (value && typeof value === "object") {
      ids.delete(value);
      elementOf.delete(value);
    }
  };

  const cacheable = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.length > 0 && value.every(cacheable)
      : value instanceof Shape ||
        value instanceof Drawing ||
        value instanceof Sketch ||
        value instanceof CompoundSketch ||
        value instanceof Sketches;
  const cloneValue = (value: any): any => {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value instanceof CompoundSketch)
      return new CompoundSketch(value.sketches.map(cloneValue));
    if (value instanceof Sketches)
      return new Sketches(value.sketches.map(cloneValue));
    return value.clone();
  };

  const valueClauses = new Set<string>(finderClauses.value);
  const combinators = new Set<string>(finderClauses.combinator);
  const recordFinder = (callback: Function): string | undefined => {
    let opaque = false;
    const record = (fn: Function): unknown[] | undefined => {
      const log: unknown[] = [];
      const recorder: object = new Proxy(
        {},
        {
          get(_target, property) {
            if (typeof property !== "string" || property === "then")
              return undefined;
            if (valueClauses.has(property))
              return (...values: unknown[]) => {
                const parts = values.map((entry) => canonical(entry));
                if (parts.some((part) => typeof part !== "string"))
                  opaque = true;
                log.push([property, parts]);
                return recorder;
              };
            if (combinators.has(property))
              return (argument: unknown) => {
                const list = Array.isArray(argument) ? argument : [argument];
                const nested = list.map((entry) =>
                  typeof entry === "function" ? record(entry) : undefined
                );
                if (nested.some((entry) => entry === undefined)) opaque = true;
                log.push([property, nested]);
                return recorder;
              };
            opaque = true; // `when` and anything unknown
            return () => recorder;
          },
        }
      );
      let result: unknown;
      try {
        result = bypassOperationCache(() => fn(recorder));
      } catch {
        opaque = true;
        return undefined;
      }
      if (result !== recorder) {
        opaque = true;
        return undefined;
      }
      return log;
    };
    const log = record(callback);
    return opaque || log === undefined ? undefined : JSON.stringify(log);
  };

  const digest = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  const canonical = (
    value: unknown,
    finder = false
  ): string | typeof FN | undefined => {
    switch (typeof value) {
      case "number":
        return Object.is(value, -0) ? "-0" : String(value);
      case "string":
        return JSON.stringify(value);
      case "boolean":
        return value ? "T" : "F";
      case "undefined":
        return "u";
      case "function": {
        if (finder && options.recordFinders !== false) {
          const recorded = recordFinder(value);
          if (recorded !== undefined) return `rec${recorded}`;
        }
        return FN;
      }
      case "object":
        break;
      default:
        reason = `type ${typeof value}`;
        return undefined;
    }
    if (value === null) return "n";
    const id = idOf(value);
    if (id !== undefined) return `#${id}`;
    if (value instanceof Uint8Array) return `bytes:${digest(value)}`;
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (const entry of value) {
        const part = canonical(entry);
        if (typeof part !== "string") {
          reason = part === FN ? "function in array" : reason;
          return undefined;
        }
        parts.push(part);
      }
      return `[${parts.join(",")}]`;
    }
    if (value instanceof Vector)
      return `V(${canonical(value.x)},${canonical(value.y)},${canonical(
        value.z
      )})`;
    if (value instanceof Plane)
      return `P(${canonical(value.origin)};${canonical(
        value.xDir
      )};${canonical(value.zDir)})`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const parts: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const part = canonical((value as Record<string, unknown>)[key]);
        if (typeof part !== "string") {
          reason = part === FN ? "function in object" : reason;
          return undefined;
        }
        parts.push(`${key}:${part}`);
      }
      return `{${parts.join(",")}}`;
    }
    reason = `untracked ${(value as object).constructor?.name ?? "object"}`;
    return undefined;
  };

  const intern = (recipe: string): string => {
    let token = tokens.get(recipe);
    if (token === undefined) {
      token = `t${tokens.size.toString(36)}`;
      tokens.set(recipe, token);
    }
    const seen = occurrences.get(token) ?? 0;
    occurrences.set(token, seen + 1);
    return seen === 0 ? token : `${token}@${seen}`;
  };

  const count = (op: string) => {
    stats.computes[op] = (stats.computes[op] ?? 0) + 1;
  };

  const keyed = <T>(
    key: string,
    op: string,
    request: { compute(): T; consume?(): void; deterministicErrors?: boolean },
    kind: "op" | "step"
  ): T => {
    const kept = retained.get(key);
    if (kept instanceof NegativeResult) {
      stats.hits += 1;
      stats.negativeHits += 1;
      if (kind === "step") stats.stepHits += 1;
      throw kept.error;
    }
    if (kept !== undefined) {
      const value = bypassOperationCache(() => cloneValue(kept));
      request.consume?.();
      assign(value, key);
      stats.hits += 1;
      if (kind === "step") stats.stepHits += 1;
      return value;
    }
    stats.misses += 1;
    count(op);
    let result: T;
    try {
      result = request.compute();
    } catch (error) {
      if (
        options.negatives !== false &&
        request.deterministicErrors &&
        qualifiesNegative(error)
      ) {
        if (!(error instanceof Error)) getOC().incrementExceptionRefcount(error);
        retained.set(key, new NegativeResult(error));
        stats.negativeStored += 1;
      }
      throw error;
    }
    assign(result, key);
    if (cacheable(result))
      retained.set(
        key,
        bypassOperationCache(() => cloneValue(result))
      );
    else {
      stats.misses -= 1;
      stats.transient += 1;
    }
    return result;
  };

  const run = <T>(op: string, frame: Frame, compute: () => T): T => {
    frames.push(frame);
    try {
      count(op);
      return compute();
    } finally {
      frames.pop();
    }
  };

  const cache: OperationCache = {
    operation<T>(request: OperationRequest<T>): T {
      stats.calls += 1;
      let opaque: string | undefined;
      let receiverId = "";
      if (request.receiver !== undefined) {
        let id = idOf(request.receiver);
        if (id === undefined && request.freshState) {
          const state = request.freshState();
          const part = state === undefined ? undefined : canonical(state);
          if (typeof part === "string") {
            id = `new:${part}`;
            ids.set(request.receiver, id);
          }
        }
        if (id === undefined)
          opaque = `receiver ${request.receiver.constructor?.name ?? "?"}`;
        else receiverId = id;
      }
      let pending = false;
      const parts: string[] = [];
      if (opaque === undefined) {
        for (let index = 0; index < request.args.length; index += 1) {
          const part = canonical(
            request.args[index],
            request.finderArgs?.includes(index) ?? false
          );
          if (part === FN) {
            pending = true;
            parts.push("fn");
            continue;
          }
          if (part === undefined) {
            opaque = reason;
            break;
          }
          parts.push(part);
        }
      }
      const recipe = `${request.op}|${receiverId}|${parts.join(",")}`;
      if (opaque !== undefined) {
        stats.opaque += 1;
        const label = `${request.op}: ${opaque}`;
        stats.reasons[label] = (stats.reasons[label] ?? 0) + 1;
        try {
          return run(request.op, { partial: recipe, pending: false }, () =>
            request.compute()
          );
        } finally {
          if (request.effect !== "pure" && request.effect !== "alias")
            forget(request.receiver);
        }
      }
      if (pending) {
        stats.pending += 1;
        const frame: Frame = { partial: recipe, pending: true };
        const result = run(request.op, frame, () => request.compute());
        if (frame.stepKey !== undefined) assign(result, frame.stepKey);
        else if (request.effect !== "pure") forget(request.receiver);
        return result;
      }
      const key = intern(recipe);
      stats.keyed += 1;
      if (request.effect === "alias") {
        const result = run(request.op, { partial: recipe, pending: false }, () =>
          request.compute()
        );
        assign(result, receiverId);
        return result;
      }
      if (request.effect === "mutates") {
        const result = run(request.op, { partial: recipe, pending: false }, () =>
          request.compute()
        );
        if (request.receiver !== undefined) ids.set(request.receiver, key);
        if (result !== request.receiver) assign(result, `${key}>`);
        return result;
      }
      const frame: Frame = { partial: recipe, pending: false };
      frames.push(frame);
      try {
        return keyed(key, request.op, request, "op");
      } finally {
        frames.pop();
      }
    },
    step<T>(request: OperationStep<T>): T {
      const frame = frames[frames.length - 1];
      if (!frame || !frame.pending || frame.stepKey !== undefined)
        return request.compute();
      stats.steps += 1;
      const values = request.values();
      const parts: string[] = [];
      let opaque = values === undefined ? "selection not in receiver" : undefined;
      for (const value of values ?? []) {
        const part = canonical(value);
        if (typeof part !== "string") {
          opaque = part === FN ? "function" : reason;
          break;
        }
        parts.push(part);
      }
      if (opaque !== undefined) {
        stats.opaque += 1;
        const label = `${request.op} step: ${opaque}`;
        stats.reasons[label] = (stats.reasons[label] ?? 0) + 1;
        return request.compute();
      }
      const key = intern(`${frame.partial}>${request.op}|${parts.join(",")}`);
      frame.stepKey = key;
      return keyed(key, request.op, request, "step");
    },
    elements(owner, kind, elements, ordinals) {
      const ownerId =
        ids.get(owner) ?? (elementOf.has(owner) ? idOf(owner) : undefined);
      if (ownerId === undefined) return;
      const group: ElementGroup = { ownerId, kind, ordinals };
      elements.forEach((element, index) => {
        ids.delete(element);
        elementOf.set(element, { group, index });
      });
    },
  };

  return {
    cache,
    /** Starts a build: occurrences restart, counters reset. */
    beginBuild() {
      occurrences.clear();
      frames.length = 0;
      stats = freshStats();
    },
    get stats() {
      return stats;
    },
    retainedCount: () => retained.size,
    idOf: (value: object) => idOf(value),
    /** Deletes every retained value. */
    dispose() {
      for (const value of retained.values()) {
        if (value instanceof NegativeResult) {
          if (!(value.error instanceof Error))
            getOC().decrementExceptionRefcount(value.error);
        } else
          bypassOperationCache(() => {
            const free = (entry: any): void => {
              if (Array.isArray(entry)) entry.forEach(free);
              else entry?.delete?.();
            };
            free(value);
          });
      }
      retained.clear();
    },
  };
}

export type TestCache = ReturnType<typeof createTestCache>;

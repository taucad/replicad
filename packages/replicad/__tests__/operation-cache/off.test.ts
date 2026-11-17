/**
 * With no cache installed the seam does nothing (I2, G-E6), and with one
 * installed the library builds nothing the cache does not ask for (G-E3).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import * as replicad from "../../src/index";
import {
  getOC,
  getOperationCache,
  setOperationCache,
  type OperationCache,
  type OperationRequest,
} from "../../src/index";
import * as shapeHelpers from "../../src/shapeHelpers";
import { classEffects, ROUTED_FUNCTION_NAMES } from "../../src/operationEffects";
import { routeFunction } from "../../src/operationCache";
import { corpus, deleteAll, finderClosure } from "./models";
import { createTestCache } from "./testCache";

vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  setOperationCache(undefined);
});

const isClass = (value: unknown): value is { prototype: object } =>
  typeof value === "function" &&
  /^class\b/.test(Function.prototype.toString.call(value));

type Snapshot = Map<object, Map<string, PropertyDescriptor>>;

/** Every own property descriptor of every exported class's prototype chain. */
const snapshot = (): Snapshot => {
  const result: Snapshot = new Map();
  for (const value of Object.values(replicad)) {
    if (!isClass(value)) continue;
    for (
      let prototype = value.prototype;
      prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      if (result.has(prototype)) continue;
      const members = new Map<string, PropertyDescriptor>();
      for (const name of Object.getOwnPropertyNames(prototype))
        members.set(name, Object.getOwnPropertyDescriptor(prototype, name)!);
      result.set(prototype, members);
    }
  }
  return result;
};

/** Names whose descriptor differs (by function identity) between snapshots. */
const changed = (before: Snapshot, after: Snapshot): string[] => {
  const names: string[] = [];
  for (const [prototype, members] of before) {
    const now = after.get(prototype)!;
    for (const [name, descriptor] of members) {
      const current = now.get(name);
      if (
        !current ||
        current.value !== descriptor.value ||
        current.get !== descriptor.get ||
        current.set !== descriptor.set
      )
        names.push(`${prototype.constructor.name}.${name}`);
    }
    for (const name of now.keys())
      if (!members.has(name)) names.push(`${prototype.constructor.name}.${name}+`);
  }
  return names.sort();
};

const passThrough = (): OperationCache & { requests: string[] } => {
  const requests: string[] = [];
  return {
    requests,
    operation<T>(request: OperationRequest<T>): T {
      requests.push(request.op);
      return request.compute();
    },
    step: (request) => request.compute(),
    elements: () => undefined,
  };
};

const countHashCodes = <T>(fn: () => T): { result: T; calls: number } => {
  const hasher = getOC().ReplicadShapeHasher as unknown as {
    HashCode: (...args: unknown[]) => number;
  };
  const original = hasher.HashCode;
  let calls = 0;
  const counting = function (this: unknown, ...args: unknown[]) {
    calls += 1;
    return original.apply(this, args);
  };
  // Embind dispatches overloads through a table on the function object.
  Object.assign(counting, original);
  hasher.HashCode = counting;
  try {
    return { result: fn(), calls };
  } finally {
    hasher.HashCode = original;
  }
};

const params = { width: 60, hole: 4, angle: 0 };

describe("I2 / G-E6 zero hook work when off", () => {
  test("G-E6 with no cache, every prototype member is the original function object", () => {
    expect(getOperationCache()).toBeUndefined();
    const before = snapshot();
    deleteAll(corpus(params));
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("G-E6 installing routes only the table's routed members; removing restores the original objects", () => {
    const before = snapshot();
    const cache = passThrough();
    setOperationCache(cache);
    const installed = changed(before, snapshot());
    // Routed: methods of routed classes that are not unrouted, element and
    // routed getters, setters, and Finder.find.
    const expected = new Set<string>(["Finder.find"]);
    for (const entry of classEffects()) {
      if (!entry.routed) continue;
      const name = (entry.target.prototype as object).constructor.name;
      for (const [member, effect] of Object.entries(entry.members)) {
        if (entry.unrouted?.includes(member)) continue;
        const key = member.replace(/^set:/, "");
        const descriptor = Object.getOwnPropertyDescriptor(
          entry.target.prototype,
          key
        )!;
        const isGetter = descriptor.get && !member.startsWith("set:");
        if (
          isGetter &&
          !(entry.elementGetters && key in entry.elementGetters) &&
          !entry.routedGetters?.includes(key)
        )
          continue;
        void effect;
        expected.add(`${name}.${key}`);
      }
    }
    expect(installed).toEqual([...expected].sort());

    // Replacing the cache keeps the routing; removing it restores everything.
    const other = passThrough();
    expect(setOperationCache(other)).toBe(cache);
    expect(changed(before, snapshot())).toEqual(installed);
    expect(setOperationCache(undefined)).toBe(other);
    expect(changed(before, snapshot())).toEqual([]);
  });

  test("G-E6 a removed cache is never called again", () => {
    const cache = passThrough();
    setOperationCache(cache);
    deleteAll(finderClosure({ top: true, radius: 2 }));
    const calls = cache.requests.length;
    expect(calls).toBeGreaterThan(0);
    setOperationCache(undefined);
    deleteAll(corpus(params));
    expect(cache.requests.length).toBe(calls);
  });

  test("G-E6 with no cache, no element ordinals or selection copies are computed", () => {
    // HashCode is what element ordinals cost; the library also uses it on its
    // own (topology enumeration), so compare with a run that cannot route.
    const off = countHashCodes(() => deleteAll(corpus(params))).calls;
    const again = countHashCodes(() => deleteAll(corpus(params))).calls;
    expect(again).toBe(off);
    const cache = createTestCache({ recordFinders: false });
    setOperationCache(cache.cache);
    cache.beginBuild();
    const keyed = countHashCodes(() => corpus(params)).calls;
    setOperationCache(undefined);
    cache.dispose();
    // A cache that keys selections does compute ordinals: the probe works.
    expect(keyed).toBeGreaterThan(off);
  });

  test("G-E6 exported free functions are routed wrappers that call the implementation unchanged when off", () => {
    for (const name of ROUTED_FUNCTION_NAMES) {
      const exported = (replicad as any)[name];
      const implementation = (shapeHelpers as any)[name];
      if (implementation) expect(exported, name).not.toBe(implementation);
    }
    const box = replicad.makeBox([0, 0, 0], [1, 2, 3]);
    const direct = shapeHelpers.makeBox([0, 0, 0], [1, 2, 3]);
    expect(box.boundingBox.bounds).toEqual(direct.boundingBox.bounds);
    expect(box.constructor).toBe(direct.constructor);
    deleteAll([box, direct]);
  });
});

describe("I2 free functions off", () => {
  test("I2 with no cache a routed function forwards this and the arguments, copying nothing", () => {
    const seen: { self: unknown; args: unknown[] }[] = [];
    const implementation = function (this: unknown, ...args: unknown[]) {
      seen.push({ self: this, args });
      return args.length;
    };
    const routed = routeFunction("probe", implementation);
    const receiver = {};
    const argument = { value: 1 };
    // Spy on the copies a routed call could make of its arguments.
    const slice = vi.spyOn(Array.prototype, "slice");
    const from = vi.spyOn(Array, "from");
    try {
      expect(routed.call(receiver, argument, undefined)).toBe(2);
      expect(slice).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    } finally {
      slice.mockRestore();
      from.mockRestore();
    }
    expect(seen[0].self).toBe(receiver);
    expect(seen[0].args[0]).toBe(argument);
    // The no-cache branch comes before any copy or request in the wrapper.
    const source = Function.prototype.toString.call(routed);
    const off = source.indexOf("apply(this, arguments");
    expect(off).toBeGreaterThan(0);
    for (const later of ["slice", "...", "_runOperation", "args"])
      if (source.includes(later))
        expect(source.indexOf(later), later).toBeGreaterThan(off);
  });

  test("I2 routed exports keep name and arity", () => {
    const routed = routeFunction("probe", function probe(a: number, b: number) {
      return a + b;
    });
    expect(routed.name).toBe("probe");
    expect(routed.length).toBe(2);
  });
});

describe("cache installation", () => {
  test("the cache cannot be changed while an operation runs", () => {
    const first = passThrough();
    const second = passThrough();
    setOperationCache(first);
    let attempted: unknown;
    first.operation = function <T>(request: OperationRequest<T>): T {
      first.requests.push(request.op);
      return request.compute();
    };
    // Library-internal work (inside an operation, or a cache's bypassed
    // calls) runs at depth 1.
    expect(() =>
      replicad.bypassOperationCache(() => setOperationCache(second))
    ).toThrow(/cannot be changed while an operation runs/);
    try {
      replicad.bypassOperationCache(() => setOperationCache(undefined));
    } catch (error) {
      attempted = error;
    }
    expect(String(attempted)).toMatch(/while an operation runs/);
    expect(getOperationCache()).toBe(first);
    // Back at the top level: routed calls reach the cache and it can change.
    deleteAll([replicad.makeBaseBox(1, 1, 1)]);
    expect(first.requests).toEqual(["makeBaseBox"]);
    expect(setOperationCache(second)).toBe(first);
    deleteAll([replicad.makeBaseBox(1, 1, 1)]);
    expect(second.requests).toEqual(["makeBaseBox"]);
  });

  test("draw() is flagged as returning a builder", () => {
    const seen: OperationRequest<unknown>[] = [];
    setOperationCache({
      operation<T>(request: OperationRequest<T>): T {
        seen.push(request as OperationRequest<unknown>);
        return request.compute();
      },
      step: (request) => request.compute(),
      elements: () => undefined,
    });
    replicad.draw().hLine(1).vLine(1).close();
    replicad.drawCircle(1);
    setOperationCache(undefined);
    const builders = seen.filter((request) => request.returnsBuilder).map((r) => r.op);
    expect(builders).toEqual(["draw"]);
  });
});

describe("G-E3 lazy recipes", () => {
  test("G-E3 a cache that reads nothing makes the library build no keys", () => {
    const off = countHashCodes(() => deleteAll(corpus(params))).calls;
    const cache = passThrough();
    setOperationCache(cache);
    const routed = countHashCodes(() => deleteAll(corpus(params))).calls;
    setOperationCache(undefined);
    expect(cache.requests.length).toBeGreaterThan(50);
    expect(routed).toBe(off);
  });

  test("G-E3 requests carry the raw receiver and arguments, not canonical copies", () => {
    const seen: OperationRequest<unknown>[] = [];
    setOperationCache({
      operation<T>(request: OperationRequest<T>): T {
        seen.push(request as OperationRequest<unknown>);
        return request.compute();
      },
      step: (request) => request.compute(),
      elements: () => undefined,
    });
    const corner: [number, number, number] = [1, 2, 3];
    const box = replicad.makeBox([0, 0, 0], corner);
    const moved = box.translate(corner);
    setOperationCache(undefined);
    const makeBoxRequest = seen.find((request) => request.op === "makeBox")!;
    expect(makeBoxRequest.args[1]).toBe(corner);
    const translate = seen.find((request) => request.op === "Shape.translate")!;
    expect(translate.receiver).toBe(box);
    expect(translate.args[0]).toBe(corner);
    expect(translate.effect).toBe("consumes");
    moved.delete();
  });

  test("G-E3 operations made inside an operation pass through (internal composition)", () => {
    const cache = passThrough();
    setOperationCache(cache);
    // makeBaseBox translates a box internally; sketch extrusion builds faces.
    deleteAll([
      replicad.makeBaseBox(2, 2, 2),
      replicad.sketchRectangle(2, 2).extrude(1),
    ]);
    setOperationCache(undefined);
    expect(cache.requests).toEqual([
      "makeBaseBox",
      "sketchRectangle",
      "Sketch.extrude",
    ]);
  });

  test("G-E3 a sweep factory runs as user code: its calls are routed", () => {
    const cache = passThrough();
    setOperationCache(cache);
    const path = replicad.draw().vLine(10).done().sketchOnPlane("XZ") as any;
    cache.requests.length = 0;
    const swept = path.sweepSketch((plane: any) =>
      replicad.sketchCircle(1, { plane })
    );
    setOperationCache(undefined);
    expect(cache.requests).toEqual(["Sketch.sweepSketch", "sketchCircle"]);
    swept.delete();
  });
});

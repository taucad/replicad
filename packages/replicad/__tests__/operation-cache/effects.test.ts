/**
 * The effect table (I4): every public member of every exported class, and
 * every exported function, has an effect class; and the classes the table
 * declares are what the members do (G-E8, consumption on hit and miss).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import * as replicad from "../../src/index";
import {
  bypassOperationCache,
  drawCircle,
  drawRectangle,
  makeBaseBox,
  makeBox,
  setOperationCache,
  sketchCircle,
  sketchRectangle,
  Shape,
  type OperationRequest,
} from "../../src/index";
import {
  classEffects,
  finderClauses,
  functionEffects,
  ROUTED_FUNCTION_NAMES,
} from "../../src/operationEffects";
import { createTestCache } from "./testCache";
import { corpus, isDeleted } from "./models";

vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  setOperationCache(undefined);
});

const isClass = (value: unknown): value is { prototype: object } =>
  typeof value === "function" &&
  /^class\b/.test(Function.prototype.toString.call(value));

/** Prototypes of the exported classes and of every class they extend. */
const exportedPrototypes = (): object[] => {
  const prototypes = new Set<object>();
  for (const value of Object.values(replicad)) {
    if (!isClass(value)) continue;
    for (
      let prototype = value.prototype;
      prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype)
    )
      prototypes.add(prototype);
  }
  return [...prototypes];
};

/** Table keys of a prototype's public own members. */
const memberKeys = (prototype: object): string[] =>
  Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor" && !name.startsWith("_"))
    .flatMap((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
      const keys: string[] = [];
      if (descriptor.get || typeof descriptor.value === "function")
        keys.push(name);
      if (descriptor.set) keys.push(`set:${name}`);
      return keys;
    });

/** Everything the table is missing or names that do not exist. */
const surfaceProblems = (): string[] => {
  const problems: string[] = [];
  const table = classEffects();
  for (const prototype of exportedPrototypes()) {
    const name = prototype.constructor.name;
    const entries = table.filter((entry) => entry.target.prototype === prototype);
    const keys = memberKeys(prototype);
    // A class that only extends another (Solid, Shell...) needs no entry.
    if (entries.length === 0 && keys.length === 0) continue;
    if (entries.length !== 1) {
      problems.push(`${name}: ${entries.length} table entries`);
      continue;
    }
    const [entry] = entries;
    for (const key of keys)
      if (!(key in entry.members)) problems.push(`${name}.${key}: no effect`);
    for (const key of Object.keys(entry.members))
      if (!keys.includes(key)) problems.push(`${name}.${key}: not a member`);
    for (const key of [
      ...(entry.unrouted ?? []),
      ...Object.keys(entry.elementGetters ?? {}),
      ...(entry.routedGetters ?? []),
      ...Object.keys(entry.finderArgs ?? {}),
      ...(entry.deterministicErrors ?? []),
      ...Object.keys(entry.consume ?? {}),
    ])
      if (!(key in entry.members))
        problems.push(`${name}.${key}: configured but not in the table`);
    for (const key of Object.keys(entry.consume ?? {}))
      if (entry.members[key] !== "consumes")
        problems.push(`${name}.${key}: custom consume on a non-consuming member`);
  }
  const exportedPrototypeSet = new Set(exportedPrototypes());
  for (const entry of table)
    if (!exportedPrototypeSet.has(entry.target.prototype))
      problems.push(`${entry.op}: table entry for a class that is not exported`);

  const functions = Object.entries(replicad).filter(
    ([, value]) => typeof value === "function" && !isClass(value)
  );
  for (const [name] of functions)
    if (!(name in functionEffects)) problems.push(`${name}(): no effect`);
  for (const name of Object.keys(functionEffects))
    if (!functions.some(([exported]) => exported === name))
      problems.push(`${name}(): not exported`);
  return problems;
};

describe("I4 surface enumeration", () => {
  test("every public member and exported function has an effect class", () => {
    expect(surfaceProblems()).toEqual([]);
  });

  test("a new public method without an effect class fails", () => {
    const prototype = Shape.prototype as unknown as Record<string, unknown>;
    prototype.newOperation = function () {
      return this;
    };
    try {
      expect(surfaceProblems()).toEqual(["Shape.newOperation: no effect"]);
    } finally {
      delete prototype.newOperation;
    }
  });

  test("a new accessor needs an effect for its getter and its setter", () => {
    Object.defineProperty(Shape.prototype, "newProperty", {
      configurable: true,
      get: () => 1,
      set: () => undefined,
    });
    try {
      expect(surfaceProblems()).toEqual([
        "Shape.newProperty: no effect",
        "Shape.set:newProperty: no effect",
      ]);
    } finally {
      delete (Shape.prototype as any).newProperty;
    }
  });

  test("routed functions are exported routed, under their own name", () => {
    for (const name of ROUTED_FUNCTION_NAMES) {
      expect(functionEffects[name].routed, name).toBe(true);
      const exported = (replicad as any)[name];
      expect(typeof exported, name).toBe("function");
    }
  });

  test("routed exports keep the implementation's name, arity and JSDoc", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = (path: string) =>
      readFileSync(resolve(import.meta.dirname, "../../src", path), "utf8");
    const index = src("index.ts");
    const modules: Record<string, string> = {};
    for (const [, alias, path] of index.matchAll(
      /^import type \* as (\w+) from "\.\/([\w/]+)";$/gm
    ))
      modules[alias] = src(`${path}.ts`);
    const docBefore = (text: string, at: number): string | undefined =>
      /(\/\*\*(?:(?!\*\/)[\s\S])*?\*\/)\s*$/.exec(text.slice(0, at))?.[1];
    for (const name of ROUTED_FUNCTION_NAMES) {
      const exported = (replicad as any)[name];
      const line = new RegExp(
        `^export const ${name}: typeof (\\w+)\\.${name} = routedFunctions\\.${name};$`,
        "m"
      ).exec(index);
      expect(line, name).not.toBeNull();
      const module = modules[line![1]];
      const declaration = new RegExp(
        `^(?:export )?(?:const|function|async function) ${name}\\b`,
        "m"
      ).exec(module)!;
      expect(docBefore(index, line!.index), name).toBe(
        docBefore(module, declaration.index)
      );
      expect(exported.name, name).not.toBe("");
      expect(exported.length, name).toBeGreaterThanOrEqual(0);
    }
    expect(replicad.makeBox.name).toBe("makeBox");
    expect(replicad.makeBox.length).toBe(2);
    expect(replicad.makeCylinder.length).toBe(2);
  });

  test("every finder clause is described as a value, combinator or predicate clause", () => {
    const clauses = [
      ...finderClauses.value,
      ...finderClauses.combinator,
      ...finderClauses.predicate,
    ];
    expect(new Set(clauses).size).toBe(clauses.length);
    const mutating = new Set(
      classEffects()
        .filter((entry) => entry.op === "Finder")
        .flatMap((entry) =>
          Object.entries(entry.members)
            .filter(([, effect]) => effect === "mutates")
            .map(([name]) => name)
        )
    );
    expect([...mutating].sort()).toEqual([...clauses].sort());
  });

  test("G-E10 qualified failures: only fillet, chamfer, shell and draft declare deterministic errors", () => {
    const flagged = new Set<string>();
    const cache = {
      operation<T>(request: OperationRequest<T>): T {
        if (request.deterministicErrors) flagged.add(request.op);
        return request.compute();
      },
      step: <T>(request: { op: string; deterministicErrors?: boolean; compute(): T }) => {
        if (request.deterministicErrors) flagged.add(`${request.op} step`);
        return request.compute();
      },
      elements: () => undefined,
    };
    setOperationCache(cache);
    const shapes = corpus({ width: 60, hole: 4, angle: 0 });
    setOperationCache(undefined);
    shapes.forEach((shape) => shape.delete());
    const declared = classEffects().flatMap((entry) =>
      (entry.deterministicErrors ?? []).map((name) => `${entry.op}.${name}`)
    );
    expect(declared.sort()).toEqual([
      "Shape.chamfer",
      "Shape.draft",
      "Shape.fillet",
      "Shape.shell",
    ]);
    for (const op of flagged)
      expect(declared).toContain(op.replace(/ step$/, ""));
    expect(flagged).toContain("Shape.fillet");
    expect(flagged).toContain("Shape.shell step");
  });
});

/**
 * One case per consuming member (and pure controls): builds a receiver and
 * arguments with routed calls, so they have identities, and runs the member.
 */
/** A square with a round hole, sketched: a `CompoundSketch`. */
const compound = (
  size = 10,
  hole = 2,
  x = 0,
  plane: "XY" | "XZ" = "XY",
  offset = 0
): any =>
  (
    drawRectangle(size, size)
      .cut(drawCircle(hole))
      .translate(x, 0)
      .sketchOnPlane(plane, offset) as any
  ).sketches[0];

type Case = () => { values: object[]; run: () => unknown };
const consumptionCases: Record<string, Case> = {
  "Shape.translate": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.translate(1, 2, 3) };
  },
  "Shape.translateX": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.translateX(1) };
  },
  "Shape.translateY": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.translateY(1) };
  },
  "Shape.translateZ": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.translateZ(1) };
  },
  "Shape.rotate": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.rotate(30) };
  },
  "Shape.mirror": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.mirror("YZ") };
  },
  "Shape.scale": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.scale(2) };
  },
  "Shape.fuse (pure control)": () => {
    const a = makeBaseBox(4, 4, 4);
    const b = makeBox([2, 2, 2], [6, 6, 6]);
    return { values: [a, b], run: () => a.fuse(b) };
  },
  "Shape.fillet (pure control)": () => {
    const box = makeBaseBox(4, 4, 4);
    return { values: [box], run: () => box.fillet(0.5) };
  },
  "Shape.offset2D (Wire)": () => {
    const wire = drawRectangle(10, 10).sketchOnPlane().wires();
    return { values: [wire], run: () => wire.offset2D(1) };
  },
  "Shape.outerWire (Face)": () => {
    const face = compound().face();
    return { values: [face], run: () => face.outerWire() };
  },
  "Shape.innerWires (Face)": () => {
    const face = compound().face();
    return { values: [face], run: () => face.innerWires() };
  },
  "Sketch.extrude": () => {
    const sketch = sketchRectangle(5, 5);
    return { values: [sketch], run: () => sketch.extrude(2) };
  },
  "Sketch.revolve": () => {
    const sketch = drawRectangle(2, 2).translate(5, 0).sketchOnPlane("XZ") as any;
    return { values: [sketch], run: () => sketch.revolve() };
  },
  "Sketch.loftWith": () => {
    const a = sketchCircle(4);
    const b = sketchCircle(2, { origin: [0, 0, 10] } as any);
    return { values: [a, b], run: () => a.loftWith(b) };
  },
  "Sketch.loftWith (array)": () => {
    const a = sketchCircle(4);
    const b = sketchCircle(3, { origin: [0, 0, 5] } as any);
    const c = sketchCircle(2, { origin: [0, 0, 10] } as any);
    return { values: [a, b, c], run: () => a.loftWith([b, c]) };
  },
  "Sketch.sweepSketch": () => {
    const rail = drawRectangle(1, 1).sketchOnPlane() as any;
    const path = (replicad.draw().vLine(20).done().sketchOnPlane("XZ") as any);
    return {
      values: [path, rail],
      run: () => path.sweepSketch((plane: any) => sketchCircle(1, { plane })),
    };
  },
  "Sketch.face (pure control)": () => {
    const sketch = sketchRectangle(5, 5);
    return { values: [sketch], run: () => sketch.face() };
  },
  "CompoundSketch.extrude (pure)": () => {
    const sketch = compound();
    return { values: [sketch], run: () => sketch.extrude(2) };
  },
  "CompoundSketch.revolve (pure)": () => {
    const sketch = compound(4, 1, 6, "XZ");
    return { values: [sketch], run: () => sketch.revolve() };
  },
  "CompoundSketch.loftWith (pure)": () => {
    const a = compound();
    const b = compound(8, 2, 0, "XY", 10);
    return { values: [a, b], run: () => a.loftWith(b, {}) };
  },
  "Sketches.extrude": () => {
    const sketches = drawRectangle(10, 10)
      .cut(drawCircle(2))
      .fuse(drawCircle(3).translate(20, 0))
      .sketchOnPlane() as any;
    return {
      values: [...sketches.sketches, sketches],
      run: () => sketches.extrude(2),
    };
  },
  "Sketches.revolve": () => {
    const sketches = drawRectangle(4, 4)
      .cut(drawCircle(1))
      .fuse(drawCircle(1).translate(6, 0))
      .translate(10, 0)
      .sketchOnPlane("XZ") as any;
    return {
      values: [...sketches.sketches, sketches],
      run: () => sketches.revolve(),
    };
  },
  compoundShapes: () => {
    const a = makeBaseBox(4, 4, 4);
    const b = makeBox([10, 0, 0], [12, 2, 2]);
    return { values: [a, b], run: () => replicad.compoundShapes([a, b]) };
  },
  makeCompound: () => {
    const a = makeBaseBox(4, 4, 4);
    const b = makeBox([10, 0, 0], [12, 2, 2]);
    return { values: [a, b], run: () => replicad.makeCompound([a, b]) };
  },
  sketchFaceOffset: () => {
    const face = compound().face();
    return { values: [face], run: () => replicad.sketchFaceOffset(face, 1) };
  },
  "CompoundSketch.wires": () => {
    const sketch = compound();
    return { values: [sketch], run: () => sketch.wires };
  },
  "Sketches.wires": () => {
    const sketches = drawRectangle(10, 10)
      .cut(drawCircle(2))
      .fuse(drawCircle(3).translate(20, 0))
      .sketchOnPlane() as any;
    return {
      values: [...sketches.sketches, sketches],
      run: () => sketches.wires(),
    };
  },
  "Drawing.sketchOnPlane (pure control)": () => {
    const drawing = drawCircle(3);
    return { values: [drawing], run: () => drawing.sketchOnPlane() };
  },
};

const deletionState = (values: object[]): boolean[] =>
  bypassOperationCache(() => values.map(isDeleted));

describe("G-E8 consumption per member", () => {
  test("the cases cover every routed consuming member and function", () => {
    const consumingFunctions = Object.entries(functionEffects)
      .filter(([, { effect, routed }]) => routed && effect === "consumes")
      .map(([name]) => name);
    expect(consumingFunctions.sort()).toEqual([
      "compoundShapes",
      "makeCompound",
      "sketchFaceOffset",
    ]);
    for (const name of consumingFunctions)
      expect(Object.keys(consumptionCases), name).toContain(name);
    const consuming = classEffects()
      .filter((entry) => entry.routed)
      .flatMap((entry) =>
        Object.entries(entry.members)
          .filter(
            ([name, effect]) =>
              effect === "consumes" && !entry.unrouted?.includes(name)
          )
          .map(([name]) => `${entry.op}.${name}`)
      );
    const covered = Object.keys(consumptionCases).map((name) =>
      name.replace(/ \(.*\)$/, "")
    );
    for (const op of consuming) expect(covered, op).toContain(op);
  });

  for (const [name, makeCase] of Object.entries(consumptionCases)) {
    test(`G-E8 ${name}: deletes the same values on a hit as on a miss and off`, () => {
      const off = makeCase();
      off.run();
      const truth = deletionState(off.values);

      const cache = createTestCache();
      setOperationCache(cache.cache);
      const states = [0, 1].map(() => {
        cache.beginBuild();
        const run = makeCase();
        run.run();
        return { state: deletionState(run.values), stats: { ...cache.stats } };
      });
      setOperationCache(undefined);
      cache.dispose();

      expect(states[0].state, "miss").toEqual(truth);
      expect(states[1].state, "hit").toEqual(truth);
      expect(states[1].stats.misses, "second run is all hits").toBe(0);
      expect(states[1].stats.opaque).toBe(0);
    });
  }
});

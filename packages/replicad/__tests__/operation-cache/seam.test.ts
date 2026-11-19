/**
 * Seam behavior with a resident cache: ports of the synthetic models the seam
 * was qualified with, and the W4 gates that apply to the library.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  asPnt,
  bypassOperationCache,
  setOperationCache,
  type AnyShape,
} from "../../src/index";
import { createTestCache, type TestCache } from "./testCache";
import {
  callbackClosure,
  consumeCheck,
  corpus,
  deleteAll,
  finderClosure,
  fingerprint,
  upstreamOps,
} from "./models";

vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  setOperationCache(undefined);
});

/** Runs `build` once without a cache and returns the fingerprint. */
const offRun = <P>(build: (p: P) => AnyShape[], params: P): string[] => {
  const shapes = build(params);
  const result = fingerprint(shapes);
  deleteAll(shapes);
  return result;
};

/** Runs `build` once inside `cache` (a build boundary) and fingerprints it. */
const cachedRun = <P>(
  cache: TestCache,
  build: (p: P) => AnyShape[],
  params: P
): string[] => {
  cache.beginBuild();
  const shapes = build(params);
  const result = bypassOperationCache(() => fingerprint(shapes));
  bypassOperationCache(() => deleteAll(shapes));
  return result;
};

/**
 * Runs a parameter history off and with one resident cache, step by step,
 * and checks each step against reuse off. Returns the cache.
 */
const history = <P>(
  build: (p: P) => AnyShape[],
  steps: readonly P[],
  options: Parameters<typeof createTestCache>[0] = {}
) => {
  const truth = steps.map((params) => offRun(build, params));
  const cache = createTestCache(options);
  setOperationCache(cache.cache);
  const stats = steps.map((params, index) => {
    expect(cachedRun(cache, build, params), `step ${index}`).toEqual(
      truth[index]
    );
    return { ...cache.stats };
  });
  setOperationCache(undefined);
  cache.dispose();
  return { stats, truth };
};

describe("finder closure (identity of a captured variable)", () => {
  const base = { top: true, radius: 2 };
  const steps = [base, { top: false, radius: 2 }, base, { top: true, radius: 3 }, base];

  test("recorded finders: every step equals reuse off; revisits are hits", () => {
    const { stats, truth } = history(finderClosure, steps);
    expect(truth[1]).not.toEqual(truth[0]);
    expect(stats.every((s) => s.opaque === 0)).toBe(true);
    expect(stats[2].misses).toBe(0);
    expect(stats[4].misses).toBe(0);
    expect(stats[1].misses).toBeGreaterThan(0);
  });

  test("unrecorded finders: keyed on the selection after it ran", () => {
    const { stats } = history(finderClosure, steps, { recordFinders: false });
    expect(stats.every((s) => s.opaque === 0)).toBe(true);
    expect(stats[0].steps).toBe(1);
    expect(stats[2].stepHits).toBe(1);
    expect(stats[1].stepHits).toBe(0);
  });
});

describe("callback closure (opaque predicate, sweep factory, fresh sketcher)", () => {
  const base = { h: 20, radius: 2, profile: 3 };
  const steps = [base, { ...base, h: 0 }, base, { ...base, profile: 4 }, base];

  test("every step equals reuse off with no opaque call", () => {
    const { stats, truth } = history(callbackClosure, steps);
    expect(truth[1][0]).not.toEqual(truth[0][0]);
    expect(truth[3][1]).not.toEqual(truth[0][1]);
    for (const s of stats) expect(s.reasons).toEqual({});
    expect(stats[2].misses).toBe(0);
    expect(stats[4].misses).toBe(0);
  });

  test("the predicate and the factory are keyed by what they produced", () => {
    const { stats } = history(callbackClosure, steps);
    // Fillet with a `when` predicate and the sweep: two steps per build.
    expect(stats[0].steps).toBe(2);
    expect(stats[2].stepHits).toBe(2);
    // The h edit selects other edges: the fillet step misses.
    expect(stats[1].stepHits).toBe(1);
  });
});

describe("G-E8 consumption is identical on hit and miss", () => {
  test("consume-check flags and outputs equal reuse off on every step", () => {
    const build = (p: { size: number }) => consumeCheck(p).shapes;
    const { stats } = history(build, [
      { size: 10 },
      { size: 12 },
      { size: 10 },
      { size: 10 },
    ]);
    expect(stats[2].misses).toBe(0);
    expect(stats[3].misses).toBe(0);
  });

  test("the flags themselves: consumed on hit as on miss", () => {
    const off = consumeCheck({ size: 10 });
    deleteAll(off.shapes);
    const cache = createTestCache();
    setOperationCache(cache.cache);
    for (let index = 0; index < 2; index += 1) {
      cache.beginBuild();
      const run = consumeCheck({ size: 10 });
      expect(run.flags, index === 0 ? "miss" : "hit").toEqual(off.flags);
      bypassOperationCache(() => deleteAll(run.shapes));
    }
    expect(cache.stats.misses).toBe(0);
    setOperationCache(undefined);
    cache.dispose();
  });
});

describe("G-E1 parity: off, cold, resident", () => {
  const base = { width: 60, hole: 4, angle: 0 };
  const steps = [
    base,
    { ...base, hole: 5 },
    base,
    { ...base, angle: 30 },
    base,
    base,
  ];

  test("G-E1 within-arm determinism: two off runs are identical", () => {
    expect(offRun(corpus, base)).toEqual(offRun(corpus, base));
  });

  test("G-E1 every step of a history equals reuse off (cold and resident)", () => {
    const { stats, truth } = history(corpus, steps);
    expect(truth[1]).not.toEqual(truth[0]);
    expect(truth[3]).not.toEqual(truth[0]);
    expect(stats[2].misses).toBe(0);
    expect(stats[5].misses).toBe(0);
  });

  test("G-E1 randomized histories give the same outputs (history independence)", () => {
    const options = [
      base,
      { ...base, hole: 5 },
      { ...base, angle: 30 },
      { ...base, width: 70 },
    ];
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const truth = options.map((params) => offRun(corpus, params));
    for (let trial = 0; trial < 3; trial += 1) {
      const cache = createTestCache();
      setOperationCache(cache.cache);
      for (let step = 0; step < 6; step += 1) {
        const choice = Math.floor(random() * options.length);
        expect(cachedRun(cache, corpus, options[choice])).toEqual(truth[choice]);
      }
      setOperationCache(undefined);
      cache.dispose();
    }
  });

  test("G-E1 alias and placement: a hit returns a new object at the same placement", () => {
    const cache = createTestCache();
    setOperationCache(cache.cache);
    const results = [0, 1].map(() => {
      cache.beginBuild();
      const shape = finderClosure({ top: true, radius: 2 })[0].translate(5, 0, 0);
      return shape;
    });
    expect(cache.stats.misses).toBe(0);
    expect(results[0]).not.toBe(results[1]);
    expect(results[0].wrapped).not.toBe(results[1].wrapped);
    const bounds = bypassOperationCache(() =>
      results.map((shape) => shape.boundingBox.bounds)
    );
    expect(bounds[1]).toEqual(bounds[0]);
    // Deleting one result leaves the other and the kept value usable.
    bypassOperationCache(() => results[0].delete());
    expect(bypassOperationCache(() => results[1].boundingBox.bounds)).toEqual(
      bounds[0]
    );
    cache.beginBuild();
    const again = finderClosure({ top: true, radius: 2 })[0].translate(5, 0, 0);
    expect(bypassOperationCache(() => again.boundingBox.bounds)).toEqual(
      bounds[0]
    );
    setOperationCache(undefined);
    cache.dispose();
  });
});

describe("upstream 1.2 operations", () => {
  const base = { limit: 20, hole: 4, simplify: true };
  const steps = [
    base,
    { ...base, simplify: false },
    base,
    { ...base, limit: 25 },
    base,
    { ...base, hole: 5 },
    base,
  ];

  test("every step equals reuse off; revisits are all hits; no opaque call", () => {
    const { stats, truth } = history(upstreamOps, steps);
    expect(truth[3]).not.toEqual(truth[0]);
    expect(truth[5]).not.toEqual(truth[0]);
    for (const s of stats) {
      expect(s.reasons).toEqual({});
      expect(s.opaque).toBe(0);
    }
    for (const index of [2, 4, 6]) expect(stats[index].misses).toBe(0);
    expect(stats[1].misses).toBeGreaterThan(0);
  });

  test("randomized histories give the same outputs (history independence)", () => {
    const options = [
      base,
      { ...base, simplify: false },
      { ...base, limit: 25 },
      { ...base, hole: 5 },
    ];
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const truth = options.map((params) => offRun(upstreamOps, params));
    for (let trial = 0; trial < 2; trial += 1) {
      const cache = createTestCache();
      setOperationCache(cache.cache);
      for (let step = 0; step < 6; step += 1) {
        const choice = Math.floor(random() * options.length);
        expect(cachedRun(cache, upstreamOps, options[choice])).toEqual(
          truth[choice]
        );
      }
      setOperationCache(undefined);
      cache.dispose();
    }
  });
});

describe("G-E2 complete lineage", () => {
  test("G-E2 no opaque call on the corpus, cold or resident", () => {
    const { stats } = history(corpus, [
      { width: 60, hole: 4, angle: 0 },
      { width: 60, hole: 4, angle: 0 },
    ]);
    for (const s of stats) {
      expect(s.reasons).toEqual({});
      expect(s.opaque).toBe(0);
    }
    expect(stats[0].calls).toBeGreaterThan(50);
    expect(stats[1].misses).toBe(0);
  });

  test("G-E2 an untracked argument makes the call opaque, not a false hit", () => {
    const cache = createTestCache();
    setOperationCache(cache.cache);
    const results: string[][] = [];
    for (const x of [1, 2]) {
      cache.beginBuild();
      const box = finderClosure({ top: true, radius: 2 })[0];
      // A raw OpenCascade point: the cache cannot describe it.
      const moved = box.translate(asPnt([x, 0, 0]) as any);
      results.push(bypassOperationCache(() => fingerprint([moved])));
      expect(cache.stats.opaque).toBe(1);
    }
    expect(results[0]).not.toEqual(results[1]);
    setOperationCache(undefined);
    cache.dispose();
  });
});

/**
 * Failures keep their class and message on a hit and a miss, and only
 * qualified failures are reused (G-E10). Imports are routed on their content
 * and own their handles exactly (G-J8).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  bypassOperationCache,
  drawCircle,
  drawRectangle,
  getOC,
  importSTEP,
  importSTL,
  makeBaseBox,
  makeBox,
  makeCylinder,
  setOperationCache,
  type AnyShape,
} from "../../src/index";
import { createTestCache, qualifiesNegative } from "./testCache";
import { fingerprint, isDeleted } from "./models";

vi.setConfig({ testTimeout: 120_000 });

afterEach(() => {
  setOperationCache(undefined);
});

/** Constructor name and message of a thrown value (OpenCascade or JS). */
const describeError = (error: unknown): [string, unknown] => {
  if (error instanceof Error) return [error.constructor.name, error.message];
  return [
    (error as object)?.constructor?.name ?? typeof error,
    getOC().getExceptionMessage(error as any),
  ];
};

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
};

const failures: Record<string, () => unknown> = {
  fillet: () => makeBaseBox(10, 10, 10).fillet(20),
  "fillet (finder)": () =>
    makeBaseBox(10, 10, 10).fillet(20, (e) => e.inPlane("XY", 10)),
  "fillet (predicate)": () =>
    makeBaseBox(10, 10, 10).fillet(20, (e) =>
      e.when(({ element }) => element.boundingBox.bounds[1][2] > 9)
    ),
  chamfer: () => makeBaseBox(10, 10, 10).chamfer(6),
  "chamfer (finder)": () =>
    makeBaseBox(10, 10, 10).chamfer(6, (e) => e.inPlane("XY", 10)),
  shell: () => makeCylinder(5, 10).shell(5, (f) => f.inPlane("XY", 10)),
  draft: () => makeBaseBox(10, 10, 10).draft(89.9, (f) => f.inPlane("XY", 10)),
};

describe("negative results keep class and message on hit and miss", () => {
  for (const [name, fail] of Object.entries(failures)) {
    for (const recordFinders of [true, false]) {
      test(`G-E10 ${name}${recordFinders ? "" : " (selection step)"}: same failure off, on a miss and on a hit; a hit skips the solve`, () => {
        const off = describeError(thrown(fail));
        expect(off[0]).toMatch(/Exception|Error/);
        const cache = createTestCache({ recordFinders });
        setOperationCache(cache.cache);
        const runs = [0, 1].map(() => {
          cache.beginBuild();
          const error = thrown(fail);
          return { error: describeError(error), stats: { ...cache.stats } };
        });
        setOperationCache(undefined);
        cache.dispose();
        expect(runs[0].error, "miss").toEqual(off);
        expect(runs[1].error, "hit").toEqual(off);
        expect(runs[0].stats.negativeStored).toBe(1);
        expect(runs[1].stats.negativeHits).toBe(1);
        const op = name.split(" ")[0];
        expect(runs[1].stats.computes[`Shape.${op}`] ?? 0).toBe(
          // A pending operation (a predicate) still runs its selection.
          name.includes("predicate") || !recordFinders
            ? runs[0].stats.computes[`Shape.${op}`]! - 1
            : 0
        );
      });
    }
  }

  test("G-E10 a failure from a user predicate is not reused: the predicate runs again", () => {
    let calls = 0;
    const fail = () =>
      makeBaseBox(10, 10, 10).fillet(1, (e) =>
        e.when(() => {
          calls += 1;
          throw new Error("user predicate failed");
        })
      );
    const cache = createTestCache();
    setOperationCache(cache.cache);
    for (let run = 0; run < 2; run += 1) {
      cache.beginBuild();
      expect(describeError(thrown(fail))).toEqual([
        "Error",
        "user predicate failed",
      ]);
      expect(cache.stats.negativeStored).toBe(0);
      expect(cache.stats.negativeHits).toBe(0);
    }
    setOperationCache(undefined);
    cache.dispose();
    expect(calls).toBe(2);
  });

  test("G-E10 cancellation, resource and trap failures do not qualify", () => {
    expect(qualifiesNegative(new RangeError("Maximum call stack size exceeded"))).toBe(false);
    expect(qualifiesNegative(new Error("Aborted(OOM)"))).toBe(false);
    expect(qualifiesNegative(new Error("operation cancelled"))).toBe(false);
    expect(qualifiesNegative(new Error("out of memory"))).toBe(false);
    expect(qualifiesNegative(new Error("Could not fillet as a 3d shape"))).toBe(true);
    expect(qualifiesNegative(thrown(failures.fillet))).toBe(true);
  });
});

describe("G-E8 a consumed value fails the same way on a hit", () => {
  test("G-E8 Sketches.wires() then extrude throws identically with no cache, a cold cache and a revisit", () => {
    const model = () => {
      const s = drawRectangle(10, 10)
        .fuse(drawCircle(2).translate(20, 0))
        .sketchOnPlane() as any;
      s.wires();
      return s.extrude(5);
    };
    const off = describeError(thrown(model));
    const cache = createTestCache();
    setOperationCache(cache.cache);
    const runs = [0, 1].map(() => {
      cache.beginBuild();
      return describeError(thrown(model));
    });
    expect(cache.stats.hits).toBeGreaterThan(0);
    setOperationCache(undefined);
    cache.dispose();
    expect(runs[0], "cold").toEqual(off);
    expect(runs[1], "revisit").toEqual(off);
  });
});

const blobBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const files = () => getOC().FS.readdir("/").sort();

describe("G-J8 imports routed on their content", () => {
  const source = () => makeBox([0, 0, 0], [10, 20, 30]).fillet(2);
  const formats: [string, (shape: AnyShape) => Blob, (blob: Blob) => Promise<AnyShape>][] = [
    ["STEP", (shape) => shape.blobSTEP(), importSTEP],
  ];

  for (const [format, write, read] of formats) {
    test(`G-J8 import${format}: a hit equals the import off, owns its handles and leaves no file`, async () => {
      const shape = source();
      const bytes = await blobBytes(write(shape));
      shape.delete();
      const before = files();

      const off = await read(new Blob([bytes]));
      const truth = fingerprint([off]);
      off.delete();

      const cache = createTestCache();
      setOperationCache(cache.cache);
      cache.beginBuild();
      const miss = await read(new Blob([bytes]));
      expect(cache.stats.misses).toBe(1);
      cache.beginBuild();
      const hit = await read(new Blob([bytes.slice()]));
      expect(cache.stats.hits).toBe(1);
      expect(cache.stats.misses).toBe(0);
      expect(files()).toEqual(before);
      expect(hit).not.toBe(miss);

      // Each result is the caller's own: deleting one leaves the other and
      // the kept value intact.
      bypassOperationCache(() => miss.delete());
      expect(isDeleted(miss)).toBe(true);
      expect(isDeleted(hit)).toBe(false);
      expect(bypassOperationCache(() => fingerprint([hit]))).toEqual(truth);
      bypassOperationCache(() => hit.delete());
      cache.beginBuild();
      const again = await read(new Blob([bytes]));
      expect(cache.stats.hits).toBe(1);
      expect(bypassOperationCache(() => fingerprint([again]))).toEqual(truth);
      bypassOperationCache(() => again.delete());

      // Other content misses.
      const other = await blobBytes(
        write(bypassOperationCache(() => makeBox([0, 0, 0], [5, 5, 5])))
      );
      cache.beginBuild();
      const different = await read(new Blob([other]));
      expect(cache.stats.misses).toBe(1);
      bypassOperationCache(() => different.delete());

      setOperationCache(undefined);
      cache.dispose();
      expect(files()).toEqual(before);
    });
  }

  test("G-J8 importSTL failure: same error off, on a miss and again (import failures are not reused), no file left", async () => {
    // importSTL cannot rebuild this box's shell (a limit of the importer, as
    // on main); the failure must pass through the seam unchanged.
    const bytes = await blobBytes(
      makeBox([0, 0, 0], [10, 20, 30]).blobSTL({ binary: true })
    );
    const before = files();
    const failure = async () => {
      try {
        await importSTL(new Blob([bytes]));
      } catch (error) {
        return describeError(error);
      }
      throw new Error("expected a failure");
    };
    const off = await failure();
    const cache = createTestCache();
    setOperationCache(cache.cache);
    const runs = [];
    for (let index = 0; index < 2; index += 1) {
      cache.beginBuild();
      runs.push(await failure());
      expect(cache.stats.negativeStored).toBe(0);
      expect(cache.stats.computes.importSTL).toBe(1);
    }
    setOperationCache(undefined);
    cache.dispose();
    expect(runs).toEqual([off, off]);
    expect(files()).toEqual(before);
  });

  test("G-J8 repeated hits keep one kept value and hand out independent shapes", async () => {
    const shape = source();
    const bytes = await blobBytes(shape.blobSTEP());
    shape.delete();
    const cache = createTestCache();
    setOperationCache(cache.cache);
    const results: AnyShape[] = [];
    for (let index = 0; index < 5; index += 1) {
      cache.beginBuild();
      results.push(await importSTEP(new Blob([bytes])));
    }
    expect(cache.retainedCount()).toBe(1);
    expect(new Set(results).size).toBe(5);
    bypassOperationCache(() => results.forEach((result) => result.delete()));
    expect(results.every(isDeleted)).toBe(true);
    setOperationCache(undefined);
    cache.dispose();
  });
});

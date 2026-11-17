/**
 * T5, the ownership contract:
 *
 * - `cast()` consumes the handle it is given: it reuses it when it already has
 *   the right type and deletes it after downcasting otherwise. A cast that
 *   throws leaves its input alone.
 * - A wrapper adopts the handle it is constructed with and deletes it once.
 * - A deleted, consumed or swept wrapper (its handle deleted from outside)
 *   throws on use instead of reaching freed memory.
 * - No handle is deleted twice, whether by the caller, an operation or the
 *   finalization registry.
 * - The operation cache seam's effect table says `cast` consumes.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  cast,
  downcast,
  getOC,
  importSTEP,
  makeBaseBox,
  makeCylinder,
  Solid,
  Face,
  drawRectangle,
} from "../../src/index";
import { functionEffects } from "../../src/operationEffects";
import {
  installHandleLedger,
  type HandleLedger,
} from "../support/handleLedger";

let ledger: HandleLedger;
beforeAll(() => {
  ledger = installHandleLedger(getOC());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const forceGC = async () => {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  for (let i = 0; i < 4; i++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("T5 cast consumes its input", () => {
  test("a generic handle is downcast and deleted", () => {
    const box = makeBaseBox(4, 4, 4);
    const generic = box.wrapped.Reversed();
    const result = cast(generic);
    try {
      expect(generic.isDeleted()).toBe(true);
      expect(result).toBeInstanceOf(Solid);
      expect(result.wrapped.IsSame(box.wrapped)).toBe(true);
    } finally {
      result.delete();
      box.delete();
    }
  });

  test("a handle of the right type is adopted as it is", () => {
    const box = makeBaseBox(4, 4, 4);
    const typed = downcast(box.wrapped);
    const result = cast(typed);
    try {
      expect(result.wrapped).toBe(typed);
      expect(typed.isDeleted()).toBe(false);
    } finally {
      result.delete();
      box.delete();
    }
    expect(typed.isDeleted()).toBe(true);
  });

  test("a cast that throws leaves its input alone", () => {
    const empty = new (getOC().TopoDS_Shape)();
    expect(() => cast(empty)).toThrow();
    expect(empty.isDeleted()).toBe(false);
    empty.delete();
  });

  test("the effect table classes cast as consuming", () => {
    expect(functionEffects.cast.effect).toBe("consumes");
  });
});

describe("T5 wrappers adopt", () => {
  test("a wrapper deletes the handle it was given, once", () => {
    const box = makeBaseBox(4, 4, 4);
    const handle = downcast(box.wrapped);
    const wrapper = new Solid(handle as any);
    expect(wrapper.wrapped).toBe(handle);
    const before = ledger.stats().doubleDeletes;
    wrapper.delete();
    wrapper.delete();
    expect(handle.isDeleted()).toBe(true);
    expect(ledger.stats().doubleDeletes).toBe(before);
    box.delete();
  });

  test("sub shapes are owned by the wrappers that return them", () => {
    const box = makeBaseBox(4, 4, 4);
    const snapshot = ledger.snapshot();
    const faces = box.faces;
    expect(faces).toHaveLength(6);
    faces.forEach((face) => face.delete());
    expect(ledger.since(snapshot)).toEqual([]);
    box.delete();
  });
});

describe("T5 a dead wrapper throws on use", () => {
  test("after delete()", () => {
    const box = makeBaseBox(4, 4, 4);
    box.delete();
    expect(() => box.wrapped).toThrow(/deleted/);
    expect(() => box.faces).toThrow(/deleted/);
    expect(() => box.translate(1, 0, 0)).toThrow(/deleted/);
  });

  test("after a consuming operation", () => {
    const box = makeBaseBox(4, 4, 4);
    const moved = box.translate(1, 0, 0);
    expect(() => box.wrapped).toThrow(/deleted/);
    expect(() => box.fuse(moved)).toThrow(/deleted/);
    moved.delete();
  });

  test("after its handle was swept from outside", () => {
    const box = makeBaseBox(4, 4, 4);
    const before = ledger.stats().doubleDeletes;
    box.wrapped.delete();
    expect(() => box.wrapped).toThrow(/deleted/);
    expect(() => box.boundingBox).toThrow(/deleted/);
    box.delete();
    expect(ledger.stats().doubleDeletes).toBe(before);
  });
});

describe("T5 no handle is deleted twice", () => {
  test("operations, imports and the finalization registry together", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = ledger.stats().doubleDeletes;

    const box = makeBaseBox(10, 10, 10);
    const cylinder = makeCylinder(3, 20);
    const step = box.cut(cylinder).blobSTEP();
    const imported = await importSTEP(step);
    const face = imported.faces[0];
    const outer = (face as Face).outerWire();
    const sketch = drawRectangle(5, 5).sketchOnPlane("XY");
    const extruded = sketch.extrude(2);
    const filleted = (extruded as Solid).fillet(0.5);
    // Leave everything to the collector except what the caller deletes.
    outer.delete();
    filleted.delete();
    await forceGC();

    expect(ledger.stats().doubleDeletes - before).toBe(0);
    expect(
      errors.mock.calls.filter((call) => /deleted/.test(String(call[0])))
    ).toEqual([]);
    box.delete();
    cylinder.delete();
  });
});

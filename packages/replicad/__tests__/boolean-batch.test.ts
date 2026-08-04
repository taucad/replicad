import { expect, test } from "vitest";
import { makeBaseBox, measureVolume } from "../src/index";

const expectSameVolume = (
  left: ReturnType<typeof makeBaseBox>,
  right: ReturnType<typeof makeBaseBox>
) => {
  expect(measureVolume(left)).toBeCloseTo(measureVolume(right), 3);
};

test("fuseAll matches chained fuse and preserves its inputs", () => {
  const base = makeBaseBox(20, 20, 10);
  const toolA = makeBaseBox(20, 20, 10).translateX(12);
  const toolB = makeBaseBox(20, 20, 10).translateY(12);

  const batched = base.fuseAll([toolA, toolB]);
  const chained = base.fuse(toolA).fuse(toolB);

  expectSameVolume(batched, chained);
  expect(measureVolume(base)).toBeCloseTo(4000, 3);
  expect(measureVolume(toolA)).toBeCloseTo(4000, 3);
  expect(measureVolume(toolB)).toBeCloseTo(4000, 3);
});

test("cutAll matches chained cut and preserves its inputs", () => {
  const base = makeBaseBox(40, 40, 10);
  const toolA = makeBaseBox(8, 8, 20).translate(-10, 0, -5);
  const toolB = makeBaseBox(8, 8, 20).translate(10, 0, -5);

  const batched = base.cutAll([toolA, toolB]);
  const chained = base.cut(toolA).cut(toolB);

  expectSameVolume(batched, chained);
  expect(measureVolume(base)).toBeCloseTo(16000, 3);
  expect(measureVolume(toolA)).toBeCloseTo(1280, 3);
  expect(measureVolume(toolB)).toBeCloseTo(1280, 3);
});

test("intersectAll matches chained intersect and preserves its inputs", () => {
  const base = makeBaseBox(30, 30, 10);
  const toolA = makeBaseBox(30, 30, 10).translateX(8);
  const toolB = makeBaseBox(30, 30, 10).translateY(8);

  const batched = base.intersectAll([toolA, toolB]);
  const chained = base.intersect(toolA).intersect(toolB);

  expectSameVolume(batched, chained);
  expect(measureVolume(base)).toBeCloseTo(9000, 3);
  expect(measureVolume(toolA)).toBeCloseTo(9000, 3);
  expect(measureVolume(toolB)).toBeCloseTo(9000, 3);
});

test("empty fuseAll and cutAll return independent shapes", () => {
  const base = makeBaseBox(10, 10, 10);
  const fused = base.fuseAll([]);
  const cut = base.cutAll([]);

  expect(fused).not.toBe(base);
  expect(cut).not.toBe(base);
  expect(fused.wrapped).not.toBe(base.wrapped);
  expect(cut.wrapped).not.toBe(base.wrapped);
  expectSameVolume(fused, base);
  expectSameVolume(cut, base);
});

test("empty intersectAll fails explicitly", () => {
  const base = makeBaseBox(10, 10, 10);

  expect(() => base.intersectAll([])).toThrow(
    "Cannot intersect with an empty shape list"
  );
});

const assertPublicBooleanOptionsType = () => {
  const base = makeBaseBox(10, 10, 10);
  const tool = makeBaseBox(2, 2, 2);

  base.fuseAll([tool], { optimisation: "commonFace" });
  base.cutAll([tool], { optimisation: "sameFace" });

  // @ts-expect-error OCCT implementation knobs are intentionally not stable public API.
  base.cutAll([tool], { fuzzyValue: 0.01 });
  // @ts-expect-error OCCT implementation knobs are intentionally not stable public API.
  base.cutAll([tool], { nonDestructive: true });
  // @ts-expect-error OCCT implementation knobs are intentionally not stable public API.
  base.cutAll([tool], { simplify: false });
};

void assertPublicBooleanOptionsType;

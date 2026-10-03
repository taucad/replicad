import { expect, test } from "vitest";
import { exportSTEP, getOC, makeBaseBox } from "../src/index";
import type { ShapeConfig } from "../src/index";

const hasMaterialBindings = () =>
  "TCollection_HAsciiString" in (getOC() as object);

test("exportSTEP accepts shapes without physical material", async () => {
  const shape = makeBaseBox(10, 10, 10);
  const config: ShapeConfig = {
    shape,
    name: "box",
    color: "#336699",
    metalness: 0.5,
    roughness: 0.25,
  };

  const step = await exportSTEP([config]).text();

  expect(step).toContain("ISO-10303-21");
  shape.delete();
});

test("exportSTEP writes density with material bindings, or fails clearly", async () => {
  const shape = makeBaseBox(10, 10, 10);
  const shapes = [{ shape, name: "steel box", density: 7.85 }];

  if (hasMaterialBindings()) {
    const step = await exportSTEP(shapes).text();
    expect(step).toContain("steel box");
    expect(step).toContain("7.85");
  } else {
    expect(() => exportSTEP(shapes)).toThrow(
      "Shape density needs an OpenCascade build with material bindings"
    );
  }
  shape.delete();
});

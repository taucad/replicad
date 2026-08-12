import { expect, beforeAll } from "vitest";
import { createInstance } from "replicad-opencascadejs/single/init";
import { setOC } from "../src/index";
import toMatchSVGSnapshot from "./toMatchSVGSnapshot";

declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchSVGSnapshot(): R;
    }
  }
}

beforeAll(async function () {
  if (globalThis.replicadInit) return;
  expect.extend({ toMatchSVGSnapshot });

  const OC = await createInstance();

  setOC(OC);
  globalThis.replicadInit = true;
});

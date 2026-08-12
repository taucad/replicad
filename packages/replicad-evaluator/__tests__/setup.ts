import { beforeAll } from "vitest";
import { createInstance } from "replicad-opencascadejs/single/init";
import * as replicad from "../../replicad/src/index";

declare global {
  var replicadEvaluatorOC: any;
  var replicadEvaluatorReady: boolean | undefined;
}

beforeAll(async () => {
  if (globalThis.replicadEvaluatorReady) return;

  globalThis.replicadEvaluatorOC = await createInstance();

  replicad.setOC(globalThis.replicadEvaluatorOC);
  globalThis.replicadEvaluatorReady = true;
});

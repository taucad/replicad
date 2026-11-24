/**
 * A stand-in for the `ReplicadBooleanBatch` binding of Tau's native
 * OpenCascade build, which the OpenCascade build the tests use does not have.
 * It runs each call as one `BRepAlgoAPI` boolean with the options it was
 * given, so that the library's batch path (and what it forwards to the
 * binding) runs in the tests.
 *
 * The binding receives shape lists; the stand-in learns their contents by
 * recording `Append` while it is installed.
 */
import { getOC } from "../../src/index";

type Operation = "fuse" | "cut" | "common";

export interface EmulatedBooleanBatch {
  /** Calls the library made to the binding. */
  readonly calls: number;
  uninstall(): void;
}

export function installEmulatedBooleanBatch(): EmulatedBooleanBatch {
  const oc = getOC() as any;
  if (oc.ReplicadBooleanBatch) throw new Error("A batch binding is installed");

  let calls = 0;
  const contents = new WeakMap<object, unknown[]>();
  const listPrototype = oc.NCollection_List_TopoDS_Shape.prototype;
  const append = listPrototype.Append;
  const recording = function (this: object, ...args: unknown[]) {
    const shapes = contents.get(this) ?? [];
    shapes.push(args[0]);
    contents.set(this, shapes);
    return append.apply(this, args);
  };
  // embind's overload dispatcher reads its (minified) overload table from the
  // prototype member when called: expose the original's own properties.
  for (const key of Object.getOwnPropertyNames(append)) {
    if (["length", "name", "prototype", "arguments", "caller"].includes(key))
      continue;
    Object.defineProperty(recording, key, {
      get: () => append[key],
      configurable: true,
    });
  }
  listPrototype.Append = recording;

  const run = (
    operation: Operation,
    argumentShapes: unknown[],
    toolShapes: unknown[],
    glue: number,
    simplify: boolean,
    angularTolerance: number
  ) => {
    calls += 1;
    const builder =
      operation === "fuse"
        ? new oc.BRepAlgoAPI_Fuse()
        : operation === "cut"
        ? new oc.BRepAlgoAPI_Cut()
        : new oc.BRepAlgoAPI_Common();
    const argumentsList = new oc.NCollection_List_TopoDS_Shape();
    const toolsList = new oc.NCollection_List_TopoDS_Shape();
    try {
      argumentShapes.forEach((shape) => append.call(argumentsList, shape)?.delete?.());
      toolShapes.forEach((shape) => append.call(toolsList, shape)?.delete?.());
      builder.SetArguments(argumentsList);
      builder.SetTools(toolsList);
      if (glue === 1) builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
      if (glue === 2) builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull);
      builder.Build();
      if (simplify) builder.SimplifyResult(true, true, angularTolerance);
      const done = builder.IsDone();
      const shape = done ? builder.Shape() : null;
      return {
        Shape: () => shape,
        IsDone: () => done,
        HasErrors: () => !done,
        Errors: () => (done ? "" : `Could not ${operation} shapes`),
        delete: () => {},
      };
    } finally {
      toolsList.delete();
      argumentsList.delete();
      builder.delete();
    }
  };
  const split = (list: object): [unknown[], unknown[]] => {
    const [first, ...rest] = contents.get(list) ?? [];
    return [[first], rest];
  };

  oc.ReplicadBooleanBatch = {
    Fuse: (shapes: object, _nd: boolean, glue: number, simplify: boolean, tolerance: number) =>
      run("fuse", ...split(shapes), glue, simplify, tolerance),
    Cut: (
      argumentsList: object,
      toolsList: object,
      _nd: boolean,
      glue: number,
      simplify: boolean,
      tolerance: number
    ) =>
      run(
        "cut",
        contents.get(argumentsList) ?? [],
        contents.get(toolsList) ?? [],
        glue,
        simplify,
        tolerance
      ),
    Common: (shapes: object, _nd: boolean, glue: number, simplify: boolean, tolerance: number) =>
      run("common", ...split(shapes), glue, simplify, tolerance),
  };

  return {
    get calls() {
      return calls;
    },
    uninstall() {
      delete oc.ReplicadBooleanBatch;
      listPrototype.Append = append;
    },
  };
}

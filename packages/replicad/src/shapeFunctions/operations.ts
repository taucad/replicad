import type {
  NCollection_List_TopoDS_Shape,
  TopoDS_Compound,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Solid,
} from "replicad-opencascadejs";

import { DEG2RAD } from "../constants.js";
import {
  asDir,
  asPnt,
  makePln,
  type Plane,
  type PlaneName,
  type SimplePoint,
} from "../geom.js";
import { makePlane } from "../geomHelpers.js";
import { getOC } from "../oclib.js";
import { GCWithScope } from "../register.js";
import { unwrapShape, type ShapeInput } from "./shapeInput.js";
import { iterTopo } from "./topology.js";

export interface BooleanOperationOptions {
  optimisation?: "none" | "commonFace" | "sameFace";
}

export interface ShellOptions {
  faces: Iterable<ShapeInput<TopoDS_Face>>;
  thickness: number;
  tolerance?: number;
}

export interface DraftOptions {
  faces: Iterable<ShapeInput<TopoDS_Face>>;
  angle: number;
  neutralPlane?: Plane | PlaneName;
}

export type PlaneSide = "positive" | "negative";

/** Pieces grouped by their position relative to an oriented plane. */
export interface PlaneSplitResult<T> {
  positive: T | null;
  negative: T | null;
  on: T | null;
}

const configureGlue = (
  builder: {
    SetGlue(value: any): void;
  },
  optimisation: BooleanOperationOptions["optimisation"]
): void => {
  const oc = getOC();
  if (optimisation === "commonFace") {
    builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
  }
  if (optimisation === "sameFace") {
    builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull);
  }
};

type BooleanOperation = "fuse" | "cut" | "common";

interface BooleanBatchResult {
  Shape(): TopoDS_Shape;
  IsDone(): boolean;
  HasErrors(): boolean;
  Errors(): string;
  delete(): void;
}

/**
 * The `ReplicadBooleanBatch` binding of Tau's native OpenCascade build. It runs
 * a whole boolean (one argument against many tools) in a single OCCT call.
 */
interface BooleanBatchApi {
  Fuse(
    shapes: NCollection_List_TopoDS_Shape,
    nonDestructive: boolean,
    glue: number,
    simplify: boolean,
    angularTolerance: number,
    fuzzyValue: number
  ): BooleanBatchResult;
  Cut(
    argumentsList: NCollection_List_TopoDS_Shape,
    toolsList: NCollection_List_TopoDS_Shape,
    nonDestructive: boolean,
    glue: number,
    simplify: boolean,
    angularTolerance: number,
    fuzzyValue: number
  ): BooleanBatchResult;
  Common(
    shapes: NCollection_List_TopoDS_Shape,
    nonDestructive: boolean,
    glue: number,
    simplify: boolean,
    angularTolerance: number,
    fuzzyValue: number
  ): BooleanBatchResult;
}

const getBooleanBatch = (): BooleanBatchApi | undefined =>
  (getOC() as { ReplicadBooleanBatch?: BooleanBatchApi }).ReplicadBooleanBatch;

const glueOption = (
  optimisation: BooleanOperationOptions["optimisation"]
): number => {
  if (optimisation === "commonFace") return 1;
  if (optimisation === "sameFace") return 2;
  return 0;
};

const makeNCollection_List_TopoDS_Shape = (shapes: readonly TopoDS_Shape[]): NCollection_List_TopoDS_Shape => {
  const oc = getOC();
  const list = new oc.NCollection_List_TopoDS_Shape();
  for (const shape of shapes) list.Append(shape);
  return list;
};

const runBooleanBatch = (
  batch: BooleanBatchApi,
  operation: BooleanOperation,
  argumentShapes: readonly TopoDS_Shape[],
  toolShapes: readonly TopoDS_Shape[],
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape => {
  const argumentsList = makeNCollection_List_TopoDS_Shape(argumentShapes);
  const toolsList = makeNCollection_List_TopoDS_Shape(toolShapes);
  const allShapesList = makeNCollection_List_TopoDS_Shape([...argumentShapes, ...toolShapes]);

  try {
    const glue = glueOption(optimisation);
    const result =
      operation === "fuse"
        ? batch.Fuse(allShapesList, false, glue, true, 1e-3, 0)
        : operation === "cut"
        ? batch.Cut(argumentsList, toolsList, false, glue, true, 1e-3, 0)
        : batch.Common(allShapesList, false, glue, true, 1e-3, 0);

    try {
      if (!result.IsDone() || result.HasErrors()) {
        throw new Error(result.Errors() || `Could not ${operation} shapes`);
      }
      return result.Shape();
    } finally {
      result.delete();
    }
  } finally {
    allShapesList.delete();
    toolsList.delete();
    argumentsList.delete();
  }
};

/**
 * Fuses or cuts one shape with several tools in one OCCT boolean, without the
 * native batch binding.
 */
const runBuilderBoolean = (
  operation: "fuse" | "cut",
  shape: TopoDS_Shape,
  tools: readonly TopoDS_Shape[],
  optimisation: BooleanOperationOptions["optimisation"]
): TopoDS_Shape => {
  const oc = getOC();
  const r = GCWithScope();
  const builder = r(
    operation === "fuse" ? new oc.BRepAlgoAPI_Fuse() : new oc.BRepAlgoAPI_Cut()
  );
  const argumentsList = r(makeNCollection_List_TopoDS_Shape([shape]));
  const toolsList = r(makeNCollection_List_TopoDS_Shape(tools));

  builder.SetArguments(argumentsList);
  builder.SetTools(toolsList);
  configureGlue(builder, optimisation);
  builder.Build();
  builder.SimplifyResult(true, true, 1e-3);
  return builder.Shape();
};

const unwrapTools = (tools: Iterable<ShapeInput>): TopoDS_Shape[] =>
  Array.from(tools, (tool) => unwrapShape(tool));

/** Builds a raw shape by fusing two shapes. */
export function fuseShapes(
  leftInput: ShapeInput,
  rightInput: ShapeInput,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const batch = getBooleanBatch();
  if (batch) {
    return runBooleanBatch(
      batch,
      "fuse",
      [unwrapShape(leftInput)],
      [unwrapShape(rightInput)],
      { optimisation }
    );
  }

  const oc = getOC();
  const r = GCWithScope();
  const builder = r(
    new oc.BRepAlgoAPI_Fuse(unwrapShape(leftInput), unwrapShape(rightInput))
  );

  configureGlue(builder, optimisation);
  builder.Build();
  builder.SimplifyResult(true, true, 1e-3);
  return builder.Shape();
}

/**
 * Builds a raw shape by fusing a shape with all the provided shapes in one
 * boolean operation.
 */
export function fuseAllShapes(
  shapeInput: ShapeInput,
  othersInput: Iterable<ShapeInput>,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const shape = unwrapShape(shapeInput);
  const others = unwrapTools(othersInput);
  if (others.length === 0) throw new Error("Cannot fuse an empty shape list");

  const batch = getBooleanBatch();
  if (batch) {
    return runBooleanBatch(batch, "fuse", [shape], others, { optimisation });
  }
  return runBuilderBoolean("fuse", shape, others, optimisation);
}

/** Builds a raw shape by cutting a tool shape from another shape. */
export function cutShape(
  shapeInput: ShapeInput,
  toolInput: ShapeInput,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const batch = getBooleanBatch();
  if (batch) {
    return runBooleanBatch(
      batch,
      "cut",
      [unwrapShape(shapeInput)],
      [unwrapShape(toolInput)],
      { optimisation }
    );
  }

  const oc = getOC();
  const r = GCWithScope();
  const builder = r(
    new oc.BRepAlgoAPI_Cut(unwrapShape(shapeInput), unwrapShape(toolInput))
  );

  configureGlue(builder, optimisation);
  builder.Build();
  builder.SimplifyResult(true, true, 1e-3);
  return builder.Shape();
}

/**
 * Builds a raw shape by removing all the provided tool shapes from a shape in
 * one boolean operation.
 */
export function cutAllShapes(
  shapeInput: ShapeInput,
  toolsInput: Iterable<ShapeInput>,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const shape = unwrapShape(shapeInput);
  const tools = unwrapTools(toolsInput);
  if (tools.length === 0) throw new Error("Cannot cut an empty shape list");

  const batch = getBooleanBatch();
  if (batch) {
    return runBooleanBatch(batch, "cut", [shape], tools, { optimisation });
  }
  return runBuilderBoolean("cut", shape, tools, optimisation);
}

/** Builds a raw shape containing the intersection of two shapes. */
export function intersectShapes(
  leftInput: ShapeInput,
  rightInput: ShapeInput,
  { optimisation = "none" }: BooleanOperationOptions = {}
): TopoDS_Shape {
  const batch = getBooleanBatch();
  if (batch) {
    return runBooleanBatch(
      batch,
      "common",
      [unwrapShape(leftInput)],
      [unwrapShape(rightInput)],
      { optimisation }
    );
  }

  const oc = getOC();
  const r = GCWithScope();
  const builder = r(
    new oc.BRepAlgoAPI_Common(unwrapShape(leftInput), unwrapShape(rightInput))
  );

  configureGlue(builder, optimisation);
  builder.Build();
  builder.SimplifyResult(true, true, 1e-3);
  return builder.Shape();
}

/**
 * Builds a raw shape containing the intersection of a shape with every one of
 * the provided shapes.
 *
 * With the native batch binding this runs as one boolean operation; otherwise
 * the shapes are intersected one after the other.
 */
export function intersectAllShapes(
  shapeInput: ShapeInput,
  toolsInput: Iterable<ShapeInput>,
  options: BooleanOperationOptions = {}
): TopoDS_Shape {
  const shape = unwrapShape(shapeInput);
  const tools = unwrapTools(toolsInput);
  if (tools.length === 0)
    throw new Error("Cannot intersect with an empty shape list");

  const batch = getBooleanBatch();
  if (batch) return runBooleanBatch(batch, "common", [shape], tools, options);

  let result = intersectShapes(shape, tools[0], options);
  for (const tool of tools.slice(1)) {
    const previous = result;
    result = intersectShapes(previous, tool, options);
    previous.delete();
  }
  return result;
}

const signedDistanceToPlane = (point: SimplePoint, plane: Plane): number =>
  (point[0] - plane.origin.x) * plane.zDir.x +
  (point[1] - plane.origin.y) * plane.zDir.y +
  (point[2] - plane.origin.z) * plane.zDir.z;

/**
 * Splits a shape with an oriented plane and groups pieces by side.
 *
 * `offset` translates the splitting plane along its normal. A side is null
 * when empty, the piece itself when it contains one piece, and a compound when
 * it contains multiple disconnected pieces.
 */
export function splitShape(
  shapeInput: ShapeInput,
  inputPlane: Plane | PlaneName = "XY",
  offset = 0,
  tolerance = 1e-7
): PlaneSplitResult<TopoDS_Solid | TopoDS_Compound> {
  const oc = getOC();
  const r = GCWithScope();
  const shape = unwrapShape(shapeInput);
  const basePlane = r(makePlane(inputPlane));
  const plane =
    offset === 0
      ? basePlane
      : r(
          basePlane.translate([
            basePlane.zDir.x * offset,
            basePlane.zDir.y * offset,
            basePlane.zDir.z * offset,
          ])
        );
  const ocPlane = r(makePln(plane.origin, plane.zDir));
  const faceBuilder = r(new oc.BRepBuilderAPI_MakeFace(ocPlane));
  const splittingFace = r(faceBuilder.Face());

  const argumentsList = r(new oc.NCollection_List_TopoDS_Shape());
  argumentsList.Append(shape);
  const toolsList = r(new oc.NCollection_List_TopoDS_Shape());
  toolsList.Append(splittingFace);

  const builder = r(new oc.BRepAlgoAPI_Splitter());
  builder.SetArguments(argumentsList);
  builder.SetTools(toolsList);
  builder.Build();
  if (builder.HasErrors()) throw new Error("Could not split shape with plane");

  // Splitter.Shape() contains the split arguments but not the tools. We only
  // expose solid results; section edges, faces, shells, and other topology are
  // intentionally ignored.
  const splitResult = builder.Shape();
  const pieces: TopoDS_Solid[] =
    splitResult.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID
      ? [oc.TopoDS.Solid(splitResult)]
      : [...iterTopo(splitResult, "solid")];
  splitResult.delete();

  const grouped = {
    positive: [] as TopoDS_Solid[],
    negative: [] as TopoDS_Solid[],
    on: [] as TopoDS_Solid[],
  };

  for (const piece of pieces) {
    const bounds = r(new oc.Bnd_Box());
    oc.BRepBndLib.Add(piece, bounds, true);
    const min = r(bounds.CornerMin());
    const max = r(bounds.CornerMax());
    const center: SimplePoint = [
      (min.X() + max.X()) / 2,
      (min.Y() + max.Y()) / 2,
      (min.Z() + max.Z()) / 2,
    ];
    const distance = signedDistanceToPlane(center, plane);

    if (distance > tolerance) grouped.positive.push(piece);
    else if (distance < -tolerance) grouped.negative.push(piece);
    else grouped.on.push(piece);
  }

  const asShape = (
    group: TopoDS_Solid[]
  ): TopoDS_Solid | TopoDS_Compound | null => {
    if (!group.length) return null;
    if (group.length === 1) return group[0];

    const compound = new oc.TopoDS_Compound();
    const compoundBuilder = r(new oc.TopoDS_Builder());
    compoundBuilder.MakeCompound(compound);
    group.forEach((piece) => compoundBuilder.Add(compound, piece));
    group.forEach((piece) => piece.delete());
    return compound;
  };

  return {
    positive: asShape(grouped.positive),
    negative: asShape(grouped.negative),
    on: asShape(grouped.on),
  };
}

/**
 * Cuts a shape with the half-space defined by an oriented plane.
 *
 * `keep` identifies the side that remains. Positive is the direction of the
 * plane normal. The offset translates the plane along that normal.
 */
export function cutShapeWithPlane(
  shapeInput: ShapeInput,
  inputPlane: Plane | PlaneName = "XY",
  offset = 0,
  keep: PlaneSide = "positive"
): TopoDS_Solid | TopoDS_Compound | null {
  const oc = getOC();
  const r = GCWithScope();
  const shape = unwrapShape(shapeInput);
  const basePlane = r(makePlane(inputPlane));
  const plane =
    offset === 0
      ? basePlane
      : r(
          basePlane.translate([
            basePlane.zDir.x * offset,
            basePlane.zDir.y * offset,
            basePlane.zDir.z * offset,
          ])
        );
  const ocPlane = r(makePln(plane.origin, plane.zDir));
  const faceBuilder = r(new oc.BRepBuilderAPI_MakeFace(ocPlane));
  const face = r(faceBuilder.Face());

  // MakeHalfSpace creates the side containing its reference point. Build the
  // side that should be removed, then subtract it from the input shape.
  const removedSign = keep === "negative" ? 1 : -1;
  const referencePoint = r(
    asPnt([
      plane.origin.x + plane.zDir.x * removedSign,
      plane.origin.y + plane.zDir.y * removedSign,
      plane.origin.z + plane.zDir.z * removedSign,
    ])
  );
  const halfSpaceBuilder = r(
    new oc.BRepPrimAPI_MakeHalfSpace(face, referencePoint)
  );
  const halfSpace = r(halfSpaceBuilder.Solid());

  const builder = r(new oc.BRepAlgoAPI_Cut(shape, halfSpace));
  builder.Build();
  if (builder.HasErrors()) throw new Error("Could not cut shape with plane");

  const cutResult = builder.Shape();
  const solids: TopoDS_Solid[] =
    cutResult.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID
      ? [oc.TopoDS.Solid(cutResult)]
      : [...iterTopo(cutResult, "solid")];
  cutResult.delete();

  if (!solids.length) return null;
  if (solids.length === 1) return solids[0];

  const compound = new oc.TopoDS_Compound();
  const compoundBuilder = r(new oc.TopoDS_Builder());
  compoundBuilder.MakeCompound(compound);
  solids.forEach((solid) => compoundBuilder.Add(compound, solid));
  solids.forEach((solid) => solid.delete());
  return compound;
}

/**
 * Hollows a shape by removing the supplied faces and retaining a wall of the
 * requested thickness.
 */
export function shellShape(
  shapeInput: ShapeInput,
  { faces, thickness, tolerance = 1e-3 }: ShellOptions
): TopoDS_Shape {
  const oc = getOC();
  const r = GCWithScope();
  const facesToRemove = r(new oc.NCollection_List_TopoDS_Shape());

  for (const face of faces) facesToRemove.Append(unwrapShape(face));

  const builder = r(new oc.BRepOffsetAPI_MakeThickSolid());
  builder.MakeThickSolidByJoin(
    unwrapShape(shapeInput),
    facesToRemove,
    -thickness,
    tolerance,
    oc.BRepOffset_Mode.BRepOffset_Skin,
    false,
    false,
    oc.GeomAbs_JoinType.GeomAbs_Arc,
    false
  );

  return builder.Shape();
}

/** Applies a draft angle to the supplied faces of a shape. */
export function draftShape(
  shapeInput: ShapeInput,
  { faces, angle, neutralPlane = "XY" }: DraftOptions
): TopoDS_Shape {
  const oc = getOC();
  const shape = unwrapShape(shapeInput);
  const builder = new oc.BRepOffsetAPI_DraftAngle(shape);
  const inputPlane = makePlane(neutralPlane);
  const plane = makePln(inputPlane.origin, inputPlane.zDir);
  const direction = asDir(inputPlane.zDir);

  for (const face of faces) {
    builder.Add(unwrapShape(face), direction, angle * DEG2RAD, plane, false);
  }

  builder.Build();
  const result = builder.ModifiedShape(shape);

  builder.delete();
  plane.delete();
  direction.delete();
  inputPlane.delete();
  return result;
}

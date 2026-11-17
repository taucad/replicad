/**
 * Effect table of the public API, for the operation cache seam.
 *
 * Every public member (method, getter, setter) of every exported class, and
 * every exported function, has an effect class (see {@link OperationEffect}).
 * A test enumerates the exports and fails when one has no entry, so a new
 * method cannot reach users without saying what it does to its receiver.
 *
 * The table also says which members are routed through an installed cache.
 * Routed members are the ones that produce or change kernel values; the
 * others (queries, export, lifecycle, values the cache identifies by content)
 * always run directly.
 */
import type { OperationEffect } from "./operationCacheHook";
import {
  Shape,
  _1DShape,
  _3DShape,
  Edge,
  Wire,
  Face,
  Vertex,
  Curve,
  Surface,
} from "./shapes";
import { WrappingObj } from "./register";
import { Vector, Plane, Transformation, BoundingBox } from "./geom";
import Sketch from "./sketches/Sketch";
import CompoundSketch from "./sketches/CompoundSketch";
import Sketches from "./sketches/Sketches";
import { Drawing, DrawingPen } from "./draw";
import Sketcher from "./Sketcher";
import FaceSketcher, { BaseSketcher2d, BlueprintSketcher } from "./Sketcher2d";
import Blueprint from "./blueprints/Blueprint";
import Blueprints from "./blueprints/Blueprints";
import CompoundBlueprint from "./blueprints/CompoundBlueprint";
import { Finder } from "./finders/definitions";
import { Finder3d } from "./finders/generic3dfinder";
import { EdgeFinder } from "./finders/edgeFinder";
import { FaceFinder } from "./finders/faceFinder";
import { CornerFinder } from "./finders/cornerFinder";
import { BoundingBox2d, Curve2D } from "./lib2d";
import { MeshShape } from "./meshShapes";
import {
  DistanceQuery,
  DistanceTool,
  LinearPhysicalProperties,
  SurfacePhysicalProperties,
  VolumePhysicalProperties,
} from "./measureShape";
import { ProjectionCamera } from "./projection/ProjectionCamera";
import { AssemblyExporter } from "./export/assemblyExporter";

type Members = Readonly<Record<string, OperationEffect>>;
type Words = Partial<Record<OperationEffect, string>>;

/** `{ pure: "a b", consumes: "c" }` to `{ a: "pure", b: "pure", c: "consumes" }`. */
const members = (words: Words): Members => {
  const result: Record<string, OperationEffect> = {};
  for (const [effect, names] of Object.entries(words) as [
    OperationEffect,
    string
  ][]) {
    for (const name of names.split(/\s+/).filter(Boolean)) {
      if (name in result) throw new Error(`Duplicate effect for ${name}`);
      result[name] = effect;
    }
  }
  return result;
};

/**
 * The effects of one class's own prototype members. A getter is listed under
 * its name, a setter under `set:<name>`. Members whose name starts with `_`
 * are internal and are not listed.
 */
export interface ClassEffects {
  readonly target: { prototype: object };
  /** Class part of the operation name (`Shape` for every shape class). */
  readonly op: string;
  readonly members: Members;
  /** Whether the class's members are routed through an installed cache. */
  readonly routed: boolean;
  /**
   * Members of a routed class that are not routed. Getters are never routed
   * unless listed in `elementGetters` or `routedGetters`.
   */
  readonly unrouted?: readonly string[];
  /** Getters returning sub shapes of the receiver: kind of sub shape. */
  readonly elementGetters?: Readonly<Record<string, string>>;
  /** Getters that compute a new kernel value; routed as `get:Class.name`. */
  readonly routedGetters?: readonly string[];
  /** Positions of finder callbacks in the arguments. */
  readonly finderArgs?: Readonly<Record<string, readonly number[]>>;
  /** Members whose errors are a deterministic function of their inputs. */
  readonly deterministicErrors?: readonly string[];
  /**
   * What a `consumes` member deletes, when it is more or less than its
   * receiver.
   */
  readonly consume?: Readonly<
    Record<string, (receiver: any, args: readonly unknown[]) => void>
  >;
  /** State of a builder that has not drawn anything yet. */
  readonly freshState?: (receiver: any) => readonly unknown[] | undefined;
}

const deleteValue = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(deleteValue);
  else (value as { delete?: () => void } | null)?.delete?.();
};

const freshPen = (pen: any): readonly unknown[] | undefined =>
  pen.pendingCurves.length === 0 && pen._nextCorner === null
    ? [pen.constructor.name, pen.pointer, pen.firstPoint, pen.face ?? null]
    : undefined;

const freshSketcher = (sketcher: any): readonly unknown[] | undefined =>
  sketcher.pendingEdges.length === 0 && !sketcher._mirrorWire
    ? ["Sketcher", sketcher.plane, sketcher.pointer, sketcher.firstPoint]
    : undefined;

/** Deletes the wires of a compound sketch's sketches. */
const deleteSketchWires = (receiver: CompoundSketch): void =>
  receiver.sketches.forEach((sketch) => sketch.wire.delete());

/** `Sketches.extrude` and `revolve` delete the plain sketches they hold. */
const consumePlainSketches = (receiver: Sketches): void =>
  receiver.sketches.forEach(
    (sketch) => sketch instanceof Sketch && sketch.delete()
  );

const PEN_METHODS =
  "movePointerTo saveCurve lineTo line vLine hLine vLineTo hLineTo polarLineTo polarLine tangentLine threePointsArcTo threePointsArc sagittaArcTo sagittaArc vSagittaArc hSagittaArc bulgeArcTo bulgeArc vBulgeArc hBulgeArc tangentArcTo tangentArc ellipseTo ellipse halfEllipseTo halfEllipse bezierCurveTo quadraticBezierCurveTo cubicBezierCurveTo smoothSplineTo smoothSpline customCorner";
const PEN_FINISH = "done close closeWithMirror closeWithCustomCorner";
const BLUEPRINT_OPS =
  "stretch rotate scale translate mirror sketchOnPlane sketchOnFace punchHole";
const SVG = "toSVGViewBox toSVGPaths toSVG";

/** The effect table, one entry per prototype in the exported class chains. */
export const classEffects = (): readonly ClassEffects[] => [
  {
    target: WrappingObj,
    op: "WrappingObj",
    routed: true,
    members: members({
      pure: "wrapped",
      mutates: "set:wrapped",
      consumes: "delete",
    }),
    unrouted: ["delete"],
  },
  {
    target: Shape,
    op: "Shape",
    routed: true,
    members: members({
      alias: "clone asShape3D",
      pure: "serialize hashCode isNull isSame isEqual split simplify edges faces solids wires boundingBox mesh meshEdges blobSTEP blobSTL",
      consumes: "translate translateX translateY translateZ rotate mirror scale",
    }),
    unrouted: [
      "serialize",
      "isSame",
      "isEqual",
      "asShape3D",
      "mesh",
      "meshEdges",
      "blobSTEP",
      "blobSTL",
    ],
    elementGetters: {
      edges: "edge",
      faces: "face",
      wires: "wire",
      solids: "solid",
    },
  },
  { target: Vertex, op: "Shape", routed: true, members: members({ pure: "asTuple" }), unrouted: ["asTuple"] },
  {
    target: _1DShape,
    op: "Shape",
    routed: true,
    members: members({
      pure: "repr curve startPoint endPoint tangentAt pointAt isClosed isPeriodic period geomType length orientation flipOrientation",
    }),
    unrouted: ["tangentAt", "pointAt"],
  },
  { target: Edge, op: "Shape", routed: true, members: members({}) },
  {
    target: Wire,
    op: "Shape",
    routed: true,
    members: members({ consumes: "offset2D" }),
  },
  {
    target: Face,
    op: "Shape",
    routed: true,
    members: members({
      pure: "surface orientation flipOrientation geomType UVBounds pointOnSurface uvCoordinates normalAt center triangulation",
      consumes: "outerWire innerWires",
    }),
    unrouted: ["pointOnSurface", "uvCoordinates", "normalAt", "triangulation"],
  },
  {
    target: _3DShape,
    op: "Shape",
    routed: true,
    members: members({
      pure: "fuse fuseAll cut cutAll intersect intersectAll cutPlane meshShape shell fillet chamfer draft",
    }),
    unrouted: ["meshShape"],
    finderArgs: { fillet: [1], chamfer: [1], shell: [1], draft: [1] },
    deterministicErrors: ["fillet", "chamfer", "shell", "draft"],
  },
  {
    target: Sketch,
    op: "Sketch",
    routed: true,
    members: members({
      pure: "baseFace defaultOrigin defaultDirection face wires faces",
      mutates: "set:baseFace set:defaultOrigin set:defaultDirection",
      alias: "clone",
      consumes: "delete revolve extrude sweepSketch loftWith",
    }),
    unrouted: ["delete"],
    consume: {
      loftWith: (receiver, args) => {
        deleteValue(receiver);
        deleteValue(args[0]);
      },
    },
  },
  {
    target: CompoundSketch,
    op: "CompoundSketch",
    routed: true,
    members: members({
      pure: "outerSketch innerSketches face extrude revolve loftWith",
      // `wires` builds a compound of the sketches' wires, which deletes them.
      consumes: "delete wires",
    }),
    unrouted: ["delete"],
    routedGetters: ["wires"],
    consume: { wires: (receiver: CompoundSketch) => deleteSketchWires(receiver) },
  },
  {
    target: Sketches,
    op: "Sketches",
    routed: true,
    members: members({ pure: "faces", consumes: "wires extrude revolve" }),
    consume: {
      // A compound of the members' wires: deletes them.
      wires: (receiver: Sketches) =>
        receiver.sketches.forEach((sketch) =>
          sketch instanceof Sketch
            ? sketch.wire.delete()
            : deleteSketchWires(sketch)
        ),
      extrude: consumePlainSketches,
      revolve: consumePlainSketches,
    },
  },
  {
    target: Drawing,
    op: "Drawing",
    routed: true,
    members: members({
      alias: "clone blueprint",
      consumes: "delete",
      pure: `serialize boundingBox repr cut fuse intersect fillet chamfer offset approximate ${BLUEPRINT_OPS} ${SVG}`,
    }),
    unrouted: ["serialize", "delete", ...SVG.split(" ")],
    finderArgs: { fillet: [1], chamfer: [1], punchHole: [1] },
  },
  {
    target: Blueprint,
    op: "Blueprint",
    routed: true,
    finderArgs: { punchHole: [1] },
    members: members({
      alias: "clone",
      consumes: "delete",
      pure: `repr boundingBox orientation subFace toSVGPathD toSVGPath firstPoint lastPoint isInside isClosed intersects ${BLUEPRINT_OPS} ${SVG}`,
    }),
    unrouted: [
      "delete",
      "toSVGPathD",
      "toSVGPath",
      "isInside",
      "isClosed",
      "intersects",
      ...SVG.split(" "),
    ],
  },
  {
    target: Blueprints,
    op: "Blueprints",
    routed: true,
    finderArgs: { punchHole: [1] },
    members: members({
      alias: "clone",
      consumes: "delete",
      pure: `repr boundingBox ${BLUEPRINT_OPS} ${SVG}`,
    }),
    unrouted: ["delete", ...SVG.split(" ")],
  },
  {
    target: CompoundBlueprint,
    op: "CompoundBlueprint",
    routed: true,
    finderArgs: { punchHole: [1] },
    members: members({
      alias: "clone",
      consumes: "delete",
      pure: `repr boundingBox toSVGGroup ${BLUEPRINT_OPS} ${SVG}`,
    }),
    unrouted: ["toSVGGroup", "delete", ...SVG.split(" ")],
  },
  {
    target: BaseSketcher2d,
    op: "Pen",
    routed: true,
    members: members({ pure: "penPosition penAngle", mutates: PEN_METHODS }),
    freshState: freshPen,
  },
  {
    target: DrawingPen,
    op: "Pen",
    routed: true,
    members: members({ mutates: PEN_FINISH }),
    freshState: freshPen,
  },
  {
    target: BlueprintSketcher,
    op: "Pen",
    routed: true,
    members: members({ mutates: PEN_FINISH }),
    freshState: freshPen,
  },
  {
    target: FaceSketcher,
    op: "Pen",
    routed: true,
    members: members({ mutates: `buildWire ${PEN_FINISH}` }),
    freshState: freshPen,
  },
  {
    target: Sketcher,
    op: "Sketcher",
    routed: true,
    members: members({
      consumes: "delete",
      mutates: `${PEN_METHODS.replace(/ saveCurve| customCorner/g, "")} buildWire done close closeWithMirror`,
    }),
    unrouted: ["delete"],
    freshState: freshSketcher,
  },

  // Finders are described, not routed: an operation that takes a finder
  // callback names its position (`finderArgs`) and the cache records the
  // clauses (see `finderClauses`) or keys the selection after it ran.
  {
    target: Finder,
    op: "Finder",
    routed: false,
    members: members({
      consumes: "delete",
      mutates: "and not either",
      pure: "find",
    }),
  },
  {
    target: Finder3d,
    op: "Finder",
    routed: false,
    members: members({
      mutates:
        "when inList atAngleWith atDistance containsPoint near withinDistance inBox inShape",
    }),
  },
  {
    target: EdgeFinder,
    op: "Finder",
    routed: false,
    members: members({
      alias: "clone",
      mutates: "inDirection ofLength ofCurveType parallelTo inPlane",
      pure: "shouldKeep applyFilter",
    }),
  },
  {
    target: FaceFinder,
    op: "Finder",
    routed: false,
    members: members({
      alias: "clone",
      mutates: "parallelTo ofSurfaceType inPlane",
      pure: "shouldKeep applyFilter",
    }),
  },
  {
    target: CornerFinder,
    op: "Finder",
    routed: false,
    members: members({
      alias: "clone",
      mutates: "inList atDistance atPoint inBox ofAngle",
      pure: "shouldKeep applyFilter",
    }),
  },

  // Values the cache identifies by content, measurements and export helpers.
  {
    target: Vector,
    op: "Vector",
    routed: false,
    members: members({
      pure: "repr x y z Length toTuple cross dot sub add multiply normalized getAngle projectToPlane equals toPnt toDir",
      alias: "getCenter",
      mutates: "normalize rotate",
    }),
  },
  {
    target: Plane,
    op: "Plane",
    routed: false,
    members: members({
      consumes: "delete",
      alias: "clone",
      pure: "origin translateTo translate translateX translateY translateZ pivot rotate2DAxes toLocalCoords toWorldCoords",
      mutates: "set:origin setOrigin2d",
    }),
  },
  {
    target: Transformation,
    op: "Transformation",
    routed: false,
    members: members({
      alias: "clone",
      mutates: "translate rotate mirror scale inverse coordSystemChange",
      pure: "inverted transformPoint transform",
    }),
  },
  {
    target: BoundingBox,
    op: "BoundingBox",
    routed: false,
    members: members({
      pure: "repr bounds center width height depth isOut",
      mutates: "add",
    }),
  },
  {
    target: BoundingBox2d,
    op: "BoundingBox2d",
    routed: false,
    members: members({
      pure: "repr bounds center width height outsidePoint isOut containsPoint",
      mutates: "add",
    }),
  },
  {
    target: Curve,
    op: "Curve",
    routed: false,
    members: members({
      pure: "repr curveType startPoint endPoint pointAt tangentAt isClosed isPeriodic period",
    }),
  },
  {
    target: Curve2D,
    op: "Curve2D",
    routed: false,
    members: members({
      pure: "boundingBox repr innerCurve serialize value firstPoint lastPoint firstParameter lastParameter adaptor geomType distanceFromPoint distanceFromCurve distanceFrom isOnCurve parameter tangentAt splitAt",
      consumes: "delete",
      alias: "clone",
      mutates: "reverse",
    }),
  },
  {
    target: Surface,
    op: "Surface",
    routed: false,
    members: members({ pure: "surfaceType" }),
  },
  {
    target: MeshShape,
    op: "MeshShape",
    routed: false,
    members: members({
      alias: "clone",
      pure: "fuse cut intersect translate translateX translateY translateZ rotate scale mirror simplify refine refineToLength refineToTolerance hull asOriginal mesh boundingBox volume surfaceArea numTri numVert numEdge isEmpty blobSTL",
    }),
  },
  {
    target: Object.getPrototypeOf(LinearPhysicalProperties) as {
      prototype: object;
    },
    op: "PhysicalProperties",
    routed: false,
    members: members({ pure: "centerOfMass" }),
  },
  {
    target: LinearPhysicalProperties,
    op: "PhysicalProperties",
    routed: false,
    members: members({ pure: "length" }),
  },
  {
    target: SurfacePhysicalProperties,
    op: "PhysicalProperties",
    routed: false,
    members: members({ pure: "area" }),
  },
  {
    target: VolumePhysicalProperties,
    op: "PhysicalProperties",
    routed: false,
    members: members({ pure: "volume" }),
  },
  {
    target: DistanceTool,
    op: "DistanceTool",
    routed: false,
    members: members({ pure: "distanceBetween" }),
  },
  {
    target: DistanceQuery,
    op: "DistanceQuery",
    routed: false,
    members: members({ pure: "distanceTo" }),
  },
  {
    target: ProjectionCamera,
    op: "ProjectionCamera",
    routed: false,
    members: members({
      pure: "position direction xAxis yAxis",
      mutates: "autoAxes setPosition setXAxis setYAxis lookAt",
    }),
  },
  {
    target: AssemblyExporter,
    op: "AssemblyExporter",
    routed: false,
    members: members({}),
  },
];

/**
 * Finder clauses by how their arguments describe them, for a cache that
 * records finder callbacks instead of running them opaquely: `value`
 * clauses take plain values, kernel values or shapes; `combinator` clauses
 * take finder callbacks; `predicate` clauses take an arbitrary function that
 * only a selection can describe.
 */
export const finderClauses = {
  value: [
    "inList",
    "atAngleWith",
    "atDistance",
    "containsPoint",
    "near",
    "withinDistance",
    "inBox",
    "inShape",
    "inDirection",
    "ofLength",
    "ofCurveType",
    "parallelTo",
    "inPlane",
    "ofSurfaceType",
    "atPoint",
    "ofAngle",
  ],
  combinator: ["and", "not", "either"],
  predicate: ["when"],
} as const;

/**
 * Exported functions routed under their own name. operationCache.ts maps each
 * to its implementation; index.ts exports the routed versions.
 */
export const ROUTED_FUNCTION_NAMES = [
  "makeLine",
  "makeCircle",
  "makeEllipse",
  "makeHelix",
  "makeThreePointArc",
  "makeEllipseArc",
  "makeBSplineApproximation",
  "makeBezierCurve",
  "makeTangentArc",
  "assembleWire",
  "makeFace",
  "makeNewFaceWithinFace",
  "makeNonPlanarFace",
  "makeCylinder",
  "makeSphere",
  "makeEllipsoid",
  "makeBox",
  "makeBaseBox",
  "makeVertex",
  "makeOffset",
  "compoundShapes",
  "makeCompound",
  "weldShellsAndFaces",
  "makeSolid",
  "addHolesInFace",
  "makePolygon",
  "basicFaceExtrusion",
  "revolution",
  "genericSweep",
  "supportExtrude",
  "complexExtrude",
  "twistExtrude",
  "loft",
  "draw",
  "drawRoundedRectangle",
  "drawRectangle",
  "drawSingleCircle",
  "drawSingleEllipse",
  "drawCircle",
  "drawEllipse",
  "drawPolysides",
  "drawText",
  "drawPointsInterpolation",
  "drawParametricFunction",
  "drawProjection",
  "drawFaceOutline",
  "deserializeDrawing",
  "sketchCircle",
  "sketchEllipse",
  "sketchRectangle",
  "sketchRoundedRectangle",
  "sketchPolysides",
  "sketchFaceOffset",
  "sketchParametricFunction",
  "sketchHelix",
  "sketchText",
  "textBlueprints",
  "polysidesBlueprint",
  "roundedRectangleBlueprint",
  "fuse2D",
  "cut2D",
  "intersect2D",
  "fuseBlueprints",
  "cutBlueprints",
  "intersectBlueprints",
  "makeProjectedEdges",
] as const;

/**
 * Effects of the exported functions. The `routed` ones produce kernel values
 * from their arguments and go through an installed cache under their own
 * name. The importers and `deserializeShape` are routed on their content
 * (see importers.ts). The others are queries, conversions of raw OpenCascade
 * values, configuration, export, and the seam itself.
 */
export interface FunctionEffects {
  readonly effect: OperationEffect;
  readonly routed: boolean;
  /** What a `consumes` function deletes, from its arguments. */
  readonly consume?: (args: readonly unknown[]) => void;
  /** The result is a mutable builder (a pen): a cache must never reuse it. */
  readonly returnsBuilder?: boolean;
}

/** `compoundShapes` and `makeCompound` delete every shape they are given. */
const consumeShapeArray = (args: readonly unknown[]): void =>
  deleteValue(args[0]);

/** Routed functions that are not plain `pure`. */
const SPECIAL_FUNCTIONS: Readonly<Record<string, FunctionEffects>> = {
  compoundShapes: { effect: "consumes", routed: true, consume: consumeShapeArray },
  makeCompound: { effect: "consumes", routed: true, consume: consumeShapeArray },
  // Takes the face's outer wire with `Face.outerWire`, which deletes the face.
  sketchFaceOffset: {
    effect: "consumes",
    routed: true,
    consume: (args) => deleteValue(args[0]),
  },
  draw: { effect: "pure", routed: true, returnsBuilder: true },
};

export const functionEffects: Readonly<Record<string, FunctionEffects>> =
  (() => {
  const routed = (names: string) =>
    names
      .split(/\s+/)
      .filter(Boolean)
      .map(
        (name) =>
          [
            name,
            SPECIAL_FUNCTIONS[name] ?? { effect: "pure", routed: true },
          ] as const
      );
  const direct = (effect: OperationEffect, names: string) =>
    names
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => [name, { effect, routed: false }] as const);
  return Object.fromEntries([
    ...routed(ROUTED_FUNCTION_NAMES.join(" ")),
    ...routed("importSTEP importSTL importSTLAsMesh deserializeShape"),
    // Takes ownership of the raw handle it wraps (see makeCaster).
    ...direct("consumes", "cast"),
    ...direct(
      "pure",
      // Raw OpenCascade values, conversions and geometry helpers.
      "asDir asPnt axis2d makeAx1 makeAx2 makeAx3 makeDirection makeDirVector makePlane makePln makePlaneFromFace createNamedPlane resolveDirection lookFromPlane polysideInnerRadius organiseBlueprints isPoint isProjectionPlane isShape3D isWire shapeType iterTopo downcast translate rotate mirror scale " +
        // Finder helpers (selections, no new geometry).
        "getSingleFace combineFinderFilters atShapeExtremum topMost bottomMost leftMost rightMost frontMost backMost " +
        // Measurements and export.
        "measureArea measureLength measureVolume measureDistanceBetween measureShapeLinearProperties measureShapeSurfaceProperties measureShapeVolumeProperties exportSTEP createAssembly " +
        // Configuration and memory helpers.
        "getOC setOC getManifold setManifold loadFont getFont localGC GCWithScope GCWithObject ocScope withOcScope " +
        // The seam.
        "setOperationCache getOperationCache bypassOperationCache elementOrdinals"
    ),
  ]);
})();

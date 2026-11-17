import Sketcher from "./Sketcher";
import FaceSketcher, { BaseSketcher2d, BlueprintSketcher } from "./Sketcher2d";

import { Point2D, BoundingBox2d, Curve2D, axis2d } from "./lib2d";
import { GenericSketcher, SplineConfig } from "./sketcherlib";

export {
  axis2d,
  Sketcher,
  BaseSketcher2d,
  FaceSketcher,
  BlueprintSketcher,
  BoundingBox2d,
  Curve2D,
};

export type { GenericSketcher, SplineConfig, Point2D };

export * from "./constants";
export * from "./oclib";
export * from "./manifoldlib";
export * from "./register";
export * from "./geom";
export * from "./geomHelpers";
export * from "./shapes";
export * from "./shapeInterfaces";
export * from "./meshShapes";
export * from "./shapeHelpers";
export * from "./measureShape";
export * from "./finders";
export * from "./shortcuts.js";
export * from "./addThickness";
export * from "./blueprints";
export * from "./sketches";
export * from "./text";
export * from "./importers";
export * from "./draw";
export * from "./projection";
export * from "./export/assemblyExporter";

// Operation cache seam (see operationCache.ts). The routed free functions
// replace the star exports of the same names above: an explicit export takes
// precedence over `export *`.
export { setOperationCache } from "./operationCache";
export {
  getOperationCache,
  bypassOperationCache,
  elementOrdinals,
} from "./operationCacheHook";
export type {
  OperationCache,
  OperationEffect,
  OperationRequest,
  OperationStep,
} from "./operationCacheHook";
export { finderClauses } from "./operationEffects";
import { routedFunctions } from "./operationCache";
import type * as shapeHelpers from "./shapeHelpers";
import type * as addThickness from "./addThickness";
import type * as drawModule from "./draw";
import type * as cannedSketches from "./sketches/cannedSketches";
import type * as textModule from "./text";
import type * as cannedBlueprints from "./blueprints/cannedBlueprints";
import type * as boolean2D from "./blueprints/boolean2D";
import type * as booleanOperations from "./blueprints/booleanOperations";
import type * as shortcuts from "./shortcuts";
import type * as projection from "./projection/makeProjectedEdges";
export const makeLine: typeof shapeHelpers.makeLine = routedFunctions.makeLine;
export const makeCircle: typeof shapeHelpers.makeCircle = routedFunctions.makeCircle;
export const makeEllipse: typeof shapeHelpers.makeEllipse = routedFunctions.makeEllipse;
export const makeHelix: typeof shapeHelpers.makeHelix = routedFunctions.makeHelix;
export const makeThreePointArc: typeof shapeHelpers.makeThreePointArc = routedFunctions.makeThreePointArc;
export const makeEllipseArc: typeof shapeHelpers.makeEllipseArc = routedFunctions.makeEllipseArc;
export const makeBSplineApproximation: typeof shapeHelpers.makeBSplineApproximation = routedFunctions.makeBSplineApproximation;
export const makeBezierCurve: typeof shapeHelpers.makeBezierCurve = routedFunctions.makeBezierCurve;
export const makeTangentArc: typeof shapeHelpers.makeTangentArc = routedFunctions.makeTangentArc;
export const assembleWire: typeof shapeHelpers.assembleWire = routedFunctions.assembleWire;
export const makeFace: typeof shapeHelpers.makeFace = routedFunctions.makeFace;
export const makeNewFaceWithinFace: typeof shapeHelpers.makeNewFaceWithinFace = routedFunctions.makeNewFaceWithinFace;
export const makeNonPlanarFace: typeof shapeHelpers.makeNonPlanarFace = routedFunctions.makeNonPlanarFace;
export const makeCylinder: typeof shapeHelpers.makeCylinder = routedFunctions.makeCylinder;
export const makeSphere: typeof shapeHelpers.makeSphere = routedFunctions.makeSphere;
export const makeEllipsoid: typeof shapeHelpers.makeEllipsoid = routedFunctions.makeEllipsoid;
export const makeBox: typeof shapeHelpers.makeBox = routedFunctions.makeBox;
export const makeBaseBox: typeof shortcuts.makeBaseBox = routedFunctions.makeBaseBox;
export const makeVertex: typeof shapeHelpers.makeVertex = routedFunctions.makeVertex;
export const makeOffset: typeof shapeHelpers.makeOffset = routedFunctions.makeOffset;
export const compoundShapes: typeof shapeHelpers.compoundShapes = routedFunctions.compoundShapes;
export const makeCompound: typeof shapeHelpers.makeCompound = routedFunctions.makeCompound;
export const weldShellsAndFaces: typeof shapeHelpers.weldShellsAndFaces = routedFunctions.weldShellsAndFaces;
export const makeSolid: typeof shapeHelpers.makeSolid = routedFunctions.makeSolid;
export const addHolesInFace: typeof shapeHelpers.addHolesInFace = routedFunctions.addHolesInFace;
export const makePolygon: typeof shapeHelpers.makePolygon = routedFunctions.makePolygon;
export const basicFaceExtrusion: typeof addThickness.basicFaceExtrusion = routedFunctions.basicFaceExtrusion;
export const revolution: typeof addThickness.revolution = routedFunctions.revolution;
export const genericSweep: typeof addThickness.genericSweep = routedFunctions.genericSweep;
export const supportExtrude: typeof addThickness.supportExtrude = routedFunctions.supportExtrude;
export const complexExtrude: typeof addThickness.complexExtrude = routedFunctions.complexExtrude;
export const twistExtrude: typeof addThickness.twistExtrude = routedFunctions.twistExtrude;
export const loft: typeof addThickness.loft = routedFunctions.loft;
export const draw: typeof drawModule.draw = routedFunctions.draw;
export const drawRoundedRectangle: typeof drawModule.drawRoundedRectangle = routedFunctions.drawRoundedRectangle;
export const drawRectangle: typeof drawModule.drawRectangle = routedFunctions.drawRectangle;
export const drawSingleCircle: typeof drawModule.drawSingleCircle = routedFunctions.drawSingleCircle;
export const drawSingleEllipse: typeof drawModule.drawSingleEllipse = routedFunctions.drawSingleEllipse;
export const drawCircle: typeof drawModule.drawCircle = routedFunctions.drawCircle;
export const drawEllipse: typeof drawModule.drawEllipse = routedFunctions.drawEllipse;
export const drawPolysides: typeof drawModule.drawPolysides = routedFunctions.drawPolysides;
export const drawText: typeof drawModule.drawText = routedFunctions.drawText;
export const drawPointsInterpolation: typeof drawModule.drawPointsInterpolation = routedFunctions.drawPointsInterpolation;
export const drawParametricFunction: typeof drawModule.drawParametricFunction = routedFunctions.drawParametricFunction;
export const drawProjection: typeof drawModule.drawProjection = routedFunctions.drawProjection;
export const drawFaceOutline: typeof drawModule.drawFaceOutline = routedFunctions.drawFaceOutline;
export const deserializeDrawing: typeof drawModule.deserializeDrawing = routedFunctions.deserializeDrawing;
export const sketchCircle: typeof cannedSketches.sketchCircle = routedFunctions.sketchCircle;
export const sketchEllipse: typeof cannedSketches.sketchEllipse = routedFunctions.sketchEllipse;
export const sketchRectangle: typeof cannedSketches.sketchRectangle = routedFunctions.sketchRectangle;
export const sketchRoundedRectangle: typeof cannedSketches.sketchRoundedRectangle = routedFunctions.sketchRoundedRectangle;
export const sketchPolysides: typeof cannedSketches.sketchPolysides = routedFunctions.sketchPolysides;
export const sketchFaceOffset: typeof cannedSketches.sketchFaceOffset = routedFunctions.sketchFaceOffset;
export const sketchParametricFunction: typeof cannedSketches.sketchParametricFunction = routedFunctions.sketchParametricFunction;
export const sketchHelix: typeof cannedSketches.sketchHelix = routedFunctions.sketchHelix;
export const sketchText: typeof textModule.sketchText = routedFunctions.sketchText;
export const textBlueprints: typeof textModule.textBlueprints = routedFunctions.textBlueprints;
export const polysidesBlueprint: typeof cannedBlueprints.polysidesBlueprint = routedFunctions.polysidesBlueprint;
export const roundedRectangleBlueprint: typeof cannedBlueprints.roundedRectangleBlueprint = routedFunctions.roundedRectangleBlueprint;
export const fuse2D: typeof boolean2D.fuse2D = routedFunctions.fuse2D;
export const cut2D: typeof boolean2D.cut2D = routedFunctions.cut2D;
export const intersect2D: typeof boolean2D.intersect2D = routedFunctions.intersect2D;
export const fuseBlueprints: typeof booleanOperations.fuseBlueprints = routedFunctions.fuseBlueprints;
export const cutBlueprints: typeof booleanOperations.cutBlueprints = routedFunctions.cutBlueprints;
export const intersectBlueprints: typeof booleanOperations.intersectBlueprints = routedFunctions.intersectBlueprints;
export const makeProjectedEdges: typeof projection.makeProjectedEdges = routedFunctions.makeProjectedEdges;

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
/**
 * Creates a cylinder with the given radius and height.
 *
 * @category Solids
 */
export const makeCylinder: typeof shapeHelpers.makeCylinder = routedFunctions.makeCylinder;
/**
 * Creates a sphere with the given radius, centred on the origin.
 *
 * @category Solids
 */
export const makeSphere: typeof shapeHelpers.makeSphere = routedFunctions.makeSphere;
/**
 * Creates an ellipsoid with the given lengths of the axes, centred on the origin.
 *
 * @category Solids
 */
export const makeEllipsoid: typeof shapeHelpers.makeEllipsoid = routedFunctions.makeEllipsoid;
/**
 * Creates a box with the given corner points.
 *
 * @category Solids
 */
export const makeBox: typeof shapeHelpers.makeBox = routedFunctions.makeBox;
/**
 * Builds a rectangular box of the given lengths.
 *
 * The box is centred on the origin in X and Y (spanning `[-x/2, +x/2]` and
 * `[-y/2, +y/2]`) and corner-based in Z (spanning `[0, +z]`). Translate by
 * `[0, 0, -z/2]` to centre the box fully, or use {@link makeBox} when you
 * want explicit two-corner control.
 *
 * @example
 * const slab = makeBaseBox(30, 50, 10);
 * // slab spans x: [-15, 15], y: [-25, 25], z: [0, 10]
 *
 * @category Solids
 */
export const makeBaseBox: typeof shortcuts.makeBaseBox = routedFunctions.makeBaseBox;
export const makeVertex: typeof shapeHelpers.makeVertex = routedFunctions.makeVertex;
export const makeOffset: typeof shapeHelpers.makeOffset = routedFunctions.makeOffset;
export const compoundShapes: typeof shapeHelpers.compoundShapes = routedFunctions.compoundShapes;
export const makeCompound: typeof shapeHelpers.makeCompound = routedFunctions.makeCompound;
/** Welds faces and shells into a single shell.
 *
 * @param facesOrShells - An array of faces and shells to be welded.
 * @param ignoreType - If true, the function will not check if the result is
 * a shell.
 * @returns A shell that contains all the faces and shells.
 * */
export const weldShellsAndFaces: typeof shapeHelpers.weldShellsAndFaces = routedFunctions.weldShellsAndFaces;
/** Welds faces and shells into a single shell and then makes a solid.
 *
 * @param facesOrShells - An array of faces and shells to be welded.
 * @returns A solid that contains all the faces and shells.
 *
 * @category Solids
 **/
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
/**
 * Creates a drawing pen to programatically draw in 2D.
 *
 * @category Drawing
 */
export const draw: typeof drawModule.draw = routedFunctions.draw;
/**
 * Creates the `Drawing` of a rectangle with (optional) rounded corners.
 *
 * The rectangle is centered on [0, 0]
 *
 * @category Drawing
 */
export const drawRoundedRectangle: typeof drawModule.drawRoundedRectangle = routedFunctions.drawRoundedRectangle;
export const drawRectangle: typeof drawModule.drawRectangle = routedFunctions.drawRectangle;
/**
 * Creates the `Drawing` of a circle as one single curve.
 *
 * The circle is centered on [0, 0]
 *
 * @category Drawing
 */
export const drawSingleCircle: typeof drawModule.drawSingleCircle = routedFunctions.drawSingleCircle;
/**
 * Creates the `Drawing` of an ellipse as one single curve.
 *
 * The ellipse is centered on [0, 0], with axes aligned with the coordinates.
 *
 * @category Drawing
 */
export const drawSingleEllipse: typeof drawModule.drawSingleEllipse = routedFunctions.drawSingleEllipse;
/**
 * Creates the `Drawing` of a circle.
 *
 * The circle is centered on [0, 0]
 *
 * @category Drawing
 */
export const drawCircle: typeof drawModule.drawCircle = routedFunctions.drawCircle;
/**
 * Creates the `Drawing` of an ellipse.
 *
 * The ellipse is centered on [0, 0], with axes aligned with the coordinates.
 *
 * @category Drawing
 */
export const drawEllipse: typeof drawModule.drawEllipse = routedFunctions.drawEllipse;
/**
 * Creates the `Drawing` of an polygon in a defined plane
 *
 * The sides of the polygon can be arcs of circle with a defined sagitta.
 * The radius defines the out radius of the polygon without sagitta
 *
 * @category Drawing
 */
export const drawPolysides: typeof drawModule.drawPolysides = routedFunctions.drawPolysides;
/**
 * Creates the `Drawing` of a text, in a defined font size and a font familiy
 * (which will be the default).
 *
 * @category Drawing
 */
export const drawText: typeof drawModule.drawText = routedFunctions.drawText;
/**
 * Creates the `Drawing` by interpolating points as a curve
 *
 * The drawing will be a spline approximating the points. Note that the
 * degree should be at maximum 3 if you need to export the drawing as an SVG.
 *
 * @category Drawing
 */
export const drawPointsInterpolation: typeof drawModule.drawPointsInterpolation = routedFunctions.drawPointsInterpolation;
/**
 * Creates the `Drawing` of parametric function
 *
 * The drawing will be a spline approximating the function. Note that the
 * degree should be at maximum 3 if you need to export the drawing as an SVG.
 *
 * @category Drawing
 */
export const drawParametricFunction: typeof drawModule.drawParametricFunction = routedFunctions.drawParametricFunction;
/**
 * Creates the `Drawing` of a projection of a shape on a plane.
 *
 * The projection is done by projecting the edges of the shape on the plane.
 *
 * @category Drawing
 */
export const drawProjection: typeof drawModule.drawProjection = routedFunctions.drawProjection;
/**
 * Creates the `Drawing` out of a face
 *
 * @category Drawing
 */
export const drawFaceOutline: typeof drawModule.drawFaceOutline = routedFunctions.drawFaceOutline;
/**
 * Deserializes a drawing from a string. String is expected to be in the format
 * generated by `Drawing.serialize()`.
 */
export const deserializeDrawing: typeof drawModule.deserializeDrawing = routedFunctions.deserializeDrawing;
/**
 * Creates the `Sketch` of a circle in a defined plane
 *
 * @category Sketching
 */
export const sketchCircle: typeof cannedSketches.sketchCircle = routedFunctions.sketchCircle;
/**
 * Creates the `Sketch` of an ellispe in a defined plane
 *
 * @category Sketching
 */
export const sketchEllipse: typeof cannedSketches.sketchEllipse = routedFunctions.sketchEllipse;
/**
 * Creates the `Sketch` of a rectangle in a defined plane
 *
 * @category Sketching
 */
export const sketchRectangle: typeof cannedSketches.sketchRectangle = routedFunctions.sketchRectangle;
/**
 * Creates the `Sketch` of a rounded rectangle in a defined plane
 *
 * @category Sketching
 */
export const sketchRoundedRectangle: typeof cannedSketches.sketchRoundedRectangle = routedFunctions.sketchRoundedRectangle;
/**
 * Creates the `Sketch` of an polygon in a defined plane
 *
 * The sides of the polygon can be arcs of circle with a defined sagitta.
 * The radius defines the out radius of the polygon without sagitta
 *
 * @category Sketching
 */
export const sketchPolysides: typeof cannedSketches.sketchPolysides = routedFunctions.sketchPolysides;
/**
 * Creates the `Sketch` of an offset of a certain face. A negative offset will
 * be within the face, a positive one outside.
 *
 * @category Sketching
 */
export const sketchFaceOffset: typeof cannedSketches.sketchFaceOffset = routedFunctions.sketchFaceOffset;
/**
 * Creates the `Sketch` of parametric function in a specified plane
 *
 * The sketch will be a spline approximating the function
 *
 * @category Sketching
 */
export const sketchParametricFunction: typeof cannedSketches.sketchParametricFunction = routedFunctions.sketchParametricFunction;
/**
 * Creates the `Sketch` of a helix
 *
 * @category Sketching
 */
export const sketchHelix: typeof cannedSketches.sketchHelix = routedFunctions.sketchHelix;
/**
 * Creates the `Sketches` of a text, in a defined font size and a font familiy
 * (which will be the default).
 */
export const sketchText: typeof textModule.sketchText = routedFunctions.sketchText;
/**
 * Creates the `Blueprints` of a text, in a defined font size and a font familiy
 * (which will be the default).
 */
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

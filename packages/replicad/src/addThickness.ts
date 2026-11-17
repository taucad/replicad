import { getOC } from "./oclib";
import {
  Solid,
  cast,
  downcast,
  Face,
  Shape3D,
  isShape3D,
  isWire,
  Wire,
  Edge,
} from "./shapes";
import { makeLine, makeHelix, assembleWire, makeVertex } from "./shapeHelpers";
import { ocScope, type OcScope } from "./register";
import { Direction, Vector, makeAx1, Point } from "./geom";
import { DEG2RAD } from "./constants";
import type {
  Law_Function,
  Law_Linear,
  Law_S,
  TopoDS_Shape,
} from "replicad-opencascadejs";

export const basicFaceExtrusion = (face: Face, extrusionVec: Vector): Solid => {
  const oc = getOC();
  const solidBuilder = new oc.BRepPrimAPI_MakePrism(
    face.wrapped,
    extrusionVec.wrapped,
    false,
    true
  );
  try {
    const shape = solidBuilder.Shape();
    try {
      return new Solid(downcast(shape));
    } finally {
      shape.delete();
    }
  } finally {
    solidBuilder.delete();
  }
};

export const revolution = (
  face: Face,
  center: Point = [0, 0, 0],
  direction: Direction = [0, 0, 1],
  angle = 360
): Shape3D => {
  const oc = getOC();
  const ax = makeAx1(center, direction);

  const revolBuilder = new oc.BRepPrimAPI_MakeRevol(
    face.wrapped,
    ax,
    angle * DEG2RAD,
    false
  );

  let shape;
  try {
    shape = cast(revolBuilder.Shape());
  } finally {
    ax.delete();
    revolBuilder.delete();
  }

  if (!isShape3D(shape)) {
    shape.delete();
    throw new Error("Could not revolve to a 3d shape");
  }
  return shape;
};

export interface GenericSweepConfig {
  frenet?: boolean;
  auxiliarySpine?: Wire | Edge;
  law?: null | Law_Function;
  transitionMode?: "right" | "transformed" | "round";
  withContact?: boolean;
  support?: TopoDS_Shape;
  forceProfileSpineOthogonality?: boolean;
}

function genericSweep(
  wire: Wire,
  spine: Wire,
  sweepConfig: GenericSweepConfig,
  shellMode: true
): [Shape3D, Wire, Wire];
function genericSweep(
  wire: Wire,
  spine: Wire,
  sweepConfig: GenericSweepConfig,
  shellMode?: false
): Shape3D;
function genericSweep(
  wire: Wire,
  spine: Wire,
  {
    frenet = false,
    auxiliarySpine,
    law = null,
    transitionMode = "right",
    withContact,
    support,
    forceProfileSpineOthogonality,
  }: GenericSweepConfig = {},
  shellMode = false
): Shape3D | [Shape3D, Wire, Wire] {
  const oc = getOC();
  const withCorrection =
    transitionMode === "round" ? true : !!forceProfileSpineOthogonality;
  const r = ocScope();
  try {
    const sweepBuilder = r(new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped));

    if (transitionMode) {
      const mode = {
        transformed: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed,
        round: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner,
        right: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner,
      }[transitionMode];
      if (mode) sweepBuilder.SetTransitionMode(mode);
    }

    if (support) {
      sweepBuilder.SetMode(support);
    } else if (frenet) {
      sweepBuilder.SetMode(frenet);
    }
    if (auxiliarySpine) {
      sweepBuilder.SetMode(
        auxiliarySpine.wrapped,
        false,
        oc.BRepFill_TypeOfContact.BRepFill_NoContact
      );
    }

    if (!law) sweepBuilder.Add(wire.wrapped, !!withContact, withCorrection);
    else sweepBuilder.SetLaw(wire.wrapped, law, !!withContact, withCorrection);

    sweepBuilder.Build();
    if (!shellMode) {
      sweepBuilder.MakeSolid();
    }
    const shape = r(cast(sweepBuilder.Shape()));
    if (!isShape3D(shape)) throw new Error("Could not sweep to a 3d shape");

    if (shellMode) {
      const startWire = r(cast(sweepBuilder.FirstShape()));
      const endWire = r(cast(sweepBuilder.LastShape()));
      if (!isWire(startWire))
        throw new Error("Could not sweep with one start wire");
      if (!isWire(endWire)) throw new Error("Could not sweep with one end wire");
      return [r.keep(shape), r.keep(startWire), r.keep(endWire)];
    }

    return r.keep(shape);
  } finally {
    r.dispose();
  }
}

export { genericSweep };

export interface ExtrusionProfile {
  profile?: "s-curve" | "linear";
  endFactor?: number;
}

const buildLawFromProfile = (
  extrusionLength: number,
  { profile, endFactor = 1 }: ExtrusionProfile
): Law_Function => {
  let law: Law_S | Law_Linear;
  const oc = getOC();

  if (profile === "s-curve") {
    law = new oc.Law_S();
    law.Set(0, 1, extrusionLength, endFactor);
  } else if (profile === "linear") {
    law = new oc.Law_Linear();
    law.Set(0, 1, extrusionLength, endFactor);
  } else {
    throw new Error("Could not generate a law function");
  }

  // This is an API compatibility issue
  // We might want to fix this in a way or another
  try {
    return law.Trim(0, extrusionLength, 1e-6);
  } finally {
    law.delete();
  }
};

export const supportExtrude = (
  wire: Wire,
  center: Point,
  normal: Point,
  support: TopoDS_Shape
): Shape3D => {
  const r = ocScope();
  try {
    const spine = r(makeSpine(r, center, normal));
    return genericSweep(wire, spine, { support });
  } finally {
    r.dispose();
  }
};

/** A straight wire from `center` along `normal`; `r` owns the temporaries. */
const makeSpine = (r: OcScope, center: Point, normal: Point): Wire => {
  const centerVec = r(new Vector(center));
  const normalVec = r(new Vector(normal));
  const mainSpineEdge = r(makeLine(centerVec, r(centerVec.add(normalVec))));
  return assembleWire([mainSpineEdge]);
};

const vectorLength = (vector: Point): number => {
  const v = new Vector(vector);
  try {
    return v.Length;
  } finally {
    v.delete();
  }
};

function complexExtrude(
  wire: Wire,
  center: Point,
  normal: Point,
  profileShape: ExtrusionProfile | undefined,
  shellMode: true
): [Shape3D, Wire, Wire];
function complexExtrude(
  wire: Wire,
  center: Point,
  normal: Point,
  profileShape?: ExtrusionProfile,
  shellMode?: false
): Shape3D;
function complexExtrude(
  wire: Wire,
  center: Point,
  normal: Point,
  profileShape?: ExtrusionProfile,
  shellMode = false
): Shape3D | [Shape3D, Wire, Wire] {
  const r = ocScope();
  try {
    const spine = r(makeSpine(r, center, normal));

    const law = profileShape
      ? r(buildLawFromProfile(vectorLength(normal), profileShape))
      : null;

    // The ternary operator is here only to make typescript happy
    const shape = shellMode
      ? genericSweep(wire, spine, { law }, shellMode)
      : genericSweep(wire, spine, { law }, shellMode);

    return shape;
  } finally {
    r.dispose();
  }
}

export { complexExtrude };

function twistExtrude(
  wire: Wire,
  angleDegrees: number,
  center: Point,
  normal: Point,
  profileShape?: ExtrusionProfile,
  shellMode?: false
): Shape3D;
function twistExtrude(
  wire: Wire,
  angleDegrees: number,
  center: Point,
  normal: Point,
  profileShape: ExtrusionProfile | undefined,
  shellMode: true
): [Shape3D, Wire, Wire];
function twistExtrude(
  wire: Wire,
  angleDegrees: number,
  center: Point,
  normal: Point,
  profileShape?: ExtrusionProfile,
  shellMode = false
): Shape3D | [Shape3D, Wire, Wire] {
  const r = ocScope();
  try {
    const spine = r(makeSpine(r, center, normal));
    const length = vectorLength(normal);

    const pitch = (360.0 / angleDegrees) * length;
    const radius = 1;

    const auxiliarySpine = r(makeHelix(pitch, length, radius, center, normal));

    const law = profileShape
      ? r(buildLawFromProfile(length, profileShape))
      : null;

    // The ternary operator is here only to make typescript happy
    const shape = shellMode
      ? genericSweep(wire, spine, { auxiliarySpine, law }, shellMode)
      : genericSweep(wire, spine, { auxiliarySpine, law }, shellMode);

    return shape;
  } finally {
    r.dispose();
  }
}
export { twistExtrude };

export interface LoftConfig {
  ruled?: boolean;
  startPoint?: Point;
  endPoint?: Point;
}

export const loft = (
  wires: Wire[],
  { ruled = true, startPoint, endPoint }: LoftConfig = {},
  returnShell = false
): Shape3D => {
  const oc = getOC();
  const r = ocScope();
  try {
    const loftBuilder = r(
      new oc.BRepOffsetAPI_ThruSections(!returnShell, ruled, 1e-6)
    );

    if (startPoint) {
      loftBuilder.AddVertex(r(makeVertex(startPoint)).wrapped);
    }
    wires.forEach((w) => loftBuilder.AddWire(w.wrapped));
    if (endPoint) {
      loftBuilder.AddVertex(r(makeVertex(endPoint)).wrapped);
    }

    loftBuilder.Build();
    const shape = cast(loftBuilder.Shape());

    if (!isShape3D(shape)) {
      shape.delete();
      throw new Error("Could not loft to a 3d shape");
    }
    return shape;
  } finally {
    r.dispose();
  }
};

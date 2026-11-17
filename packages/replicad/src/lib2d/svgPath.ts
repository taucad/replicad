import type { Geom2dAdaptor_Curve, gp_Pnt2d } from "replicad-opencascadejs";
import { RAD2DEG } from "../constants";
import { findCurveType } from "../definitionMaps";
import { getOC } from "../oclib";
import round5 from "../utils/round5";
import { Point2D } from "./definitions";

/** Formats a point the caller owns, then deletes it. */
const fromPnt = (pnt: gp_Pnt2d) => {
  try {
    return `${round5(pnt.X())} ${round5(pnt.Y())}`;
  } finally {
    pnt.delete();
  }
};

/** Reads an OpenCascade value, then deletes it. */
const read = <T extends { delete(): void }, R>(value: T, fn: (v: T) => R): R => {
  try {
    return fn(value);
  } finally {
    value.delete();
  }
};

export const adaptedCurveToPathElem = (
  adaptor: Geom2dAdaptor_Curve,
  lastPoint: Point2D
): string => {
  const oc = getOC();
  const curveType = findCurveType(adaptor.GetType());

  const [endX, endY] = lastPoint;
  const endpoint = `${round5(endX)} ${round5(endY)}`;
  if (curveType === "LINE") {
    return `L ${endpoint}`;
  }
  if (curveType === "BEZIER_CURVE") {
    const bezier = read(adaptor.Bezier(), (curve) => {
      const deg = curve.Degree();

      if (deg === 1) {
        return `L ${endpoint}`;
      }

      if (deg === 2) {
        return `Q ${fromPnt(curve.Pole(2))} ${endpoint}`;
      }

      if (deg === 3) {
        const p1 = fromPnt(curve.Pole(2));
        const p2 = fromPnt(curve.Pole(3));
        return `C ${p1} ${p2} ${endpoint}`;
      }
      return null;
    });
    if (bezier) return bezier;
  }
  if (curveType === "CIRCLE") {
    const curve = adaptor.Circle();
    const radius = curve.Radius();
    const isDirect = curve.IsDirect();
    curve.delete();

    const p1 = adaptor.FirstParameter();
    const p2 = adaptor.LastParameter();

    const paramAngle = (p2 - p1) * RAD2DEG;

    const end =
      paramAngle !== 360
        ? endpoint
        : `${round5(endX)} ${round5(endY + 0.0001)}`;

    return `A ${radius} ${radius} 0 ${Math.abs(paramAngle) > 180 ? "1" : "0"} ${
      isDirect ? "1" : "0"
    } ${end}`;
  }

  if (curveType === "ELLIPSE") {
    const curve = adaptor.Ellipse();
    const rx = curve.MajorRadius();
    const ry = curve.MinorRadius();

    const p1 = adaptor.FirstParameter();
    const p2 = adaptor.LastParameter();

    const paramAngle = (p2 - p1) * RAD2DEG;

    const end =
      paramAngle !== 360
        ? endpoint
        : `${round5(endX)} ${round5(endY + 0.0001)}`;

    const dir0 = new oc.gp_Dir2d();
    const angle =
      180 -
      read(curve.XAxis(), (axis) =>
        read(axis.Direction(), (direction) => direction.Angle(dir0))
      ) *
        RAD2DEG;
    dir0.delete();
    const isDirect = curve.IsDirect();
    curve.delete();

    return `A ${round5(rx)} ${round5(ry)} ${round5(angle)} ${
      Math.abs(paramAngle) > 180 ? "1" : "0"
    } ${isDirect ? "1" : "0"} ${end}`;
  }

  throw new Error(`Unsupported curve type: ${curveType}`);
};

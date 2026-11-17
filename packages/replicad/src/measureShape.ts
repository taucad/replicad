import { getOC } from "./oclib";
import { AnyShape, Face, Shape3D } from "./shapes";

import type {
  BRepExtrema_DistShapeShape,
  GProp_GProps,
} from "replicad-opencascadejs";
import { ocScope, WrappingObj } from "./register";
class PhysicalProperties extends WrappingObj<GProp_GProps> {
  get centerOfMass(): [number, number, number] {
    const r = ocScope();
    try {
      const pnt = r(this.wrapped.CentreOfMass());
      return [pnt.X(), pnt.Y(), pnt.Z()];
    } finally {
      r.dispose();
    }
  }
}

export class VolumePhysicalProperties extends PhysicalProperties {
  get volume(): number {
    return this.wrapped.Mass();
  }
}

export class SurfacePhysicalProperties extends PhysicalProperties {
  get area(): number {
    return this.wrapped.Mass();
  }
}

export class LinearPhysicalProperties extends PhysicalProperties {
  get length(): number {
    return this.wrapped.Mass();
  }
}

export function measureShapeSurfaceProperties(
  shape: Face | Shape3D
): SurfacePhysicalProperties {
  const oc = getOC();
  const properties = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(shape.wrapped, properties, false, false);
  return new SurfacePhysicalProperties(properties);
}

export function measureShapeLinearProperties(
  shape: AnyShape
): LinearPhysicalProperties {
  const oc = getOC();
  const properties = new oc.GProp_GProps();
  oc.BRepGProp.LinearProperties(shape.wrapped, properties, false, false);
  return new LinearPhysicalProperties(properties);
}

export function measureShapeVolumeProperties(
  shape: Shape3D
): VolumePhysicalProperties {
  const oc = getOC();
  const properties = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(
    shape.wrapped,
    properties,
    false,
    false,
    false
  );
  return new VolumePhysicalProperties(properties);
}

/**
 * Measure the volume of a shape
 *
 * @category Measure
 */
export function measureVolume(shape: Shape3D) {
  const properties = measureShapeVolumeProperties(shape);
  try {
    return properties.volume;
  } finally {
    properties.delete();
  }
}

/**
 * Measure the area of a shape
 *
 * @category Measure
 */
export function measureArea(shape: Face | Shape3D) {
  const properties = measureShapeSurfaceProperties(shape);
  try {
    return properties.area;
  } finally {
    properties.delete();
  }
}

/**
 * Measure the length of a shape
 *
 * @category Measure
 */
export function measureLength(shape: AnyShape) {
  const properties = measureShapeLinearProperties(shape);
  try {
    return properties.length;
  } finally {
    properties.delete();
  }
}

export class DistanceTool extends WrappingObj<BRepExtrema_DistShapeShape> {
  constructor() {
    const oc = getOC();
    super(new oc.BRepExtrema_DistShapeShape());
  }

  distanceBetween(shape1: AnyShape, shape2: AnyShape): number {
    this.wrapped.LoadS1(shape1.wrapped);
    this.wrapped.LoadS2(shape2.wrapped);
    this.wrapped.Perform();
    return this.wrapped.Value();
  }
}

/**
 * Measure the distance between two shapes
 *
 * @category Measure
 */
export function measureDistanceBetween(
  shape1: AnyShape,
  shape2: AnyShape
): number {
  const tool = new DistanceTool();
  try {
    return tool.distanceBetween(shape1, shape2);
  } finally {
    tool.delete();
  }
}

export class DistanceQuery extends WrappingObj<BRepExtrema_DistShapeShape> {
  constructor(shape: AnyShape) {
    const oc = getOC();
    super(new oc.BRepExtrema_DistShapeShape());
    this.wrapped.LoadS1(shape.wrapped);
  }

  distanceTo(shape: AnyShape): number {
    this.wrapped.LoadS2(shape.wrapped);
    this.wrapped.Perform();
    return this.wrapped.Value();
  }
}

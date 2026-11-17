import type { TopoDS_Shape } from "replicad-opencascadejs";

import {
  downcast,
  shapeType,
  topologyKind,
  type TopologyKind,
} from "./topology.js";

export type ShapeConstructors<T> = {
  [K in TopologyKind]: new (shape: any) => T;
};

/** The OpenCascade class of a downcast handle of each kind. */
const HANDLE_CLASS: Record<TopologyKind, string> = {
  vertex: "TopoDS_Vertex",
  edge: "TopoDS_Edge",
  wire: "TopoDS_Wire",
  face: "TopoDS_Face",
  shell: "TopoDS_Shell",
  solid: "TopoDS_Solid",
  solidCompound: "TopoDS_CompSolid",
  compound: "TopoDS_Compound",
};

/**
 * Builds a cast function from the concrete wrappers to instantiate.
 *
 * The cast consumes the handle it is given: a handle that already has the
 * class of its kind is adopted by the wrapper as it is, any other is
 * downcast to a new handle and deleted. If the cast throws, its input is left
 * alone. A caller that must keep using the handle passes a copy.
 *
 * This keeps the casting module independent from the wrapper classes, while
 * letting the caller keep the mapping fully typed.
 */
export function makeCaster<T>(
  constructors: ShapeConstructors<T>
): (shape: TopoDS_Shape) => T {
  return (shape: TopoDS_Shape) => {
    const kind = topologyKind(shape);
    if (!kind)
      throw new Error(`Unsupported topology type: ${shapeType(shape)}`);

    if (shape.constructor?.name === HANDLE_CLASS[kind])
      return new constructors[kind](shape);
    const typed = downcast(shape);
    shape.delete();
    return new constructors[kind](typed);
  };
}

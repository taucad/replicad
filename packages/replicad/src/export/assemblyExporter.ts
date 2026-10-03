import type {
  Quantity_ColorRGBA,
  TCollection_ExtendedString,
  TDF_Label,
  TDocStd_Document,
} from "replicad-opencascadejs";
// NOTE: XCAFDoc_VisMaterial* (PBR visual materials) are deliberately omitted from
// the replicad-opencascadejs WASM build — they depend on Graphic3d/TKService which
// requires TKOpenGl (unavailable in WASM).
import { uuidv } from "../utils/uuid";
import { getOC } from "../oclib";
import { AnyShape } from "../shapes";
import { GCWithScope, WrappingObj } from "../register";

const wrapString = (str: string): TCollection_ExtendedString => {
  const oc = getOC();
  return new oc.TCollection_ExtendedString(str, true);
};

function parseSlice(hex: string, index: number): number {
  return parseInt(hex.slice(index * 2, (index + 1) * 2), 16);
}
function colorFromHex(hex: string): [number, number, number] {
  let color = hex;
  if (color.indexOf("#") === 0) color = color.slice(1);

  if (color.length === 3) {
    color = color.replace(/([0-9a-f])/gi, "$1$1");
  }

  return [parseSlice(color, 0), parseSlice(color, 1), parseSlice(color, 2)];
}

const wrapColor = (hex: string, alpha = 1): Quantity_ColorRGBA => {
  const oc = getOC();
  const [r, g, b] = colorFromHex(hex);

  return new oc.Quantity_ColorRGBA(r / 255, g / 255, b / 255, alpha);
};

export class AssemblyExporter extends WrappingObj<TDocStd_Document> {}

export type ShapeConfig = {
  shape: AnyShape;
  color?: string;
  alpha?: number;
  name?: string;
  /** PBR metalness factor (0 = dielectric, 1 = metal). Threaded to GLTF only (not STEP; see note above). */
  metalness?: number;
  /** PBR roughness factor — threaded to GLTF only (not STEP; see note above). */
  roughness?: number;
  /** Material density in g/cm3, written as the shape's STEP material. */
  density?: number;
};

interface HAsciiString {
  delete(): void;
}

interface MaterialTool {
  SetMaterial(
    label: TDF_Label,
    name: HAsciiString,
    description: HAsciiString,
    density: number,
    densityName: HAsciiString,
    densityValueType: HAsciiString
  ): void;
}

/**
 * Typed bindings of `XCAFDoc_MaterialTool` and `TCollection_HAsciiString`,
 * which only Tau's OpenCascade build declares and exports.
 */
interface MaterialBindings {
  TCollection_HAsciiString?: new (value: string) => HAsciiString;
}

const makeMaterialWriter = (mainLabel: TDF_Label) => {
  const oc = getOC();
  const { TCollection_HAsciiString } = oc as unknown as MaterialBindings;
  if (!TCollection_HAsciiString) {
    throw new Error(
      "Shape density needs an OpenCascade build with material bindings"
    );
  }

  const wrapAscii = (value: string) => new TCollection_HAsciiString(value);
  const matTool = oc.XCAFDoc_DocumentTool.MaterialTool(
    mainLabel
  ) as MaterialTool;

  return (label: TDF_Label, name: string, density: number) => {
    matTool.SetMaterial(
      label,
      wrapAscii(name),
      wrapAscii(""),
      density,
      wrapAscii("g/cm3"),
      wrapAscii("POSITIVE_RATIO_MEASURE")
    );
  };
};

export function createAssembly(shapes: ShapeConfig[] = []): AssemblyExporter {
  const oc = getOC();

  const doc = new oc.TDocStd_Document(wrapString("XmlOcaf"));

  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);

  const mainLabel = doc.Main();

  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);
  const ctool = oc.XCAFDoc_DocumentTool.ColorTool(mainLabel);
  // The material tool is only bound in Tau's build: create it on first use.
  let setMaterial: ReturnType<typeof makeMaterialWriter> | undefined;

  for (const { shape, name, color, alpha, density } of shapes) {
    const shapeNode = tool.NewShape();

    tool.SetShape(shapeNode, shape.wrapped);

    oc.TDataStd_Name.Set(shapeNode, wrapString(name || uuidv()));

    ctool.SetColor(
      shapeNode,
      wrapColor(color || "#f00", alpha ?? 1),
      oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf
    );

    if (density !== undefined) {
      setMaterial ??= makeMaterialWriter(mainLabel);
      setMaterial(shapeNode, name || "material", density);
    }
  }

  tool.UpdateAssemblies();

  return new AssemblyExporter(doc);
}

export type SupportedUnit =
  | "M"
  | "CM"
  | "MM"
  | "INCH"
  | "FT"
  | "m"
  | "mm"
  | "cm"
  | "inch"
  | "ft";

export function exportSTEP(
  shapes: ShapeConfig[] = [],
  { unit, modelUnit }: { unit?: SupportedUnit; modelUnit?: SupportedUnit } = {}
): Blob {
  const oc = getOC();
  const r = GCWithScope();

  const doc = createAssembly(shapes);

  if (unit || modelUnit) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const dummy = r(new oc.STEPCAFControl_Writer());

    oc.Interface_Static.SetCVal(
      "xstep.cascade.unit",
      (modelUnit || unit || "MM").toUpperCase()
    );
    oc.Interface_Static.SetCVal(
      "write.step.unit",
      (unit || modelUnit || "MM").toUpperCase()
    );
  }

  const session = r(new oc.XSControl_WorkSession());
  const writer = r(
    new oc.STEPCAFControl_Writer(
      session,
      false
    )
  );
  writer.SetColorMode(true);
  writer.SetLayerMode(true);
  writer.SetNameMode(true);
  writer.SetMaterialMode(true);
  oc.Interface_Static.SetIVal("write.surfacecurve.mode", 1);
  oc.Interface_Static.SetIVal("write.precision.mode", 0);
  oc.Interface_Static.SetIVal("write.step.assembly", 2);
  oc.Interface_Static.SetIVal("write.step.schema", 5);

  const filename = "export.step";
  const progress = r(new oc.Message_ProgressRange());
  const success = writer.Perform(doc.wrapped, filename, progress);

  if (success) {
    const file = oc.FS.readFile("/" + filename);
    oc.FS.unlink("/" + filename);
    // Emscripten's Uint8Array is ArrayBuffer-backed despite TypeScript's broader type.
    const blob = new Blob([file as BlobPart], { type: "application/STEP" });
    return blob;
  } else {
    throw new Error("WRITE STEP FILE FAILED.");
  }
}

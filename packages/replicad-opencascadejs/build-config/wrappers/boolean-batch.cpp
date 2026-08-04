// Native batch Boolean helpers for Replicad's high-volume Boolean paths.
//
// The wrapper keeps JavaScript responsible for ergonomic shape arrays while
// one Embind call performs the complete OCCT operation and returns only the
// functional result: shape, completion state, errors, and warnings.

#include <BOPAlgo_GlueEnum.hxx>
#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <Message_ProgressRange.hxx>
#include <NCollection_List.hxx>
#include <Standard_SStream.hxx>
#include <TopoDS_Shape.hxx>
#include <string>
#include <utility>

class ReplicadBooleanBatchResult {
public:
  ReplicadBooleanBatchResult()
    : isDone_(false), hasErrors_(true), hasWarnings_(false) {}

  ReplicadBooleanBatchResult(
    const TopoDS_Shape& shape,
    bool isDone,
    bool hasErrors,
    bool hasWarnings,
    std::string errors,
    std::string warnings
  )
    : shape_(shape), isDone_(isDone), hasErrors_(hasErrors),
      hasWarnings_(hasWarnings), errors_(std::move(errors)),
      warnings_(std::move(warnings)) {}

  TopoDS_Shape Shape() const { return shape_; }
  bool IsDone() const { return isDone_; }
  bool HasErrors() const { return hasErrors_; }
  bool HasWarnings() const { return hasWarnings_; }
  std::string Errors() const { return errors_; }
  std::string Warnings() const { return warnings_; }

private:
  TopoDS_Shape shape_;
  bool isDone_;
  bool hasErrors_;
  bool hasWarnings_;
  std::string errors_;
  std::string warnings_;
};

class ReplicadBooleanBatch {
public:
  static ReplicadBooleanBatchResult Fuse(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue
  ) {
    if (ListSize(shapes) < 2) {
      return Failure("Fuse requires at least two shapes");
    }

    NCollection_List<TopoDS_Shape> arguments;
    NCollection_List<TopoDS_Shape> tools;
    SplitFirstAsArgument(shapes, arguments, tools);
    BRepAlgoAPI_Fuse algorithm;
    return Run(
      algorithm,
      arguments,
      tools,
      nonDestructive,
      glue,
      simplify,
      angularTolerance,
      fuzzyValue);
  }

  static ReplicadBooleanBatchResult Cut(
    const NCollection_List<TopoDS_Shape>& arguments,
    const NCollection_List<TopoDS_Shape>& tools,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue
  ) {
    if (ListSize(arguments) == 0 || ListSize(tools) == 0) {
      return Failure("Cut requires at least one argument and one tool");
    }

    BRepAlgoAPI_Cut algorithm;
    return Run(
      algorithm,
      arguments,
      tools,
      nonDestructive,
      glue,
      simplify,
      angularTolerance,
      fuzzyValue);
  }

  static ReplicadBooleanBatchResult Common(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue
  ) {
    if (ListSize(shapes) < 2) {
      return Failure("Common requires at least two shapes");
    }

    TopoDS_Shape current;
    bool first = true;
    std::string warnings;

    for (NCollection_List<TopoDS_Shape>::Iterator iterator(shapes);
         iterator.More();
         iterator.Next()) {
      if (first) {
        current = iterator.Value();
        first = false;
        continue;
      }

      NCollection_List<TopoDS_Shape> arguments;
      NCollection_List<TopoDS_Shape> tools;
      arguments.Append(current);
      tools.Append(iterator.Value());

      BRepAlgoAPI_Common algorithm;
      ReplicadBooleanBatchResult partial = Run(
        algorithm,
        arguments,
        tools,
        nonDestructive,
        glue,
        simplify,
        angularTolerance,
        fuzzyValue);
      if (!partial.IsDone() || partial.HasErrors()) return partial;

      current = partial.Shape();
      if (partial.HasWarnings()) {
        if (!warnings.empty()) warnings += "\n";
        warnings += partial.Warnings();
      }
    }

    return ReplicadBooleanBatchResult(
      current,
      !current.IsNull(),
      current.IsNull(),
      !warnings.empty(),
      current.IsNull() ? "Common produced a null shape" : "",
      warnings);
  }

private:
  static int ListSize(const NCollection_List<TopoDS_Shape>& shapes) {
    int size = 0;
    for (NCollection_List<TopoDS_Shape>::Iterator iterator(shapes);
         iterator.More();
         iterator.Next()) {
      size++;
    }
    return size;
  }

  static ReplicadBooleanBatchResult Failure(const std::string& message) {
    return ReplicadBooleanBatchResult(
      TopoDS_Shape(), false, true, false, message, "");
  }

  static BOPAlgo_GlueEnum GlueFromInt(int glue) {
    if (glue == 1) return BOPAlgo_GlueShift;
    if (glue == 2) return BOPAlgo_GlueFull;
    return BOPAlgo_GlueOff;
  }

  static void SplitFirstAsArgument(
    const NCollection_List<TopoDS_Shape>& shapes,
    NCollection_List<TopoDS_Shape>& arguments,
    NCollection_List<TopoDS_Shape>& tools
  ) {
    bool first = true;
    for (NCollection_List<TopoDS_Shape>::Iterator iterator(shapes);
         iterator.More();
         iterator.Next()) {
      if (first) {
        arguments.Append(iterator.Value());
        first = false;
      } else {
        tools.Append(iterator.Value());
      }
    }
  }

  static std::string DumpErrors(const BRepAlgoAPI_BooleanOperation& algorithm) {
    if (!algorithm.HasErrors()) return "";
    Standard_SStream stream;
    algorithm.DumpErrors(stream);
    return stream.str();
  }

  static std::string DumpWarnings(const BRepAlgoAPI_BooleanOperation& algorithm) {
    if (!algorithm.HasWarnings()) return "";
    Standard_SStream stream;
    algorithm.DumpWarnings(stream);
    return stream.str();
  }

  static ReplicadBooleanBatchResult Run(
    BRepAlgoAPI_BooleanOperation& algorithm,
    const NCollection_List<TopoDS_Shape>& arguments,
    const NCollection_List<TopoDS_Shape>& tools,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue
  ) {
    algorithm.SetArguments(arguments);
    algorithm.SetTools(tools);
    algorithm.SetRunParallel(ReplicadConfigureThreadPool() > 1);
    algorithm.SetNonDestructive(nonDestructive);
    algorithm.SetToFillHistory(false);
    algorithm.SetUseOBB(false);
    algorithm.SetGlue(GlueFromInt(glue));
    if (fuzzyValue > 0.0) algorithm.SetFuzzyValue(fuzzyValue);

    Message_ProgressRange progress;
    algorithm.Build(progress);
    if (simplify && !algorithm.HasErrors()) {
      algorithm.SimplifyResult(true, true, angularTolerance);
    }

    const bool hasErrors = algorithm.HasErrors();
    const bool hasWarnings = algorithm.HasWarnings();
    const std::string errors = DumpErrors(algorithm);
    const std::string warnings = DumpWarnings(algorithm);
    const TopoDS_Shape shape = hasErrors ? TopoDS_Shape() : algorithm.Shape();
    const bool isDone = !hasErrors && !shape.IsNull();

    return ReplicadBooleanBatchResult(
      shape,
      isDone,
      hasErrors || shape.IsNull(),
      hasWarnings,
      !hasErrors && shape.IsNull() ? "Boolean operation produced a null shape" : errors,
      warnings);
  }
};

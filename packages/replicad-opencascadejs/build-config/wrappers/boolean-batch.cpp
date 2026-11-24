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
    : isDone_(false), hasErrors_(true), hasWarnings_(false),
      isUserBreak_(false) {}

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
      warnings_(std::move(warnings)), isUserBreak_(false) {}

  TopoDS_Shape Shape() const { return shape_; }
  bool IsDone() const { return isDone_; }
  bool HasErrors() const { return hasErrors_; }
  bool HasWarnings() const { return hasWarnings_; }
  std::string Errors() const { return errors_; }
  std::string Warnings() const { return warnings_; }
  // True when a `ReplicadUserBreak` stopped the operation; the result then
  // has errors and no shape. Always false for the entry points without one.
  bool IsUserBreak() const { return isUserBreak_; }

private:
  TopoDS_Shape shape_;
  bool isDone_;
  bool hasErrors_;
  bool hasWarnings_;
  std::string errors_;
  std::string warnings_;
  bool isUserBreak_;

  friend class ReplicadBooleanBatch;
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
    return FuseImpl(
      shapes, nonDestructive, glue, simplify, angularTolerance, fuzzyValue,
      false, nullptr);
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
    return CutImpl(
      arguments, tools, nonDestructive, glue, simplify, angularTolerance,
      fuzzyValue, false, nullptr);
  }

  static ReplicadBooleanBatchResult Common(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue
  ) {
    return CommonImpl(
      shapes, nonDestructive, glue, simplify, angularTolerance, fuzzyValue,
      false, nullptr);
  }

  // The `...WithOptions` variants add two inputs and change nothing else:
  //   useOBB    : BOPAlgo's oriented-bounding-box prefilter (the entry points
  //               above always pass false);
  //   userBreak : a `ReplicadUserBreak`; a disabled one attaches no progress
  //               indicator, exactly like the entry points above. When it
  //               stops the operation the result reports IsUserBreak().
  static ReplicadBooleanBatchResult FuseWithOptions(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    const ReplicadUserBreak& userBreak
  ) {
    Handle(ReplicadUserBreakIndicator) indicator =
      ReplicadMakeUserBreakIndicator(userBreak);
    return FuseImpl(
      shapes, nonDestructive, glue, simplify, angularTolerance, fuzzyValue,
      useOBB, indicator.get());
  }

  static ReplicadBooleanBatchResult CutWithOptions(
    const NCollection_List<TopoDS_Shape>& arguments,
    const NCollection_List<TopoDS_Shape>& tools,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    const ReplicadUserBreak& userBreak
  ) {
    Handle(ReplicadUserBreakIndicator) indicator =
      ReplicadMakeUserBreakIndicator(userBreak);
    return CutImpl(
      arguments, tools, nonDestructive, glue, simplify, angularTolerance,
      fuzzyValue, useOBB, indicator.get());
  }

  static ReplicadBooleanBatchResult CommonWithOptions(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    const ReplicadUserBreak& userBreak
  ) {
    Handle(ReplicadUserBreakIndicator) indicator =
      ReplicadMakeUserBreakIndicator(userBreak);
    return CommonImpl(
      shapes, nonDestructive, glue, simplify, angularTolerance, fuzzyValue,
      useOBB, indicator.get());
  }

private:
  static ReplicadBooleanBatchResult FuseImpl(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    ReplicadUserBreakIndicator* indicator
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
      fuzzyValue,
      useOBB,
      indicator);
  }

  static ReplicadBooleanBatchResult CutImpl(
    const NCollection_List<TopoDS_Shape>& arguments,
    const NCollection_List<TopoDS_Shape>& tools,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    ReplicadUserBreakIndicator* indicator
  ) {
    if (ListSize(arguments) == 0 || ListSize(tools) == 0) {
      return Failure("Cut requires at least one argument and one tool");
    }

    ReplicadBooleanBatchResult result;
    {
      BRepAlgoAPI_Cut algorithm;
      result = Run(
        algorithm,
        arguments,
        tools,
        nonDestructive,
        glue,
        simplify,
        angularTolerance,
        fuzzyValue,
        useOBB,
        indicator);
      if (indicator) ReplicadCallProbeHook("algorithm-destroying");
    }
    if (indicator) ReplicadCallProbeHook("algorithm-destroyed");
    return result;
  }

  static ReplicadBooleanBatchResult CommonImpl(
    const NCollection_List<TopoDS_Shape>& shapes,
    bool nonDestructive,
    int glue,
    bool simplify,
    double angularTolerance,
    double fuzzyValue,
    bool useOBB,
    ReplicadUserBreakIndicator* indicator
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
        fuzzyValue,
        useOBB,
        indicator);
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
    double fuzzyValue,
    bool useOBB,
    ReplicadUserBreakIndicator* indicator
  ) {
    algorithm.SetArguments(arguments);
    algorithm.SetTools(tools);
    algorithm.SetRunParallel(ReplicadConfigureThreadPool() > 1);
    algorithm.SetNonDestructive(nonDestructive);
    algorithm.SetToFillHistory(false);
    algorithm.SetUseOBB(useOBB);
    algorithm.SetGlue(GlueFromInt(glue));
    if (fuzzyValue > 0.0) algorithm.SetFuzzyValue(fuzzyValue);

    if (indicator) {
      algorithm.Build(indicator->Start());
    } else {
      Message_ProgressRange progress;
      algorithm.Build(progress);
    }
    if (indicator) ReplicadCallProbeHook("build-returned");
    bool isUserBreak = indicator && indicator->WasBroken();
    // `SimplifyResult` takes no progress range and never polls, so a break
    // requested after the Boolean's last poll would wait for it to finish.
    // Ask once more before starting it; a stop here reports exactly like a
    // stop inside the Boolean. Without an indicator nothing changes.
    if (simplify && indicator && !isUserBreak && !algorithm.HasErrors()) {
      isUserBreak = indicator->UserBreak();
    }
    if (simplify && !algorithm.HasErrors() && !isUserBreak) {
      algorithm.SimplifyResult(true, true, angularTolerance);
    }

    const bool hasErrors = algorithm.HasErrors() || isUserBreak;
    const bool hasWarnings = algorithm.HasWarnings();
    std::string errors = DumpErrors(algorithm);
    if (isUserBreak && errors.empty()) errors = "ReplicadUserBreak";
    const std::string warnings = DumpWarnings(algorithm);
    const TopoDS_Shape shape = hasErrors ? TopoDS_Shape() : algorithm.Shape();
    const bool isDone = !hasErrors && !shape.IsNull();

    ReplicadBooleanBatchResult result(
      shape,
      isDone,
      hasErrors || shape.IsNull(),
      hasWarnings,
      !hasErrors && shape.IsNull() ? "Boolean operation produced a null shape" : errors,
      warnings);
    result.isUserBreak_ = isUserBreak;
    if (indicator) ReplicadCallProbeHook("run-returning");
    return result;
  }
};

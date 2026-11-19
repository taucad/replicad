// Surface coordinates (UVs) and tangent frames for Tau's textured and
// anisotropic materials, in the face extractors' vertex order.
//
// `ReplicadSurfaceCoordinates::Extract(shape, normalsPtr, normalsSize, prototype)`
// is a line-for-line port of Tau's JavaScript loop
// (`packages/plugins/replicad/src/utils/surface-coordinates.ts`), so the two
// produce the same doubles bit for bit:
//   - faces in `TopExp_Explorer` order, skipping faces without triangulation;
//   - each node's UV normalized by `BRepTools::UVBounds`;
//   - `BRepAdaptor_Surface(face, false).EvalD1` at the node's UV;
//   - for a prototype, `D1U` and `D1V` brought back through the inverse of the
//     shape's own location;
//   - `D1U` projected off the caller's normal, normalized with a port of V8's
//     `Math.hypot`, with the same pole fallback and handedness sign.
// The arithmetic is written in the same operation order as the JavaScript and
// compiled with floating-point contraction off, so no fused multiply-add can
// change a last bit.
//
// `normalsPtr` points at `normalsSize` doubles in WASM memory: the mesh's
// normals as JavaScript numbers (float32 normals promoted exactly; prototype
// normals are already doubles). An index past `normalsSize` reads NaN, as
// reading past a JavaScript array does. `AllocateNormals(size)` returns a
// buffer for them (the module exports no malloc): write the doubles at
// `getPtr()`, pass `getPtr()` and `getSize()` to `Extract`, then `delete()` it.
//
// The result owns two malloc'd double arrays: texCoords (u, v per node) and
// tangents (x, y, z, w per node). Copy them out of `oc.wasmMemory.buffer` and
// `delete()` it. `getStatus()` is 1 when a triangulated face has no UV nodes
// (the JavaScript loop throws there); both arrays are then empty.

#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Surface.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>
#include <vector>

namespace {

// V8's `Math.hypot` (src/builtins/math.tq, `MathHypot`) for three arguments:
// Infinity wins over NaN, NaN over a finite result, all-zero is +0; otherwise
// every magnitude is divided by the largest and squared into a Kahan sum, and
// the result is sqrt(sum) * max. Verified against Node's Math.hypot on 2e7
// random triples, signed zeros, NaN and infinities.
double ReplicadV8Hypot3(double a, double b, double c) {
#pragma clang fp contract(off)
  const double values[3] = {a, b, c};
  double magnitudes[3] = {0, 0, 0};
  bool oneIsNaN = false;
  double max = 0;
  for (int i = 0; i < 3; i++) {
    const double value = values[i];
    if (std::isnan(value)) {
      oneIsNaN = true;
    } else {
      const double magnitude = std::fabs(value);
      magnitudes[i] = magnitude;
      if (magnitude > max) max = magnitude;
    }
  }
  if (max == std::numeric_limits<double>::infinity()) return max;
  if (oneIsNaN) return std::numeric_limits<double>::quiet_NaN();
  if (max == 0) return 0;
  double sum = 0;
  double compensation = 0;
  for (int i = 0; i < 3; i++) {
    const double n = magnitudes[i] / max;
    const double summand = n * n - compensation;
    const double preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return std::sqrt(sum) * max;
}

} // namespace

class ReplicadSurfaceNormals {
public:
  ReplicadSurfaceNormals() : ptr_(nullptr), size_(0) {}

  ~ReplicadSurfaceNormals() { std::free(ptr_); }

  // Embind returns by value through the copy constructor: transfer ownership.
  ReplicadSurfaceNormals(const ReplicadSurfaceNormals& other)
    : ptr_(other.ptr_), size_(other.size_) {
    auto& moved = const_cast<ReplicadSurfaceNormals&>(other);
    moved.ptr_ = nullptr;
    moved.size_ = 0;
  }

  int getPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(ptr_)); }
  int getSize() const { return size_; }

private:
  double* ptr_;
  int size_;

  friend class ReplicadSurfaceCoordinates;
};

class ReplicadSurfaceData {
public:
  ReplicadSurfaceData()
    : texCoordsPtr_(nullptr), tangentsPtr_(nullptr),
      texCoordsSize_(0), tangentsSize_(0), status_(0) {}

  ~ReplicadSurfaceData() {
    std::free(texCoordsPtr_);
    std::free(tangentsPtr_);
  }

  // Embind returns by value through the copy constructor: transfer ownership.
  ReplicadSurfaceData(const ReplicadSurfaceData& other)
    : texCoordsPtr_(other.texCoordsPtr_), tangentsPtr_(other.tangentsPtr_),
      texCoordsSize_(other.texCoordsSize_), tangentsSize_(other.tangentsSize_),
      status_(other.status_) {
    auto& moved = const_cast<ReplicadSurfaceData&>(other);
    moved.texCoordsPtr_ = nullptr;
    moved.tangentsPtr_ = nullptr;
    moved.texCoordsSize_ = 0;
    moved.tangentsSize_ = 0;
  }

  int getTexCoordsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(texCoordsPtr_)); }
  int getTexCoordsSize() const { return texCoordsSize_; }
  int getTangentsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(tangentsPtr_)); }
  int getTangentsSize() const { return tangentsSize_; }
  // 0: complete; 1: a triangulated face has no UV nodes (no arrays).
  int getStatus() const { return status_; }

private:
  double* texCoordsPtr_;
  double* tangentsPtr_;
  int texCoordsSize_;
  int tangentsSize_;
  int status_;

  friend class ReplicadSurfaceCoordinates;
};

class ReplicadSurfaceCoordinates {
public:
  static ReplicadSurfaceNormals AllocateNormals(int size) {
    ReplicadSurfaceNormals normals;
    normals.size_ = size > 0 ? size : 0;
    normals.ptr_ = static_cast<double*>(std::calloc(normals.size_ > 0 ? normals.size_ : 1, sizeof(double)));
    if (!normals.ptr_) throw std::bad_alloc();
    return normals;
  }

  static ReplicadSurfaceData Extract(
    const TopoDS_Shape& shape,
    int normalsPtr,
    int normalsSize,
    bool prototype
  ) {
#pragma clang fp contract(off)
    const double* normals = reinterpret_cast<const double*>(static_cast<uintptr_t>(normalsPtr));
    const double nan = std::numeric_limits<double>::quiet_NaN();
    auto normal = [&](int index) -> double {
      return index >= 0 && index < normalsSize ? normals[index] : nan;
    };

    std::vector<double> coordinates;
    std::vector<double> tangents;
    gp_Trsf inverseLocation = shape.Location().Transformation();
    inverseLocation.Invert();

    ReplicadSurfaceData result;
    for (TopExp_Explorer explorer(shape, TopAbs_FACE); explorer.More(); explorer.Next()) {
      const TopoDS_Face& face = TopoDS::Face(explorer.Current());
      TopLoc_Location location;
      const Handle(Poly_Triangulation)& triangulation = BRep_Tool::Triangulation(face, location);
      if (triangulation.IsNull()) continue;
      if (!triangulation->HasUVNodes()) {
        result.status_ = 1;
        return result;
      }
      const BRepAdaptor_Surface surface(face, false);
      double uMin = 0, uMax = 0, vMin = 0, vMax = 0;
      BRepTools::UVBounds(face, uMin, uMax, vMin, vMax);
      const int nodeCount = triangulation->NbNodes();
      const double width = uMax - uMin;
      const double height = vMax - vMin;
      for (int index = 1; index <= nodeCount; index++) {
        const gp_Pnt2d point = triangulation->UVNode(index);
        const int vertex = static_cast<int>(coordinates.size() / 2);
        coordinates.push_back(width > 0 ? (point.X() - uMin) / width : 0);
        coordinates.push_back(height > 0 ? (point.Y() - vMin) / height : 0);
        Geom_Surface::ResD1 derivatives = surface.EvalD1(point.X(), point.Y());
        if (prototype) {
          derivatives.D1U.Transform(inverseLocation);
          derivatives.D1V.Transform(inverseLocation);
        }
        const double nx = normal(vertex * 3);
        const double ny = normal(vertex * 3 + 1);
        const double nz = normal(vertex * 3 + 2);
        double tx = derivatives.D1U.X();
        double ty = derivatives.D1U.Y();
        double tz = derivatives.D1U.Z();
        const double projection = tx * nx + ty * ny + tz * nz;
        tx -= projection * nx;
        ty -= projection * ny;
        tz -= projection * nz;
        double length = ReplicadV8Hypot3(tx, ty, tz);
        if (length == 0) {
          // The U direction is undefined at a parametrization pole. Choose a finite perpendicular frame.
          if (std::fabs(nx) < 0.9) {
            tx = 0;
            ty = nz;
            tz = -ny;
          } else {
            tx = -nz;
            ty = 0;
            tz = nx;
          }
          length = ReplicadV8Hypot3(tx, ty, tz);
        }
        tx /= length;
        ty /= length;
        tz /= length;
        const double handedness =
          (ny * tz - nz * ty) * derivatives.D1V.X() +
          (nz * tx - nx * tz) * derivatives.D1V.Y() +
          (nx * ty - ny * tx) * derivatives.D1V.Z();
        tangents.push_back(tx);
        tangents.push_back(ty);
        tangents.push_back(tz);
        tangents.push_back(handedness < 0 ? -1 : 1);
      }
    }

    result.texCoordsSize_ = static_cast<int>(coordinates.size());
    result.tangentsSize_ = static_cast<int>(tangents.size());
    result.texCoordsPtr_ = static_cast<double*>(std::malloc((coordinates.empty() ? 1 : coordinates.size()) * sizeof(double)));
    result.tangentsPtr_ = static_cast<double*>(std::malloc((tangents.empty() ? 1 : tangents.size()) * sizeof(double)));
    if (!result.texCoordsPtr_ || !result.tangentsPtr_) throw std::bad_alloc();
    std::memcpy(result.texCoordsPtr_, coordinates.data(), coordinates.size() * sizeof(double));
    std::memcpy(result.tangentsPtr_, tangents.data(), tangents.size() * sizeof(double));
    return result;
  }
};

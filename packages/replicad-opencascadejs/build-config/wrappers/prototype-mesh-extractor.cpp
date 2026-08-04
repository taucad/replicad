// Prototype-local adapters for Tau's transparent tessellation instancing.
// Only the top-level location is stripped. Face and edge algorithms remain
// owned by the regular extractors so both paths share selection, hashing,
// coordinates, winding, and tolerance behavior. Prototype coordinates remain
// doubles until occurrence transforms are applied, matching the regular path's
// transform-before-float-rounding order.

#include <cstdlib>
#include <vector>

namespace {

TopoDS_Shape ReplicadPrototypeShape(const TopoDS_Shape& shape) {
  TopoDS_Shape prototype = shape;
  prototype.Location(TopLoc_Location(), false);
  return prototype;
}

} // namespace

class ReplicadPrototypeMeshData {
public:
  ReplicadPrototypeMeshData()
    : verticesPtr_(nullptr), normalsPtr_(nullptr),
      trianglesPtr_(nullptr), faceGroupsPtr_(nullptr),
      verticesSize_(0), normalsSize_(0),
      trianglesSize_(0), faceGroupsSize_(0) {}

  ~ReplicadPrototypeMeshData() {
    std::free(verticesPtr_);
    std::free(normalsPtr_);
    std::free(trianglesPtr_);
    std::free(faceGroupsPtr_);
  }

  ReplicadPrototypeMeshData(const ReplicadPrototypeMeshData& other)
    : verticesPtr_(other.verticesPtr_), normalsPtr_(other.normalsPtr_),
      trianglesPtr_(other.trianglesPtr_), faceGroupsPtr_(other.faceGroupsPtr_),
      verticesSize_(other.verticesSize_), normalsSize_(other.normalsSize_),
      trianglesSize_(other.trianglesSize_), faceGroupsSize_(other.faceGroupsSize_) {
    auto& moved = const_cast<ReplicadPrototypeMeshData&>(other);
    moved.verticesPtr_ = nullptr;
    moved.normalsPtr_ = nullptr;
    moved.trianglesPtr_ = nullptr;
    moved.faceGroupsPtr_ = nullptr;
  }

  int getVerticesPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(verticesPtr_)); }
  int getNormalsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(normalsPtr_)); }
  int getTrianglesPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(trianglesPtr_)); }
  int getFaceGroupsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(faceGroupsPtr_)); }
  int getVerticesSize() const { return verticesSize_; }
  int getNormalsSize() const { return normalsSize_; }
  int getTrianglesSize() const { return trianglesSize_; }
  int getFaceGroupsSize() const { return faceGroupsSize_; }

private:
  using Coordinate = double;

  double* verticesPtr_;
  double* normalsPtr_;
  uint32_t* trianglesPtr_;
  int32_t* faceGroupsPtr_;
  int verticesSize_;
  int normalsSize_;
  int trianglesSize_;
  int faceGroupsSize_;

  template <typename Result>
  friend Result ReplicadExtractFaceMesh(const TopoDS_Shape&, bool);
};

class ReplicadPrototypeEdgeMeshData {
public:
  ReplicadPrototypeEdgeMeshData()
    : linesPtr_(nullptr), edgeGroupsPtr_(nullptr),
      linesSize_(0), edgeGroupsSize_(0) {}

  ~ReplicadPrototypeEdgeMeshData() {
    std::free(linesPtr_);
    std::free(edgeGroupsPtr_);
  }

  ReplicadPrototypeEdgeMeshData(const ReplicadPrototypeEdgeMeshData& other)
    : linesPtr_(other.linesPtr_), edgeGroupsPtr_(other.edgeGroupsPtr_),
      linesSize_(other.linesSize_), edgeGroupsSize_(other.edgeGroupsSize_) {
    auto& moved = const_cast<ReplicadPrototypeEdgeMeshData&>(other);
    moved.linesPtr_ = nullptr;
    moved.edgeGroupsPtr_ = nullptr;
  }

  int getLinesPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(linesPtr_)); }
  int getLinesSize() const { return linesSize_; }
  int getEdgeGroupsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(edgeGroupsPtr_)); }
  int getEdgeGroupsSize() const { return edgeGroupsSize_; }

private:
  using Coordinate = double;

  double* linesPtr_;
  int32_t* edgeGroupsPtr_;
  int linesSize_;
  int edgeGroupsSize_;

  template <typename Result>
  friend Result ReplicadExtractEdgeMesh(const TopoDS_Shape&, double, double);
};

class ReplicadPrototypeIdData {
public:
  ReplicadPrototypeIdData() : idsPtr_(nullptr), idsSize_(0) {}

  ~ReplicadPrototypeIdData() {
    std::free(idsPtr_);
  }

  ReplicadPrototypeIdData(const ReplicadPrototypeIdData& other)
    : idsPtr_(other.idsPtr_), idsSize_(other.idsSize_) {
    auto& moved = const_cast<ReplicadPrototypeIdData&>(other);
    moved.idsPtr_ = nullptr;
  }

  int getIdsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(idsPtr_)); }
  int getIdsSize() const { return idsSize_; }

private:
  int32_t* idsPtr_;
  int idsSize_;

  friend class ReplicadPrototypeMeshExtractor;
};

class ReplicadPrototypeMeshExtractor {
public:
  static ReplicadPrototypeMeshData ExtractFaces(
    const TopoDS_Shape& shape,
    double tolerance,
    double angularTolerance,
    bool skipNormals
  ) {
    const TopoDS_Shape prototype = ReplicadPrototypeShape(shape);
    ReplicadMeshExtractor::mesh(prototype, tolerance, angularTolerance);
    return ReplicadExtractFaceMesh<ReplicadPrototypeMeshData>(prototype, skipNormals);
  }

  static ReplicadPrototypeEdgeMeshData ExtractEdges(
    const TopoDS_Shape& shape,
    double tolerance,
    double angularTolerance
  ) {
    const TopoDS_Shape prototype = ReplicadPrototypeShape(shape);
    return ReplicadExtractEdgeMesh<ReplicadPrototypeEdgeMeshData>(
      prototype,
      tolerance,
      angularTolerance);
  }

  static ReplicadPrototypeIdData ExtractFaceIds(const TopoDS_Shape& shape) {
    return PackIds(ReplicadCollectFaceIds(shape));
  }

  static ReplicadPrototypeIdData ExtractEdgeIds(
    const TopoDS_Shape& shape,
    double tolerance,
    double angularTolerance
  ) {
    return PackIds(ReplicadCollectEdgeIds(shape, tolerance, angularTolerance));
  }

private:
  static ReplicadPrototypeIdData PackIds(const std::vector<int32_t>& ids) {
    ReplicadPrototypeIdData result;
    result.idsSize_ = static_cast<int>(ids.size());
    if (result.idsSize_ == 0) return result;

    result.idsPtr_ = static_cast<int32_t*>(
      std::malloc(result.idsSize_ * sizeof(int32_t)));
    if (!result.idsPtr_) throw std::bad_alloc();
    for (int index = 0; index < result.idsSize_; index++) {
      result.idsPtr_[index] = ids[static_cast<std::size_t>(index)];
    }
    return result;
  }
};

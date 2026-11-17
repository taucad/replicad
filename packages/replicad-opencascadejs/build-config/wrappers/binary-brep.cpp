// Binary BRep (BinTools) through memory, with the triangulation optional.
//
// The bound `BinTools.Write(shape, path, progress)` always writes the cached
// triangulation; its six-argument form needs the unbound
// `BinTools_FormatVersion`. `ReplicadBinaryBrep.Write` takes the two flags
// directly and always writes `BinTools_FormatVersion_CURRENT`, so
// `Write(shape, true, false)` produces the same bytes as the file form, and
// `Write(shape, false, false)` writes the geometry and topology alone without
// touching (or needing to clean) the shape's display mesh.
//
// Bytes cross the boundary in a malloc'd buffer owned by `ReplicadBinaryBrepData`:
// `Write` returns one (copy `getSize()` bytes from `oc.wasmMemory.buffer` at
// `getPtr()`, then `delete()` it); to read, `Allocate(size)` one, copy the
// bytes in at `getPtr()`, pass it to `Read` and `delete()` it. (The generated
// bindings accept only JavaScript strings for std::string parameters, which
// would corrupt binary data.)

#include <BinTools.hxx>
#include <BinTools_FormatVersion.hxx>
#include <Message_ProgressRange.hxx>
#include <TopoDS_Shape.hxx>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>

class ReplicadBinaryBrepData {
public:
  ReplicadBinaryBrepData() : ptr_(nullptr), size_(0) {}

  ~ReplicadBinaryBrepData() { std::free(ptr_); }

  // Embind returns by value through the copy constructor: transfer ownership.
  ReplicadBinaryBrepData(const ReplicadBinaryBrepData& other)
    : ptr_(other.ptr_), size_(other.size_) {
    auto& moved = const_cast<ReplicadBinaryBrepData&>(other);
    moved.ptr_ = nullptr;
    moved.size_ = 0;
  }

  int getPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(ptr_)); }
  int getSize() const { return size_; }

private:
  uint8_t* ptr_;
  int size_;

  friend class ReplicadBinaryBrep;
};

class ReplicadBinaryBrep {
public:
  static ReplicadBinaryBrepData Write(
    const TopoDS_Shape& shape,
    bool withTriangles,
    bool withNormals
  ) {
    const std::string bytes = Serialize(shape, withTriangles, withNormals);
    ReplicadBinaryBrepData data;
    data.size_ = static_cast<int>(bytes.size());
    data.ptr_ = static_cast<uint8_t*>(std::malloc(bytes.empty() ? 1 : bytes.size()));
    if (!data.ptr_) throw std::bad_alloc();
    std::memcpy(data.ptr_, bytes.data(), bytes.size());
    return data;
  }

  static ReplicadBinaryBrepData Allocate(int size) {
    ReplicadBinaryBrepData data;
    data.size_ = size > 0 ? size : 0;
    data.ptr_ = static_cast<uint8_t*>(std::calloc(data.size_ > 0 ? data.size_ : 1, 1));
    if (!data.ptr_) throw std::bad_alloc();
    return data;
  }

  static TopoDS_Shape Read(const ReplicadBinaryBrepData& data) {
    if (!data.ptr_ || data.size_ <= 0) return TopoDS_Shape();
    std::istringstream stream(
      std::string(reinterpret_cast<const char*>(data.ptr_), data.size_),
      std::ios::binary);
    TopoDS_Shape shape;
    BinTools::Read(shape, stream, Message_ProgressRange());
    return shape;
  }

  // 64-bit FNV-1a of the shape's binary BRep without triangulation, as 16
  // lowercase hex digits. It depends on geometry, topology, orientation and
  // location only, so meshing or cleaning a shape never changes it. Equal
  // hashes mean equal serialized B-rep; it is not a geometric equivalence.
  // A shape read back from BinTools can differ from its source in the sign of
  // a zero direction component, so compare hashes of shapes from the same
  // origin (live with live, restored with restored).
  static std::string IdentityHash(const TopoDS_Shape& shape) {
    const std::string bytes = Serialize(shape, false, false);
    uint64_t hash = 14695981039346656037ULL;
    for (const char value : bytes) {
      hash ^= static_cast<uint8_t>(value);
      hash *= 1099511628211ULL;
    }
    char text[17];
    std::snprintf(text, sizeof(text), "%016llx", static_cast<unsigned long long>(hash));
    return std::string(text);
  }

private:
  static std::string Serialize(
    const TopoDS_Shape& shape,
    bool withTriangles,
    bool withNormals
  ) {
    std::ostringstream stream(std::ios::binary);
    BinTools::Write(
      shape,
      stream,
      withTriangles,
      withNormals,
      BinTools_FormatVersion_CURRENT,
      Message_ProgressRange());
    return stream.str();
  }
};

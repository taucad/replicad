// Whole-shape prototype and occurrence identity helpers for Tau's transparent
// tessellation instancing and STEP/XCAF product reuse.
//
// OCCT represents a placed shape as a shared TopoDS_TShape definition plus
// local TopLoc_Location and TopAbs_Orientation metadata. The existing
// Bounded Replicad face/edge hashes include non-empty locations, so they are
// render-range labels rather than prototype identity. This wrapper exposes:
//   - runtime-local partner identity based on TShape*
//   - deterministic prototype hash over top-level-location-stripped BRep data

#include <array>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>

namespace {

TopoDS_Shape ReplicadLocationStrippedShape(const TopoDS_Shape& shape) {
  TopoDS_Shape prototype = shape;
  prototype.Location(TopLoc_Location(), false);
  return prototype;
}

std::string ReplicadOrientationName(TopAbs_Orientation orientation) {
  switch (orientation) {
    case TopAbs_FORWARD:
      return "forward";
    case TopAbs_REVERSED:
      return "reversed";
    case TopAbs_INTERNAL:
      return "internal";
    case TopAbs_EXTERNAL:
      return "external";
  }

  return "unknown";
}

std::string ReplicadSerializePrototype(const TopoDS_Shape& shape) {
  TopoDS_Shape prototype = ReplicadLocationStrippedShape(shape);
  std::ostringstream oss(std::ios::binary);
  oss << std::setprecision(17);
  BRepTools::Write(prototype, oss);
  return oss.str();
}

uint32_t ReplicadRotateRight(uint32_t value, uint32_t bits) {
  return (value >> bits) | (value << (32u - bits));
}

std::string ReplicadSha256Hex(const std::string& input) {
  static constexpr std::array<uint32_t, 64> k = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
  };

  std::string data = input;
  const uint64_t bitLength = static_cast<uint64_t>(data.size()) * 8u;
  data.push_back(static_cast<char>(0x80));
  while ((data.size() % 64u) != 56u) {
    data.push_back(static_cast<char>(0x00));
  }
  for (int shift = 56; shift >= 0; shift -= 8) {
    data.push_back(static_cast<char>((bitLength >> shift) & 0xffu));
  }

  std::array<uint32_t, 8> h = {
    0x6a09e667u,
    0xbb67ae85u,
    0x3c6ef372u,
    0xa54ff53au,
    0x510e527fu,
    0x9b05688cu,
    0x1f83d9abu,
    0x5be0cd19u,
  };

  for (std::size_t chunk = 0; chunk < data.size(); chunk += 64) {
    std::array<uint32_t, 64> w{};
    for (int i = 0; i < 16; i++) {
      const std::size_t base = chunk + static_cast<std::size_t>(i) * 4u;
      w[static_cast<std::size_t>(i)] =
        (static_cast<uint32_t>(static_cast<unsigned char>(data[base])) << 24u)
        | (static_cast<uint32_t>(static_cast<unsigned char>(data[base + 1u])) << 16u)
        | (static_cast<uint32_t>(static_cast<unsigned char>(data[base + 2u])) << 8u)
        | static_cast<uint32_t>(static_cast<unsigned char>(data[base + 3u]));
    }

    for (int i = 16; i < 64; i++) {
      const uint32_t s0 = ReplicadRotateRight(w[static_cast<std::size_t>(i - 15)], 7)
        ^ ReplicadRotateRight(w[static_cast<std::size_t>(i - 15)], 18)
        ^ (w[static_cast<std::size_t>(i - 15)] >> 3u);
      const uint32_t s1 = ReplicadRotateRight(w[static_cast<std::size_t>(i - 2)], 17)
        ^ ReplicadRotateRight(w[static_cast<std::size_t>(i - 2)], 19)
        ^ (w[static_cast<std::size_t>(i - 2)] >> 10u);
      w[static_cast<std::size_t>(i)] =
        w[static_cast<std::size_t>(i - 16)] + s0 + w[static_cast<std::size_t>(i - 7)] + s1;
    }

    uint32_t a = h[0];
    uint32_t b = h[1];
    uint32_t c = h[2];
    uint32_t d = h[3];
    uint32_t e = h[4];
    uint32_t f = h[5];
    uint32_t g = h[6];
    uint32_t hh = h[7];

    for (int i = 0; i < 64; i++) {
      const uint32_t s1 = ReplicadRotateRight(e, 6) ^ ReplicadRotateRight(e, 11) ^ ReplicadRotateRight(e, 25);
      const uint32_t ch = (e & f) ^ ((~e) & g);
      const uint32_t temp1 = hh + s1 + ch + k[static_cast<std::size_t>(i)] + w[static_cast<std::size_t>(i)];
      const uint32_t s0 = ReplicadRotateRight(a, 2) ^ ReplicadRotateRight(a, 13) ^ ReplicadRotateRight(a, 22);
      const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      const uint32_t temp2 = s0 + maj;

      hh = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }

    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }

  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (uint32_t word : h) {
    oss << std::setw(8) << word;
  }
  return oss.str();
}

} // namespace

class ReplicadShapeIdentityInfo {
public:
  ReplicadShapeIdentityInfo()
    : prototypeHash_(""),
      partnerKey_(""),
      orientation_("unknown"),
      determinant_(0.0),
      canPrototypeMesh_(false),
      matrix_{0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0} {}

  ReplicadShapeIdentityInfo(
    std::string prototypeHash,
    std::string partnerKey,
    std::string orientation,
    double determinant,
    bool canPrototypeMesh,
    const std::array<double, 16>& matrix
  )
    : prototypeHash_(std::move(prototypeHash)),
      partnerKey_(std::move(partnerKey)),
      orientation_(std::move(orientation)),
      determinant_(determinant),
      canPrototypeMesh_(canPrototypeMesh),
      matrix_(matrix) {}

  std::string PrototypeHash() const { return prototypeHash_; }
  std::string PartnerKey() const { return partnerKey_; }
  std::string Orientation() const { return orientation_; }
  double Determinant() const { return determinant_; }
  bool CanPrototypeMesh() const { return canPrototypeMesh_; }
  int MatrixSize() const { return 16; }
  double MatrixValue(int index) const {
    if (index < 0 || index >= 16) {
      return 0.0;
    }
    return matrix_[static_cast<std::size_t>(index)];
  }

private:
  std::string prototypeHash_;
  std::string partnerKey_;
  std::string orientation_;
  double determinant_;
  bool canPrototypeMesh_;
  std::array<double, 16> matrix_;
};

class ReplicadShapeIdentity {
public:
  static ReplicadShapeIdentityInfo Inspect(const TopoDS_Shape& shape) {
    if (shape.IsNull() || shape.TShape().get() == nullptr) {
      return ReplicadShapeIdentityInfo();
    }

    const TopLoc_Location& location = shape.Location();
    const gp_Trsf& trsf = location.Transformation();
    const gp_Mat& vector = trsf.VectorialPart();

    std::array<double, 16> matrix = {
      trsf.Value(1, 1), trsf.Value(1, 2), trsf.Value(1, 3), trsf.Value(1, 4),
      trsf.Value(2, 1), trsf.Value(2, 2), trsf.Value(2, 3), trsf.Value(2, 4),
      trsf.Value(3, 1), trsf.Value(3, 2), trsf.Value(3, 3), trsf.Value(3, 4),
      0.0, 0.0, 0.0, 1.0,
    };

    std::ostringstream partner;
    partner << std::hex << reinterpret_cast<std::uintptr_t>(shape.TShape().get());

    return ReplicadShapeIdentityInfo(
      ReplicadSha256Hex(ReplicadSerializePrototype(shape)),
      partner.str(),
      ReplicadOrientationName(shape.Orientation()),
      vector.Determinant(),
      true,
      matrix);
  }

  static bool IsPartner(const TopoDS_Shape& left, const TopoDS_Shape& right) {
    return left.IsPartner(right);
  }

  static std::string PrototypeHash(const TopoDS_Shape& shape) {
    return ReplicadSha256Hex(ReplicadSerializePrototype(shape));
  }
};

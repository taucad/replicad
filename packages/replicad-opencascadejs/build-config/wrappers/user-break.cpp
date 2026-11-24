// Cooperative user break for long native operations.
//
// `ReplicadUserBreak` is a plain description of where an abort comes from,
// built once by JavaScript and passed to the `...WithOptions` entry points of
// `ReplicadBooleanBatch` and `ReplicadMeshExtractor`. A disabled description
// (no word, no hook) makes those entry points run exactly like the original
// ones: no progress indicator is attached at all.
//
// Two sources can request the break, and either one is enough:
//   word : a 32-bit integer in this module's linear memory. The operation
//          breaks once the integer differs from `expectedValue`. Another
//          thread can only write it when the memory is shared (multi variant);
//          `ReplicadAbortWord` allocates a suitable integer.
//   hook : `Module.replicadUserBreak`, a JavaScript function returning a truthy
//          value to break. It is called on the main runtime thread only, so it
//          works in both variants and can read any SharedArrayBuffer the host
//          already owns. Pool threads observe its answer through the sticky
//          flag below. It must not throw: a JavaScript exception would unwind
//          through OCCT without running its destructors.
//
// OCCT polls `UserBreak()` from its progress scopes, possibly from several
// pool threads at once, so the indicator only uses atomics and never locks.

#include <Message_ProgressIndicator.hxx>
#include <Message_ProgressRange.hxx>
#include <Message_ProgressScope.hxx>
#include <Standard_Handle.hxx>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <stdexcept>
#include <string>
// The bindings generator parses this file without Emscripten's system headers;
// the fallbacks below only exist for that parse.
#if __has_include(<emscripten/val.h>)
#include <emscripten/val.h>
inline bool ReplicadCallUserBreakHook() {
  const emscripten::val hook =
    emscripten::val::module_property("replicadUserBreak");
  if (hook.typeOf().as<std::string>() != "function") return false;
  return hook().as<bool>();
}
// Measurement probe only (never merged): report progress scope names to JS.
inline void ReplicadCallProgressShowHook(const std::string& chain, double position) {
  const emscripten::val hook =
    emscripten::val::module_property("replicadProgressShow");
  if (hook.typeOf().as<std::string>() != "function") return;
  hook(chain, position);
}
#else
inline bool ReplicadCallUserBreakHook() { return false; }
inline void ReplicadCallProgressShowHook(const std::string&, double) {}
#endif
#if defined(__EMSCRIPTEN_PTHREADS__) && __has_include(<emscripten/threading.h>)
#include <emscripten/threading.h>
#define REPLICAD_HAS_THREADING_H 1
#endif

class ReplicadUserBreak {
public:
  ReplicadUserBreak()
    : wordAddress_(0), expectedValue_(0), useHook_(false) {}

  ReplicadUserBreak(int wordAddress, int expectedValue, bool useHook)
    : wordAddress_(wordAddress), expectedValue_(expectedValue),
      useHook_(useHook) {}

  int WordAddress() const { return wordAddress_; }
  int ExpectedValue() const { return expectedValue_; }
  bool UsesHook() const { return useHook_; }
  bool IsEnabled() const { return wordAddress_ != 0 || useHook_; }

private:
  int wordAddress_;
  int expectedValue_;
  bool useHook_;
};

// One aligned 32-bit integer owned by C++, for hosts that have no allocator
// of their own in this module's memory. Write it from JavaScript with
// `Atomics.store(new Int32Array(oc.wasmMemory.buffer), address / 4, value)`.
class ReplicadAbortWord {
public:
  ReplicadAbortWord() : word_(static_cast<int32_t*>(std::calloc(1, sizeof(int32_t)))) {
    if (!word_) throw std::bad_alloc();
  }

  ~ReplicadAbortWord() { std::free(word_); }

  // Embind returns by value through the copy constructor; transfer ownership
  // the same way `ReplicadMeshData` does so the word is freed exactly once.
  ReplicadAbortWord(const ReplicadAbortWord& other) : word_(other.word_) {
    const_cast<ReplicadAbortWord&>(other).word_ = nullptr;
  }

  int Address() const { return static_cast<int>(reinterpret_cast<uintptr_t>(word_)); }
  int Load() const { return word_ ? __atomic_load_n(word_, __ATOMIC_SEQ_CST) : 0; }
  void Store(int value) {
    if (word_) __atomic_store_n(word_, static_cast<int32_t>(value), __ATOMIC_SEQ_CST);
  }

private:
  int32_t* word_;
};

// Not bound: created by the `...WithOptions` entry points for one call.
class ReplicadUserBreakIndicator : public Message_ProgressIndicator {
public:
  explicit ReplicadUserBreakIndicator(const ReplicadUserBreak& source)
    : word_(reinterpret_cast<const int32_t*>(
        static_cast<uintptr_t>(static_cast<uint32_t>(source.WordAddress())))),
      expected_(source.ExpectedValue()), useHook_(source.UsesHook()),
      broken_(false) {}

  bool UserBreak() override {
    if (broken_.load(std::memory_order_relaxed)) return true;
    bool requested = word_ != nullptr &&
      __atomic_load_n(word_, __ATOMIC_SEQ_CST) != expected_;
    if (!requested && useHook_ && IsMainRuntimeThread()) {
      requested = ReplicadCallUserBreakHook();
    }
    if (requested) broken_.store(true, std::memory_order_relaxed);
    return requested;
  }

  bool WasBroken() const { return broken_.load(std::memory_order_relaxed); }

protected:
  void Show(const Message_ProgressScope& scope, const bool) override {
    if (!IsMainRuntimeThread()) return;
    std::string chain;
    for (const Message_ProgressScope* current = &scope; current != nullptr;
         current = current->Parent()) {
      const char* name = current->Name();
      chain = std::string(name ? name : "-") + (chain.empty() ? "" : "/") + chain;
    }
    if (chain == lastChain_) return;
    lastChain_ = chain;
    ReplicadCallProgressShowHook(chain, GetPosition());
  }

private:
  static bool IsMainRuntimeThread() {
#if defined(REPLICAD_HAS_THREADING_H)
    return emscripten_is_main_runtime_thread() != 0;
#else
    return true;
#endif
  }

  const int32_t* word_;
  const int32_t expected_;
  const bool useHook_;
  std::atomic<bool> broken_;
  std::string lastChain_;
};

inline Handle(ReplicadUserBreakIndicator) ReplicadMakeUserBreakIndicator(
  const ReplicadUserBreak& source
) {
  if (!source.IsEnabled()) return Handle(ReplicadUserBreakIndicator)();
  return new ReplicadUserBreakIndicator(source);
}

// Thrown by the mesh entry points when a break stops meshing. The type name is
// what `getExceptionMessage` reports, so hosts can tell it from OCCT failures.
class ReplicadUserBreakError : public std::runtime_error {
public:
  ReplicadUserBreakError() : std::runtime_error("ReplicadUserBreak") {}
};

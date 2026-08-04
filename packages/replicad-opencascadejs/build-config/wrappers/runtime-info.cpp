#include <OSD_ThreadPool.hxx>

class ReplicadRuntimeInfo {
public:
  static bool IsMultiThreaded() {
#if defined(__EMSCRIPTEN_PTHREADS__)
    return true;
#else
    return false;
#endif
  }

  static int ThreadCount() {
#if defined(__EMSCRIPTEN_PTHREADS__)
    const Handle(OSD_ThreadPool)& pool = OSD_ThreadPool::DefaultPool(-1);
    return pool->NbThreads();
#else
    return 1;
#endif
  }

  static int ConfigureThreadPool() {
    return ReplicadConfigureThreadPool();
  }
};

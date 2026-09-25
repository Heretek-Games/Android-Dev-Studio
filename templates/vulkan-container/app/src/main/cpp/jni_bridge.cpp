// Heretek Tier 2 — JNI bridge between MainActivity.kt and the native core.
// Android-only; host builds skip this file entirely.

#ifdef __ANDROID__

#include <android/log.h>
#include <android/native_window_jni.h>
#include <jni.h>

#include <string>

#include "scene_loader.h"
#include "vulkan_renderer.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "HeretekTier2", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "HeretekTier2", __VA_ARGS__)

namespace {
heretek::NativeScene gScene;
heretek::VulkanRenderer gRenderer;
bool gSceneReady = false;
}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeInit(JNIEnv* env, jobject /*this*/,
                                                           jstring scenePath, jstring shaderDir) {
  const char* path = env->GetStringUTFChars(scenePath, nullptr);
  std::string error;
  gSceneReady = heretek::loadSceneFile(path, gScene, error);
  env->ReleaseStringUTFChars(scenePath, path);

  const char* dir = env->GetStringUTFChars(shaderDir, nullptr);
  const bool rendererReady = gRenderer.initialize(dir);
  env->ReleaseStringUTFChars(shaderDir, dir);

  if (gSceneReady) {
    gRenderer.uploadScene(gScene);
  } else {
    LOGE("Scene load failed: %s", error.c_str());
  }
  if (!rendererReady) {
    LOGE("Renderer init failed: %s", gRenderer.lastError().c_str());
  }
  return (gSceneReady && rendererReady) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeSurfaceCreated(JNIEnv* env, jobject /*this*/,
                                                                     jobject surface, jint width,
                                                                     jint height) {
  ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) return JNI_FALSE;
  const bool ok = gRenderer.createSurface(window, width, height);
  ANativeWindow_release(window);
  if (!ok) {
    LOGE("createSurface failed (%dx%d): %s", width, height, gRenderer.lastError().c_str());
  } else {
    // The GPU buffers only exist after createSurface; nativeInit runs before any
    // surface is available, so the scene upload happens here.
    if (gSceneReady) {
      gRenderer.uploadScene(gScene);
    }
    LOGI("Surface ready (%dx%d) — swapchain + pipelines created", width, height);
  }
  return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeSurfaceDestroyed(JNIEnv* /*env*/,
                                                                       jobject /*this*/) {
  gRenderer.destroySurface();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeDrawCalls(JNIEnv* /*env*/, jobject /*this*/) {
  return gSceneReady ? gRenderer.drawCallEstimate() : -1;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeInstanceCount(JNIEnv* /*env*/,
                                                                    jobject /*this*/) {
  return gSceneReady ? gRenderer.instanceCount() : -1;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeTerrainLeaves(JNIEnv* /*env*/,
                                                                    jobject /*this*/) {
  return gSceneReady ? gRenderer.terrainLeaves() : -1;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeTerrainVertices(JNIEnv* /*env*/,
                                                                      jobject /*this*/) {
  return gSceneReady ? gRenderer.terrainVertices() : -1;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeFrame(JNIEnv* /*env*/, jobject /*this*/) {
  static uint64_t frameCount = 0;
  gRenderer.renderFrame();
  if (frameCount == 0 || frameCount % 300 == 0) {
    LOGI("frame %llu presented", static_cast<unsigned long long>(frameCount));
  }
  frameCount++;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeCaptureFrame(JNIEnv* env, jobject /*this*/,
                                                                   jstring path) {
  const char* cpath = env->GetStringUTFChars(path, nullptr);
  const bool ok = gRenderer.captureNextFrame(cpath);
  env->ReleaseStringUTFChars(path, cpath);
  return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeShutdown(JNIEnv* /*env*/, jobject /*this*/) {
  gRenderer.shutdown();
  gSceneReady = false;
}

// Experiment 1 (delta-loop spike): batched per-frame instance sync.
// slots[i] selects the instance, xyz[3i..3i+2] its new position. Returns applied.
extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_tier2_MainActivity_nativeSyncInstances(JNIEnv* env, jobject /*this*/,
                                                                   jintArray slots,
                                                                   jfloatArray xyz) {
  if (!gSceneReady || slots == nullptr || xyz == nullptr) return 0;
  const jsize n = env->GetArrayLength(slots);
  if (n <= 0 || env->GetArrayLength(xyz) < n * 3) return 0;
  jint* slotPtr = static_cast<jint*>(env->GetPrimitiveArrayCritical(slots, nullptr));
  jfloat* xyzPtr = static_cast<jfloat*>(env->GetPrimitiveArrayCritical(xyz, nullptr));
  int applied = 0;
  if (slotPtr != nullptr && xyzPtr != nullptr) {
    applied = gRenderer.syncInstances(slotPtr, xyzPtr, n);
  }
  if (xyzPtr != nullptr) env->ReleasePrimitiveArrayCritical(xyz, xyzPtr, JNI_ABORT);
  if (slotPtr != nullptr) env->ReleasePrimitiveArrayCritical(slots, slotPtr, JNI_ABORT);
  return applied;
}

#endif  // __ANDROID__

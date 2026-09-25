// Heretek Tier 2 — JNI bridge between MainActivity.kt and the native core.
// Android-only; host builds skip this file entirely.

#ifdef __ANDROID__

#include <jni.h>

#include <string>

#include "scene_loader.h"
#include "vulkan_renderer.h"

namespace {
heretek::NativeScene gScene;
heretek::VulkanRenderer gRenderer;
bool gReady = false;
}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeInit(JNIEnv* env, jobject /*this*/,
                                                           jstring scenePath) {
  const char* path = env->GetStringUTFChars(scenePath, nullptr);
  std::string error;
  const bool loaded = heretek::loadSceneFile(path, gScene, error);
  env->ReleaseStringUTFChars(scenePath, path);
  if (!loaded) {
    return JNI_FALSE;
  }
  // Renderer init is best-effort: scene telemetry works even without a device.
  gRenderer.initialize();
  gRenderer.uploadScene(gScene);
  gReady = true;
  return JNI_TRUE;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeDrawCalls(JNIEnv* /*env*/, jobject /*this*/) {
  return gReady ? gRenderer.drawCallEstimate() : -1;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeInstanceCount(JNIEnv* /*env*/,
                                                                    jobject /*this*/) {
  return gReady ? gRenderer.instanceCount() : -1;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeFrame(JNIEnv* /*env*/, jobject /*this*/) {
  // Render loop entry point (swapchain + instanced draws land with the Tier 2
  // pipeline; the scene graph is parsed and counted today).
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeShutdown(JNIEnv* /*env*/, jobject /*this*/) {
  gRenderer.shutdown();
  gReady = false;
}

#endif  // __ANDROID__

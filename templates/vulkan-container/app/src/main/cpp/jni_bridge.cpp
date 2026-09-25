// Heretek Tier 2 — JNI bridge between MainActivity.kt and the native core.
// Android-only; host builds skip this file entirely.

#ifdef __ANDROID__

#include <android/native_window_jni.h>
#include <jni.h>

#include <string>

#include "scene_loader.h"
#include "vulkan_renderer.h"

namespace {
heretek::NativeScene gScene;
heretek::VulkanRenderer gRenderer;
bool gSceneReady = false;
}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeInit(JNIEnv* env, jobject /*this*/,
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
  }
  return (gSceneReady && rendererReady) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeSurfaceCreated(JNIEnv* env, jobject /*this*/,
                                                                     jobject surface, jint width,
                                                                     jint height) {
  ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) return JNI_FALSE;
  const bool ok = gRenderer.createSurface(window, width, height);
  ANativeWindow_release(window);
  return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeSurfaceDestroyed(JNIEnv* /*env*/,
                                                                       jobject /*this*/) {
  gRenderer.destroySurface();
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeDrawCalls(JNIEnv* /*env*/, jobject /*this*/) {
  return gSceneReady ? gRenderer.drawCallEstimate() : -1;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeInstanceCount(JNIEnv* /*env*/,
                                                                    jobject /*this*/) {
  return gSceneReady ? gRenderer.instanceCount() : -1;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeFrame(JNIEnv* /*env*/, jobject /*this*/) {
  gRenderer.renderFrame();
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretek_gamestudio_native_MainActivity_nativeShutdown(JNIEnv* /*env*/, jobject /*this*/) {
  gRenderer.shutdown();
  gSceneReady = false;
}

#endif  // __ANDROID__

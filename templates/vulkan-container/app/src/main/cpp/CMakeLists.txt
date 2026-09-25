# Heretek Tier 2 — native Vulkan container (NDK build)
#
# Builds libheretek_native.so from the scene loader, CPU culling reference
# implementation, Vulkan bootstrap, and JNI bridge. The platform-independent
# files (scene_loader.cpp, culling.cpp, tests/) also compile with any host
# C++17 toolchain for testing — see tests/native_scene_test.cpp.

cmake_minimum_required(VERSION 3.22.1)
project(heretek_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Android/NDK build: the shared library with the Vulkan bootstrap + JNI bridge.
if(ANDROID)
  add_library(heretek_native SHARED
    scene_loader.cpp
    culling.cpp
    vulkan_swapchain.cpp
    vulkan_renderer.cpp
    jni_bridge.cpp
  )

  target_compile_definitions(heretek_native PRIVATE HERETEK_ENABLE_VULKAN)

  find_library(log-lib log)
  target_link_libraries(heretek_native PRIVATE ${log-lib} vulkan android)
endif()

# Optional host test target (build with the host toolchain, not the NDK):
#   cmake -S . -B build-host -DHERETEK_BUILD_HOST_TESTS=ON && cmake --build build-host
option(HERETEK_BUILD_HOST_TESTS "Build the host-side native core tests" OFF)
if(HERETEK_BUILD_HOST_TESTS)
  add_executable(native_scene_test
    scene_loader.cpp
    culling.cpp
    tests/native_scene_test.cpp
  )
  target_include_directories(native_scene_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
endif()

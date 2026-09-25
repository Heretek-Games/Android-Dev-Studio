#include "vulkan_renderer.h"

#ifdef HERETEK_ENABLE_VULKAN

#include <cstring>
#include <vulkan/vulkan.h>

namespace heretek {

bool VulkanRenderer::createInstance() {
  VkApplicationInfo appInfo{};
  appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  appInfo.pApplicationName = "Heretek Tier 2";
  appInfo.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
  appInfo.pEngineName = "HeretekNative";
  appInfo.engineVersion = VK_MAKE_VERSION(1, 0, 0);
  appInfo.apiVersion = VK_API_VERSION_1_1;

  const char* extensions[] = {"VK_KHR_surface", "VK_KHR_android_surface"};

  VkInstanceCreateInfo createInfo{};
  createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  createInfo.pApplicationInfo = &appInfo;
  createInfo.enabledExtensionCount = 2;
  createInfo.ppEnabledExtensionNames = extensions;

  VkInstance instance = VK_NULL_HANDLE;
  const VkResult result = vkCreateInstance(&createInfo, nullptr, &instance);
  if (result != VK_SUCCESS) {
    lastError_ = "vkCreateInstance failed with code " + std::to_string(result);
    return false;
  }
  instance_ = instance;
  return true;
}

bool VulkanRenderer::pickPhysicalDevice() {
  auto instance = static_cast<VkInstance>(instance_);
  uint32_t deviceCount = 0;
  vkEnumeratePhysicalDevices(instance, &deviceCount, nullptr);
  if (deviceCount == 0) {
    lastError_ = "no Vulkan-capable physical devices";
    return false;
  }
  std::vector<VkPhysicalDevice> devices(deviceCount);
  vkEnumeratePhysicalDevices(instance, &deviceCount, devices.data());

  for (auto candidate : devices) {
    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, nullptr);
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, families.data());
    for (uint32_t i = 0; i < familyCount; i++) {
      if (families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
        physicalDevice_ = candidate;
        queueFamily_ = i;
        return true;
      }
    }
  }
  lastError_ = "no graphics queue family found";
  return false;
}

bool VulkanRenderer::createDevice() {
  const float priority = 1.0f;
  VkDeviceQueueCreateInfo queueInfo{};
  queueInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
  queueInfo.queueFamilyIndex = queueFamily_;
  queueInfo.queueCount = 1;
  queueInfo.pQueuePriorities = &priority;

  VkPhysicalDeviceFeatures features{};

  VkDeviceCreateInfo createInfo{};
  createInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
  createInfo.queueCreateInfoCount = 1;
  createInfo.pQueueCreateInfos = &queueInfo;
  createInfo.pEnabledFeatures = &features;

  VkDevice device = VK_NULL_HANDLE;
  const VkResult result =
      vkCreateDevice(static_cast<VkPhysicalDevice>(physicalDevice_), &createInfo, nullptr, &device);
  if (result != VK_SUCCESS) {
    lastError_ = "vkCreateDevice failed with code " + std::to_string(result);
    return false;
  }
  device_ = device;

  VkQueue queue = VK_NULL_HANDLE;
  vkGetDeviceQueue(device, queueFamily_, 0, &queue);
  queue_ = queue;
  return true;
}

bool VulkanRenderer::initialize() {
  if (device_ != nullptr) return true;
  if (!createInstance()) return false;
  if (!pickPhysicalDevice()) return false;
  return createDevice();
}

void VulkanRenderer::uploadScene(const NativeScene& scene) {
  // The full pipeline (instance buffers + compute culling dispatch) lands with
  // the Tier 2 render loop; record the draw/instance counts for telemetry now.
  drawCallEstimate_ = scene.drawCallEstimate();
  instanceCount_ = static_cast<int>(scene.instances.size());
}

void VulkanRenderer::shutdown() {
  if (device_ != nullptr) {
    vkDeviceWaitIdle(static_cast<VkDevice>(device_));
    vkDestroyDevice(static_cast<VkDevice>(device_), nullptr);
    device_ = nullptr;
    queue_ = nullptr;
  }
  if (instance_ != nullptr) {
    vkDestroyInstance(static_cast<VkInstance>(instance_), nullptr);
    instance_ = nullptr;
  }
  physicalDevice_ = nullptr;
}

}  // namespace heretek

#else  // !HERETEK_ENABLE_VULKAN — host builds get a no-op stub for tests

namespace heretek {

bool VulkanRenderer::initialize() {
  lastError_ = "built without HERETEK_ENABLE_VULKAN";
  return false;
}
void VulkanRenderer::uploadScene(const NativeScene& scene) {
  drawCallEstimate_ = scene.drawCallEstimate();
  instanceCount_ = static_cast<int>(scene.instances.size());
}
void VulkanRenderer::shutdown() {}

}  // namespace heretek

#endif

#include "vulkan_swapchain.h"

#ifdef HERETEK_ENABLE_VULKAN

#include <android/log.h>

#include <algorithm>

#define SW_LOGI(...) __android_log_print(ANDROID_LOG_INFO, "HeretekTier2", __VA_ARGS__)
#define SW_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "HeretekTier2", __VA_ARGS__)

namespace heretek {

namespace {

VkSurfaceFormatKHR chooseFormat(const std::vector<VkSurfaceFormatKHR>& formats) {
  for (const auto& format : formats) {
    if (format.format == VK_FORMAT_R8G8B8A8_UNORM || format.format == VK_FORMAT_B8G8R8A8_UNORM) {
      return format;
    }
  }
  return formats[0];
}

}  // namespace

bool VulkanSwapchain::create(VkInstance instance, VkPhysicalDevice physical, VkDevice device,
                             uint32_t queueFamily, ANativeWindow* window, int width, int height) {
  instance_ = instance;
  SW_LOGI("swapchain.create: instance=%p window=%p %dx%d", (void*)instance, (void*)window, width, height);

  // Resolve the extension entry points explicitly (Android loader requirement).
  const auto getInstanceProc =
      reinterpret_cast<PFN_vkGetInstanceProcAddr>(vkGetInstanceProcAddr);
  const auto getDeviceProc = reinterpret_cast<PFN_vkGetDeviceProcAddr>(
      getInstanceProc(instance, "vkGetDeviceProcAddr"));
  createAndroidSurface_ = reinterpret_cast<PFN_vkCreateAndroidSurfaceKHR>(
      getInstanceProc(instance, "vkCreateAndroidSurfaceKHR"));
  getSurfaceCaps_ = reinterpret_cast<PFN_vkGetPhysicalDeviceSurfaceCapabilitiesKHR>(
      getInstanceProc(instance, "vkGetPhysicalDeviceSurfaceCapabilitiesKHR"));
  getSurfaceFormats_ = reinterpret_cast<PFN_vkGetPhysicalDeviceSurfaceFormatsKHR>(
      getInstanceProc(instance, "vkGetPhysicalDeviceSurfaceFormatsKHR"));
  createSwapchain_ = reinterpret_cast<PFN_vkCreateSwapchainKHR>(
      getDeviceProc ? getDeviceProc(device, "vkCreateSwapchainKHR") : nullptr);
  getSwapchainImages_ = reinterpret_cast<PFN_vkGetSwapchainImagesKHR>(
      getDeviceProc ? getDeviceProc(device, "vkGetSwapchainImagesKHR") : nullptr);
  destroySwapchain_ = reinterpret_cast<PFN_vkDestroySwapchainKHR>(
      getDeviceProc ? getDeviceProc(device, "vkDestroySwapchainKHR") : nullptr);
  destroySurface_ = reinterpret_cast<PFN_vkDestroySurfaceKHR>(
      getInstanceProc(instance, "vkDestroySurfaceKHR"));
  if (createAndroidSurface_ == nullptr || getSurfaceCaps_ == nullptr ||
      getSurfaceFormats_ == nullptr || createSwapchain_ == nullptr ||
      getSwapchainImages_ == nullptr || destroySwapchain_ == nullptr ||
      destroySurface_ == nullptr) {
    SW_LOGE("swapchain extension entry points unavailable (VK_KHR_swapchain missing?)");
    lastError_ = "VK_KHR_swapchain entry points unavailable";
    return false;
  }

  // Android surface
  VkAndroidSurfaceCreateInfoKHR surfaceInfo{};
  surfaceInfo.sType = VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR;
  surfaceInfo.window = window;
  const VkResult surfaceResult = createAndroidSurface_(instance, &surfaceInfo, nullptr, &surface_);
  if (surfaceResult != VK_SUCCESS) {
    SW_LOGE("vkCreateAndroidSurfaceKHR failed: %d", static_cast<int>(surfaceResult));
    lastError_ = "vkCreateAndroidSurfaceKHR failed";
    return false;
  }
  SW_LOGI("android surface created: %p", (void*)surface_);

  // Capabilities + format selection
  VkSurfaceCapabilitiesKHR caps{};
  getSurfaceCaps_(physical, surface_, &caps);
  uint32_t formatCount = 0;
  getSurfaceFormats_(physical, surface_, &formatCount, nullptr);
  SW_LOGI("surface caps: extent=%ux%u minImages=%u formats=%u", caps.currentExtent.width,
          caps.currentExtent.height, caps.minImageCount, formatCount);
  std::vector<VkSurfaceFormatKHR> formats(formatCount);
  getSurfaceFormats_(physical, surface_, &formatCount, formats.data());
  format_ = chooseFormat(formats);
  SW_LOGI("chosen format: %d colorspace=%d", static_cast<int>(format_.format),
          static_cast<int>(format_.colorSpace));

  extent_ = caps.currentExtent;
  if (extent_.width == UINT32_MAX) {
    extent_.width = std::clamp(static_cast<uint32_t>(width), caps.minImageExtent.width, caps.maxImageExtent.width);
    extent_.height = std::clamp(static_cast<uint32_t>(height), caps.minImageExtent.height, caps.maxImageExtent.height);
  }

  uint32_t imageCount = caps.minImageCount + 1;
  if (caps.maxImageCount > 0) imageCount = std::min(imageCount, caps.maxImageCount);

  VkSwapchainCreateInfoKHR swapInfo{};
  swapInfo.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
  swapInfo.surface = surface_;
  swapInfo.minImageCount = imageCount;
  swapInfo.imageFormat = format_.format;
  swapInfo.imageColorSpace = format_.colorSpace;
  swapInfo.imageExtent = extent_;
  swapInfo.imageArrayLayers = 1;
  swapInfo.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
  if (caps.supportedUsageFlags & VK_IMAGE_USAGE_TRANSFER_SRC_BIT) {
    // Enables debug readback of rendered frames (see VulkanRenderer::captureNextFrame).
    swapInfo.imageUsage |= VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
  }
  swapInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
  swapInfo.preTransform = caps.currentTransform;
  swapInfo.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
  swapInfo.presentMode = VK_PRESENT_MODE_FIFO_KHR;
  swapInfo.clipped = VK_TRUE;
  const VkResult swapResult = createSwapchain_(device, &swapInfo, nullptr, &swapchain_);
  if (swapResult != VK_SUCCESS) {
    SW_LOGE("vkCreateSwapchainKHR failed: %d (images=%u %ux%u)", static_cast<int>(swapResult),
            imageCount, extent_.width, extent_.height);
    lastError_ = "vkCreateSwapchainKHR failed";
    return false;
  }
  SW_LOGI("swapchain created: %p", (void*)swapchain_);

  uint32_t actualCount = 0;
  getSwapchainImages_(device, swapchain_, &actualCount, nullptr);
  images_.resize(actualCount);
  getSwapchainImages_(device, swapchain_, &actualCount, images_.data());

  // Image views
  imageViews_.resize(images_.size());
  for (size_t i = 0; i < images_.size(); i++) {
    VkImageViewCreateInfo viewInfo{};
    viewInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    viewInfo.image = images_[i];
    viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    viewInfo.format = format_.format;
    viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    if (vkCreateImageView(device, &viewInfo, nullptr, &imageViews_[i]) != VK_SUCCESS) {
      lastError_ = "vkCreateImageView failed";
      return false;
    }
  }

  // Render pass: single color attachment, clear -> store for present
  VkAttachmentDescription color{};
  color.format = format_.format;
  color.samples = VK_SAMPLE_COUNT_1_BIT;
  color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

  VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};

  VkSubpassDescription subpass{};
  subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  subpass.colorAttachmentCount = 1;
  subpass.pColorAttachments = &colorRef;

  VkSubpassDependency dependency{};
  dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
  dependency.dstSubpass = 0;
  dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

  VkRenderPassCreateInfo passInfo{};
  passInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
  passInfo.attachmentCount = 1;
  passInfo.pAttachments = &color;
  passInfo.subpassCount = 1;
  passInfo.pSubpasses = &subpass;
  passInfo.dependencyCount = 1;
  passInfo.pDependencies = &dependency;
  if (vkCreateRenderPass(device, &passInfo, nullptr, &renderPass_) != VK_SUCCESS) {
    lastError_ = "vkCreateRenderPass failed";
    return false;
  }

  // Framebuffers
  framebuffers_.resize(imageViews_.size());
  for (size_t i = 0; i < imageViews_.size(); i++) {
    VkImageView attachments[] = {imageViews_[i]};
    VkFramebufferCreateInfo fbInfo{};
    fbInfo.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
    fbInfo.renderPass = renderPass_;
    fbInfo.attachmentCount = 1;
    fbInfo.pAttachments = attachments;
    fbInfo.width = extent_.width;
    fbInfo.height = extent_.height;
    fbInfo.layers = 1;
    if (vkCreateFramebuffer(device, &fbInfo, nullptr, &framebuffers_[i]) != VK_SUCCESS) {
      lastError_ = "vkCreateFramebuffer failed";
      return false;
    }
  }
  return true;
}

void VulkanSwapchain::destroy(VkDevice device) {
  for (auto framebuffer : framebuffers_) vkDestroyFramebuffer(device, framebuffer, nullptr);
  framebuffers_.clear();
  for (auto view : imageViews_) vkDestroyImageView(device, view, nullptr);
  imageViews_.clear();
  images_.clear();
  if (renderPass_ != VK_NULL_HANDLE) vkDestroyRenderPass(device, renderPass_, nullptr);
  renderPass_ = VK_NULL_HANDLE;
  if (swapchain_ != VK_NULL_HANDLE && destroySwapchain_ != nullptr) {
    destroySwapchain_(device, swapchain_, nullptr);
  }
  swapchain_ = VK_NULL_HANDLE;
  if (surface_ != VK_NULL_HANDLE && instance_ != VK_NULL_HANDLE && destroySurface_ != nullptr) {
    destroySurface_(instance_, surface_, nullptr);
  }
  surface_ = VK_NULL_HANDLE;
  instance_ = VK_NULL_HANDLE;
}

}  // namespace heretek

#endif  // HERETEK_ENABLE_VULKAN

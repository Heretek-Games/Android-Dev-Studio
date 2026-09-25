#include "vulkan_swapchain.h"

#ifdef HERETEK_ENABLE_VULKAN

#include <algorithm>

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
  // Android surface
  VkAndroidSurfaceCreateInfoKHR surfaceInfo{};
  surfaceInfo.sType = VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR;
  surfaceInfo.window = window;
  if (vkCreateAndroidSurfaceKHR(instance, &surfaceInfo, nullptr, &surface_) != VK_SUCCESS) {
    lastError_ = "vkCreateAndroidSurfaceKHR failed";
    return false;
  }

  // Capabilities + format selection
  VkSurfaceCapabilitiesKHR caps{};
  vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical, surface_, &caps);
  uint32_t formatCount = 0;
  vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface_, &formatCount, nullptr);
  std::vector<VkSurfaceFormatKHR> formats(formatCount);
  vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface_, &formatCount, formats.data());
  format_ = chooseFormat(formats);

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
  swapInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
  swapInfo.preTransform = caps.currentTransform;
  swapInfo.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
  swapInfo.presentMode = VK_PRESENT_MODE_FIFO_KHR;
  swapInfo.clipped = VK_TRUE;
  if (vkCreateSwapchainKHR(device, &swapInfo, nullptr, &swapchain_) != VK_SUCCESS) {
    lastError_ = "vkCreateSwapchainKHR failed";
    return false;
  }

  uint32_t actualCount = 0;
  vkGetSwapchainImagesKHR(device, swapchain_, &actualCount, nullptr);
  images_.resize(actualCount);
  vkGetSwapchainImagesKHR(device, swapchain_, &actualCount, images_.data());

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
  if (swapchain_ != VK_NULL_HANDLE) vkDestroySwapchainKHR(device, swapchain_, nullptr);
  swapchain_ = VK_NULL_HANDLE;
  if (surface_ != VK_NULL_HANDLE && instance_ != VK_NULL_HANDLE) {
    vkDestroySurfaceKHR(instance_, surface_, nullptr);
  }
  surface_ = VK_NULL_HANDLE;
  instance_ = VK_NULL_HANDLE;
}

}  // namespace heretek

#endif  // HERETEK_ENABLE_VULKAN

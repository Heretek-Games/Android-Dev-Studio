#include "vulkan_renderer.h"

#ifdef HERETEK_ENABLE_VULKAN

#include <android/log.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>

#include "culling.h"

#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "HeretekTier2", __VA_ARGS__)

namespace heretek {

namespace {

constexpr uint32_t kWorkgroupSize = 64;
constexpr uint32_t kIndicesPerCube = 36;
constexpr uint32_t kMaxFramesInFlight = 3;

struct CullPushConstants {
  float planes[6][4];
  uint32_t instanceCount;
  uint32_t indicesPerInstance;
  uint32_t firstIndex;
  uint32_t firstVertex;
};

struct GraphicsPushConstants {
  float viewProj[16];
};

/** Unit cube (24 vertices: position + normal), scaled per-instance in the shader. */
void writeCubeVertices(float* out /* 24 * 6 floats */) {
  const float p[6][4][3] = {
      {{-0.5f, -0.5f, -0.5f}, {-0.5f, -0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, -0.5f}},
      {{0.5f, -0.5f, -0.5f}, {0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, 0.5f}, {0.5f, -0.5f, 0.5f}},
      {{-0.5f, -0.5f, -0.5f}, {0.5f, -0.5f, -0.5f}, {0.5f, -0.5f, 0.5f}, {-0.5f, -0.5f, 0.5f}},
      {{-0.5f, 0.5f, -0.5f}, {-0.5f, 0.5f, 0.5f}, {0.5f, 0.5f, 0.5f}, {0.5f, 0.5f, -0.5f}},
      {{-0.5f, -0.5f, -0.5f}, {-0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, -0.5f}, {0.5f, -0.5f, -0.5f}},
      {{-0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, 0.5f}, {0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f}}};
  const float n[6][3] = {{-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}};
  int v = 0;
  for (int face = 0; face < 6; face++) {
    for (int corner = 0; corner < 4; corner++) {
      out[v++] = p[face][corner][0];
      out[v++] = p[face][corner][1];
      out[v++] = p[face][corner][2];
      out[v++] = n[face][0];
      out[v++] = n[face][1];
      out[v++] = n[face][2];
    }
  }
}

void writeCubeIndices(uint16_t* out /* 36 */) {
  int i = 0;
  for (uint16_t face = 0; face < 6; face++) {
    const uint16_t base = face * 4;
    out[i++] = base + 0;
    out[i++] = base + 1;
    out[i++] = base + 2;
    out[i++] = base + 0;
    out[i++] = base + 2;
    out[i++] = base + 3;
  }
}

}  // namespace

bool VulkanRenderer::createInstance() {
  VkApplicationInfo appInfo{};
  appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  appInfo.pApplicationName = "Heretek Tier 2";
  appInfo.pEngineName = "HeretekNative";
  appInfo.apiVersion = VK_API_VERSION_1_1;

  const char* extensions[] = {"VK_KHR_surface", "VK_KHR_android_surface"};

  VkInstanceCreateInfo createInfo{};
  createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  createInfo.pApplicationInfo = &appInfo;
  createInfo.enabledExtensionCount = 2;
  createInfo.ppEnabledExtensionNames = extensions;

  if (vkCreateInstance(&createInfo, nullptr, &instance_) != VK_SUCCESS) {
    lastError_ = "vkCreateInstance failed";
    return false;
  }
  return true;
}

bool VulkanRenderer::pickPhysicalDevice() {
  uint32_t deviceCount = 0;
  vkEnumeratePhysicalDevices(instance_, &deviceCount, nullptr);
  if (deviceCount == 0) {
    lastError_ = "no Vulkan-capable physical devices";
    return false;
  }
  std::vector<VkPhysicalDevice> devices(deviceCount);
  vkEnumeratePhysicalDevices(instance_, &deviceCount, devices.data());

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

  if (vkCreateDevice(physicalDevice_, &createInfo, nullptr, &device_) != VK_SUCCESS) {
    lastError_ = "vkCreateDevice failed";
    return false;
  }
  vkGetDeviceQueue(device_, queueFamily_, 0, &queue_);
  return true;
}

bool VulkanRenderer::createCommandPool() {
  VkCommandPoolCreateInfo poolInfo{};
  poolInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
  poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  poolInfo.queueFamilyIndex = queueFamily_;
  if (vkCreateCommandPool(device_, &poolInfo, nullptr, &commandPool_) != VK_SUCCESS) {
    lastError_ = "vkCreateCommandPool failed";
    return false;
  }
  return true;
}

bool VulkanRenderer::createBuffer(VkDeviceSize size, VkBufferUsageFlags usage, VkBuffer* buffer,
                                  VkDeviceMemory* memory, void** mapped) {
  VkBufferCreateInfo bufferInfo{};
  bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bufferInfo.size = size;
  bufferInfo.usage = usage;
  bufferInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  if (vkCreateBuffer(device_, &bufferInfo, nullptr, buffer) != VK_SUCCESS) {
    lastError_ = "vkCreateBuffer failed";
    return false;
  }

  VkMemoryRequirements requirements{};
  vkGetBufferMemoryRequirements(device_, *buffer, &requirements);

  VkPhysicalDeviceMemoryProperties memoryProps{};
  vkGetPhysicalDeviceMemoryProperties(physicalDevice_, &memoryProps);

  const VkMemoryPropertyFlags flags =
      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
  uint32_t typeIndex = UINT32_MAX;
  for (uint32_t i = 0; i < memoryProps.memoryTypeCount; i++) {
    if ((requirements.memoryTypeBits & (1u << i)) &&
        (memoryProps.memoryTypes[i].propertyFlags & flags) == flags) {
      typeIndex = i;
      break;
    }
  }
  if (typeIndex == UINT32_MAX) {
    lastError_ = "no host-visible memory type for buffer";
    return false;
  }

  VkMemoryAllocateInfo allocInfo{};
  allocInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  allocInfo.allocationSize = requirements.size;
  allocInfo.memoryTypeIndex = typeIndex;
  if (vkAllocateMemory(device_, &allocInfo, nullptr, memory) != VK_SUCCESS) {
    lastError_ = "vkAllocateMemory failed";
    return false;
  }
  vkBindBufferMemory(device_, *buffer, *memory, 0);
  if (mapped != nullptr) {
    vkMapMemory(device_, *memory, 0, size, 0, mapped);
  }
  return true;
}

bool VulkanRenderer::createBuffers() {
  const VkDeviceSize instanceBytes = sizeof(float) * 8 * 65536;  // 65k instances
  const VkDeviceSize visibleBytes = sizeof(uint32_t) * 65536;
  const VkDeviceSize indirectBytes = sizeof(IndirectDrawCommand);

  if (!createBuffer(instanceBytes,
                    VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                    &instanceBuffer_, &instanceMemory_, &instanceMapped_)) {
    return false;
  }
  if (!createBuffer(visibleBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, &visibleBuffer_,
                    &visibleMemory_, nullptr)) {
    return false;
  }
  if (!createBuffer(indirectBytes,
                    VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT,
                    &indirectBuffer_, &indirectMemory_, &indirectMapped_)) {
    return false;
  }
  if (!createBuffer(sizeof(float) * 24 * 6, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, &vertexBuffer_,
                    &vertexMemory_, nullptr)) {
    return false;
  }
  if (!createBuffer(sizeof(uint16_t) * kIndicesPerCube, VK_BUFFER_USAGE_INDEX_BUFFER_BIT,
                    &indexBuffer_, &indexMemory_, nullptr)) {
    return false;
  }

  // Static cube geometry
  void* vertexMapped = nullptr;
  vkMapMemory(device_, vertexMemory_, 0, sizeof(float) * 24 * 6, 0, &vertexMapped);
  writeCubeVertices(static_cast<float*>(vertexMapped));
  vkUnmapMemory(device_, vertexMemory_);

  void* indexMapped = nullptr;
  vkMapMemory(device_, indexMemory_, 0, sizeof(uint16_t) * kIndicesPerCube, 0, &indexMapped);
  writeCubeIndices(static_cast<uint16_t*>(indexMapped));
  vkUnmapMemory(device_, indexMemory_);
  return true;
}

bool VulkanRenderer::createDescriptors() {
  VkDescriptorSetLayoutBinding computeBindings[3]{};
  for (int i = 0; i < 3; i++) {
    computeBindings[i].binding = static_cast<uint32_t>(i);
    computeBindings[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    computeBindings[i].descriptorCount = 1;
    computeBindings[i].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
  }
  VkDescriptorSetLayoutCreateInfo computeLayoutInfo{};
  computeLayoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
  computeLayoutInfo.bindingCount = 3;
  computeLayoutInfo.pBindings = computeBindings;
  if (vkCreateDescriptorSetLayout(device_, &computeLayoutInfo, nullptr, &computeSetLayout_) !=
      VK_SUCCESS) {
    lastError_ = "compute descriptor set layout failed";
    return false;
  }

  VkDescriptorSetLayoutBinding graphicsBindings[2]{};
  for (int i = 0; i < 2; i++) {
    graphicsBindings[i].binding = static_cast<uint32_t>(i);
    graphicsBindings[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    graphicsBindings[i].descriptorCount = 1;
    graphicsBindings[i].stageFlags = VK_SHADER_STAGE_VERTEX_BIT;
  }
  VkDescriptorSetLayoutCreateInfo graphicsLayoutInfo{};
  graphicsLayoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
  graphicsLayoutInfo.bindingCount = 2;
  graphicsLayoutInfo.pBindings = graphicsBindings;
  if (vkCreateDescriptorSetLayout(device_, &graphicsLayoutInfo, nullptr, &graphicsSetLayout_) !=
      VK_SUCCESS) {
    lastError_ = "graphics descriptor set layout failed";
    return false;
  }

  VkDescriptorPoolSize poolSizes[1]{};
  poolSizes[0].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  poolSizes[0].descriptorCount = 5;
  VkDescriptorPoolCreateInfo poolInfo{};
  poolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
  poolInfo.maxSets = 2;
  poolInfo.poolSizeCount = 1;
  poolInfo.pPoolSizes = poolSizes;
  if (vkCreateDescriptorPool(device_, &poolInfo, nullptr, &descriptorPool_) != VK_SUCCESS) {
    lastError_ = "descriptor pool creation failed";
    return false;
  }

  VkDescriptorSetAllocateInfo computeAlloc{};
  computeAlloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
  computeAlloc.descriptorPool = descriptorPool_;
  computeAlloc.descriptorSetCount = 1;
  computeAlloc.pSetLayouts = &computeSetLayout_;
  vkAllocateDescriptorSets(device_, &computeAlloc, &computeSet_);

  VkDescriptorSetAllocateInfo graphicsAlloc{};
  graphicsAlloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
  graphicsAlloc.descriptorPool = descriptorPool_;
  graphicsAlloc.descriptorSetCount = 1;
  graphicsAlloc.pSetLayouts = &graphicsSetLayout_;
  vkAllocateDescriptorSets(device_, &graphicsAlloc, &graphicsSet_);

  VkDescriptorBufferInfo instanceInfo{instanceBuffer_, 0, VK_WHOLE_SIZE};
  VkDescriptorBufferInfo visibleInfo{visibleBuffer_, 0, VK_WHOLE_SIZE};
  VkDescriptorBufferInfo indirectInfo{indirectBuffer_, 0, VK_WHOLE_SIZE};

  VkWriteDescriptorSet computeWrites[3]{};
  const VkDescriptorBufferInfo* computeInfos[3] = {&instanceInfo, &visibleInfo, &indirectInfo};
  for (int i = 0; i < 3; i++) {
    computeWrites[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    computeWrites[i].dstSet = computeSet_;
    computeWrites[i].dstBinding = static_cast<uint32_t>(i);
    computeWrites[i].descriptorCount = 1;
    computeWrites[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    computeWrites[i].pBufferInfo = computeInfos[i];
  }
  vkUpdateDescriptorSets(device_, 3, computeWrites, 0, nullptr);

  VkWriteDescriptorSet graphicsWrites[2]{};
  const VkDescriptorBufferInfo* graphicsInfos[2] = {&instanceInfo, &visibleInfo};
  for (int i = 0; i < 2; i++) {
    graphicsWrites[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    graphicsWrites[i].dstSet = graphicsSet_;
    graphicsWrites[i].dstBinding = static_cast<uint32_t>(i);
    graphicsWrites[i].descriptorCount = 1;
    graphicsWrites[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    graphicsWrites[i].pBufferInfo = graphicsInfos[i];
  }
  vkUpdateDescriptorSets(device_, 2, graphicsWrites, 0, nullptr);
  return true;
}

VkShaderModule VulkanRenderer::loadShader(const std::string& path) {
  std::ifstream file(path, std::ios::binary | std::ios::ate);
  if (!file.is_open()) {
    lastError_ = "cannot open shader: " + path;
    return VK_NULL_HANDLE;
  }
  const size_t size = static_cast<size_t>(file.tellg());
  std::vector<char> data(size);
  file.seekg(0);
  file.read(data.data(), static_cast<std::streamsize>(size));

  VkShaderModuleCreateInfo moduleInfo{};
  moduleInfo.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
  moduleInfo.codeSize = data.size();
  moduleInfo.pCode = reinterpret_cast<const uint32_t*>(data.data());
  VkShaderModule module = VK_NULL_HANDLE;
  if (vkCreateShaderModule(device_, &moduleInfo, nullptr, &module) != VK_SUCCESS) {
    lastError_ = "vkCreateShaderModule failed for " + path;
  }
  return module;
}

bool VulkanRenderer::createPipelines() {
  // ---- Compute culling pipeline -------------------------------------------
  VkPushConstantRange cullRange{};
  cullRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
  cullRange.offset = 0;
  cullRange.size = sizeof(CullPushConstants);

  VkPipelineLayoutCreateInfo computeLayout{};
  computeLayout.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
  computeLayout.setLayoutCount = 1;
  computeLayout.pSetLayouts = &computeSetLayout_;
  computeLayout.pushConstantRangeCount = 1;
  computeLayout.pPushConstantRanges = &cullRange;
  if (vkCreatePipelineLayout(device_, &computeLayout, nullptr, &computePipelineLayout_) !=
      VK_SUCCESS) {
    lastError_ = "compute pipeline layout failed";
    return false;
  }

  VkShaderModule cullModule = loadShader(shaderDir_ + "/cull.comp.spv");
  if (cullModule == VK_NULL_HANDLE) return false;

  VkPipelineShaderStageCreateInfo cullStage{};
  cullStage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  cullStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  cullStage.module = cullModule;
  cullStage.pName = "main";

  VkComputePipelineCreateInfo cullInfo{};
  cullInfo.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
  cullInfo.stage = cullStage;
  cullInfo.layout = computePipelineLayout_;
  if (vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &cullInfo, nullptr, &cullPipeline_) !=
      VK_SUCCESS) {
    lastError_ = "vkCreateComputePipelines failed";
    return false;
  }
  vkDestroyShaderModule(device_, cullModule, nullptr);

  // ---- Instanced scene graphics pipeline ----------------------------------
  VkPushConstantRange graphicsRange{};
  graphicsRange.stageFlags = VK_SHADER_STAGE_VERTEX_BIT;
  graphicsRange.offset = 0;
  graphicsRange.size = sizeof(GraphicsPushConstants);

  VkPipelineLayoutCreateInfo graphicsLayout{};
  graphicsLayout.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
  graphicsLayout.setLayoutCount = 1;
  graphicsLayout.pSetLayouts = &graphicsSetLayout_;
  graphicsLayout.pushConstantRangeCount = 1;
  graphicsLayout.pPushConstantRanges = &graphicsRange;
  if (vkCreatePipelineLayout(device_, &graphicsLayout, nullptr, &graphicsPipelineLayout_) !=
      VK_SUCCESS) {
    lastError_ = "graphics pipeline layout failed";
    return false;
  }

  VkShaderModule vertexModule = loadShader(shaderDir_ + "/scene.vert.spv");
  VkShaderModule fragmentModule = loadShader(shaderDir_ + "/scene.frag.spv");
  if (vertexModule == VK_NULL_HANDLE || fragmentModule == VK_NULL_HANDLE) return false;

  VkPipelineShaderStageCreateInfo stages[2]{};
  stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
  stages[0].module = vertexModule;
  stages[0].pName = "main";
  stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
  stages[1].module = fragmentModule;
  stages[1].pName = "main";

  VkVertexInputBindingDescription binding{0, sizeof(float) * 6, VK_VERTEX_INPUT_RATE_VERTEX};
  VkVertexInputAttributeDescription attributes[2]{};
  attributes[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0};
  attributes[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, sizeof(float) * 3};

  VkPipelineVertexInputStateCreateInfo vertexInput{};
  vertexInput.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
  vertexInput.vertexBindingDescriptionCount = 1;
  vertexInput.pVertexBindingDescriptions = &binding;
  vertexInput.vertexAttributeDescriptionCount = 2;
  vertexInput.pVertexAttributeDescriptions = attributes;

  VkPipelineInputAssemblyStateCreateInfo inputAssembly{};
  inputAssembly.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
  inputAssembly.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

  VkPipelineViewportStateCreateInfo viewportState{};
  viewportState.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
  viewportState.viewportCount = 1;
  viewportState.scissorCount = 1;

  VkPipelineRasterizationStateCreateInfo raster{};
  raster.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
  raster.polygonMode = VK_POLYGON_MODE_FILL;
  raster.cullMode = VK_CULL_MODE_BACK_BIT;
  raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
  raster.lineWidth = 1.0f;

  VkPipelineMultisampleStateCreateInfo multisample{};
  multisample.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
  multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

  VkPipelineColorBlendAttachmentState blendAttachment{};
  blendAttachment.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                                   VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
  VkPipelineColorBlendStateCreateInfo colorBlend{};
  colorBlend.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
  colorBlend.attachmentCount = 1;
  colorBlend.pAttachments = &blendAttachment;

  VkDynamicState dynamicStates[2] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
  VkPipelineDynamicStateCreateInfo dynamic{};
  dynamic.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
  dynamic.dynamicStateCount = 2;
  dynamic.pDynamicStates = dynamicStates;

  VkGraphicsPipelineCreateInfo graphicsInfo{};
  graphicsInfo.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
  graphicsInfo.stageCount = 2;
  graphicsInfo.pStages = stages;
  graphicsInfo.pVertexInputState = &vertexInput;
  graphicsInfo.pInputAssemblyState = &inputAssembly;
  graphicsInfo.pViewportState = &viewportState;
  graphicsInfo.pRasterizationState = &raster;
  graphicsInfo.pMultisampleState = &multisample;
  graphicsInfo.pColorBlendState = &colorBlend;
  graphicsInfo.pDynamicState = &dynamic;
  graphicsInfo.layout = graphicsPipelineLayout_;
  graphicsInfo.renderPass = swapchain_.renderPass();
  graphicsInfo.subpass = 0;
  if (vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &graphicsInfo, nullptr, &scenePipeline_) !=
      VK_SUCCESS) {
    lastError_ = "vkCreateGraphicsPipelines failed";
    return false;
  }
  vkDestroyShaderModule(device_, vertexModule, nullptr);
  vkDestroyShaderModule(device_, fragmentModule, nullptr);
  return true;
}

bool VulkanRenderer::initialize(const std::string& shaderDir) {
  if (device_ != VK_NULL_HANDLE) return true;
  shaderDir_ = shaderDir;
  if (!createInstance()) return false;
  if (!pickPhysicalDevice()) return false;
  if (!createDevice()) return false;
  return createCommandPool();
}

bool VulkanRenderer::createSurface(ANativeWindow* window, int width, int height) {
  if (!isReady() || window == nullptr) {
    lastError_ = "renderer not initialized";
    return false;
  }
  if (!swapchain_.create(instance_, physicalDevice_, device_, queueFamily_, window, width, height)) {
    lastError_ = swapchain_.lastError();
    return false;
  }
  if (!createBuffers() || !createDescriptors() || !createPipelines()) return false;

  commandBuffers_.resize(swapchain_.imageCount());
  VkCommandBufferAllocateInfo allocInfo{};
  allocInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  allocInfo.commandPool = commandPool_;
  allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  allocInfo.commandBufferCount = static_cast<uint32_t>(commandBuffers_.size());
  if (vkAllocateCommandBuffers(device_, &allocInfo, commandBuffers_.data()) != VK_SUCCESS) {
    lastError_ = "vkAllocateCommandBuffers failed";
    return false;
  }

  inFlightFences_.resize(commandBuffers_.size());
  VkFenceCreateInfo fenceInfo{};
  fenceInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
  fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;
  for (auto& fence : inFlightFences_) {
    vkCreateFence(device_, &fenceInfo, nullptr, &fence);
  }

  VkSemaphoreCreateInfo semaphoreInfo{};
  semaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
  vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &imageAvailable_);
  vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &renderFinished_);
  return true;
}

void VulkanRenderer::uploadScene(const NativeScene& scene) {
  drawCallEstimate_ = scene.drawCallEstimate();
  instanceCount_ = 0;
  if (instanceMapped_ == nullptr) return;

  float* instances = static_cast<float*>(instanceMapped_);
  auto writeInstance = [&](float x, float y, float z, float radius, float r, float g, float b) {
    if (instanceCount_ >= 65536) return;
    float* slot = instances + static_cast<size_t>(instanceCount_) * 8;
    slot[0] = x;
    slot[1] = y;
    slot[2] = z;
    slot[3] = radius;
    slot[4] = r;
    slot[5] = g;
    slot[6] = b;
    slot[7] = 1.0f;
    instanceCount_++;
  };

  for (const auto& mesh : scene.meshes) {
    const float radius = 0.5f * std::max(mesh.sx, std::max(mesh.sy, mesh.sz));
    writeInstance(mesh.px, mesh.py, mesh.pz, radius, mesh.r, mesh.g, mesh.b);
  }
  for (const auto& inst : scene.instances) {
    writeInstance(inst.px, inst.py, inst.pz, 0.3f, 0.45f, 0.65f, 0.35f);
  }

  // One indirect command covers every instance (the compute pass rewrites the
  // instanceCount; the CPU-side reference planner is exercised in host tests).
  auto* commands = static_cast<IndirectDrawCommand*>(indirectMapped_);
  commands[0].indexCount = kIndicesPerCube;
  commands[0].instanceCount = 0;  // GPU atomicAdd fills this during culling
  commands[0].firstIndex = 0;
  commands[0].vertexOffset = 0;
  commands[0].firstInstance = 0;
  indirectCommandCount_ = 1;
}

void VulkanRenderer::recordFrame(VkCommandBuffer cmd, uint32_t imageIndex) {
  VkCommandBufferBeginInfo beginInfo{};
  beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
  vkBeginCommandBuffer(cmd, &beginInfo);

  // ---- Compute culling pass ----
  const Mat4 proj = perspective(1.0472f, 16.0f / 9.0f, 0.1f, 500.0f);
  const Mat4 view = lookAt({12.0f, 14.0f, 24.0f}, {0.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f});
  const Mat4 viewProj = multiply(proj, view);

  CullPushConstants cullConstants{};
  extractFrustumPlanes(viewProj, cullConstants.planes);
  cullConstants.instanceCount = instanceCount_;
  cullConstants.indicesPerInstance = kIndicesPerCube;
  cullConstants.firstIndex = 0;
  cullConstants.firstVertex = 0;

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, cullPipeline_);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, computePipelineLayout_, 0, 1,
                          &computeSet_, 0, nullptr);
  vkCmdPushConstants(cmd, computePipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                     sizeof(CullPushConstants), &cullConstants);
  const ComputeDispatchPlan plan = planComputeDispatch(static_cast<int>(instanceCount_),
                                                       kWorkgroupSize);
  if (plan.groupCountX > 0) {
    vkCmdDispatch(cmd, plan.groupCountX, 1, 1);
  }

  VkMemoryBarrier cullBarrier{};
  cullBarrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
  cullBarrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
  cullBarrier.dstAccessMask =
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_INDIRECT_COMMAND_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                       VK_PIPELINE_STAGE_VERTEX_SHADER_BIT |
                           VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
                       0, 1, &cullBarrier, 0, nullptr, 0, nullptr);

  // ---- Graphics pass ----
  VkClearValue clear{};
  clear.color = {{0.02f, 0.02f, 0.04f, 1.0f}};
  VkRenderPassBeginInfo passInfo{};
  passInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
  passInfo.renderPass = swapchain_.renderPass();
  passInfo.framebuffer = swapchain_.framebuffer(imageIndex);
  passInfo.renderArea = {{0, 0}, swapchain_.extent()};
  passInfo.clearValueCount = 1;
  passInfo.pClearValues = &clear;
  vkCmdBeginRenderPass(cmd, &passInfo, VK_SUBPASS_CONTENTS_INLINE);

  VkViewport viewport{0.0f, 0.0f, static_cast<float>(swapchain_.extent().width),
                      static_cast<float>(swapchain_.extent().height), 0.0f, 1.0f};
  VkRect2D scissor{{0, 0}, swapchain_.extent()};
  vkCmdSetViewport(cmd, 0, 1, &viewport);
  vkCmdSetScissor(cmd, 0, 1, &scissor);

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, scenePipeline_);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, graphicsPipelineLayout_, 0, 1,
                          &graphicsSet_, 0, nullptr);
  GraphicsPushConstants graphicsConstants{};
  std::memcpy(graphicsConstants.viewProj, viewProj.m, sizeof(float) * 16);
  vkCmdPushConstants(cmd, graphicsPipelineLayout_, VK_SHADER_STAGE_VERTEX_BIT, 0,
                     sizeof(GraphicsPushConstants), &graphicsConstants);

  VkDeviceSize offset = 0;
  vkCmdBindVertexBuffers(cmd, 0, 1, &vertexBuffer_, &offset);
  vkCmdBindIndexBuffer(cmd, indexBuffer_, 0, VK_INDEX_TYPE_UINT16);
  if (indirectCommandCount_ > 0) {
    vkCmdDrawIndexedIndirect(cmd, indirectBuffer_, 0, indirectCommandCount_,
                             sizeof(IndirectDrawCommand));
  }

  vkCmdEndRenderPass(cmd);
  vkEndCommandBuffer(cmd);
}

void VulkanRenderer::renderFrame() {
  if (swapchain_.handle() == VK_NULL_HANDLE || commandBuffers_.empty()) return;

  uint32_t imageIndex = 0;
  const VkResult acquire =
      vkAcquireNextImageKHR(device_, swapchain_.handle(), UINT64_MAX, imageAvailable_,
                            VK_NULL_HANDLE, &imageIndex);
  if (acquire != VK_SUCCESS) {
    lastError_ = "vkAcquireNextImageKHR failed (swapchain out of date)";
    return;
  }

  vkWaitForFences(device_, 1, &inFlightFences_[imageIndex], VK_TRUE, UINT64_MAX);
  vkResetFences(device_, 1, &inFlightFences_[imageIndex]);

  VkCommandBuffer cmd = commandBuffers_[imageIndex];
  vkResetCommandBuffer(cmd, 0);
  recordFrame(cmd, imageIndex);

  VkSubmitInfo submit{};
  submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
  VkSemaphore waitSemaphores[] = {imageAvailable_};
  VkPipelineStageFlags waitStages[] = {VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT};
  submit.waitSemaphoreCount = 1;
  submit.pWaitSemaphores = waitSemaphores;
  submit.pWaitDstStageMask = waitStages;
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &cmd;
  VkSemaphore signalSemaphores[] = {renderFinished_};
  submit.signalSemaphoreCount = 1;
  submit.pSignalSemaphores = signalSemaphores;

  if (vkQueueSubmit(queue_, 1, &submit, inFlightFences_[imageIndex]) != VK_SUCCESS) {
    lastError_ = "vkQueueSubmit failed";
    return;
  }

  VkPresentInfoKHR present{};
  present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
  present.waitSemaphoreCount = 1;
  present.pWaitSemaphores = signalSemaphores;
  present.swapchainCount = 1;
  VkSwapchainKHR swapchains[] = {swapchain_.handle()};
  present.pSwapchains = swapchains;
  present.pImageIndices = &imageIndex;
  vkQueuePresentKHR(queue_, &present);
}

void VulkanRenderer::destroySurface() {
  if (device_ == VK_NULL_HANDLE) return;
  vkDeviceWaitIdle(device_);

  for (auto fence : inFlightFences_) vkDestroyFence(device_, fence, nullptr);
  inFlightFences_.clear();
  if (imageAvailable_ != VK_NULL_HANDLE) vkDestroySemaphore(device_, imageAvailable_, nullptr);
  imageAvailable_ = VK_NULL_HANDLE;
  if (renderFinished_ != VK_NULL_HANDLE) vkDestroySemaphore(device_, renderFinished_, nullptr);
  renderFinished_ = VK_NULL_HANDLE;

  if (!commandBuffers_.empty()) {
    vkFreeCommandBuffers(device_, commandPool_, static_cast<uint32_t>(commandBuffers_.size()),
                         commandBuffers_.data());
    commandBuffers_.clear();
  }

  if (cullPipeline_ != VK_NULL_HANDLE) vkDestroyPipeline(device_, cullPipeline_, nullptr);
  cullPipeline_ = VK_NULL_HANDLE;
  if (scenePipeline_ != VK_NULL_HANDLE) vkDestroyPipeline(device_, scenePipeline_, nullptr);
  scenePipeline_ = VK_NULL_HANDLE;
  if (computePipelineLayout_ != VK_NULL_HANDLE) {
    vkDestroyPipelineLayout(device_, computePipelineLayout_, nullptr);
  }
  computePipelineLayout_ = VK_NULL_HANDLE;
  if (graphicsPipelineLayout_ != VK_NULL_HANDLE) {
    vkDestroyPipelineLayout(device_, graphicsPipelineLayout_, nullptr);
  }
  graphicsPipelineLayout_ = VK_NULL_HANDLE;
  if (descriptorPool_ != VK_NULL_HANDLE) vkDestroyDescriptorPool(device_, descriptorPool_, nullptr);
  descriptorPool_ = VK_NULL_HANDLE;
  if (computeSetLayout_ != VK_NULL_HANDLE) {
    vkDestroyDescriptorSetLayout(device_, computeSetLayout_, nullptr);
  }
  computeSetLayout_ = VK_NULL_HANDLE;
  if (graphicsSetLayout_ != VK_NULL_HANDLE) {
    vkDestroyDescriptorSetLayout(device_, graphicsSetLayout_, nullptr);
  }
  graphicsSetLayout_ = VK_NULL_HANDLE;

  VkBuffer buffers[] = {instanceBuffer_, visibleBuffer_, indirectBuffer_, vertexBuffer_, indexBuffer_};
  VkDeviceMemory memories[] = {instanceMemory_, visibleMemory_, indirectMemory_, vertexMemory_,
                               indexMemory_};
  for (int i = 0; i < 5; i++) {
    if (buffers[i] != VK_NULL_HANDLE) vkDestroyBuffer(device_, buffers[i], nullptr);
    if (memories[i] != VK_NULL_HANDLE) vkFreeMemory(device_, memories[i], nullptr);
  }
  instanceBuffer_ = visibleBuffer_ = indirectBuffer_ = vertexBuffer_ = indexBuffer_ = VK_NULL_HANDLE;
  instanceMemory_ = visibleMemory_ = indirectMemory_ = vertexMemory_ = indexMemory_ = VK_NULL_HANDLE;
  instanceMapped_ = nullptr;
  indirectMapped_ = nullptr;

  swapchain_.destroy(device_);
}

void VulkanRenderer::shutdown() {
  destroySurface();
  if (commandPool_ != VK_NULL_HANDLE) vkDestroyCommandPool(device_, commandPool_, nullptr);
  commandPool_ = VK_NULL_HANDLE;
  if (device_ != VK_NULL_HANDLE) vkDestroyDevice(device_, nullptr);
  device_ = VK_NULL_HANDLE;
  queue_ = VK_NULL_HANDLE;
  if (instance_ != VK_NULL_HANDLE) vkDestroyInstance(instance_, nullptr);
  instance_ = VK_NULL_HANDLE;
  physicalDevice_ = VK_NULL_HANDLE;
}

}  // namespace heretek

#else  // !HERETEK_ENABLE_VULKAN

#include <algorithm>

namespace heretek {

// (stub methods are inline in the header)

}  // namespace heretek

#endif  // HERETEK_ENABLE_VULKAN

#include "scene_loader.h"

#include <fstream>
#include <set>
#include <sstream>

namespace heretek {

int NativeScene::uniqueBatchCount() const {
  std::set<std::string> batches;
  for (const auto& inst : instances) batches.insert(inst.batch);
  return static_cast<int>(batches.size());
}

int NativeScene::drawCallEstimate() const {
  return static_cast<int>(meshes.size()) + uniqueBatchCount() +
         static_cast<int>(terrainLod.size());
}

namespace {

PhysicsType parsePhysics(const std::string& token) {
  if (token == "fixed") return PhysicsType::Fixed;
  if (token == "dynamic") return PhysicsType::Dynamic;
  return PhysicsType::None;
}

}  // namespace

bool parseSceneText(const std::string& text, NativeScene& out, std::string& error) {
  out = NativeScene{};
  std::istringstream stream(text);
  std::string line;
  int lineNumber = 0;

  while (std::getline(stream, line)) {
    lineNumber++;
    // Trim leading whitespace
    size_t start = line.find_first_not_of(" \t\r");
    if (start == std::string::npos) continue;
    std::string trimmed = line.substr(start);
    if (trimmed[0] == '#') continue;

    std::istringstream tokens(trimmed);
    std::string kind;
    tokens >> kind;

    if (kind == "scene") {
      tokens >> out.name;
      if (out.name.empty()) {
        error = "line " + std::to_string(lineNumber) + ": scene record missing name";
        return false;
      }
    } else if (kind == "mesh") {
      MeshRecord mesh;
      std::string physics;
      if (!(tokens >> mesh.name >> mesh.px >> mesh.py >> mesh.pz >> mesh.sx >> mesh.sy >> mesh.sz >> mesh.r >>
            mesh.g >> mesh.b >> physics)) {
        error = "line " + std::to_string(lineNumber) + ": malformed mesh record";
        return false;
      }
      mesh.physics = parsePhysics(physics);
      // Track C.3 trailing material (backward-compatible: v1 lines stop here).
      std::string shading;
      if (tokens >> mesh.metallic >> mesh.roughness >> shading) {
        mesh.unlit = (shading == "unlit");
      }
      out.meshes.push_back(std::move(mesh));
    } else if (kind == "instance") {
      InstanceRecord inst;
      if (!(tokens >> inst.batch >> inst.px >> inst.py >> inst.pz >> inst.rotY)) {
        error = "line " + std::to_string(lineNumber) + ": malformed instance record";
        return false;
      }
      inst.foliage = (inst.batch == kFoliageBatch);
      float metallic = 0.0f, roughness = 0.9f;
      std::string shading;
      if (tokens >> inst.r >> inst.g >> inst.b >> metallic >> roughness >> shading) {
        inst.metallic = metallic;
        inst.roughness = roughness;
        inst.unlit = (shading == "unlit");
        inst.legacy = false;
      }
      out.instances.push_back(std::move(inst));
    } else if (kind == "light") {
      LightRecord light;
      if (!(tokens >> light.name >> light.px >> light.py >> light.pz >> light.r >> light.g >> light.b >>
            light.intensity >> light.type)) {
        error = "line " + std::to_string(lineNumber) + ": malformed light record";
        return false;
      }
      out.lights.push_back(std::move(light));
    } else if (kind == "terrain_lod") {
      TerrainLodRecord leaf;
      if (!(tokens >> leaf.id >> leaf.depth >> leaf.minX >> leaf.minZ >> leaf.maxX >> leaf.maxZ >>
            leaf.lod >> leaf.blend)) {
        error = "line " + std::to_string(lineNumber) + ": malformed terrain_lod record";
        return false;
      }
      out.terrainLod.push_back(std::move(leaf));
    } else if (kind == "terrain_meta") {
      if (!(tokens >> out.terrainMaxDepth >> out.terrainFocusX >> out.terrainFocusZ)) {
        error = "line " + std::to_string(lineNumber) + ": malformed terrain_meta record";
        return false;
      }
    } else {
      error = "line " + std::to_string(lineNumber) + ": unknown record type '" + kind + "'";
      return false;
    }
  }

  return true;
}

bool loadSceneFile(const std::string& path, NativeScene& out, std::string& error) {
  std::ifstream file(path, std::ios::binary);
  if (!file.is_open()) {
    error = "cannot open scene file: " + path;
    return false;
  }
  std::ostringstream buffer;
  buffer << file.rdbuf();
  return parseSceneText(buffer.str(), out, error);
}

}  // namespace heretek

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { restoreCelMaterial, createFoliageController } from './foliage.js';

const TREE_X = 4.2,
  TREE_Z = 2.2;
export function isWillowFootprint(x, z) {
  return Math.hypot(x - TREE_X, z - TREE_Z) < 0.61;
}

export async function loadWeepingWillow(scene, clock, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(
    new URL('../assets/models/willow-original.glb', import.meta.url).href,
    onProgress
  );
  const group = gltf.scene;
  group.name = 'Original weeping willow — Just a Simple Tree';
  const bounds = new THREE.Box3().setFromObject(group),
    size = bounds.getSize(new THREE.Vector3());
  const scale = 4.5 / size.y;
  group.scale.setScalar(scale);
  group.position.set(TREE_X, 0.012 - bounds.min.y * scale, TREE_Z);
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => restoreCelMaterial(material, clock))
      : restoreCelMaterial(object.material, clock);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (!material.map) continue;
      // Filter small leaf silhouettes across zoom levels instead of switching
      // between hard texels as the dense crown moves across phone pixels.
      material.map.minFilter = THREE.LinearMipmapLinearFilter;
      material.map.magFilter = THREE.LinearFilter;
      material.map.generateMipmaps = true;
      material.map.anisotropy = 4;
      material.map.needsUpdate = true;
      if (material.alphaTest > 0) {
        material.alphaTest = 0.35;
        material.alphaToCoverage = true;
      }
    }
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
  });
  scene.add(group);
  group.updateMatrixWorld(true);
  return createFoliageController(group);
}

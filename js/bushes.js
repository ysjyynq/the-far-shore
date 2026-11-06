import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shorelineRadius } from './pool.js';
import { restoreCelMaterial, createFoliageController } from './foliage.js';

// Offset each shrub from the procedural waterline rather than planting it in
// the pool. The gaps leave the shore readable and keep clear of the willow.
const placements = [
  { angle: 108, height: 1.25, rotation: 0.25, width: 1.08 },
  { angle: 172, height: 1.52, rotation: 1.9, width: 0.96 },
  { angle: 235, height: 1.18, rotation: 3.8, width: 1.04 },
  { angle: 300, height: 1.38, rotation: 5.2, width: 1 }
].map((item) => {
  const angle = THREE.MathUtils.degToRad(item.angle);
  const radius = Math.min(5.6, Math.max(4.9, shorelineRadius(angle) + 0.6));
  return { ...item, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
});

export function isBushFootprint(x, z) {
  return placements.some(
    (plant) =>
      Math.hypot(x - plant.x, z - plant.z) < Math.min(0.55, plant.height * 0.36)
  );
}

export async function createBushes(scene, clock, onProgress) {
  const { scene: source } = await new GLTFLoader().loadAsync(
    new URL('../assets/models/bush-original.glb', import.meta.url).href,
    onProgress
  );
  const bounds = new THREE.Box3().setFromObject(source),
    size = bounds.getSize(new THREE.Vector3());
  const group = new THREE.Group();
  group.name = 'Four frost bushes';
  const plants = [];
  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i],
      plant = source.clone(true);
    const scale = Math.min(
      placement.height / size.y,
      1.9 / Math.max(size.x, size.z)
    );
    plant.name = `Frost bush ${i + 1}`;
    plant.scale.set(scale * placement.width, scale, scale);
    plant.rotation.y = placement.rotation;
    plant.position.set(placement.x, 0.012 - bounds.min.y * scale, placement.z);
    plant.traverse((object) => {
      if (!object.isMesh) return;
      // Springs modify actual vertices, so geometry belongs to this bush.
      object.geometry = object.geometry.clone();
      object.material = Array.isArray(object.material)
        ? object.material.map((material) =>
            restoreCelMaterial(material.clone(), clock)
          )
        : restoreCelMaterial(object.material.clone(), clock);
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
    });
    group.add(plant);
  }
  scene.add(group);
  group.updateMatrixWorld(true);
  for (const plant of group.children)
    plants.push(
      createFoliageController(plant, {
        radius: 0.68,
        pull: 0.28,
        spread: 0.1,
        droop: 0.035,
        anchor: 'base',
        solidCrown: true
      })
    );
  return {
    group,
    plants,
    pick(raycaster) {
      let closest = null;
      for (const plant of plants) {
        const hit = plant.pick(raycaster);
        if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      return closest;
    },
    pickDistance(raycaster) {
      return this.pick(raycaster)?.distance ?? Infinity;
    },
    brush(from, to, direction) {
      for (const plant of plants) plant.brush(from, to, direction);
    },
    update(dt, origin, direction, active) {
      for (const plant of plants) plant.update(dt, origin, direction, active);
    }
  };
}

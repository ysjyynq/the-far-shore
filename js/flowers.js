import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAconiteGeometry } from './aconite.js';
import { createAdonisGeometry } from './adonis.js';
import { createFlowerMaterial } from './flower-material.js';
import { isGrassAllowed, shorelineRadius } from './pool.js';
import { isWillowFootprint } from './willow-model.js';
import { isBushFootprint } from './bushes.js';

// Individual, irregularly spaced accents through the grassy ring, rather than
// display beds. Sector batching is only for rendering and does not cluster them.
let placementSeed = 78531;
const placementRandom = () => {
  placementSeed = (Math.imul(placementSeed, 1664525) + 1013904223) >>> 0;
  return placementSeed / 4294967296;
};
const placements = [];
for (let i = 0; i < 17; i++) {
  let point = null;
  for (let attempt = 0; attempt < 200 && !point; attempt++) {
    const angle =
      ((i + 0.15 + placementRandom() * 0.7) / 17) * Math.PI * 2 +
      (placementRandom() - 0.5) * 0.2;
    const inner = Math.min(5.8, shorelineRadius(angle) + 0.25),
      radius = Math.sqrt(
        THREE.MathUtils.lerp(inner * inner, 6.02 * 6.02, placementRandom())
      );
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    if (
      !isGrassAllowed(x, z) ||
      isBushFootprint(x, z) ||
      isWillowFootprint(x, z)
    )
      continue;
    if (
      isBushFootprint(x + 0.22, z) ||
      isBushFootprint(x - 0.22, z) ||
      isBushFootprint(x, z + 0.22) ||
      isBushFootprint(x, z - 0.22)
    )
      continue;
    if (
      Math.hypot(x - 4.2, z - 2.2) < 0.95 ||
      placements.some((other) => Math.hypot(other.x - x, other.z - z) < 0.63)
    )
      continue;
    const species = i % 2 === 0 ? 'aconite' : 'adonis',
      scale = (species === 'aconite' ? 0.51 : 0.49) + placementRandom() * 0.065,
      yaw = placementRandom() * Math.PI * 2;
    point = { x, z, species, scale, yaw, seed: 19271 + i * 1009 };
  }
  if (point) placements.push(point);
}
const patches = Array.from({ length: 4 }, (_, sector) => {
  const flowers = placements.filter(
    (p) =>
      Math.floor(
        ((Math.atan2(p.z, p.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 0.5)
      ) === sector
  );
  return {
    flowers,
    count: flowers.length,
    x: flowers.reduce((sum, p) => sum + p.x, 0) / Math.max(1, flowers.length),
    z: flowers.reduce((sum, p) => sum + p.z, 0) / Math.max(1, flowers.length)
  };
}).filter((patch) => patch.count);

export function isFlowerFootprint(x, z) {
  return placements.some(
    (plant) => Math.hypot(x - plant.x, z - plant.z) < 0.04
  );
}
export function flowerGrassScale(x, z) {
  let scale = 1;
  for (const plant of placements) {
    const distance = Math.hypot(x - plant.x, z - plant.z);
    scale = Math.min(
      scale,
      0.2 + 0.8 * THREE.MathUtils.smoothstep(distance, 0.13, 0.3)
    );
  }
  return scale;
}

// One mesh per drift, with a rooted spring for each complete flower. Petals,
// foliage and stems move together rather than separating into individual pieces.
function createPatch(scene, clock, patch, index) {
  const pieces = [],
    springs = [];
  let vertexOffset = 0;
  for (let i = 0; i < patch.count; i++) {
    const plant = patch.flowers[i],
      { species, scale, yaw, seed } = plant,
      x = plant.x - patch.x,
      z = plant.z - patch.z;
    const geometry =
      species === 'aconite'
        ? createAconiteGeometry(seed)
        : createAdonisGeometry(seed);
    geometry.computeBoundingBox();
    const low = geometry.boundingBox.min.y,
      rawHeight = geometry.boundingBox.max.y - low;
    const weights = new Float32Array(geometry.attributes.position.count),
      phases = new Float32Array(weights.length),
      phase = seed * 0.31;
    for (let v = 0; v < weights.length; v++) {
      const t = (geometry.attributes.position.getY(v) - low) / rawHeight;
      weights[v] = THREE.MathUtils.smoothstep(t, 0.02, 1);
      phases[v] = phase;
    }
    geometry.scale(scale, scale, scale);
    geometry.rotateY(yaw);
    geometry.translate(x, 0.012 - low * scale, z);
    geometry.setAttribute(
      'flowerWeight',
      new THREE.Float32BufferAttribute(weights, 1)
    );
    geometry.setAttribute(
      'flowerPhase',
      new THREE.Float32BufferAttribute(phases, 1)
    );
    pieces.push(geometry);
    springs.push({
      start: vertexOffset,
      end: vertexOffset + weights.length,
      center: new THREE.Vector3(x, rawHeight * scale * 0.66, z),
      offset: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
      pressure: 0
    });
    vertexOffset += weights.length;
  }
  const geometry = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundingBox.expandByScalar(0.18);
  geometry.boundingSphere.radius += 0.18;
  const position = geometry.attributes.position,
    rest = position.array.slice(),
    weights = geometry.attributes.flowerWeight.array;
  position.setUsage(THREE.DynamicDrawUsage);
  const material = createFlowerMaterial(clock);
  const group = new THREE.Group();
  group.name = `Scattered winter flowers ${index + 1}`;
  group.position.set(patch.x, 0, patch.z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = group.name + ' — modeled stems, foliage and blooms';
  group.add(mesh);
  scene.add(group);
  group.updateMatrixWorld(true);
  const stroke = new THREE.Vector3(),
    center = new THREE.Vector3(),
    away = new THREE.Vector3(),
    closest = new THREE.Vector3();
  const moving = new Set();
  function brush(from, to, direction) {
    stroke.subVectors(to, from);
    const length = stroke.lengthSq();
    for (const spring of springs) {
      center.copy(spring.center).add(group.position).add(spring.offset);
      const along =
        length > 1e-8
          ? THREE.MathUtils.clamp(
              away.subVectors(center, from).dot(stroke) / length,
              0,
              1
            )
          : 0;
      closest.copy(from).addScaledVector(stroke, along);
      away.subVectors(center, closest);
      const t = Math.max(0, 1 - away.length() / 0.4),
        pressure = t * t * (3 - 2 * t);
      if (pressure <= spring.pressure) continue;
      spring.pressure = pressure;
      spring.target.copy(direction).multiplyScalar(0.1 * pressure);
      spring.target.y -= 0.015 * pressure;
      moving.add(spring);
    }
  }
  const controller = {
    group,
    pick(raycaster) {
      const hit = raycaster.intersectObject(mesh, false)[0];
      return hit
        ? {
            distance: hit.distance,
            point: hit.point,
            kind: 'crown',
            owner: controller
          }
        : null;
    },
    brush,
    update(dt, origin, direction, active) {
      if (active && origin) brush(origin, origin, direction);
      if (moving.size === 0) return;
      const recovery = Math.exp(-dt * 2.8),
        omega = 11,
        decay = Math.exp(-omega * dt);
      let changed = false;
      for (const spring of moving) {
        spring.pressure *= recovery;
        spring.target.multiplyScalar(recovery);
        for (const axis of ['x', 'y', 'z']) {
          const delta = spring.offset[axis] - spring.target[axis],
            step = (spring.velocity[axis] + omega * delta) * dt;
          spring.offset[axis] = spring.target[axis] + (delta + step) * decay;
          spring.velocity[axis] =
            (spring.velocity[axis] - omega * step) * decay;
        }
        if (
          spring.pressure < 1e-5 &&
          spring.offset.lengthSq() < 1e-8 &&
          spring.velocity.lengthSq() < 1e-8
        ) {
          spring.pressure = 0;
          spring.target.set(0, 0, 0);
          spring.offset.set(0, 0, 0);
          spring.velocity.set(0, 0, 0);
          moving.delete(spring);
        }
        for (let v = spring.start; v < spring.end; v++) {
          const k = v * 3,
            w = weights[v];
          position.array[k] = rest[k] + spring.offset.x * w;
          position.array[k + 1] = rest[k + 1] + spring.offset.y * w;
          position.array[k + 2] = rest[k + 2] + spring.offset.z * w;
        }
        changed = true;
      }
      if (changed) position.needsUpdate = true;
    }
  };
  return controller;
}

export function createFlowers(scene, clock) {
  const plants = patches.map((patch, i) => createPatch(scene, clock, patch, i));
  return { plants };
}

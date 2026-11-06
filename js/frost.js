import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  float,
  mix,
  smoothstep,
  uv,
  varying
} from 'three/tsl';

// A bounded, single-draw pool of soft firefly-shaped frost motes. A small
// luminous core and colored halo are drawn in TSL, without an image texture.
export function createFrostParticles(scene, camera, reducedMotion) {
  const capacity = 96,
    geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity),
    1
  ).setUsage(THREE.DynamicDrawUsage);
  const tints = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity * 3),
    3
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('frostOpacity', opacity);
  geometry.setAttribute('frostTint', tints);
  // Normal blending preserves icy color against the nearly white grass.
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending
  });
  const point = uv().sub(0.5).mul(2),
    radius = point.length();
  const core = float(1).sub(smoothstep(0.04, 0.24, radius));
  const halo = float(1)
    .sub(smoothstep(0.08, 1, radius))
    .pow(3)
    .mul(0.55);
  const shape = core.max(halo);
  material.colorNode = mix(
    varying(attribute('frostTint', 'vec3')),
    color('#e4edf1'),
    core.mul(0.65)
  );
  material.opacityNode = shape.mul(varying(attribute('frostOpacity', 'float')));
  const motes = new THREE.InstancedMesh(geometry, material, capacity);
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  motes.frustumCulled = false;
  motes.renderOrder = 2;
  scene.add(motes);
  const transform = new THREE.Object3D();
  const particles = Array.from({ length: capacity }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 1,
    life: 0,
    size: 0,
    curl: 0
  }));
  const palette = ['#e4edf1', '#9abedb', '#b3d9df', '#b9bddb', '#c3d9e5'].map(
    (hex) => new THREE.Color(hex)
  );
  const motion = reducedMotion ? 0.4 : 1;
  let next = 0,
    budget = 0,
    emitting = false;
  transform.scale.setScalar(0);
  transform.updateMatrix();
  for (let i = 0; i < capacity; i++) motes.setMatrixAt(i, transform.matrix);

  function emit(origin) {
    const index = next,
      particle = particles[index];
    next = (next + 1) % capacity;
    const tint = palette[Math.floor(Math.random() * palette.length)];
    tint.toArray(tints.array, index * 3);
    const angle = Math.random() * Math.PI * 2,
      spread = 0.06 + Math.random() * 0.18;
    particle.position.copy(origin);
    particle.position.x += Math.cos(angle) * spread;
    particle.position.z += Math.sin(angle) * spread;
    particle.position.y = Math.max(origin.y + 0.14, 0.7) + Math.random() * 0.16;
    // A broad outward fan: some motes lift, some skim sideways, and some
    // drift down. Preserve horizontal speed so the spray never becomes a column.
    const drift = (0.4 + Math.random() * 0.6) * motion,
      rise = (-0.1 + Math.random() * 0.65) * motion;
    particle.velocity.set(
      Math.cos(angle) * drift,
      rise,
      Math.sin(angle) * drift
    );
    particle.age = 0;
    particle.life = 1.1 + Math.random() * 0.5;
    particle.size = 0.13 + Math.random() * 0.12;
    particle.curl = (Math.random() - 0.5) * 2.4 * motion;
    tints.needsUpdate = true;
  }

  return {
    update(dt, origin) {
      if (origin) {
        if (!emitting)
          for (let i = 0; i < (reducedMotion ? 4 : 12); i++) emit(origin);
        budget += dt * (reducedMotion ? 16 : 48);
        while (budget >= 1) {
          emit(origin);
          budget--;
        }
      } else budget = 0;
      emitting = Boolean(origin);
      for (let i = 0; i < capacity; i++) {
        const particle = particles[i];
        particle.age += dt;
        if (particle.age >= particle.life) {
          opacity.array[i] = 0;
          continue;
        }
        const progress = particle.age / particle.life;
        const vx = particle.velocity.x,
          vz = particle.velocity.z,
          turn = particle.curl * dt;
        const drag = Math.exp(-dt * 0.15),
          cos = Math.cos(turn),
          sin = Math.sin(turn);
        particle.velocity.x = (vx * cos - vz * sin) * drag;
        particle.velocity.z = (vx * sin + vz * cos) * drag;
        particle.position.x += (vx + particle.velocity.x) * 0.5 * dt;
        particle.position.z += (vz + particle.velocity.z) * 0.5 * dt;
        particle.position.y +=
          particle.velocity.y * dt - 0.08 * motion * dt * dt;
        particle.velocity.y -= 0.16 * motion * dt;
        transform.position.copy(particle.position);
        transform.quaternion.copy(camera.quaternion);
        const size =
          particle.size * (0.75 + Math.sin(progress * Math.PI) * 0.25);
        transform.scale.setScalar(size);
        transform.updateMatrix();
        motes.setMatrixAt(i, transform.matrix);
        const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.5, 1);
        opacity.array[i] = Math.min(particle.age / 0.05, 1) * fadeOut * 0.95;
      }
      opacity.needsUpdate = true;
      motes.instanceMatrix.needsUpdate = true;
    }
  };
}

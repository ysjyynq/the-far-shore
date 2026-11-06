import { acceleratePicking } from './picking.js';
import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  color,
  cos,
  dot,
  float,
  mix,
  output,
  positionLocal,
  sin,
  smoothstep,
  step,
  vec3,
  vec4
} from 'three/tsl';

// Restore the exported model's cel ramps and baked leaf shading using the
// author's WebGPU material adapter. The meadow applies its own tone mapping.
// Just a Simple Tree, Mike Fernandez, MIT; see LICENSE-willow.txt.
export function restoreCelMaterial(old, clock) {
  const ramp = old.userData.celRamp;
  if (!ramp) return old;
  const material = new THREE.MeshLambertNodeMaterial({
    name: old.name,
    color: new THREE.Color().setRGB(0.8, 0.8, 0.8),
    map: old.map,
    alphaTest: old.alphaTest,
    alphaToCoverage: true,
    side: old.side
  });
  const value = dot(output.rgb, vec3(0.2126, 0.7152, 0.0722));
  let band = color(ramp[0][1]);
  for (const [at, hex] of ramp.slice(1))
    band = mix(band, color(hex), smoothstep(at - 0.075, at + 0.075, value));
  const tint = mix(
    vec3(1),
    output.rgb.div(value.max(0.0001)),
    smoothstep(0, 0.02, value)
  );
  const shade = old.vertexColors
    ? attribute('color', 'vec3').mul(old.userData.shadeScale ?? 1)
    : float(1);
  material.outputNode = vec4(
    mix(band, band.mul(color('#bfd1dd')), float(0.16))
      .mul(tint)
      .mul(shade),
    output.a
  );
  // The GLB is baked at rest. Apply the same gentle sway to both meshes so the
  // original branches and foliage stay together, with the trunk base anchored.
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar(),
      weight = smoothstep(0.3, 8.8, p.y);
    p.x.addAssign(
      sin(clock.mul(0.65).add(p.y.mul(0.5)))
        .mul(0.07)
        .mul(weight)
    );
    p.z.addAssign(
      cos(clock.mul(0.56).add(p.y.mul(0.42)))
        .mul(0.045)
        .mul(weight)
    );
    return p;
  })();
  material.userData = { ...old.userData };
  old.dispose();
  return material;
}

// Each disconnected grid in the exported leaves mesh is one leaf card. Give
// these cards their own spring, and soften the motion toward their upper edge.
// Updating the real positions keeps ray picking aligned with brushed foliage.
export function createCrownBrush(mesh, options = {}) {
  const geometry = mesh.geometry,
    position = geometry.attributes.position;
  position.setUsage(THREE.DynamicDrawUsage);
  const rest = position.array.slice(),
    parents = new Int32Array(position.count);
  for (let i = 0; i < parents.length; i++) parents[i] = i;
  const root = (i) => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const join = (a, b) => {
    a = root(a);
    b = root(b);
    if (a !== b) parents[b] = a;
  };
  const index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    join(index.getX(i), index.getX(i + 1));
    join(index.getX(i), index.getX(i + 2));
  }
  const components = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = root(i);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(i);
  }
  const vertexWeight = new Float32Array(position.count),
    cards = [];
  for (const vertices of components.values()) {
    const center = new THREE.Vector3();
    let low = Infinity,
      high = -Infinity;
    for (const vertex of vertices) {
      const k = vertex * 3;
      center.x += rest[k];
      center.y += rest[k + 1];
      center.z += rest[k + 2];
      low = Math.min(low, rest[k + 1]);
      high = Math.max(high, rest[k + 1]);
    }
    center.multiplyScalar(1 / vertices.length);
    for (const vertex of vertices)
      vertexWeight[vertex] =
        0.22 +
        0.78 *
          Math.pow(
            (high - rest[vertex * 3 + 1]) / Math.max(high - low, 0.001),
            0.85
          );
    const bounds = new THREE.Box3();
    for (const vertex of vertices)
      bounds.expandByPoint(new THREE.Vector3().fromArray(rest, vertex * 3));
    cards.push({
      bounds,
      vertices,
      center,
      world: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
      pressure: 0
    });
  }
  const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const stroke = new THREE.Vector3(),
    closest = new THREE.Vector3(),
    away = new THREE.Vector3(),
    push = new THREE.Vector3(),
    localOrigin = new THREE.Vector3();
  const {
      radius = 1.05,
      pull = 0.7,
      spread = 0.2,
      droop = 0.08,
      anchor = 'top'
    } = options,
    axes = ['x', 'y', 'z'];
  if (anchor === 'base') {
    const low = geometry.boundingBox.min.y,
      span = Math.max(geometry.boundingBox.max.y - low, 0.001);
    for (let vertex = 0; vertex < position.count; vertex++) {
      const height = THREE.MathUtils.clamp(
        (rest[vertex * 3 + 1] - low) / span,
        0,
        1
      );
      vertexWeight[vertex] = THREE.MathUtils.smoothstep(height, 0.08, 0.85);
    }
  }
  const padding =
    (Math.max(pull + spread + droop, 0.98) /
      mesh.getWorldScale(new THREE.Vector3()).length()) *
    Math.sqrt(3) *
    1.25;
  geometry.boundingBox.expandByScalar(padding);
  geometry.boundingSphere.radius += padding;
  // Only touched cards need CPU spring work. Wind remains entirely in TSL.
  const moving = new Set();

  function brush(from, to, direction) {
    stroke.subVectors(to, from);
    const lengthSquared = stroke.lengthSq();
    for (const card of cards) {
      card.world
        .copy(card.center)
        .addScaledVector(card.offset, 0.65)
        .applyMatrix4(mesh.matrixWorld);
      const along =
        lengthSquared > 1e-8
          ? THREE.MathUtils.clamp(
              away.subVectors(card.world, from).dot(stroke) / lengthSquared,
              0,
              1
            )
          : 0;
      closest.copy(from).addScaledVector(stroke, along);
      away.subVectors(card.world, closest);
      const distance = away.length(),
        t = Math.max(0, 1 - distance / radius),
        pressure = t * t * (3 - 2 * t);
      if (pressure <= card.pressure || pressure === 0) continue;
      card.pressure = pressure;
      if (distance > 0.02) away.multiplyScalar(1 / distance);
      else away.set(0, 0, 0);
      push.copy(direction).multiplyScalar(pull).addScaledVector(away, spread);
      push.y -= droop;
      // Transform displacement without introducing the model's translation.
      localOrigin.copy(closest).applyMatrix4(inverse);
      push
        .add(closest)
        .applyMatrix4(inverse)
        .sub(localOrigin)
        .multiplyScalar(pressure);
      card.target.copy(push);
      moving.add(card);
    }
  }

  const pickRay = new THREE.Ray(),
    pickBox = new THREE.Box3(),
    pickPoint = new THREE.Vector3(),
    worldPoint = new THREE.Vector3();
  return {
    // Touch uses individual moving leaf-card envelopes, not thousands of
    // triangle and alpha-texture tests. Gaps between cards remain ungrabbable.
    pickTouch(raycaster) {
      pickRay.copy(raycaster.ray).applyMatrix4(inverse);
      let nearest = null;
      for (const card of cards) {
        pickBox.copy(card.bounds);
        for (const axis of axes) {
          pickBox.min[axis] += Math.min(0, card.offset[axis]);
          pickBox.max[axis] += Math.max(0, card.offset[axis]);
        }
        if (!pickRay.intersectBox(pickBox, pickPoint)) continue;
        worldPoint.copy(pickPoint).applyMatrix4(mesh.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(worldPoint);
        if (
          distance >= raycaster.near &&
          distance <= raycaster.far &&
          (!nearest || distance < nearest.distance)
        )
          nearest = { distance, point: worldPoint.clone() };
      }
      return nearest;
    },
    brush,
    update(dt, origin, direction, active) {
      if (active && origin) brush(origin, origin, direction);
      if (moving.size === 0) return;
      const omega = 10,
        decay = Math.exp(-omega * dt),
        recovery = Math.exp(-dt * (active ? 2.9 : 1.8));
      let changed = false,
        firstChanged = Infinity,
        lastChanged = -1;
      for (const card of moving) {
        card.pressure *= recovery;
        card.target.multiplyScalar(recovery);
        for (const axis of axes) {
          const delta = card.offset[axis] - card.target[axis],
            step = (card.velocity[axis] + omega * delta) * dt;
          card.offset[axis] = card.target[axis] + (delta + step) * decay;
          card.velocity[axis] = (card.velocity[axis] - omega * step) * decay;
        }
        if (
          card.pressure < 1e-5 &&
          card.offset.lengthSq() < 1e-8 &&
          card.velocity.lengthSq() < 1e-8
        ) {
          card.pressure = 0;
          card.target.set(0, 0, 0);
          card.offset.set(0, 0, 0);
          card.velocity.set(0, 0, 0);
          moving.delete(card);
        }
        for (const vertex of card.vertices) {
          const k = vertex * 3,
            weight = vertexWeight[vertex];
          firstChanged = Math.min(firstChanged, k);
          lastChanged = Math.max(lastChanged, k + 2);
          position.array[k] = rest[k] + card.offset.x * weight;
          position.array[k + 1] = rest[k + 1] + card.offset.y * weight;
          position.array[k + 2] = rest[k + 2] + card.offset.z * weight;
        }
        changed = true;
      }
      if (changed) {
        position.clearUpdateRanges();
        position.addUpdateRange(firstChanged, lastChanged - firstChanged + 1);
        position.needsUpdate = true;
      }
    }
  };
}

const alphaPixelCache = new WeakMap();
export function leafAlphaSampler(material) {
  const texture = material.map,
    image = texture?.image;
  if (!image?.width || !image?.height) return () => true;
  let mask = alphaPixelCache.get(image);
  if (!mask) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    mask = {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data
    };
    alphaPixelCache.set(image, mask);
  }
  const { width, height, pixels } = mask,
    uv = new THREE.Vector2();
  return (hit) => {
    if (!hit.uv) return true;
    texture.transformUv(uv.copy(hit.uv));
    const x = THREE.MathUtils.clamp(Math.floor(uv.x * width), 0, width - 1),
      y = THREE.MathUtils.clamp(Math.floor(uv.y * height), 0, height - 1);
    return pixels[(y * width + x) * 4 + 3] / 255 >= material.alphaTest;
  };
}

// One controller per plant keeps grab ownership and each crown's recovery local.
export function createFoliageController(group, options = {}) {
  const meshes = [];
  group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  const crowns = meshes.filter((mesh) => mesh.name === 'leaves');
  // A shrub's painted cards have many tiny internal gaps. Its modest inner
  // volume is grabbable too, while the outer silhouette still uses leaf alpha.
  // Capture bounds before the springs expand them for raycast motion margins.
  let grabCore = null;
  if (options.solidCrown && crowns.length) {
    const bounds = new THREE.Box3(),
      size = new THREE.Vector3();
    for (const crown of crowns) {
      if (!crown.geometry.boundingBox) crown.geometry.computeBoundingBox();
      bounds.union(
        crown.geometry.boundingBox.clone().applyMatrix4(crown.matrixWorld)
      );
    }
    bounds.getSize(size);
    grabCore = new THREE.Sphere(
      bounds.getCenter(new THREE.Vector3()),
      0.43 * Math.min(size.x, size.y, size.z)
    );
  }
  const brushes = crowns.map((mesh) => createCrownBrush(mesh, options));
  const touchPicking =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.quality === 'mobile';
  for (const mesh of meshes) {
    if (touchPicking && crowns.includes(mesh)) continue;
    const scale = mesh.getWorldScale(new THREE.Vector3());
    const margin = crowns.includes(mesh)
      ? (((options.pull ?? 0.7) +
          (options.spread ?? 0.2) +
          (options.droop ?? 0.08)) *
          1.5) /
        Math.min(scale.x, scale.y, scale.z)
      : 0;
    acceleratePicking(mesh, margin);
  }
  const alphaMasks = new Map(
    crowns.map((mesh) => [mesh, leafAlphaSampler(mesh.material)])
  );
  const corePoint = new THREE.Vector3();
  function pick(raycaster) {
    let nearest = null;
    if (touchPicking)
      for (const brush of brushes) {
        const hit = brush.pickTouch(raycaster);
        if (hit && (!nearest || hit.distance < nearest.distance))
          nearest = { ...hit, kind: 'crown', owner: controller };
      }
    for (const hit of raycaster.intersectObjects(
      touchPicking ? meshes.filter((mesh) => !crowns.includes(mesh)) : meshes,
      false
    )) {
      const mask = alphaMasks.get(hit.object);
      if (mask && !mask(hit)) continue;
      if (!nearest || hit.distance < nearest.distance)
        nearest = {
          distance: hit.distance,
          point: hit.point,
          kind: mask ? 'crown' : 'wood',
          owner: controller
        };
      break;
    }
    if (grabCore && raycaster.ray.intersectSphere(grabCore, corePoint)) {
      const distance = raycaster.ray.origin.distanceTo(corePoint);
      if (!nearest || distance < nearest.distance)
        nearest = {
          distance,
          point: corePoint.clone(),
          kind: 'crown',
          owner: controller
        };
    }
    return nearest;
  }
  const controller = {
    group,
    pick,
    pickDistance(raycaster) {
      return pick(raycaster)?.distance ?? Infinity;
    },
    brush(from, to, direction) {
      for (const brush of brushes) brush.brush(from, to, direction);
    },
    update(dt, origin, direction, active) {
      for (const brush of brushes) brush.update(dt, origin, direction, active);
    }
  };
  return controller;
}

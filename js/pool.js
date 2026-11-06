import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  positionLocal,
  varying,
  vec2,
  vec3,
  vec4,
  float,
  uint,
  ivec2,
  uvec2,
  floor,
  fract,
  mix,
  smoothstep,
  length,
  sin,
  exp,
  max,
  min,
  clamp,
  color
} from 'three/tsl';

// Pond contour and broken ripple bands ported from
// fidel3ng/3jsScene's common.glsl.js, ground.glsl.js and ripples.glsl.js.
// Water and shore use cool shades of the frost crown palette.
// The same integer hash is used on CPU and GPU so grass stays off the shore.
const SEGMENTS = 256;
const POND_RADIUS = 5;
function hash(ix, iy) {
  let x = (Math.imul(ix, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(iy, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x & 0x00ffffff) / 16777216;
}
const lerp = (a, b, t) => a + (b - a) * t;
function vnoise(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = (x - ix) ** 2 * (3 - 2 * (x - ix));
  const fy = (y - iy) ** 2 * (3 - 2 * (y - iy));
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), fx),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
    fy
  );
}
export function poolDepth(x, z) {
  const wobble = (vnoise(x * 0.35, z * 0.35) - 0.5) * 2.5;
  const t = Math.min(Math.max((Math.hypot(x, z) + wobble) / POND_RADIUS, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}
export function isGrassAllowed(x, z) {
  return Math.hypot(x, z) <= 6.2 && poolDepth(x, z) <= 0.045;
}
export function shorelineRadius(angle, threshold = 0.045) {
  let low = 0,
    high = 6.5;
  for (let step = 0; step < 32; step++) {
    const radius = (low + high) * 0.5;
    if (
      poolDepth(Math.cos(angle) * radius, Math.sin(angle) * radius) > threshold
    )
      low = radius;
    else high = radius;
  }
  return (low + high) * 0.5;
}

// Returned in world XZ orientation, with upward-facing normals.
export function createGroundGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const x = Math.cos(angle) * 6.5,
      z = Math.sin(angle) * 6.5;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  const hole = new THREE.Path();
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (-i / SEGMENTS) * Math.PI * 2,
      radius = shorelineRadius(angle);
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    if (i === 0) hole.moveTo(x, -z);
    else hole.lineTo(x, -z);
  }
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

const hashNode = Fn(([point]) => {
  const v = uvec2(ivec2(point)).toVar();
  v.assign(v.mul(uint(1664525)).add(uint(1013904223)));
  v.x.addAssign(v.y.mul(uint(1664525)));
  v.y.addAssign(v.x.mul(uint(1664525)));
  v.x.assign(v.x.bitXor(v.x.shiftRight(uint(16))));
  v.y.assign(v.y.bitXor(v.y.shiftRight(uint(16))));
  v.x.addAssign(v.y.mul(uint(1664525)));
  v.x.assign(v.x.bitXor(v.x.shiftRight(uint(16))));
  return float(v.x.bitAnd(uint(0x00ffffff))).div(16777216);
}).setLayout({
  name: 'meadowPondHash',
  type: 'float',
  inputs: [{ name: 'point', type: 'vec2' }]
});
const valueNoise = Fn(([point]) => {
  const i = floor(point).toVar(),
    f = fract(point).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  return mix(
    mix(hashNode(i), hashNode(i.add(vec2(1, 0))), f.x),
    mix(hashNode(i.add(vec2(0, 1))), hashNode(i.add(vec2(1, 1))), f.x),
    f.y
  );
}).setLayout({
  name: 'meadowPondNoise',
  type: 'float',
  inputs: [{ name: 'point', type: 'vec2' }]
});
const depthNode = Fn(([point]) => {
  const wobble = valueNoise(point.mul(0.35)).sub(0.5).mul(2.5);
  return float(1).sub(smoothstep(0, POND_RADIUS, length(point).add(wobble)));
}).setLayout({
  name: 'meadowPondDepth',
  type: 'float',
  inputs: [{ name: 'point', type: 'vec2' }]
});

function pondFan(threshold, y) {
  const points = [0, y, 0],
    indices = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2,
      radius = shorelineRadius(angle, threshold);
    points.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    if (i < SEGMENTS) indices.push(0, i + 2, i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bankGeometry() {
  const points = [],
    indices = [];
  const layers = [
    [0.045, 0.003],
    [0.075, -0.008],
    [0.15, -0.055]
  ];
  for (let layer = 0; layer < layers.length; layer++) {
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2,
        radius = shorelineRadius(angle, layers[layer][0]);
      points.push(
        Math.cos(angle) * radius,
        layers[layer][1],
        Math.sin(angle) * radius
      );
      if (layer < layers.length - 1 && i < SEGMENTS) {
        const a = layer * (SEGMENTS + 1) + i,
          b = a + SEGMENTS + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPool(scene, clock) {
  const point = varying(positionLocal.xz),
    depth = depthNode(point).toVar('pondDepth');
  const bankMaterial = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    side: THREE.DoubleSide
  });
  bankMaterial.colorNode = mix(
    color('#829bb0'),
    color('#627b91'),
    smoothstep(0.045, 0.09, depth)
  ).mul(valueNoise(point.mul(8)).mul(0.12).add(0.88));
  const bank = new THREE.Mesh(bankGeometry(), bankMaterial);
  scene.add(bank);

  const shallow = color('#bfd1dd'),
    deep = color('#829bb0');
  const waterColor = mix(shallow, deep, smoothstep(0.15, 0.8, depth));
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = waterColor
    .mul(0.72)
    .add(valueNoise(point.mul(2.5)).mul(0.018));
  const water = new THREE.Mesh(pondFan(0.075, -0.025), material);
  scene.add(water);
  const bottom = new THREE.Mesh(
    pondFan(0.075, -0.09),
    new THREE.MeshBasicNodeMaterial({
      color: '#2e3b5c',
      side: THREE.DoubleSide
    })
  );
  scene.add(bottom);

  // Reference advances .00015 per frame; .009/second keeps its 60 Hz pace
  // independent of the display refresh rate.
  const rippleTime = clock.mul(0.009);
  const wave = sin(depth.add(rippleTime.mul(8)).mul(40));
  const breakup = smoothstep(
    0.35,
    0.65,
    valueNoise(point.mul(1.5).add(rippleTime.mul(3)))
  ).toVar('pondRippleBreakup');
  const ambient = smoothstep(0.75, 0.95, wave)
    .mul(float(1).sub(smoothstep(0.45, 0.7, depth)))
    .mul(breakup);
  const drops = Array.from({ length: 8 }, () =>
    uniform(new THREE.Vector4(0, 0, -100, 0))
  );
  const dropBands = Fn(() => {
    const total = float(0).toVar();
    for (const drop of drops) {
      const age = max(clock.sub(drop.z), 0),
        distance = length(point.sub(drop.xy));
      const ring = smoothstep(
        0.75,
        0.95,
        sin(distance.sub(age.mul(0.55)).mul(8))
      );
      const front = float(1).sub(
        smoothstep(age.mul(0.55), age.mul(0.55).add(0.5), distance)
      );
      total.addAssign(
        ring
          .mul(front)
          .mul(exp(age.mul(-0.9)))
          .mul(drop.w)
      );
    }
    return total;
  })();
  const ripplesMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  ripplesMaterial.colorNode = color('#e4edf1');
  ripplesMaterial.opacityNode = clamp(
    ambient.add(dropBands.mul(breakup).mul(0.5)),
    0,
    1
  )
    .mul(0.38)
    .mul(smoothstep(0.1, 0.25, depth));
  const ripples = new THREE.Mesh(pondFan(0.075, -0.023), ripplesMaterial);
  scene.add(ripples);
  let nextDrop = 0;
  return {
    water,
    bank,
    ripples,
    addRipple(x, z) {
      if (poolDepth(x, z) <= 0.1) return false;
      drops[nextDrop].value.set(x, z, clock.value, 1);
      nextDrop = (nextDrop + 1) % drops.length;
      return true;
    }
  };
}

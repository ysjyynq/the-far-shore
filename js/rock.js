import * as THREE from 'three/webgpu';
import {
  Fn,
  color,
  float,
  floor,
  fract,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uv,
  varying,
  vec2
} from 'three/tsl';

// Original geometry and procedural watercolor shading, inspired by the visual
// style of vitorbalbio's Stylized Watercolor Rocks. No downloaded model assets.
const placements = [
  { x: -4.72, z: -0.85, size: 0.78, rotation: 0.25 },
  { x: 2.46, z: 3.51, size: 0.48, rotation: 1.8 },
  { x: 3.4, z: -2.38, size: 0.42, rotation: 3.1 }
];

export function isRockFootprint(x, z) {
  return placements.some(
    (rock) => Math.hypot(x - rock.x, z - rock.z) < 0.9 * rock.size
  );
}

const hash = Fn(([point]) =>
  fract(sin(point.dot(vec2(127.1, 311.7))).mul(43758.5453))
).setLayout({
  name: 'watercolorRockHash',
  type: 'float',
  inputs: [{ name: 'point', type: 'vec2' }]
});
const noise = Fn(([point]) => {
  const cell = floor(point).toVar(),
    f = fract(point).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  return mix(
    mix(hash(cell), hash(cell.add(vec2(1, 0))), f.x),
    mix(hash(cell.add(vec2(0, 1))), hash(cell.add(vec2(1, 1))), f.x),
    f.y
  );
}).setLayout({
  name: 'watercolorRockNoise',
  type: 'float',
  inputs: [{ name: 'point', type: 'vec2' }]
});

function boulderGeometry() {
  const sides = 9,
    points = [],
    indices = [];
  const radii = [1.02, 0.93, 1.08, 0.9, 1.04, 0.97, 1.1, 0.92, 0.99];
  // Uneven shoulders and a sloping crown make broad, chisel-like facets.
  const rings = [
    { y: 0.015, rx: 0.62, rz: 0.49, ox: 0, oz: 0 },
    { y: 0.36, rx: 0.73, rz: 0.58, ox: -0.035, oz: 0.015 },
    { y: 0.88, rx: 0.51, rz: 0.43, ox: -0.1, oz: -0.045 },
    { y: 1.13, rx: 0.25, rz: 0.25, ox: -0.15, oz: -0.065 }
  ];
  for (let ring = 0; ring < rings.length; ring++) {
    const r = rings[ring];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + 0.1;
      const slope = ring === 0 ? 0 : Math.sin(angle * 1.4 + 0.6) * 0.065;
      points.push(
        r.ox + Math.cos(angle) * r.rx * radii[i],
        r.y + slope,
        r.oz + Math.sin(angle) * r.rz * radii[i]
      );
      if (ring < rings.length - 1) {
        const a = ring * sides + i,
          b = ring * sides + ((i + 1) % sides),
          c = a + sides,
          d = b + sides;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const top = points.length / 3;
  points.push(-0.17, 1.14, -0.07);
  for (let i = 0; i < sides; i++)
    indices.push(top, 3 * sides + ((i + 1) % sides), 3 * sides + i);
  const bottom = points.length / 3;
  points.push(0, 0.015, 0);
  for (let i = 0; i < sides; i++) indices.push(bottom, i, (i + 1) % sides);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setIndex(indices);
  const faceted = geometry.toNonIndexed();
  faceted.computeVertexNormals();
  faceted.computeBoundingBox();
  faceted.computeBoundingSphere();
  geometry.dispose();
  return faceted;
}

export function createWatercolorRockMaterial({
  scale = 1,
  flatShading = true,
  side = THREE.FrontSide,
  frosted = false
} = {}) {
  const point = varying(positionLocal).mul(scale),
    paper = vec2(
      point.x.add(point.z.mul(0.65)),
      point.y.add(point.z.mul(0.25))
    );
  const wash = noise(paper.mul(3.4)).toVar(),
    pigment = noise(paper.mul(8.2).add(vec2(9, 17))).toVar();
  const grain = noise(paper.mul(95));
  const stone = mix(
    color(frosted ? '#536d86' : '#8d7d65'),
    color(frosted ? '#a2b8c9' : '#c9bc9c'),
    wash.mul(0.75).add(pigment.mul(0.25))
  );
  const coating = mix(
    color(frosted ? '#9cbacf' : '#6d7d53'),
    color(frosted ? '#d3e6ed' : '#a2ae78'),
    pigment
  );
  const coverage = smoothstep(0.42, 0.95, point.y)
    .mul(smoothstep(0.31, 0.65, noise(paper.mul(4.6).add(vec2(3, 11)))))
    .mul(0.85);
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    metalness: 0,
    flatShading,
    side
  });
  material.colorNode = mix(stone, coating, coverage).mul(
    grain.mul(0.09).add(0.88)
  );
  return material;
}

export function createShorelineRocks(scene) {
  const geometry = boulderGeometry();
  const material = createWatercolorRockMaterial({ frosted: true });
  const shadowGeometry = new THREE.PlaneGeometry(2, 1.65);
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({
    color: '#253849',
    transparent: true,
    depthWrite: false
  });
  const distance = uv().sub(0.5).mul(2).length();
  shadowMaterial.opacityNode = float(1)
    .sub(smoothstep(0.25, 1, distance))
    .pow(2)
    .mul(0.26);
  for (const { x, z, size, rotation } of placements) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Frosted shoreline rock';
    mesh.position.set(x, -0.025, z);
    mesh.rotation.y = rotation;
    mesh.scale.set(size, size, size);

    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, 0.004, z);
    shadow.scale.setScalar(size);
    scene.add(mesh, shadow);
  }
}

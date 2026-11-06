import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  float,
  mix,
  normalView,
  positionViewDirection,
  varying
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWatercolorRockMaterial } from './rock.js';

// Broad broken shelves taper into a slender central hanging rock formation.
export function createIslandBase(scene, { mobile = false } = {}) {
  let seed = 91573;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const rock = [],
    snow = [],
    ice = [],
    iceDetails = [],
    iceIndices = [];
  const count = 72,
    rough = Array.from({ length: count }, () => random());
  const tri = (list, a, b, c) => list.push(...a, ...b, ...c);
  const rockTri = (a, b, c) => tri(rock, a, b, c);
  const depths = [
    -0.012, -0.42, -0.7, -1.05, -1.32, -1.65, -1.94, -2.3, -2.65, -3, -3.35,
    -3.9, -4.5, -5.1, -5.75
  ];
  const radii = [
    6.49, 6.3, 5.93, 5.8, 5.24, 4.9, 4.3, 3.95, 3.35, 2.95, 2.55, 2.08, 1.55, 1,
    0.45
  ];
  const rings = depths.map((y, j) =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2,
        t = j / (depths.length - 1);
      const broken =
        Math.sin(a * 3 + 0.6) * 0.3 +
        Math.sin(a * 7 + j * 0.2) * 0.22 +
        (rough[i] - 0.5) * 0.38;
      const r =
        j === 1
          ? Math.min(6.39, radii[j] + broken * 0.35)
          : radii[j] + broken * Math.min(1, j * 0.8) * (1 - t * 0.65);
      const drop =
        (Math.sin(a * 3 + j * 0.18) * 0.27 +
          Math.sin(a * 7) * 0.13 +
          (rough[i] - 0.5) * 0.28) *
        Math.min(1, j * 0.5);
      return [Math.cos(a) * r + t * 0.35, y + drop, Math.sin(a) * r - t * 0.18];
    })
  );
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < count; i++) {
      const k = (i + 1) % count;
      rockTri(rings[j][i], rings[j][k], rings[j + 1][i]);
      rockTri(rings[j][k], rings[j + 1][k], rings[j + 1][i]);
    }
  // All final faces meet at one shared lowest point, below the hanging ice.
  const tip = [0.35, -6.6, -0.18];
  for (let i = 0; i < count; i++)
    rockTri(rings.at(-1)[i], rings.at(-1)[(i + 1) % count], tip);
  // Snow spills down selected cracks, replacing horizontal terrace stripes.
  const lip = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const depth = 0.07 + 0.055 * (1 + Math.sin(a * 5)) + 0.025 * rough[i];
    const p = rings[0][i],
      q = rings[1][i];
    const t = (depth - 0.012) / (p[1] - q[1]);
    lip.push([
      (p[0] + (q[0] - p[0]) * t) * 1.001,
      -depth,
      (p[2] + (q[2] - p[2]) * t) * 1.001
    ]);
  }
  for (let i = 0; i < count; i++) {
    const k = (i + 1) % count,
      a = (i / count) * Math.PI * 2,
      b = (k / count) * Math.PI * 2;
    const top = (t) => [Math.cos(t) * 6.495, -0.006, Math.sin(t) * 6.495];
    tri(snow, top(a), top(b), lip[i]);
    tri(snow, top(b), lip[k], lip[i]);
  }
  // Small frozen drips surround a few long icicles. Sample the actual cliff
  // edge, including its broken outline, so every shoulder grows out of rock.
  const sides = 6,
    steps = mobile ? 7 : 9;
  for (const level of [5, 7, 9]) {
    const clusters = level === 1 ? 11 : level === 3 ? 8 : 6;
    for (let cluster = 0; cluster < clusters; cluster++) {
      const centre =
        ((cluster + 0.25 + (random() - 0.5) * 0.65) / clusters) * Math.PI * 2 +
        level * 0.49;
      const members = 3 + Math.floor(random() * 4);
      let spread = 0;
      for (let m = 0; m < members; m++) {
        const angle = centre + spread;
        const sample =
          ((((angle / (Math.PI * 2)) * count) % count) + count) % count;
        const i = Math.floor(sample),
          f = sample - i,
          p = rings[level][i],
          q = rings[level][(i + 1) % count];
        const root = p.map((v, k) => v + (q[k] - v) * f);
        // Bury the whole shoulder inside the ledge rather than balancing its
        // open top on an interpolated ring edge, which can expose a sky gap.
        root[0] -= Math.cos(angle) * 0.085;
        root[2] -= Math.sin(angle) * 0.085;
        root[1] += 0.16;
        // A long central drip with shorter neighbours and occasional runts.
        const hero = m === Math.floor(members / 2);
        const length = Math.min(
          (hero ? 1.5 + random() * 1.8 : 0.25 + Math.pow(random(), 1.5) * 1.8) *
            (level < 4 ? 1 : 0.78),
          root[1] + 6.1
        );
        const width =
          (0.025 + random() * 0.034 + Math.sqrt(length) * 0.023) *
          (hero ? 1.12 : 1) *
          0.68;
        spread += (width * 2 + 0.055 + random() * 0.13) / radii[level];
        const phase = random() * Math.PI * 2,
          lean = (random() - 0.5) * 0.09;
        const bend = (random() - 0.5) * 0.07,
          ellipse = 0.78 + random() * 0.35;
        const start = ice.length / 3;
        for (let j = 0; j < steps; j++) {
          const t = (j / (steps - 1)) * 0.975;
          // Broad broken facets narrow into slender, slightly curved tips.
          const shoulder = 1 + 0.24 * Math.exp(-t * 23);
          const ripple =
            1 + 0.13 * Math.sin(t * 9 + phase) * Math.sin(Math.PI * t);
          const radius = width * Math.pow(1 - t, 0.82) * shoulder * ripple;
          const cx =
            root[0] +
            Math.cos(angle) * (lean * t + bend * Math.sin(t * Math.PI));
          const cz =
            root[2] +
            Math.sin(angle) * (lean * t + bend * Math.sin(t * Math.PI));
          for (let k = 0; k < sides; k++) {
            const theta = (k / sides) * Math.PI * 2 + phase;
            const ridge =
              1 +
              0.075 * Math.sin(theta * 3 + phase + t * 2) +
              0.035 * Math.sin(theta * 5 - t * 4);
            ice.push(
              cx + Math.cos(theta) * radius * ridge,
              root[1] - t * length,
              cz + Math.sin(theta) * radius * ridge * ellipse
            );
            const frost = Math.exp(-t * 18);
            // Fine trapped-air veins run lengthwise; no repeated color bands.
            const vein =
              Math.pow(Math.max(0, Math.cos(theta * 3 + phase + t * 0.9)), 14) *
              (0.45 + 0.55 * Math.sin(t * 17 + phase) ** 2);
            iceDetails.push(frost, vein);
          }
        }
        for (let j = 0; j < steps - 1; j++)
          for (let k = 0; k < sides; k++) {
            const a = start + j * sides + k,
              b = start + j * sides + ((k + 1) % sides),
              c = a + sides,
              d = b + sides;
            iceIndices.push(a, b, c, b, d, c);
          }
        const tipIndex = ice.length / 3;
        ice.push(
          root[0] + Math.cos(angle) * lean,
          root[1] - length,
          root[2] + Math.sin(angle) * lean
        );
        iceDetails.push(0, 0.2);
        for (let k = 0; k < sides; k++)
          iceIndices.push(
            start + (steps - 1) * sides + k,
            start + (steps - 1) * sides + ((k + 1) % sides),
            tipIndex
          );
      }
    }
  }
  const geometry = (points) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  const rawRock = geometry(rock);
  rawRock.deleteAttribute('normal');
  const rockGeometry = mergeVertices(rawRock);
  rockGeometry.computeVertexNormals();
  rawRock.dispose();
  const base = new THREE.Mesh(
    rockGeometry,
    createWatercolorRockMaterial({
      scale: 0.3,
      flatShading: false,
      side: THREE.DoubleSide
    })
  );
  base.name = 'Weathered natural winter island';
  const cap = new THREE.Mesh(
    geometry(snow),
    new THREE.MeshStandardNodeMaterial({
      color: '#cbdbe5',
      roughness: 1,
      side: THREE.DoubleSide
    })
  );
  cap.name = 'Broken snow lip and frozen seams';
  base.add(cap);
  const iceGeometry = new THREE.BufferGeometry();
  iceGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(ice, 3)
  );
  iceGeometry.setAttribute(
    'iceDetail',
    new THREE.Float32BufferAttribute(iceDetails, 2)
  );
  iceGeometry.setIndex(iceIndices);
  iceGeometry.computeVertexNormals();
  iceGeometry.computeBoundingSphere();
  // Bright translucent crystal faces, without an expensive refraction target.
  const settings = {
    roughness: 0.55,
    metalness: 0,
    flatShading: false,
    transparent: !mobile,
    depthWrite: mobile,
    alphaToCoverage: mobile,
    alphaTest: mobile ? 0.05 : 0
  };
  const iceMaterial = mobile
    ? new THREE.MeshStandardNodeMaterial(settings)
    : new THREE.MeshPhysicalNodeMaterial({
        ...settings,
        clearcoat: 0.35,
        clearcoatRoughness: 0.25,
        ior: 1.31
      });
  const detail = varying(attribute('iceDetail', 'vec2'));
  const edge = float(1)
    .sub(normalView.dot(positionViewDirection).abs())
    .clamp(0, 1)
    .pow(2.4);
  const milk = detail.x
    .mul(0.8)
    .add(detail.y.mul(0.28))
    .add(edge.mul(0.5))
    .clamp(0, 1);
  iceMaterial.colorNode = mix(color('#a2c9dc'), color('#e4eff4'), milk);
  iceMaterial.opacityNode = float(0.42)
    .add(edge.mul(0.35))
    .add(detail.x.mul(0.18))
    .clamp(0, 0.9);
  iceMaterial.roughnessNode = mix(0.5, 0.7, detail.x);
  iceMaterial.emissiveNode = color('#bedde9').mul(
    float(0.13).add(edge.mul(0.2)).add(detail.y.mul(0.1))
  );
  const icicles = new THREE.Mesh(iceGeometry, iceMaterial);
  icicles.name = 'Slender carved blue ice with pale mineral edges';
  base.add(icicles);
  scene.add(base);
  return base;
}

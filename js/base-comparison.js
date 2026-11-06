import * as THREE from 'three/webgpu';
import {
  color,
  float,
  mix,
  normalView,
  positionViewDirection,
  uniform,
  vec3
} from 'three/tsl';

const versions = [
  {
    name: 'Watercolor',
    note: 'Original Moonstone · soft pigment washes',
    dark: '#555c76',
    light: '#cbd5e5',
    roughness: 1,
    metalness: 0,
    contrast: 1,
    glow: 0
  },
  {
    name: 'Chalk',
    note: 'Powdery pale stone · soft, matte finish',
    dark: '#8e96ab',
    light: '#d9e2ed',
    roughness: 1,
    metalness: 0,
    contrast: 0.3,
    glow: 0
  },
  {
    name: 'Polished',
    note: 'Smooth mineral · soft silver reflections',
    dark: '#626b88',
    light: '#c6cde2',
    roughness: 0.24,
    metalness: 0.2,
    contrast: 0.55,
    glow: 0
  },
  {
    name: 'Frosted ice',
    note: 'Deep slate-blue ice · soft frosted edges',
    dark: '#435c77',
    light: '#8aa5ba',
    roughness: 0.68,
    metalness: 0,
    contrast: 0.5,
    glow: 0.09
  },
  {
    name: 'Dark crystal',
    note: 'Smoky violet · glossy, deep mineral surface',
    dark: '#292b43',
    light: '#747c9e',
    roughness: 0.15,
    metalness: 0.32,
    contrast: 1.3,
    glow: 0.04
  }
];

export function createBaseComparison(base, { showPanel = false } = {}) {
  // Apply the chosen Moonstone silhouette once. Material switches never move
  // the rock, snow or icicle vertices.
  base.traverse((mesh) => {
    if (!mesh.geometry) return;
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i),
        y = position.getY(i),
        z = position.getZ(i);
      const depth = THREE.MathUtils.clamp(-y / 6.6, 0, 1);
      const scale = 1 - 0.03 * THREE.MathUtils.smoothstep(depth, 0, 0.8);
      position.setXYZ(i, x * scale + 0.22 * depth * depth, y * 0.96, z * scale);
    }
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  });
  const original = base.material.colorNode;
  const dark = uniform(new THREE.Color()),
    light = uniform(new THREE.Color());
  const roughness = uniform(1),
    metalness = uniform(0),
    contrast = uniform(1),
    glow = uniform(0);
  const wash = original
    .dot(vec3(0.2126, 0.7152, 0.0722))
    .mul(2.2)
    .clamp(0, 1);
  const pigment = wash.sub(0.5).mul(contrast).add(0.5).clamp(0, 1);
  const edge = float(1)
    .sub(normalView.dot(positionViewDirection).abs())
    .clamp(0, 1)
    .pow(3);
  base.material.colorNode = mix(dark, light, pigment);
  base.material.roughnessNode = roughness;
  base.material.metalnessNode = metalness;
  base.material.emissiveNode = color('#b9dced').mul(edge).mul(glow);
  const panel = document.createElement('details');
  panel.className = 'base-comparison';
  panel.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Compare base materials';
  panel.append(summary);
  const choices = document.createElement('div');
  choices.className = 'base-choices';
  panel.append(choices);
  const note = document.createElement('p');
  note.setAttribute('aria-live', 'polite');
  panel.append(note);
  function select(version) {
    dark.value.set(version.dark);
    light.value.set(version.light);
    roughness.value = version.roughness;
    metalness.value = version.metalness;
    contrast.value = version.contrast;
    glow.value = version.glow;
    for (const button of choices.children)
      button.setAttribute(
        'aria-pressed',
        String(button.textContent === version.name)
      );
    note.textContent = version.note;
  }
  for (const version of versions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = version.name;
    button.style.setProperty('--swatch', version.light);
    button.addEventListener('click', () => select(version));
    choices.append(button);
  }
  select(versions.find((version) => version.name === 'Frosted ice'));
  if (showPanel) document.body.append(panel);
  return { select, versions };
}

import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  dot,
  mix,
  output,
  positionLocal,
  sin,
  smoothstep,
  vec3,
  vec4
} from 'three/tsl';

// Painted vertex colors with three soft cel-lighting bands, like the foliage.
// Upper stems and cups bob together; zero root weights keep each plant planted.
export function createFlowerMaterial(clock) {
  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(0.75, 0.75, 0.75),
    side: THREE.DoubleSide
  });
  const light = dot(output.rgb, vec3(0.2126, 0.7152, 0.0722));
  const shade = mix(
    mix(0.56, 0.8, smoothstep(0.28, 0.4, light)),
    1,
    smoothstep(0.85, 0.95, light)
  );
  material.outputNode = vec4(attribute('color', 'vec3').mul(shade), output.a);
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar(),
      weight = attribute('flowerWeight', 'float'),
      phase = attribute('flowerPhase', 'float');
    p.x.addAssign(sin(clock.mul(1.25).add(phase)).mul(0.02).mul(weight));
    p.y.addAssign(
      sin(clock.mul(1.7).add(phase.mul(0.73)))
        .mul(0.014)
        .mul(weight)
    );
    p.z.addAssign(sin(clock.mul(1.05).add(phase)).mul(0.014).mul(weight));
    return p;
  })();
  return material;
}

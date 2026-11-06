import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  dFdx,
  dFdy,
  dot,
  exp,
  floor,
  fract,
  fwidth,
  hash,
  mix,
  positionLocal,
  screenUV,
  smoothstep,
  step,
  uint,
  uniform,
  sin,
  cos,
  varying,
  vec2,
  vec3
} from 'three/tsl';

// A sky made entirely from math: soft stellar clouds, branching dark dust,
// and tiny stars. No photographs, generated bitmap, or external textures.
const noise = Fn(([p]) => {
  const cell = floor(p).toVar(),
    f = fract(p).toVar(),
    blend = f
      .mul(f)
      .mul(vec2(3).sub(f.mul(2)))
      .toVar();
  const seed = uint(cell.x.toInt())
    .mul(1597)
    .add(uint(cell.y.toInt()).mul(5171))
    .add(1729)
    .toVar();
  return mix(
    mix(hash(seed), hash(seed.add(1597)), blend.x),
    mix(hash(seed.add(5171)), hash(seed.add(6768)), blend.x),
    blend.y
  );
}).setLayout({
  name: 'galaxyNoise',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec2' }]
});

const field = Fn(([p]) =>
  noise(p)
    .mul(0.55)
    .add(noise(p.mul(2.13).add(vec2(17.3, 8.7))).mul(0.29))
    .add(noise(p.mul(4.37).add(vec2(38.1, 23.4))).mul(0.16))
).setLayout({
  name: 'galaxyField',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec2' }]
});

const stars = Fn(([p, density]) => {
  const cell = floor(p).toVar(),
    f = fract(p).toVar();
  const seed = uint(cell.x.toInt())
    .mul(1031)
    .add(uint(cell.y.toInt()).mul(3137))
    .add(9337)
    .toVar();
  const random = hash(seed),
    center = vec2(hash(seed.add(41)), hash(seed.add(127)))
      .mul(0.7)
      .add(0.15);
  // Give subpixel stars a softly filtered footprint instead of letting them
  // disappear between samples. The small core stays fine as the view changes.
  const pixel = fwidth(p).length().max(0.001).toVar(),
    aa = pixel.mul(0.42);
  const radius = hash(seed.add(271)).mul(0.105).add(0.045).max(pixel.mul(0.24));
  // Measure the radial footprint in screen space using the inverse local
  // projection. A circle therefore stays round on tilted celestial planes.
  const dx = dFdx(p).toVar(),
    dy = dFdy(p).toVar(),
    delta = f.sub(center).toVar();
  const determinant = abs(dx.x.mul(dy.y).sub(dx.y.mul(dy.x)))
    .max(0.000001)
    .toVar();
  const screenDelta = vec2(
    delta.x.mul(dy.y).sub(delta.y.mul(dy.x)),
    dx.x.mul(delta.y).sub(dx.y.mul(delta.x))
  ).div(determinant);
  const distance = screenDelta.length().mul(determinant.sqrt());
  const point = vec2(1).x.sub(
    smoothstep(radius.sub(aa.mul(0.5)), radius.add(aa), distance)
  );
  return point
    .mul(step(density, random))
    .mul(hash(seed.add(719)).pow(2).mul(0.85).add(0.12));
}).setLayout({
  name: 'galaxyStars',
  type: 'float',
  inputs: [
    { name: 'p', type: 'vec2' },
    { name: 'density', type: 'float' }
  ]
});

export function createGalaxy(scene, camera, { mobile = false } = {}) {
  // Fixed celestial basis: the band's diagonal rises from lower left to upper
  // right in the initial view, then turns naturally as the viewer orbits.
  const right = new THREE.Vector3(0.831, 0, -0.556).normalize();
  const up = new THREE.Vector3(-0.172, 0.951, -0.257).normalize();
  const normal = new THREE.Vector3().crossVectors(right, up).normalize();
  const skyTurn = uniform(0),
    cloudTint = uniform(new THREE.Vector3(0.105, 0.115, 0.137)),
    rimTint = uniform(new THREE.Vector3(0.017, 0.014, 0.03));
  const horizonTint = uniform(new THREE.Vector3(0.02, 0.032, 0.05)),
    zenithTint = uniform(new THREE.Vector3(0.003, 0.006, 0.012));
  const raw = varying(positionLocal).normalize();
  const direction = vec3(
    raw.x.mul(cos(skyTurn)).sub(raw.z.mul(sin(skyTurn))),
    raw.y,
    raw.x.mul(sin(skyTurn)).add(raw.z.mul(cos(skyTurn)))
  );
  const u = dot(direction, vec3(right.x, right.y, right.z));
  const v = dot(direction, vec3(up.x, up.y, up.z));
  const n = dot(direction, vec3(normal.x, normal.y, normal.z));
  const coords = vec2(u, v);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  });
  material.colorNode = Fn(() => {
    // Preserve the original face-on pattern, but wrap cloud detail onto
    // orthogonal planes before a grazing projection stretches it into lines.
    const weights = vec3(abs(u), abs(v), abs(n)).pow(12).toVar();
    const total = weights.x.add(weights.y).add(weights.z).max(0.000001).toVar();
    const grazing = vec2(1)
      .x.sub(smoothstep(0.35, 0.65, abs(n)))
      .toVar();
    const skySample = (sample, scale, offset = vec2(0)) => {
      // Phones avoid the deeply expanded three-octave, three-plane graph.
      // Keep the same cloud coordinates and smooth wrapping around the dome.
      if (mobile) sample = noise;
      const original = sample(coords.mul(scale).add(offset)).toVar();
      const result = original.toVar();
      // Most directions use the original plane only. Avoid evaluating both
      // invisible side projections at every pixel; blend them near the rim.
      If(grazing.greaterThan(0), () => {
        const wrapped = original
          .mul(weights.z)
          .add(
            sample(
              vec2(v, n).mul(scale).add(offset).add(vec2(101.3, 43.7))
            ).mul(weights.x)
          )
          .add(
            sample(vec2(n, u).mul(scale).add(offset).add(vec2(37.1, 81.9))).mul(
              weights.y
            )
          )
          .div(total);
        result.assign(mix(original, wrapped, grazing));
      });
      return result;
    };
    const warp = skySample(field, 9, vec2(7.1, 2.9)).sub(0.5);
    const across = v.sub(u.mul(0.43)).sub(0.105).add(warp.mul(0.045)).toVar();
    const broad = exp(across.mul(across).mul(-125)).toVar();
    const belt = exp(across.mul(across).mul(-440)).toVar();
    const cloud = skySample(field, 39, vec2(8.7, 21.4));
    const detail = skySample(noise, 170, vec2(3.1, 9.8));
    const grain = skySample(noise, 621, vec2(16.8, 71.2));
    const ridge = skySample(field, vec2(25, 9), vec2(51.2, 8.4)).sub(0.5);
    const breaks = skySample(field, 82, vec2(73.1, 5.8));
    const rift = vec2(1).x.sub(
      smoothstep(
        0.002,
        0.012,
        abs(
          across
            .add(ridge.mul(0.055))
            .add(detail.sub(0.5).mul(0.014))
            .add(0.005)
        )
      )
    );
    const branch = vec2(1).x.sub(
      smoothstep(
        0.001,
        0.007,
        abs(
          across
            .add(u.mul(0.055))
            .sub(0.027)
            .add(ridge.mul(0.03))
            .add(grain.sub(0.5).mul(0.006))
        )
      )
    );
    const twigs = vec2(1).x.sub(
      smoothstep(
        0.001,
        0.005,
        abs(across.sub(u.mul(0.13)).add(0.033).add(ridge.mul(0.04)))
      )
    );
    const patch = smoothstep(
      0.55,
      0.74,
      skySample(field, 68, vec2(29.4, 31.8))
    );
    const dust = rift
      .mul(mix(0.12, 0.64, smoothstep(0.3, 0.68, breaks)))
      .add(branch.mul(0.32).mul(breaks))
      .add(twigs.mul(0.2).mul(detail))
      .add(patch.mul(0.36))
      .clamp(0, 0.86);
    const texture = smoothstep(
      0.15,
      0.85,
      cloud.mul(0.4).add(detail.mul(0.28)).add(grain.mul(0.32))
    );
    const glow = belt.mul(texture.mul(0.8).add(0.13)).mul(vec2(1).x.sub(dust));
    const haze = broad.mul(0.009).mul(skySample(field, 18).mul(0.65).add(0.35));
    const cool = vec3(0.2, 0.25, 0.38).mul(haze);
    const warm = mix(
      cloudTint,
      rimTint.mul(4),
      smoothstep(0.25, 0.8, cloud)
    ).mul(glow);
    const fringe = rimTint.mul(broad).mul(vec2(1).x.sub(belt));
    // Blend three orthogonal stellar fields. A grazing plane fades out before
    // its coordinates collapse into streaks; the initial view keeps its field.
    const starField = (scale, offset, density) => {
      const result = vec2(0).x.toVar();
      If(weights.z.greaterThan(0.002), () => {
        result.addAssign(
          stars(coords.mul(scale).add(offset), density).mul(weights.z)
        );
      });
      If(weights.x.greaterThan(0.002), () => {
        result.addAssign(
          stars(
            vec2(v, n).mul(scale).add(offset).add(vec2(101.3, 43.7)),
            density
          ).mul(weights.x)
        );
      });
      If(weights.y.greaterThan(0.002), () => {
        result.addAssign(
          stars(
            vec2(n, u).mul(scale).add(offset).add(vec2(37.1, 81.9)),
            density
          ).mul(weights.y)
        );
      });
      return result.div(total);
    };
    const micro = starField(690, vec2(0), mix(0.977, 0.918, belt)).mul(
      mix(0.65, 1, belt)
    );
    const fine = mobile
      ? vec2(0).x
      : starField(1330, vec2(33.7, 11.2), mix(0.993, 0.964, belt)).mul(0.48);
    const starTint = mix(
      vec3(0.78, 0.86, 1),
      vec3(0.94, 0.95, 1),
      skySample(noise, 550)
    );
    // The Milky Way owns the complete opaque sky, including its night color.
    // Keep the former composite's quiet contrast without a CSS layer beneath it.
    const night = mix(horizonTint, zenithTint, smoothstep(0, 1, screenUV.y));
    // Five fixed stars share the surrounding field's tint and exposure.
    // Keep all five in the front sky and within the allowed orbit elevations.
    // Wide desktop views show the full arrangement; narrow views can orbit to it.
    const forward = new THREE.Vector3(-18.25, -11.94, -27.32).normalize();
    const beacons = [
      [-0.32, 0.12, 1],
      [-0.19, 0.16, 0.78],
      [0.02, 0.18, 0.7],
      [0.25, 0.14, 0.67],
      [0.34, -0.12, 0.82]
    ].map(([x, y, strength]) => [
      ...forward
        .clone()
        .addScaledVector(right, x)
        .addScaledVector(up, y)
        .normalize()
        .toArray(),
      strength
    ]);
    let beaconLight = vec2(0).x;
    for (const [x, y, z, strength] of beacons) {
      const pole = vec3(x, y, z).normalize();
      const delta = direction.sub(pole).toVar();
      const radiusSquared = dot(delta, delta).toVar();
      const px = dot(delta, vec3(right.x, right.y, right.z))
        .pow(2)
        .toVar();
      const py = dot(delta, vec3(up.x, up.y, up.z))
        .pow(2)
        .toVar();
      const core = exp(radiusSquared.mul(-1000000)).mul(1.35);
      const halo = exp(radiusSquared.mul(-55000)).mul(0.07);
      const rays = exp(px.mul(-9000000).add(py.mul(-17000)))
        .add(exp(py.mul(-9000000).add(px.mul(-27000))))
        .mul(0.045)
        .mul(smoothstep(0.98, 0.999, dot(direction, pole)));
      beaconLight = beaconLight.add(core.add(halo).add(rays).mul(strength));
    }
    const northStar = starTint.mul(beaconLight);
    return night.add(
      cool
        .add(warm)
        .add(fringe)
        .add(starTint.mul(micro.add(fine)))
        .add(northStar)
        .mul(0.55)
    );
  })();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), material);
  // Draw after opaque island geometry so covered pixels can fail depth testing
  // before running this expensive sky shader. Transparent ice still draws last.
  dome.name = 'Procedural Milky Way';
  dome.frustumCulled = false;
  dome.renderOrder = 1000;
  scene.add(dome);
  const update = () => dome.position.copy(camera.position);
  update();
  const keys = [
    [
      0,
      [0.12, 0.2, 0.3],
      [0.016, 0.038, 0.065],
      [0.014, 0.03, 0.05],
      [0.003, 0.007, 0.016]
    ],
    [
      2,
      [0.105, 0.115, 0.137],
      [0.017, 0.022, 0.03],
      [0.02, 0.032, 0.05],
      [0.003, 0.006, 0.012]
    ],
    [
      6,
      [0.3, 0.35, 0.38],
      [0.058, 0.076, 0.09],
      [0.035, 0.046, 0.057],
      [0.008, 0.012, 0.02]
    ],
    [
      12,
      [0.19, 0.38, 0.4],
      [0.025, 0.075, 0.09],
      [0.023, 0.06, 0.08],
      [0.003, 0.012, 0.023]
    ],
    [
      18,
      [0.12, 0.32, 0.38],
      [0.018, 0.07, 0.085],
      [0.016, 0.043, 0.06],
      [0.003, 0.01, 0.02]
    ],
    [
      22,
      [0.15, 0.25, 0.4],
      [0.02, 0.047, 0.085],
      [0.018, 0.034, 0.06],
      [0.003, 0.007, 0.018]
    ],
    [
      24,
      [0.12, 0.2, 0.3],
      [0.016, 0.038, 0.065],
      [0.014, 0.03, 0.05],
      [0.003, 0.007, 0.016]
    ]
  ];
  function setTime(minutes) {
    const hour = (((minutes / 60) % 24) + 24) % 24;
    let i = 0;
    while (i < keys.length - 2 && hour >= keys[i + 1][0]) i++;
    const a = keys[i],
      b = keys[i + 1];
    let t = (hour - a[0]) / (b[0] - a[0]);
    t = t * t * (3 - 2 * t);
    [cloudTint, rimTint, horizonTint, zenithTint].forEach((u, j) =>
      u.value.set(...a[j + 1]).lerp(new THREE.Vector3(...b[j + 1]), t)
    );
    skyTurn.value = ((hour - 2) / 24) * Math.PI * 2;
  }
  setTime(120);
  return { dome, update, setTime };
}

import * as THREE from 'three/webgpu';

// Stylized, texture-free Amur adonis: a rounded champagne-gold cup, clear
// pollen beads and bold divided foliage in the meadow's cool sage palette.
export function createAdonisGeometry(seed = 19271) {
  const positions = [],
    colors = [],
    indices = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const C = (hex) => new THREE.Color(hex);
  const green = C('#78999d'),
    leafLight = C('#b1c7bf'),
    leafDark = C('#5e818d');
  const stemColor = C('#587a8d'),
    gold = C('#bea463'),
    goldTip = C('#dfc98d'),
    goldBase = C('#8e7447');
  const p = new THREE.Vector3(),
    tint = new THREE.Color();

  function surface(rows, columns, point, colorAt) {
    const base = positions.length / 3;
    for (let row = 0; row <= rows; row++)
      for (let column = 0; column <= columns; column++) {
        const t = row / rows,
          s = (column / columns) * 2 - 1;
        point(t, s, p);
        positions.push(p.x, p.y, p.z);
        const c = typeof colorAt === 'function' ? colorAt(t, s) : colorAt;
        colors.push(c.r, c.g, c.b);
      }
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const a = base + row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }

  function append(geometry, center, scale, c) {
    const base = positions.length / 3,
      a = geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).multiply(scale).add(center);
      positions.push(p.x, p.y, p.z);
      colors.push(c.r, c.g, c.b);
    }
    if (geometry.index)
      for (const index of geometry.index.array) indices.push(base + index);
    else for (let i = 0; i < a.count; i++) indices.push(base + i);
    geometry.dispose();
  }

  function tube(points, radius, c, segments = 8, sides = 5) {
    append(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        segments,
        radius,
        sides,
        false
      ),
      V(0, 0, 0),
      V(1, 1, 1),
      c
    );
  }
  function bead(center, size, c, segments = 6, rings = 4) {
    append(new THREE.SphereGeometry(1, segments, rings), center, size, c);
  }
  function leaflet(start, end, width, c) {
    const direction = end.clone().sub(start),
      side = V(-direction.z, 0, direction.x).normalize();
    surface(
      3,
      2,
      (t, s, out) => {
        const span = Math.pow(Math.sin(Math.PI * t), 0.7) * width * s;
        out
          .copy(start)
          .addScaledVector(direction, t)
          .addScaledVector(side, span);
        out.y += Math.sin(Math.PI * t) * (0.008 + 0.007 * (1 - s * s));
      },
      (t, s) => tint.copy(c).lerp(leafLight, (1 - Math.abs(s)) * 0.18 + t * 0.1)
    );
  }

  const bloom = V(0.023, 0.597, -0.012);
  tube(
    [V(0, 0, 0), V(-0.014, 0.19, 0.008), V(0.012, 0.4, 0.002), bloom],
    0.015,
    stemColor,
    13,
    7
  );
  // Young Adonis leaves are only partly expanded at flowering. Three low,
  // triangular fronds carry secondary pinnae and narrow terminal segments.
  for (let frond = 0; frond < 3; frond++) {
    const a = 0.45 + (frond * Math.PI * 2) / 3 + (random() - 0.5) * 0.24;
    const forward = V(Math.cos(a), 0, Math.sin(a)),
      side = V(-Math.sin(a), 0, Math.cos(a));
    const root = V(0, 0.115 + frond * 0.078, 0),
      length = 0.27 + random() * 0.045;
    const end = root.clone().addScaledVector(forward, length);
    end.y += 0.115;
    const rachis = (t) =>
      root
        .clone()
        .lerp(end, t)
        .add(V(0, Math.sin(t * Math.PI) * 0.022, 0));
    tube([root, rachis(0.5), end], 0.0045, green, 7, 4);
    for (let tier = 0; tier < 3; tier++)
      for (const sign of [-1, 1]) {
        const t = 0.23 + tier * 0.24,
          start = rachis(t);
        const span = (0.11 - tier * 0.018) * (1 + (random() - 0.5) * 0.1);
        const tip = start
          .clone()
          .addScaledVector(side, span * sign)
          .addScaledVector(forward, 0.037);
        tip.y += 0.013;
        tube(
          [
            start,
            start
              .clone()
              .lerp(tip, 0.55)
              .add(V(0, 0.007, 0)),
            tip
          ],
          0.0026,
          green,
          3,
          3
        );
        for (let lobe = 0; lobe < 2; lobe++) {
          const along = 0.32 + lobe * 0.34,
            base = start.clone().lerp(tip, along);
          const reach = (0.065 - lobe * 0.009) * (1 - tier * 0.07);
          const lobeEnd = base
            .clone()
            .addScaledVector(forward, reach)
            .addScaledVector(side, sign * 0.025);
          lobeEnd.y += 0.014;
          leaflet(
            base,
            lobeEnd,
            0.016 + random() * 0.003,
            frond === 1 ? leafDark : green
          );
        }
        leaflet(
          start.clone().lerp(tip, 0.7),
          tip.clone().addScaledVector(side, sign * 0.028),
          0.016,
          green
        );
      }
    leaflet(
      rachis(0.76),
      end.clone().addScaledVector(forward, 0.035),
      0.014,
      green
    );
  }

  // Protective brown-green scales and a small calyx beneath the cup.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    leaflet(
      V(0, 0.025, 0),
      V(Math.cos(a) * 0.055, 0.17, Math.sin(a) * 0.055),
      0.021,
      C('#778b91')
    );
    const radial = V(Math.cos(a), 0, Math.sin(a)),
      side = V(-Math.sin(a), 0, Math.cos(a));
    surface(
      5,
      2,
      (t, s, out) => {
        out
          .copy(bloom)
          .addScaledVector(radial, 0.02 + t * 0.115)
          .addScaledVector(side, s * Math.sin(t * Math.PI) * 0.026);
        out.y -= 0.025 + t * 0.025;
      },
      C('#8ca99d')
    );
  }

  // Seven outer and five smaller inner petals form a simple, open cup. Their
  // edges turn upward, and a shallow central fold catches the winter light.
  for (let ring = 0; ring < 2; ring++) {
    const count = ring ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const a =
        (i / count) * Math.PI * 2 +
        (ring ? 0.34 : 0) +
        (random() - 0.5) * 0.075;
      const radial = V(Math.cos(a), 0, Math.sin(a)),
        side = V(-Math.sin(a), 0, Math.cos(a));
      const length = (ring ? 0.174 : 0.219) * (0.96 + random() * 0.08),
        width = ring ? 0.066 : 0.078;
      const lift = ring ? 0.112 : 0.084,
        variation = (random() - 0.5) * 0.018;
      surface(
        8,
        4,
        (t, s, out) => {
          const profile =
            Math.pow(Math.sin(Math.PI * t), 0.48) * (0.72 + 0.28 * t);
          out
            .copy(bloom)
            .addScaledVector(radial, 0.042 + t * length)
            .addScaledVector(side, s * width * profile);
          out.y +=
            t * t * lift +
            Math.sin(t * Math.PI) * (0.009 + 0.021 * s * s) +
            variation * t;
        },
        (t, s) =>
          tint
            .copy(t < 0.22 ? goldBase : t < 0.78 ? gold : goldTip)
            .lerp(goldTip, Math.pow(Math.abs(s), 3) * 0.14)
      );
    }
  }

  // Central, greenish carpels surrounded by many slender golden filaments.
  bead(
    bloom.clone().add(V(0, 0.034, 0)),
    V(0.053, 0.039, 0.053),
    C('#9ba483'),
    8,
    4
  );
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399963,
      r = 0.033 * Math.sqrt((i + 0.5) / 7);
    bead(
      bloom
        .clone()
        .add(V(Math.cos(a) * r, 0.062 + random() * 0.012, Math.sin(a) * r)),
      V(0.014, 0.017, 0.014),
      C('#b4ba8d'),
      5,
      3
    );
  }
  for (let i = 0; i < 20; i++) {
    const a = i * 2.399963,
      r = 0.058 + random() * 0.032;
    const start = bloom
      .clone()
      .add(V(Math.cos(a) * r * 0.72, 0.012, Math.sin(a) * r * 0.72));
    const top = bloom
      .clone()
      .add(V(Math.cos(a) * r, 0.065 + random() * 0.031, Math.sin(a) * r));
    tube(
      [start, start.clone().lerp(top, 0.5), top],
      0.0033,
      C('#c5b77e'),
      2,
      3
    );
    bead(
      top,
      V(0.014, 0.016, 0.011),
      i % 3 ? C('#e4d59d') : C('#cdb87a'),
      5,
      3
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'Stylized Adonis amurensis — champagne cup and sage foliage';
  geometry.userData = { species: 'Adonis amurensis', petals: 12 };
  return geometry;
}

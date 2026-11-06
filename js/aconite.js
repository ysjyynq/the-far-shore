import * as THREE from 'three/webgpu';

// Eranthis hyemalis 'Schwefelglanz': six pale sulphur-yellow cup segments
// above a divided leafy ruff. Broad painted forms keep the little flower clear.
export function createAconiteGeometry(seed = 19271) {
  const positions = [],
    colors = [],
    indices = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z),
    C = (hex) => new THREE.Color(hex);
  const leaf = C('#7c9d9e'),
    leafLight = C('#abc2bd'),
    stem = C('#6f9099');
  const cream = C('#dfd8a4'),
    creamLight = C('#ece6c2'),
    creamShade = C('#aaa677');
  const p = V(0, 0, 0),
    tint = new THREE.Color();
  function surface(rows, columns, point, colorAt) {
    const base = positions.length / 3;
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= columns; c++) {
        const t = r / rows,
          s = (c / columns) * 2 - 1;
        point(t, s, p);
        positions.push(p.x, p.y, p.z);
        const color = typeof colorAt === 'function' ? colorAt(t, s) : colorAt;
        colors.push(color.r, color.g, color.b);
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < columns; c++) {
        const a = base + r * (columns + 1) + c,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  function append(g, c) {
    const base = positions.length / 3,
      a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      positions.push(a.getX(i), a.getY(i), a.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    if (g.index) for (const index of g.index.array) indices.push(base + index);
    else for (let i = 0; i < a.count; i++) indices.push(base + i);
    g.dispose();
  }
  function bead(center, size, color) {
    const g = new THREE.SphereGeometry(1, 6, 4);
    g.scale(size.x, size.y, size.z);
    g.translate(center.x, center.y, center.z);
    append(g, color);
  }
  function tube(points, radius, color, segments = 8) {
    append(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        segments,
        radius,
        6,
        false
      ),
      color
    );
  }
  const bloom = V(0.025, 0.505, 0.008);
  tube(
    [V(0, 0, 0), V(-0.016, 0.18, 0.012), V(0.005, 0.36, -0.008), bloom],
    0.014,
    stem,
    12
  );
  // Three finger-like lobes on each of three bracts form the collar. They are
  // distinctly broader than Adonis's fern-like foliage.
  function lobedLeaf(start, angle, length, width, drop) {
    const radial = V(Math.cos(angle), 0, Math.sin(angle)),
      side = V(-Math.sin(angle), 0, Math.cos(angle));
    surface(
      9,
      4,
      (t, s, out) => {
        const fingers = 0.72 + 0.28 * Math.cos(t * Math.PI * 5);
        const span = Math.pow(Math.sin(Math.PI * t), 0.6) * width * fingers;
        out
          .copy(start)
          .addScaledVector(radial, t * length)
          .addScaledVector(side, s * span);
        out.y +=
          Math.sin(Math.PI * t) * 0.025 - t * t * drop + 0.009 * (1 - s * s);
      },
      (t, s) =>
        tint
          .copy(leaf)
          .lerp(leafLight, t < 0.68 ? 0.18 : 0.55)
          .lerp(stem, Math.abs(s) * 0.12)
    );
    for (const sign of [-1, 1]) {
      const branch = start.clone().addScaledVector(radial, length * 0.36);
      const bearing = angle + sign * 0.52,
        r = V(Math.cos(bearing), 0, Math.sin(bearing)),
        q = V(-Math.sin(bearing), 0, Math.cos(bearing));
      surface(
        6,
        2,
        (t, s, out) => {
          out
            .copy(branch)
            .addScaledVector(r, t * length * 0.61)
            .addScaledVector(q, s * Math.sin(Math.PI * t) * width * 0.49);
          out.y += Math.sin(Math.PI * t) * 0.015 - t * t * drop;
        },
        (t, s) => tint.copy(leaf).lerp(leafLight, 0.2 + t * 0.25)
      );
    }
  }
  for (let i = 0; i < 3; i++)
    lobedLeaf(
      bloom.clone().add(V(0, -0.037, 0)),
      (i * Math.PI * 2) / 3 + 0.35,
      0.195,
      0.054,
      0.055
    );
  for (let i = 0; i < 2; i++) {
    const angle = i * Math.PI + 0.8,
      start = V(0, 0.025, 0);
    tube(
      [
        start,
        V(Math.cos(angle) * 0.07, 0.09, Math.sin(angle) * 0.07),
        V(Math.cos(angle) * 0.12, 0.13, Math.sin(angle) * 0.12)
      ],
      0.0055,
      stem,
      6
    );
    lobedLeaf(
      V(Math.cos(angle) * 0.12, 0.13, Math.sin(angle) * 0.12),
      angle,
      0.15,
      0.046,
      0.025
    );
  }
  // Six rounded sepals make an open, upward-facing cup. The soft central fold
  // and stepped cream tones catch light without requiring an image texture.
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + 0.12 + (random() - 0.5) * 0.055;
    const radial = V(Math.cos(angle), 0, Math.sin(angle)),
      side = V(-Math.sin(angle), 0, Math.cos(angle));
    const length = 0.172 + random() * 0.012,
      lift = 0.091 + random() * 0.013;
    surface(
      10,
      6,
      (t, s, out) => {
        const width =
          0.088 *
          Math.sqrt(Math.max(0, Math.sin(Math.PI * t))) *
          (0.72 + 0.28 * t);
        out
          .copy(bloom)
          .addScaledVector(radial, 0.021 + t * length)
          .addScaledVector(side, s * width);
        out.y += lift * t * t + 0.016 * Math.sin(Math.PI * t) * s * s;
      },
      (t, s) =>
        tint
          .copy(t < 0.23 ? creamShade : t < 0.76 ? cream : creamLight)
          .lerp(creamLight, 0.12 * Math.abs(s))
    );
  }
  bead(bloom.clone().add(V(0, 0.018, 0)), V(0.048, 0.028, 0.048), C('#b5bb94'));
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.39996,
      r = 0.035 + random() * 0.025;
    const top = bloom
      .clone()
      .add(
        V(Math.cos(angle) * r, 0.052 + random() * 0.018, Math.sin(angle) * r)
      );
    tube(
      [
        bloom
          .clone()
          .add(V(Math.cos(angle) * r * 0.5, 0.014, Math.sin(angle) * r * 0.5)),
        top
      ],
      0.0028,
      C('#c7bb8c'),
      2
    );
    bead(top, V(0.011, 0.012, 0.01), i % 3 ? C('#e2d5a1') : C('#c9b47d'));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name =
    "Stylized Eranthis hyemalis 'Schwefelglanz' — sulphur cup and leaf ruff";
  g.userData = {
    species: 'Eranthis hyemalis',
    cultivar: 'Schwefelglanz',
    sepals: 6
  };
  return g;
}

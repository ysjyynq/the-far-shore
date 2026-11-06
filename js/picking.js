import * as THREE from 'three/webgpu';

// Conservative spatial tree: keeps native triangle/UV hits and alpha picking.
// Bounds include the full allowed spring excursion; no per-frame rebuild.
export function acceleratePicking(mesh, padding = 0) {
  const g = mesh.geometry,
    index = g.index,
    position = g.attributes.position;
  if (
    !index ||
    Array.isArray(mesh.material) ||
    index.count < 600 ||
    g.drawRange.start !== 0 ||
    g.drawRange.count < index.count
  )
    return;
  const triangles = [],
    v = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const bounds = new THREE.Box3();
    for (let j = 0; j < 3; j++)
      bounds.expandByPoint(v.fromBufferAttribute(position, index.getX(i + j)));
    triangles.push({
      indices: [index.getX(i), index.getX(i + 1), index.getX(i + 2)],
      bounds,
      center: bounds.getCenter(new THREE.Vector3())
    });
  }
  const ordered = [];
  function build(items) {
    const box = new THREE.Box3();
    for (const t of items) box.union(t.bounds);
    const node = { box: box.clone().expandByScalar(padding) };
    if (items.length <= 64) {
      node.start = ordered.length;
      for (const t of items) ordered.push(...t.indices);
      node.count = ordered.length - node.start;
      return node;
    }
    const size = box.getSize(new THREE.Vector3()),
      axis =
        size.x > size.y
          ? size.x > size.z
            ? 'x'
            : 'z'
          : size.y > size.z
            ? 'y'
            : 'z';
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = items.length >> 1;
    node.left = build(items.slice(0, mid));
    node.right = build(items.slice(mid));
    return node;
  }
  const tree = build(triangles);
  g.setIndex(ordered);
  const original = mesh.raycast,
    inverse = new THREE.Matrix4(),
    ray = new THREE.Ray();
  mesh.raycast = function (raycaster, hits) {
    inverse.copy(this.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inverse);
    const start = g.drawRange.start,
      count = g.drawRange.count;
    const visit = (node) => {
      if (!ray.intersectsBox(node.box)) return;
      if (node.left) {
        visit(node.left);
        visit(node.right);
      } else {
        g.setDrawRange(node.start, node.count);
        original.call(this, raycaster, hits);
      }
    };
    try {
      visit(tree);
    } finally {
      g.setDrawRange(start, count);
    }
  };
}

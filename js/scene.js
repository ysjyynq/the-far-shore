import { createTimeDial } from './time-dial.js';
import { createPickSchedule } from './interaction-schedule.js';
import { createFPSMeter } from './performance.js';
import { createDesktopResolution } from './desktop-resolution.js';
import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  attribute,
  positionLocal,
  uv,
  vec3,
  sin,
  cos,
  mix,
  color,
  texture,
  smoothstep,
  varying
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPool, createGroundGeometry, isGrassAllowed } from './pool.js';
import { createFrostParticles } from './frost.js';
import { loadWeepingWillow, isWillowFootprint } from './willow-model.js';
import { createBushes, isBushFootprint } from './bushes.js';
import { createGalaxy } from './galaxy.js';
import { createIslandBase } from './island-base.js';
import { createBaseComparison } from './base-comparison.js';

import {
  createFlowers,
  isFlowerFootprint,
  flowerGrassScale
} from './flowers.js';

// Crossed alpha-cutout tufts follow fidel3ng's scene, adapted from FluffyGrass
// (MIT, Ebenezer). Colors use Just a Simple Tree's frost crown palette.
// Wind and interaction run in TSL.
const $ = (id) => document.getElementById(id);
const RADIUS = 6.5;
const TUFTS = 1500;
const clock = uniform(0);
const wind = uniform(0.65);
const moonlight = uniform(1);
let renderer,
  scene,
  camera,
  controls,
  grass,
  flies,
  pool,
  frost,
  willow,
  bushes,
  galaxy;
let foliagePlants = [],
  mobileQuality = false,
  skyTimeDial,
  desktopResolution;
const pickSchedule = createPickSchedule(),
  cachedPickPoint = new THREE.Vector3();
let cachedPickKind = null,
  cachedPickOwner = null;
const paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0,
  previous = performance.now(),
  zoomTargetDistance = 35;
let pinchZoomActive = false,
  zoomMomentum = 0,
  lastPinchTime = 0;
const touchOrbitPending = new THREE.Vector2();
const touchOrbitSpherical = new THREE.Spherical(),
  touchOrbitOffset = new THREE.Vector3();
const interaction = {
  active: false,
  brushing: false,
  dragging: false,
  mouseInside: false,
  crownGrab: null,
  owner: null,
  strength: 0,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  screen: new THREE.Vector2()
};
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const grassPickBox = new THREE.Box3(),
  grassPickPoint = new THREE.Vector3(),
  brushMotion = new THREE.Vector3(),
  crownPickNormal = new THREE.Vector3();
let tuftPositions,
  bendAttribute,
  grassRecovery = 0;
const bendVelocity = new Float32Array(TUFTS * 3);
const bendTargets = new Float32Array(TUFTS * 3),
  tuftPressure = new Float32Array(TUFTS);
let randomSeed = 81277;
function random() {
  randomSeed = (Math.imul(1664525, randomSeed) + 1013904223) >>> 0;
  return randomSeed / 4294967296;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,.95)');
  g.addColorStop(0.3, 'rgba(255,255,255,.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createPlatform(options) {
  const islandBase = createIslandBase(scene, options);
  createBaseComparison(islandBase);
  const groundMaterial = new THREE.MeshBasicNodeMaterial();
  groundMaterial.colorNode = color('#829bb0').mul(moonlight.mul(0.5).add(0.25));
  const ground = new THREE.Mesh(createGroundGeometry(), groundMaterial);
  ground.position.y = 0.001;
  scene.add(ground);
}

function createGrass(alpha, noise) {
  const positions = [],
    uvs = [],
    indices = [];
  // Three intersecting vertical cards, subdivided so tips bend while roots hold.
  for (let card = 0; card < 3; card++) {
    const a = (card * Math.PI) / 3,
      base = positions.length / 3;
    for (let row = 0; row <= 4; row++) {
      const v = row / 4;
      for (let side = 0; side < 2; side++) {
        const x = (side - 0.5) * 0.55;
        positions.push(x * Math.cos(a), v * 0.5, x * Math.sin(a));
        uvs.push(side, v);
      }
      if (row < 4) {
        const k = base + row * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const offsets = new Float32Array(TUFTS * 3),
    params = new Float32Array(TUFTS * 4);
  for (let i = 0; i < TUFTS; i++) {
    let x, z;
    do {
      const a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * (RADIUS - 0.3);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    } while (
      !isGrassAllowed(x, z) ||
      isWillowFootprint(x, z) ||
      isBushFootprint(x, z) ||
      isFlowerFootprint(x, z)
    );

    offsets.set([x, 0.007, z], i * 3);
    params.set(
      [
        (0.7 + random() * 0.7) * flowerGrassScale(x, z),
        random() * Math.PI,
        random(),
        random()
      ],
      i * 4
    );
  }
  tuftPositions = offsets;
  bendAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(TUFTS * 3),
    3
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('tuftBend', bendAttribute);
  geometry.setAttribute(
    'tuftOffset',
    new THREE.InstancedBufferAttribute(offsets, 3)
  );
  geometry.setAttribute(
    'tuftParams',
    new THREE.InstancedBufferAttribute(params, 4)
  );
  geometry.instanceCount = TUFTS;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0.3, 0),
    RADIUS + 1
  );
  const offset = attribute('tuftOffset', 'vec3'),
    paramsNode = attribute('tuftParams', 'vec4');
  const worldUV = offset.xz.div(RADIUS * 2).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    alphaTest: 0.15,
    alphaToCoverage: renderer.samples > 1
  });
  material.positionNode = Fn(() => {
    const p = positionLocal.mul(paramsNode.x).toVar();
    const x = p.x.mul(cos(paramsNode.y)).sub(p.z.mul(sin(paramsNode.y)));
    const z = p.x.mul(sin(paramsNode.y)).add(p.z.mul(cos(paramsNode.y)));
    const result = vec3(x, p.y, z).add(offset).toVar();
    const n = texture(noise, worldUV.add(clock.mul(0.001))).level(0);
    const sway = sin(
      worldUV.x.add(worldUV.y).mul(35.35).add(n.g.mul(5.5)).add(clock)
    )
      .mul(0.12)
      .mul(uv().y)
      .mul(wind);
    const flutter = sin(clock.mul(2.6).add(n.r.mul(12)))
      .mul(0.035)
      .mul(uv().y)
      .mul(wind);
    result.x.addAssign(sway.add(flutter));
    result.z.addAssign(sway.sub(flutter.mul(0.6)));
    result.addAssign(attribute('tuftBend', 'vec3').mul(uv().y.pow(1.5)));
    return result;
  })();
  const variation = texture(noise, varying(worldUV).mul(1.5)).r;
  // The crown's three colors: blue-gray shade, powder blue, snow-white light.
  const tip = mix(
    color('#bfd1dd'),
    color('#e4edf1'),
    variation.mul(0.65).add(0.35)
  );
  const blade = mix(
    color('#829bb0'),
    color('#bfd1dd'),
    smoothstep(0, 0.48, uv().y)
  );
  const frost = mix(blade, tip, smoothstep(0.25, 1, uv().y));
  const brightness = mix(0.83, 1, varying(paramsNode.z));
  const brushed = varying(attribute('tuftBend', 'vec3'))
    .xz.length()
    .div(0.65)
    .clamp(0, 1);
  material.colorNode = mix(frost, color('#829bb0'), brushed.mul(0.6))
    .mul(brightness)
    .mul(moonlight.mul(0.55).add(0.3));
  material.opacityNode = texture(alpha, uv()).r;
  grass = new THREE.Mesh(geometry, material);
  grass.frustumCulled = false;
  scene.add(grass);
}

const flyOrigins = [];
function createFireflies() {
  flies = new THREE.Group();
  const spriteMap = glowTexture();
  for (let i = 0; i < 48; i++) {
    const a = random() * Math.PI * 2,
      r = Math.sqrt(random()) * 6.8;
    flyOrigins.push([
      Math.cos(a) * r,
      0.35 + random() * 1.5,
      Math.sin(a) * r,
      random() * Math.PI * 2
    ]);
    const fly = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: spriteMap,
        color: '#e3f0f7',
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    fly.scale.setScalar(0.1 + random() * 0.045);
    flies.add(fly);
  }
  scene.add(flies);
}

// Pick the visible tuft envelope, including its height and current bend. The
// instanced TSL offsets are not represented by Three's default mesh raycast.
function pickPlant() {
  let nearest = null;
  for (const plant of foliagePlants) {
    const hit = plant.pick(raycaster);
    if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
  }
  return nearest;
}

function pickFoliage(target, immediate = false) {
  // Desktop grabs stay exact and immediate; cursor-only hover can use the
  // same bounded cadence as touch, including while orbit damping settles.
  if (!mobileQuality && (immediate || interaction.brushing))
    return pickFoliageNow(target);
  const p = camera.position,
    q = camera.quaternion;
  const key = [p.x, p.y, p.z, q.x, q.y, q.z, q.w].join(',');
  if (
    pickSchedule.due(
      performance.now(),
      interaction.screen.x,
      interaction.screen.y,
      key,
      String(interaction.brushing)
    )
  ) {
    cachedPickKind = pickFoliageNow(cachedPickPoint);
    cachedPickOwner = interaction.owner;
  }
  interaction.owner = cachedPickOwner;
  if (cachedPickKind) target.copy(cachedPickPoint);
  return cachedPickKind;
}

function pickFoliageNow(target) {
  raycaster.setFromCamera(interaction.screen, camera);
  const scales = grass.geometry.getAttribute('tuftParams').array,
    bends = bendAttribute.array;
  const plantHit = pickPlant();
  let nearest = (plantHit?.distance ?? Infinity) ** 2,
    kind = plantHit?.kind === 'crown' ? 'crown' : null,
    fallback = false;
  let owner = kind ? plantHit.owner : null;
  if (kind) target.copy(plantHit.point);
  // Follow fresh leaf hits across the whole crown. Bridge only tiny gaps beside
  // the last actual leaf; a fallback never moves that reference into empty sky.
  const grab = interaction.crownGrab;
  if (!plantHit && interaction.brushing && grab) {
    const pixels = Math.hypot(
      (interaction.screen.x - grab.screen.x) * innerWidth * 0.5,
      (interaction.screen.y - grab.screen.y) * innerHeight * 0.5
    );
    if (pixels <= 12 && raycaster.ray.intersectPlane(grab.plane, target)) {
      nearest = raycaster.ray.origin.distanceToSquared(target);
      kind = 'crown';
      owner = grab.owner;
      fallback = true;
    }
  }
  for (let i = 0; i < TUFTS; i++) {
    const k = i * 3,
      x = tuftPositions[k],
      z = tuftPositions[k + 2],
      scale = scales[i * 4],
      width = 0.275 * scale + 0.1;
    grassPickBox.min.set(
      x - width + Math.min(0, bends[k]),
      0.007,
      z - width + Math.min(0, bends[k + 2])
    );
    grassPickBox.max.set(
      x + width + Math.max(0, bends[k]),
      0.007 + 0.5 * scale + bends[k + 1],
      z + width + Math.max(0, bends[k + 2])
    );
    if (!raycaster.ray.intersectBox(grassPickBox, grassPickPoint)) continue;
    const distance = raycaster.ray.origin.distanceToSquared(grassPickPoint);
    if (distance < nearest) {
      nearest = distance;
      target.copy(grassPickPoint);
      kind = 'grass';
      owner = null;
    }
  }
  if (kind === 'crown' && interaction.brushing && !fallback) {
    const latest =
      interaction.crownGrab ??
      (interaction.crownGrab = {
        plane: new THREE.Plane(),
        screen: new THREE.Vector2()
      });
    latest.plane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(crownPickNormal),
      target
    );
    latest.screen.copy(interaction.screen);
    latest.owner = owner;
  }
  interaction.owner = owner;
  return kind;
}

function stampBrush(x, z, direction) {
  for (let i = 0; i < TUFTS; i++) {
    const k = i * 3,
      dx = tuftPositions[k] - x,
      dz = tuftPositions[k + 2] - z;
    const t = Math.max(0, 1 - Math.hypot(dx, dz) / 1.5),
      pressure = t * t * (3 - 2 * t);
    if (pressure <= tuftPressure[i]) continue;
    const divisor = Math.sqrt(dx * dx + dz * dz + 0.035);
    tuftPressure[i] = pressure;
    bendTargets[k] = ((dx / divisor) * 0.52 + direction.x * 0.38) * pressure;
    bendTargets[k + 1] = -pressure * 0.22;
    bendTargets[k + 2] =
      ((dz / divisor) * 0.52 + direction.z * 0.38) * pressure;
  }
}

function bindInteraction() {
  const canvas = renderer.domElement;
  let brush = null;
  const setPointer = (e) =>
    interaction.screen.set(
      (e.clientX / innerWidth) * 2 - 1,
      (-e.clientY / innerHeight) * 2 + 1
    );
  // Own touch gestures as a unit: the first finger must not seed OrbitControls
  // while the second finger is about to start a pinch.
  const fingers = new Map();
  let touchMode = null,
    lastSpread = 0,
    touchStart = null;
  const fingerSpread = () => {
    const p = [...fingers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };
  const stopTouch = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('selectstart', (e) => e.preventDefault());
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      stopTouch(e);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (fingers.size > 1) {
        touchOrbitPending.set(0, 0);
        touchMode = 'pinch';
        lastSpread = fingerSpread();
        pinchZoomActive = true;
        zoomMomentum = 0;
        lastPinchTime = performance.now();
        interaction.active = false;
        interaction.brushing = false;
        interaction.mouseInside = false;
        interaction.dragging = false;
        return;
      }
      touchStart = { x: e.clientX, y: e.clientY, time: performance.now() };
      setPointer(e);
      interaction.mouseInside = true;
      pickSchedule.reset();
      const hit = new THREE.Vector3();
      touchMode = pickFoliage(hit) ? 'brush' : 'orbit';
      if (touchMode === 'brush') touchOrbitPending.set(0, 0);
      interaction.active = interaction.brushing = touchMode === 'brush';
      interaction.dragging = touchMode === 'orbit';
      interaction.position.copy(hit);
      interaction.target.copy(hit);
      interaction.direction.set(0, 0, 0);
    },
    true
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
      stopTouch(e);
      const old = fingers.get(e.pointerId);
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size > 1) {
        const distance = fingerSpread();
        const now = performance.now(),
          seconds = Math.max(0.008, (now - lastPinchTime) / 1000);
        if (lastSpread > 4 && distance > 4) {
          const delta = Math.log(lastSpread / distance);
          zoomTargetDistance = THREE.MathUtils.clamp(
            zoomTargetDistance * Math.exp(delta),
            5,
            35
          );
          zoomMomentum = THREE.MathUtils.lerp(
            zoomMomentum,
            THREE.MathUtils.clamp(delta / seconds, -1.5, 1.5),
            0.45
          );
        }
        lastPinchTime = now;
        lastSpread = distance;
        return;
      }
      if (touchMode === 'pinch') return; // Lift both fingers before another gesture.
      if (touchMode === 'brush') {
        setPointer(e);
        return;
      }
      touchOrbitPending.x -=
        ((e.clientX - old.x) / canvas.clientHeight) * Math.PI * 2;
      touchOrbitPending.y -=
        ((e.clientY - old.y) / canvas.clientHeight) * Math.PI * 2;
    },
    true
  );
  const endTouch = (e) => {
    if (e.pointerType !== 'touch') return;
    stopTouch(e);
    fingers.delete(e.pointerId);
    if (e.type === 'pointercancel') touchOrbitPending.set(0, 0);
    if (
      touchMode === 'orbit' &&
      e.type === 'pointerup' &&
      touchStart &&
      Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) < 6
    ) {
      setPointer(e);
      raycaster.setFromCamera(interaction.screen, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hit))
        pool.addRipple(hit.x, hit.z);
    }
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    if (e.type === 'pointercancel') zoomMomentum = 0;
    if (fingers.size < 2 && pinchZoomActive) {
      pinchZoomActive = false;
      if (performance.now() - lastPinchTime > 100) zoomMomentum = 0;
    }
    if (!fingers.size) {
      touchMode = null;
      lastSpread = 0;
      interaction.active = false;
      interaction.brushing = false;
      interaction.mouseInside = false;
      interaction.dragging = false;
    }
  };
  canvas.addEventListener('pointerup', endTouch, true);
  canvas.addEventListener('pointercancel', endTouch, true);
  function finishBrush() {
    if (!brush) return;
    const pointerId = brush.id;
    brush = null;
    interaction.active = false;
    interaction.brushing = false;
    interaction.crownGrab = null;
    canvas.classList.remove('brushing');
    if (canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (
        e.pointerType !== 'mouse' ||
        e.button !== 0 ||
        brush ||
        interaction.dragging
      )
        return;
      setPointer(e);
      interaction.mouseInside = true;
      const hit = new THREE.Vector3(),
        kind = pickFoliage(hit, true);
      if (!kind) return;
      // A grab on either foliage surface brushes it without orbiting the camera.
      e.preventDefault();
      e.stopImmediatePropagation();
      brush = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        point: hit.clone(),
        kind,
        owner: interaction.owner
      };
      if (kind === 'crown')
        interaction.crownGrab = {
          screen: interaction.screen.clone(),
          owner: interaction.owner,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(crownPickNormal),
            hit
          )
        };
      interaction.active = false;
      interaction.brushing = true;
      interaction.position.copy(hit);
      interaction.direction.set(0, 0, 0);
      canvas.classList.add('brushing');
      canvas.setPointerCapture(e.pointerId);
    },
    true
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse') {
        setPointer(e);
        interaction.mouseInside = true;
      }
      if (!brush || e.pointerId !== brush.id) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if ((e.buttons & 1) === 0) {
        finishBrush();
        return;
      }
      setPointer(e);
      if (Math.hypot(e.clientX - brush.x, e.clientY - brush.y) >= 3)
        interaction.active = true;
      if (interaction.active) {
        const hit = new THREE.Vector3(),
          kind = pickFoliage(hit);
        if (kind) {
          // Start a fresh stroke when moving between the ground and crown, so
          // the depth jump never draws a bend through the intervening scene.
          if (kind !== brush.kind || interaction.owner !== brush.owner) {
            brush.point.copy(hit);
            interaction.position.copy(hit);
            interaction.target.copy(hit);
            interaction.direction.set(0, 0, 0);
            interaction.strength = 0;
          }
          brush.kind = kind;
          brush.owner = interaction.owner;
          brushMotion.subVectors(hit, brush.point);
          if (kind === 'grass') brushMotion.y = 0;
          const distance = brushMotion.length(),
            steps = Math.min(24, Math.max(1, Math.ceil(distance / 0.25)));
          if (distance > 0.001)
            interaction.direction.copy(brushMotion).normalize();
          // Deposit the whole stroke between input samples, so even a quick drag
          // bends tufts when its press, move and release fall in one render frame.
          if (kind === 'crown')
            brush.owner.brush(brush.point, hit, interaction.direction);
          else
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              stampBrush(
                THREE.MathUtils.lerp(brush.point.x, hit.x, t),
                THREE.MathUtils.lerp(brush.point.z, hit.z, t),
                interaction.direction
              );
            }
          brush.point.copy(hit);
        } else {
          brush.kind = null;
          brush.owner = null;
        }
      }
    },
    true
  );
  canvas.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') {
      setPointer(e);
      interaction.mouseInside = true;
    }
  });
  canvas.addEventListener('pointerleave', () => {
    interaction.mouseInside = false;
    canvas.classList.remove('over-foliage');
  });
  for (const eventName of ['pointerup', 'pointercancel'])
    canvas.addEventListener(
      eventName,
      (e) => {
        if (!brush || e.pointerId !== brush.id) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        finishBrush();
      },
      true
    );
  canvas.addEventListener('lostpointercapture', (e) => {
    if (brush && e.pointerId === brush.id) finishBrush();
  });
  window.addEventListener('blur', () => {
    touchOrbitPending.set(0, 0);
    pinchZoomActive = false;
    zoomMomentum = 0;
    fingers.clear();
    touchMode = null;
    lastSpread = 0;
    interaction.brushing = false;
    interaction.dragging = false;
    finishBrush();
    interaction.active = false;
    interaction.mouseInside = false;
    canvas.classList.remove('over-foliage');
  });
  controls.addEventListener('start', () => {
    touchOrbitPending.set(0, 0);
    interaction.dragging = true;
    canvas.classList.remove('over-foliage');
  });
  controls.addEventListener('end', () => {
    interaction.dragging = false;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomMomentum = 0;
      zoomTargetDistance = THREE.MathUtils.clamp(
        zoomTargetDistance * Math.pow(1.28, e.deltaY / 100),
        5,
        35
      );
    },
    { passive: false }
  );
  let tap = null;
  canvas.addEventListener('pointerdown', (e) => {
    tap =
      e.button !== 0
        ? null
        : {
            x: e.clientX,
            y: e.clientY,
            id: e.pointerId,
            time: performance.now()
          };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!tap || e.pointerId !== tap.id) return;
    if (
      performance.now() - tap.time < 600 &&
      Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 6
    ) {
      const screen = new THREE.Vector2(
          (e.clientX / innerWidth) * 2 - 1,
          (-e.clientY / innerHeight) * 2 + 1
        ),
        hit = new THREE.Vector3();
      raycaster.setFromCamera(screen, camera);
      if (
        raycaster.ray.intersectPlane(groundPlane, hit) &&
        (pickPlant()?.distance ?? Infinity) >
          raycaster.ray.origin.distanceTo(hit)
      )
        pool.addRipple(hit.x, hit.z);
    }
    tap = null;
  });
  canvas.addEventListener('pointercancel', () => {
    tap = null;
  });
}

function updateFoliageInteraction(dt) {
  const previousOwner = interaction.owner;
  const kind =
    interaction.mouseInside && !interaction.dragging
      ? pickFoliage(interaction.target)
      : null;
  if (interaction.active && previousOwner !== interaction.owner) {
    interaction.position.copy(interaction.target);
    interaction.direction.set(0, 0, 0);
    interaction.strength = 0;
  }
  renderer.domElement.classList.toggle('over-foliage', Boolean(kind));
  const active = interaction.active && Boolean(kind),
    activeGrass = active && kind === 'grass';
  const follow = 1 - Math.exp(-dt * 24);
  if (active) {
    brushMotion.subVectors(interaction.target, interaction.position);
    if (kind === 'grass') brushMotion.y = 0;
    if (brushMotion.lengthSq() > 0.0001)
      interaction.direction.lerp(
        brushMotion.normalize(),
        1 - Math.exp(-dt * 20)
      );
    interaction.position.lerp(interaction.target, follow);
  }
  interaction.strength = THREE.MathUtils.damp(
    interaction.strength,
    activeGrass ? 1 : 0,
    activeGrass ? 14 : 5,
    dt
  );
  const values = bendAttribute.array,
    omega = 13,
    decay = Math.exp(-omega * dt),
    recovery = Math.exp(-dt * (activeGrass ? 3.2 : 2.5));
  const wasRecovering = grassRecovery > 0;
  grassRecovery = activeGrass ? 8 : Math.max(0, grassRecovery - dt);
  if (activeGrass || grassRecovery > 0)
    for (let i = 0; i < TUFTS; i++) {
      const k = i * 3,
        dx = tuftPositions[k] - interaction.position.x,
        dz = tuftPositions[k + 2] - interaction.position.z;
      const distance = Math.hypot(dx, dz),
        t = Math.max(0, 1 - distance / 1.5),
        falloff = activeGrass ? t * t * (3 - 2 * t) * interaction.strength : 0;
      const divisor = Math.sqrt(dx * dx + dz * dz + 0.035);
      // Tufts comb in the drag direction, part around the hand, and hold a brief
      // blue-shadowed trail before recovering through the same damped spring.
      if (falloff > tuftPressure[i] * recovery) {
        tuftPressure[i] = falloff;
        bendTargets[k] =
          ((dx / divisor) * 0.52 + interaction.direction.x * 0.38) * falloff;
        bendTargets[k + 1] = -falloff * 0.22;
        bendTargets[k + 2] =
          ((dz / divisor) * 0.52 + interaction.direction.z * 0.38) * falloff;
      } else {
        tuftPressure[i] *= recovery;
        for (let axis = 0; axis < 3; axis++) bendTargets[k + axis] *= recovery;
      }
      for (let axis = 0; axis < 3; axis++) {
        const j = k + axis,
          target = bendTargets[j],
          delta = values[j] - target,
          step = (bendVelocity[j] + omega * delta) * dt;
        values[j] = target + (delta + step) * decay;
        bendVelocity[j] = (bendVelocity[j] - omega * step) * decay;
      }
    }
  if (activeGrass || grassRecovery > 0) bendAttribute.needsUpdate = true;
  else if (wasRecovering) {
    values.fill(0);
    bendVelocity.fill(0);
    bendTargets.fill(0);
    tuftPressure.fill(0);
    bendAttribute.needsUpdate = true;
  }
  for (const plant of foliagePlants) {
    const selected = kind === 'crown' && interaction.owner === plant;
    plant.update(
      dt,
      selected ? interaction.target : null,
      interaction.direction,
      active && selected
    );
  }
  frost.update(dt, interaction.brushing && kind ? interaction.target : null);
}

function updateProjection() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = THREE.MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(THREE.MathUtils.degToRad(25) / 2) / Math.min(camera.aspect, 1)
      )
  );
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

async function init({ progress, signal, fail }) {
  const paint = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const active = () => {
    if (signal.aborted) throw new Error('Scene startup was cancelled');
  };
  const waitFor = async (task, milliseconds, label) => {
    let timeout;
    try {
      const result = await Promise.race([
        task,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(label + ' timed out')),
            milliseconds
          );
        })
      ]);
      active();
      return result;
    } finally {
      clearTimeout(timeout);
    }
  };
  progress(8, 'Starting graphics');
  await paint();
  active();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(25, innerWidth / innerHeight, 0.35, 220);
  camera.position.set(18.25, 10.69, 27.32);
  const params = new URLSearchParams(location.search),
    requested = params.get('renderer');
  const mobile =
    params.get('quality') === 'mobile' ||
    matchMedia('(pointer:coarse)').matches;
  mobileQuality = mobile;
  const forceWebGL =
    requested === 'webgl' ||
    (mobile && requested !== 'webgpu') ||
    !window.isSecureContext ||
    !navigator.gpu;
  renderer = new THREE.WebGPURenderer({
    antialias: true,
    samples: 4,
    alpha: false,
    powerPreference: 'high-performance',
    forceWebGL,
    outputBufferType: mobile ? THREE.UnsignedByteType : THREE.HalfFloatType
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 1.25));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute(
    'aria-label',
    'Frosty grass, small flowers, bushes and a weeping willow beside a moonlit pool beneath the Milky Way. Grab plants to release frost particles and drag to brush the foliage. Drag the background or right-drag to orbit. Scroll or pinch to zoom.'
  );
  renderer.domElement.setAttribute('tabindex', '0');
  $('scene').appendChild(renderer.domElement);
  renderer.onDeviceLost = () => {
    renderer.setAnimationLoop(null);
    fail(new Error('Graphics context was lost'));
  };
  await waitFor(renderer.init(), 20000, 'Starting graphics');
  document.documentElement.dataset.renderer = renderer.backend.isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';
  document.documentElement.dataset.quality = mobile ? 'mobile' : 'desktop';
  progress(18, 'Shaping the island');
  await paint();
  active();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minPolarAngle = 1;
  controls.minDistance = 5;
  controls.maxDistance = 35;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.target.y = -1.25;
  zoomTargetDistance = camera.position.distanceTo(controls.target);
  controls.update();
  updateProjection();
  scene.add(new THREE.HemisphereLight('#dfeef9', '#2e3b5c', 1.5));
  const moonLamp = new THREE.DirectionalLight('#e4edf1', 2);
  moonLamp.position.set(-5, 12, -5);
  scene.add(moonLamp);
  createPlatform({ mobile });
  pool = createPool(scene, clock);
  progress(25, 'Loading the willow');
  await paint();
  const assetProgress = (from, to, label) => (event) => {
    if (event.total > 0)
      progress(from + ((to - from) * event.loaded) / event.total, label);
  };
  willow = await waitFor(
    loadWeepingWillow(
      scene,
      clock,
      assetProgress(25, 44, 'Loading the willow')
    ),
    60000,
    'Loading the willow'
  );
  progress(48, 'Loading the bushes');
  await paint();
  bushes = await waitFor(
    createBushes(scene, clock, assetProgress(48, 62, 'Loading the bushes')),
    60000,
    'Loading the bushes'
  );
  foliagePlants = [willow, ...bushes.plants];
  progress(66, 'Planting the flowers');
  await paint();
  active();
  const flowers = createFlowers(scene, clock);
  foliagePlants.push(...flowers.plants);

  galaxy = createGalaxy(scene, camera, { mobile });
  skyTimeDial = createTimeDial((minutes) => galaxy.setTime(minutes));
  progress(72, 'Loading the grass');
  await paint();
  const loader = new THREE.TextureLoader();
  let texturesLoaded = 0;
  const loadTexture = async (name) => {
    const result = await loader.loadAsync(new URL(name, import.meta.url).href);
    progress(72 + ++texturesLoaded * 4, 'Loading the grass');
    return result;
  };
  const [alpha, noise] = await waitFor(
    Promise.all([
      loadTexture('../assets/textures/grass.png'),
      loadTexture('../assets/textures/perlinnoise.webp')
    ]),
    60000,
    'Loading the grass'
  );
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  alpha.anisotropy = 4;
  createGrass(alpha, noise);
  createFireflies();
  frost = createFrostParticles(scene, camera, paused);
  bindInteraction();
  progress(85, 'Preparing the light and sky');
  await paint();
  active();
  // WebGL's parallel compiler reports failures through a callback. Reject a
  // separate promise instead of throwing inside its animation-frame callback.
  let rejectShader;
  const shaderFailure = new Promise((_, reject) => {
    rejectShader = reject;
  });
  shaderFailure.catch(() => {});
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const details = [
      gl.getProgramInfoLog(program),
      gl.getShaderInfoLog(vertex),
      gl.getShaderInfoLog(fragment)
    ]
      .filter(Boolean)
      .join('\n');
    console.error('Scene shader failed:', details);
    const error = new Error('The graphics shader could not be compiled');
    error.graphicsDetails = details.slice(0, 700);
    if (document.documentElement.dataset.ready === 'true') {
      renderer.setAnimationLoop(null);
      fail(error);
    } else rejectShader(error);
  };
  controls.update();
  await waitFor(
    Promise.race([renderer.compileAsync(scene, camera), shaderFailure]),
    90000,
    'Preparing graphics'
  );
  if (new URLSearchParams(location.search).has('profile')) {
    const shader = await renderer.debug.getShaderAsync(
      scene,
      camera,
      galaxy.dome
    );
    console.info(
      '[shader]',
      document.documentElement.dataset.renderer,
      'galaxy fragment bytes:',
      shader.fragmentShader.length,
      'vertex bytes:',
      shader.vertexShader.length
    );
  }
  progress(97, 'Opening the meadow');
  await paint();
  active();
  renderer.render(scene, camera);
  active();
  document.documentElement.dataset.ready = 'true';
  if (!mobile)
    desktopResolution = createDesktopResolution(
      renderer.getPixelRatio(),
      (ratio) => {
        renderer.setPixelRatio(ratio);
        document.documentElement.dataset.renderScale = String(ratio);
      }
    );
  renderer.setAnimationLoop(animate);
  window.addEventListener('resize', updateProjection);
  document.addEventListener('visibilitychange', () => {
    fpsMeter.reset();
    desktopResolution?.reset();
    if (document.hidden) renderer.setAnimationLoop(null);
    else if (!signal.aborted) {
      previous = performance.now();
      renderer.setAnimationLoop(animate);
    }
  });
}

const fpsMeter = createFPSMeter(document.getElementById('fps-meter'));

function animate(now) {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (!paused) elapsed += dt;
  clock.value = elapsed;
  for (let i = 0; i < flyOrigins.length; i++) {
    const [x, y, z, phase] = flyOrigins[i],
      t = elapsed * 0.5 + phase;
    flies.children[i].position.set(
      x + Math.sin(t * 0.7) * 0.3,
      y + Math.sin(t * 1.3) * 0.18,
      z + Math.cos(t) * 0.3
    );
    flies.children[i].material.opacity =
      0.25 + Math.pow(Math.sin(t * 0.9) * 0.5 + 0.5, 2) * 0.75;
  }
  // Consume touch rotation gradually, including after release, just like the
  // desktop control's damping. Exponential decay is independent of frame rate.
  if (touchOrbitPending.lengthSq() > 1e-10) {
    const follow = 1 - Math.exp(-8 * dt);
    touchOrbitSpherical.setFromVector3(
      touchOrbitOffset.copy(camera.position).sub(controls.target)
    );
    touchOrbitSpherical.theta += touchOrbitPending.x * follow;
    const phi = touchOrbitSpherical.phi + touchOrbitPending.y * follow;
    touchOrbitSpherical.phi = THREE.MathUtils.clamp(
      phi,
      controls.minPolarAngle,
      controls.maxPolarAngle
    );
    touchOrbitPending.multiplyScalar(1 - follow);
    if (phi !== touchOrbitSpherical.phi) touchOrbitPending.y = 0;
    camera.position
      .copy(controls.target)
      .add(touchOrbitOffset.setFromSpherical(touchOrbitSpherical));
  } else touchOrbitPending.set(0, 0);
  controls.update();
  if (!pinchZoomActive && Math.abs(zoomMomentum) > 0.001) {
    const decay = Math.exp(-6 * dt);
    zoomTargetDistance = THREE.MathUtils.clamp(
      zoomTargetDistance * Math.exp((zoomMomentum * (1 - decay)) / 6),
      5,
      35
    );
    zoomMomentum *= decay;
  }
  const offset = camera.position.clone().sub(controls.target),
    distance = THREE.MathUtils.damp(
      offset.length(),
      zoomTargetDistance,
      4.35,
      dt
    );
  camera.position
    .copy(controls.target)
    .addScaledVector(offset.normalize(), distance);
  skyTimeDial.update(dt);
  galaxy.update();

  updateFoliageInteraction(dt);
  desktopResolution?.frame(now);
  renderer.render(scene, camera);
  fpsMeter.frame(now);
}

export async function startScene(options) {
  try {
    await init(options);
  } catch (error) {
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.dispose();
    }
    throw error;
  }
}

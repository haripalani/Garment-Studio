// The 3D studio: garment, materials, key light, HDRI, backdrop with gobo pattern, hanger and neck label.
// Imperative three.js (no React) so the same class can run headless in the render worker (ADR-0013).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GarmentModel, Look, Side } from '@gs/core';
import { buildGarmentGeometry, MM, type GarmentGeometry, type PanelGeometry } from './garmentMesh';
import { goboShadowAlpha, knitNormalMap, LABEL_SIZES, labelTexture, MATERIAL_PROPS } from './procedural';

export type CameraPreset = 'front' | 'back' | 'side';
/** Final-render framing: the current view, or a fixed preset framed for the output aspect. */
export type RenderFrame = 'preview' | CameraPreset;

/** A view as sent to the cloud renderer: spherical position around a target (radians, metres). */
export interface Orbit {
  azimuth: number;
  polar: number;
  distance: number;
  target: [number, number, number];
}
export type Quality = 'adaptive' | 'full' | 'half' | 'quarter';

const QUALITY_SCALE: Record<Quality, number> = { adaptive: 1, full: 1, half: 0.5, quarter: 0.25 };
const AZIMUTH: Record<CameraPreset, number> = { front: 0, back: Math.PI, side: Math.PI / 2 };
const BACKDROP_Z = -0.42;
const FRAME_MARGIN = 1.22;
/** Distance of the inside face behind the outside face (metres). */
const INSIDE_OFFSET = 0.4 * MM;

/** Camera distance that fits a garment of size w × h (metres) for a vertical fov and aspect. */
export function fitDistance(size: { w: number; h: number }, fovDeg: number, aspect: number): number {
  const fov = (fovDeg * Math.PI) / 180;
  const fitH = (size.h + 0.16) / 2 / Math.tan(fov / 2);
  const fitW = size.w / 2 / Math.tan(fov / 2) / Math.max(aspect, 0.2);
  return Math.max(fitH, fitW) * FRAME_MARGIN;
}

/** What the path tracer temporarily sees: everything the live view shows, set up for one camera. */
export interface PathTraceScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  exposure: number;
  /** Studio environment as an equirect float map (CPU pixels), or null when HDRI is off. */
  environment: THREE.DataTexture | null;
  /** Fill light when HDRI is off (the path tracer has no hemisphere light). */
  ambient: { top: string; bottom: string; intensity: number };
}

interface PanelMeshes {
  geom: PanelGeometry;
  outer: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  inner: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
}

export interface StudioOptions {
  /** Called after every rendered frame (tests and "live" indicators). */
  onRender?: () => void;
  labelText?: string;
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
  readonly controls: OrbitControls;

  private garment: GarmentModel | null = null;
  private geometry: GarmentGeometry | null = null;
  private geomKey = '';
  private garmentGroup = new THREE.Group();
  /** Key light, backdrop and gobo turn with the camera (turntable behaviour): any angle is lit like the front. */
  private rig = new THREE.Group();
  private hdriRotation = 0;
  private panels: PanelMeshes[] = [];
  private textures = new Map<string, THREE.Texture>();
  private normalTiles = new Map<string, THREE.Texture>();
  private rib: THREE.Mesh | null = null;
  private hanger = new THREE.Group();
  private label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private labelKey = '';
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private key = new THREE.DirectionalLight('#ffffff', 3);
  private hemi = new THREE.HemisphereLight('#ffffff', '#8a8a8a', 0.35);
  /** Gobo = a light pattern on the backdrop only, drawn as a shadow overlay so it never lights the garment. */
  private gobo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private goboKey = '';
  private env: THREE.Texture;
  private look: Look | null = null;
  private quality: Quality = 'adaptive';
  private interacting = false;
  private width = 1;
  private height = 1;
  private frame = 0;
  private anim: { from: number; to: number; start: number; dur: number } | null = null;
  private disposed = false;
  private framing = { distance: 2.6, target: new THREE.Vector3(0, 0.03, 0) };
  private envEquirect: THREE.DataTexture | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly opts: StudioOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 5;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI - 0.35;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.applyPixelRatio();
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.applyPixelRatio();
      this.requestRender();
    });

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -0.9;
    this.key.shadow.camera.right = 0.9;
    this.key.shadow.camera.top = 0.9;
    this.key.shadow.camera.bottom = -0.9;
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 6;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.radius = 4;
    this.rig.add(this.key, this.key.target);
    this.scene.add(this.rig, this.hemi);

    this.gobo = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.gobo.position.set(0.35, 0.25, BACKDROP_Z + 0.002);
    this.gobo.rotation.z = -0.25;
    this.gobo.renderOrder = 1;

    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 6),
      new THREE.MeshStandardMaterial({ color: '#ece6dc', roughness: 1, metalness: 0, envMapIntensity: 0.45 }),
    );
    this.backdrop.position.set(0, 0, BACKDROP_Z);
    this.backdrop.receiveShadow = true;
    this.rig.add(this.backdrop, this.gobo);
    this.scene.add(this.garmentGroup, this.hanger);
    this.resetView(false);
  }

  /* ───────────── garment & textures ───────────── */

  setGarment(g: GarmentModel, look: Look): void {
    this.garment = g;
    this.geomKey = '';
    this.setLook(look);
  }

  /** Upload a baked piece texture (outer = outside face, inner = inside face). */
  setPieceTexture(pieceId: string, side: Side, source: TexImageSource | OffscreenCanvas): void {
    const k = `${pieceId}|${side}`;
    let tex = this.textures.get(k);
    const w = (source as { width: number }).width;
    const h = (source as { height: number }).height;
    const img = tex?.image as { width?: number; height?: number } | undefined;
    if (!tex || img?.width !== w || img?.height !== h) {
      tex?.dispose();
      tex = new THREE.CanvasTexture(source as HTMLCanvasElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.textures.set(k, tex);
      this.bindTextures();
    } else {
      tex.image = source;
    }
    tex.needsUpdate = true;
    this.requestRender();
  }

  private bindTextures(): void {
    for (const p of this.panels) {
      const outer = this.textures.get(`${p.geom.pieceId}|outside`) ?? null;
      const inner = this.textures.get(`${p.geom.pieceId}|inside`) ?? outer;
      if (p.outer.material.map !== outer) {
        p.outer.material.map = outer;
        p.outer.material.needsUpdate = true;
        this.depthMaterial(p.outer, outer);
      }
      if (p.inner.material.map !== inner) {
        p.inner.material.map = inner;
        p.inner.material.needsUpdate = true;
        this.depthMaterial(p.inner, inner);
      }
    }
  }

  /** Alpha-tested shadows: the shadow follows the piece outline, not the grid. */
  private depthMaterial(mesh: THREE.Mesh, map: THREE.Texture | null): void {
    const old = mesh.customDepthMaterial;
    old?.dispose();
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: 0.5,
    });
  }

  private rebuildGeometry(look: Look): void {
    if (!this.garment) return;
    const wrinkles = look.fabric.wrinkles ? look.fabric.wrinkleStrength : 0;
    const key = `${this.garment.id}@${this.garment.version}|${wrinkles.toFixed(2)}|${look.fabric.ao}`;
    if (key === this.geomKey) return;
    this.geomKey = key;
    this.clearGarment();
    this.geometry = buildGarmentGeometry(this.garment, { wrinkles, ao: look.fabric.ao });

    for (const pg of this.geometry.panels) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pg.positions, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(pg.uvs, 2));
      const ao = new Float32Array(pg.ao.length * 3);
      pg.ao.forEach((v, i) => ao.set([v, v, v], i * 3));
      g.setAttribute('color', new THREE.BufferAttribute(ao, 3));
      g.setIndex(new THREE.BufferAttribute(pg.indices, 1));
      g.computeVertexNormals();
      // The inside face is its own surface, 0.4 mm behind the outside one. Coincident surfaces are
      // invisible to rasterisation (back faces are culled) but a path tracer hits either at random,
      // letting light and shadow leak through the fabric.
      const gi = g.clone();
      const pos = gi.getAttribute('position') as THREE.BufferAttribute;
      const nrm = gi.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) - nrm.getX(i) * INSIDE_OFFSET,
          pos.getY(i) - nrm.getY(i) * INSIDE_OFFSET,
          pos.getZ(i) - nrm.getZ(i) * INSIDE_OFFSET,
        );
      }
      const make = (side: THREE.Side) =>
        new THREE.MeshPhysicalMaterial({
          side,
          vertexColors: true,
          alphaTest: 0.5,
          roughness: 0.9,
          sheen: 0.3,
          sheenRoughness: 0.8,
        });
      const outer = new THREE.Mesh(g, make(THREE.FrontSide));
      const inner = new THREE.Mesh(gi, make(THREE.BackSide));
      for (const m of [outer, inner]) {
        m.castShadow = true;
        m.receiveShadow = true;
        this.garmentGroup.add(m);
      }
      this.panels.push({ geom: pg, outer, inner });
    }

    const ribPts = this.geometry.necklines.flatMap((n) => [n.points.map((p) => new THREE.Vector3(...p))]);
    const ribGeoms = ribPts
      .filter((pts) => pts.length > 2)
      .map((pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 6 * MM, 8, false));
    if (ribGeoms.length) {
      const merged = mergeTubes(ribGeoms);
      this.rib = new THREE.Mesh(merged, new THREE.MeshPhysicalMaterial({ roughness: 0.95, sheen: 0.3 }));
      this.rib.castShadow = true;
      this.garmentGroup.add(this.rib);
      ribGeoms.forEach((r) => r.dispose());
    }

    this.buildHanger();
    this.bindTextures();
    this.frameGarment();
  }

  private clearGarment(): void {
    for (const p of this.panels) {
      p.outer.geometry.dispose();
      p.inner.geometry.dispose();
      p.outer.material.dispose();
      p.inner.material.dispose();
      p.outer.customDepthMaterial?.dispose();
      p.inner.customDepthMaterial?.dispose();
    }
    this.panels = [];
    if (this.rib) {
      this.rib.geometry.dispose();
      (this.rib.material as THREE.Material).dispose();
      this.rib = null;
    }
    this.garmentGroup.clear();
  }

  private buildHanger(): void {
    this.hanger.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.hanger.clear();
    if (!this.geometry) return;
    const { neckTop, shoulderL, shoulderR } = this.geometry.anchors;
    const top = new THREE.Vector3(neckTop[0], neckTop[1] + 0.02, 0);
    const hook = new THREE.CatmullRomCurve3([
      new THREE.Vector3(top.x, top.y - 0.01, 0),
      new THREE.Vector3(top.x, top.y + 0.05, 0),
      new THREE.Vector3(top.x + 0.012, top.y + 0.085, 0),
      new THREE.Vector3(top.x + 0.04, top.y + 0.09, 0),
      new THREE.Vector3(top.x + 0.055, top.y + 0.065, 0),
    ]);
    const bar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(shoulderL[0] - 0.01, shoulderL[1] - 0.02, 0),
      new THREE.Vector3(top.x, top.y - 0.012, 0),
      new THREE.Vector3(shoulderR[0] + 0.01, shoulderR[1] - 0.02, 0),
    ]);
    const mat = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.35, metalness: 0.1 });
    const hookMesh = new THREE.Mesh(new THREE.TubeGeometry(hook, 32, 2.6 * MM, 8, false), mat);
    const barMesh = new THREE.Mesh(new THREE.TubeGeometry(bar, 32, 6 * MM, 10, false), mat.clone());
    hookMesh.castShadow = barMesh.castShadow = true;
    this.hanger.add(hookMesh, barMesh);
  }

  /* ───────────── look ───────────── */

  setLook(look: Look): void {
    this.look = look;
    this.rebuildGeometry(look);
    const f = look.fabric;
    const props = MATERIAL_PROPS[f.material];

    let normal = this.normalTiles.get(f.material);
    if (!normal) {
      normal = new THREE.CanvasTexture(knitNormalMap(f.material) as HTMLCanvasElement);
      normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
      normal.colorSpace = THREE.NoColorSpace;
      this.normalTiles.set(f.material, normal);
    }
    const tileMm = props.tileMm * (f.knitScale / 3);
    for (const p of this.panels) {
      const piece = this.garment?.pieces.find((x) => x.id === p.geom.pieceId);
      const w = piece ? Math.max(...piece.outlineMm.map((v) => v[0])) : 500;
      const h = piece ? Math.max(...piece.outlineMm.map((v) => v[1])) : 500;
      for (const m of [p.outer.material, p.inner.material]) {
        const nm = m.normalMap && m.normalMap.source === normal.source ? m.normalMap : normal.clone();
        nm.repeat.set(w / tileMm, h / tileMm);
        if (m.normalMap !== nm) {
          m.normalMap?.dispose();
          m.normalMap = nm;
          m.needsUpdate = true;
        }
        m.normalScale.set(props.normal * f.texture * 0.45, props.normal * f.texture * 0.45);
        m.roughness = props.roughness;
        m.sheen = props.sheen * 0.6;
        m.sheenColor.set(f.color);
        m.color.setScalar(1);
      }
    }
    if (this.rib) {
      const rm = this.rib.material as THREE.MeshPhysicalMaterial;
      rm.color.set(f.color).multiplyScalar(0.94 * f.brightness);
      rm.roughness = props.roughness;
    }

    this.applyLight(look);
    this.applyScene(look);
    this.requestRender();
  }

  private applyLight(look: Look): void {
    const { azimuthDeg, elevationDeg, power } = look.light;
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const r = 3;
    this.key.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    this.key.target.position.set(0, 0, 0);
    this.key.intensity = power * 1.15;
  }

  private applyScene(look: Look): void {
    const s = look.scene;
    this.scene.environment = s.hdri ? this.env : null;
    this.scene.environmentIntensity = s.hdriIntensity * 0.5;
    this.hdriRotation = (s.hdriRotationDeg * Math.PI) / 180;
    this.hemi.intensity = s.hdri ? 0.08 : 0.35;

    this.backdrop.visible = s.backdrop;
    const bc = new THREE.Color(s.backdropColor).multiplyScalar(0.5 + 0.35 * s.backdropBrightness);
    this.backdrop.material.color.copy(bc);
    this.backdrop.receiveShadow = s.backdropShadow;
    this.key.castShadow = s.backdropShadow;

    const gk = `${s.gobo}|${s.goboInvert}`;
    if (gk !== this.goboKey) {
      this.goboKey = gk;
      const m = this.gobo.material;
      m.alphaMap?.dispose();
      // Gobo canvases are white where light passes; the overlay needs alpha where light is blocked.
      m.alphaMap = s.gobo === 'none' ? null : new THREE.CanvasTexture(goboShadowAlpha(s.gobo, s.goboInvert) as HTMLCanvasElement);
      m.needsUpdate = true;
    }
    // Contrast: how dark the pattern's shadows fall on the backdrop.
    this.gobo.visible = s.backdrop && s.gobo !== 'none';
    this.gobo.material.opacity = Math.min(0.85, 0.32 * s.backdropContrast * (2 - s.backdropBrightness));

    this.hanger.visible = s.hanger;
    this.hanger.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).color.set(s.hangerColor);
    });

    this.applyLabel(s);
    this.controls.autoRotate = s.autoRotate;
    this.controls.autoRotateSpeed = 1.6;
    if (s.autoRotate) this.loop();
  }

  private applyLabel(s: Look['scene']): void {
    const key = `${s.neckLabel}|${s.labelShape}|${s.labelColor}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    if (this.label) {
      this.label.geometry.dispose();
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.scene.remove(this.label);
      this.label = null;
    }
    if (!s.neckLabel || !this.geometry) return;
    const [w, h] = LABEL_SIZES[s.labelShape];
    const tex = new THREE.CanvasTexture(labelTexture(s.labelShape, s.labelColor, this.opts.labelText ?? 'STUDIO') as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(w * MM, h * MM),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }),
    );
    this.label.position.set(...this.geometry.anchors.labelCentre);
    this.scene.add(this.label);
  }

  /* ───────────── camera ───────────── */

  private frameGarment(): void {
    if (!this.geometry) return;
    this.framing.distance = fitDistance(this.geometry.size, this.camera.fov, this.camera.aspect);
    this.framing.target.set(0, 0.04, 0);
    // Keep the current viewing direction, apply the fitted distance.
    if (!this.interacting && !this.anim) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.lengthSq() < 0.5) dir.set(0, 0, 1);
      this.controls.target.copy(this.framing.target);
      this.camera.position.copy(this.framing.target).addScaledVector(dir, this.framing.distance);
      this.controls.update();
    }
  }

  resetView(animate = true): void {
    this.frameGarment();
    this.controls.target.copy(this.framing.target);
    if (animate) this.setCamera('front');
    else {
      this.camera.position.set(0, this.framing.target.y + 0.05, this.framing.distance);
      this.controls.update();
      this.requestRender();
    }
  }

  setCamera(preset: CameraPreset, animate = true): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const from = Math.atan2(offset.x, offset.z);
    let to = AZIMUTH[preset];
    // Take the short way round.
    while (to - from > Math.PI) to -= Math.PI * 2;
    while (to - from < -Math.PI) to += Math.PI * 2;
    if (!animate) {
      this.placeCamera(to);
      return;
    }
    this.anim = { from, to, start: performance.now(), dur: 450 };
    this.loop();
  }

  private placeCamera(az: number): void {
    const d = this.framing.distance;
    this.controls.target.copy(this.framing.target);
    this.camera.position.set(Math.sin(az) * d, this.framing.target.y + 0.05, Math.cos(az) * d);
    this.controls.update();
    this.requestRender();
  }

  /* ───────────── rendering ───────────── */

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyPixelRatio();
    this.requestRender();
  }

  private applyPixelRatio(): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const adaptiveDrop = this.quality === 'adaptive' && this.interacting ? 0.5 : 1;
    this.renderer.setPixelRatio(Math.max(0.25, dpr * QUALITY_SCALE[this.quality] * adaptiveDrop));
    this.renderer.setSize(this.width, this.height, false);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
    this.frameGarment();
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private loop(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
      if (this.anim || this.controls.autoRotate) this.loop();
    });
  }

  private renderNow(): void {
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.placeCamera(this.anim.from + (this.anim.to - this.anim.from) * e);
      if (t >= 1) this.anim = null;
    }
    this.controls.update();
    this.syncRig();
    this.renderer.render(this.scene, this.camera);
    this.opts.onRender?.();
  }

  private syncRig(camera: THREE.Camera = this.camera, target: THREE.Vector3 = this.controls.target): void {
    const az = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
    this.rig.rotation.y = az;
    this.scene.environmentRotation.set(0, this.hdriRotation + az, 0);
  }

  /**
   * A camera for a final render at `aspect`. "preview" keeps the current view direction and zoom,
   * re-fitted so the garment frames the same way at the new aspect; presets use the fitted distance.
   */
  cameraFor(frame: RenderFrame, aspect: number, orbit?: Orbit): THREE.PerspectiveCamera {
    const cam = this.camera.clone();
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const size = this.geometry?.size ?? { w: 0.6, h: 0.8 };
    if (frame === 'preview' && orbit) {
      const target = new THREE.Vector3(...orbit.target);
      cam.position.setFromSphericalCoords(orbit.distance, orbit.polar, orbit.azimuth).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.userData.target = target;
      return cam;
    }
    const target = frame === 'preview' ? this.controls.target.clone() : this.framing.target.clone();
    if (frame === 'preview') {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const zoom = offset.length() / fitDistance(size, this.camera.fov, this.camera.aspect);
      offset.setLength(fitDistance(size, cam.fov, aspect) * zoom);
      cam.position.copy(target).add(offset);
    } else {
      const d = fitDistance(size, cam.fov, aspect);
      const az = AZIMUTH[frame];
      cam.position.set(Math.sin(az) * d, target.y + 0.05, Math.cos(az) * d);
    }
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.userData.target = target;
    return cam;
  }

  /**
   * Lends the scene to `use`, arranged for `camera` (rig turned to it, backdrop hidden for transparent
   * output), then restores the live view. The path tracer copies everything it needs during `use`.
   */
  async withPathTraceScene<T>(
    camera: THREE.PerspectiveCamera,
    opts: { transparent: boolean },
    use: (s: PathTraceScene) => Promise<T>,
  ): Promise<T> {
    const hdri = this.look?.scene.hdri ?? true;
    const prev = { backdrop: this.backdrop.visible, gobo: this.gobo.visible, environment: this.scene.environment };
    this.syncRig(camera, camera.userData.target as THREE.Vector3);
    if (opts.transparent) {
      this.backdrop.visible = false;
      this.gobo.visible = false;
    }
    try {
      return await use({
        scene: this.scene,
        camera,
        exposure: this.renderer.toneMappingExposure,
        environment: hdri ? this.environmentEquirect() : null,
        ambient: { top: '#ffffff', bottom: '#8a8a8a', intensity: hdri ? 0 : 0.35 },
      });
    } finally {
      this.backdrop.visible = prev.backdrop;
      this.gobo.visible = prev.gobo;
      this.scene.environment = prev.environment;
      this.syncRig();
      this.requestRender();
    }
  }

  /**
   * The studio room environment as an equirectangular float map with its pixels on the CPU (made once).
   * The path tracer runs in its own WebGL context and builds an importance-sampling table from the
   * pixel data, so a GPU-only texture from this context would arrive black.
   */
  private environmentEquirect(): THREE.DataTexture {
    if (!this.envEquirect) {
      const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      const room = new RoomEnvironment();
      new THREE.CubeCamera(0.1, 100, cube).update(this.renderer, room);
      room.dispose();
      const W = 512;
      const H = 256;
      const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          uniforms: { cube: { value: cube.texture } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          // Same convention as three's equirect sampling: u = atan(z, x), v = asin(y).
          fragmentShader: `
            varying vec2 vUv; uniform samplerCube cube;
            void main() {
              float phi = (vUv.x - 0.5) * 6.28318530718;
              float theta = (vUv.y - 0.5) * 3.14159265359;
              vec3 dir = vec3(cos(theta) * cos(phi), sin(theta), cos(theta) * sin(phi));
              gl_FragColor = vec4(textureCube(cube, dir).rgb, 1.0);
            }`,
          depthTest: false,
        }),
      );
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.render(quad, cam);
      const data = new Float32Array(W * H * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, W, H, data);
      this.renderer.setRenderTarget(prev);
      quad.geometry.dispose();
      quad.material.dispose();
      target.dispose();
      cube.dispose();
      const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.needsUpdate = true;
      this.envEquirect = tex;
    }
    return this.envEquirect;
  }

  /** A second renderer drawing this scene off screen (turntable video, spec sheet). */
  offscreenView(width: number, height: number, opts: { transparent?: boolean } = {}) {
    const canvas = createCanvas(width, height);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = this.renderer.outputColorSpace;
    renderer.toneMapping = this.renderer.toneMapping;
    renderer.toneMappingExposure = this.renderer.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // GPU textures belong to one WebGL context: this renderer needs its own copy of the studio
    // environment (the live one would sample as black here).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const camera = this.cameraFor('front', width / height);
    const target = camera.userData.target as THREE.Vector3;
    const distance = camera.position.distanceTo(target);
    const y = camera.position.y;
    return {
      canvas,
      /** Draw the garment turned to `azimuth` (radians, 0 = front). */
      render: (azimuth: number) => {
        camera.position.set(Math.sin(azimuth) * distance, y, Math.cos(azimuth) * distance);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        const vis = { b: this.backdrop.visible, g: this.gobo.visible };
        if (opts.transparent) this.backdrop.visible = this.gobo.visible = false;
        this.syncRig(camera, target);
        const liveEnv = this.scene.environment;
        if (liveEnv) this.scene.environment = env;
        try {
          renderer.render(this.scene, camera);
        } finally {
          this.scene.environment = liveEnv;
          this.backdrop.visible = vis.b;
          this.gobo.visible = vis.g;
          this.syncRig();
        }
      },
      dispose: () => {
        env.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  }

  /** Renders the current view at a higher resolution and returns a PNG (or WebP). */
  async snapshot(longSide = 2400, type: 'image/png' | 'image/webp' = 'image/png'): Promise<Blob> {
    const prevRatio = this.renderer.getPixelRatio();
    const ratio = longSide / Math.max(this.width, this.height);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.syncRig();
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, type, 0.92));
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.requestRender();
    if (!blob) throw new Error('Snapshot failed');
    return blob;
  }

  /** The current view as an orbit (for cloud renders of "as in 3D preview"). */
  orbit(): Orbit {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const t = this.controls.target;
    return { azimuth: s.theta, polar: s.phi, distance: s.radius, target: [t.x, t.y, t.z] };
  }

  /** Stats for tests and diagnostics. */
  info() {
    return {
      panels: this.panels.length,
      textures: this.textures.size,
      triangles: this.renderer.info.render.triangles,
      calls: this.renderer.info.render.calls,
      cameraAzimuth: Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z),
      pixelRatio: this.renderer.getPixelRatio(),
      look: this.look,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearGarment();
    this.textures.forEach((t) => t.dispose());
    this.normalTiles.forEach((t) => t.dispose());
    this.gobo.material.alphaMap?.dispose();
    this.gobo.material.dispose();
    this.gobo.geometry.dispose();
    this.env.dispose();
    this.envEquirect?.dispose();
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  return new OffscreenCanvas(width, height);
}

/** PNG / WebP bytes from either canvas kind. */
export async function canvasBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality = 0.92): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error(`Could not encode ${type}`);
  return blob;
}

/** Concatenate tube geometries (same attribute layout) into one. */
function mergeTubes(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'] as const;
  let offset = 0;
  const index: number[] = [];
  const attrs: Record<string, number[]> = { position: [], normal: [], uv: [] };
  for (const g of geoms) {
    for (const n of names) attrs[n]!.push(...(g.getAttribute(n).array as Float32Array));
    const idx = g.getIndex()!.array;
    for (let i = 0; i < idx.length; i++) index.push(idx[i]! + offset);
    offset += g.getAttribute('position').count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(attrs.position!, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(attrs.normal!, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(attrs.uv!, 2));
  out.setIndex(index);
  return out;
}

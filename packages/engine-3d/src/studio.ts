// The 3D studio: garment, materials, key light, HDRI, backdrop with gobo pattern, hanger and neck label.
// Imperative three.js (no React) so the same class can run headless in the render worker (ADR-0013).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GarmentModel, Look, Side } from '@gs/core';
import { buildGarmentGeometry, MM, type GarmentGeometry, type PanelGeometry } from './garmentMesh';
import { goboShadowAlpha, knitNormalMap, LABEL_SIZES, labelTexture, MATERIAL_PROPS } from './procedural';

export type CameraPreset = 'front' | 'back' | 'side';
export type Quality = 'adaptive' | 'full' | 'half' | 'quarter';

const QUALITY_SCALE: Record<Quality, number> = { adaptive: 1, full: 1, half: 0.5, quarter: 0.25 };
const AZIMUTH: Record<CameraPreset, number> = { front: 0, back: Math.PI, side: Math.PI / 2 };
const BACKDROP_Z = -0.42;

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
      const inner = new THREE.Mesh(g, make(THREE.BackSide));
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
    const { w, h } = this.geometry.size;
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitH = (h + 0.16) / 2 / Math.tan(fov / 2);
    const fitW = w / 2 / Math.tan(fov / 2) / Math.max(this.camera.aspect, 0.2);
    this.framing.distance = Math.max(fitH, fitW) * 1.22;
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

  private syncRig(): void {
    const az = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
    this.rig.rotation.y = az;
    this.scene.environmentRotation.set(0, this.hdriRotation + az, 0);
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
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
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

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VesselFlow } from './vessel-flow.js';

const FLOOR_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 p = modelMatrix * vec4(position, 1.0);
    vWorld = p.xyz;
    gl_Position = projectionMatrix * viewMatrix * p;
  }
`;
const FLOOR_FRAGMENT = /* glsl */ `
  varying vec3 vWorld;
  uniform sampler2D uShadow;
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uPulse;
  float grid(vec2 p, float spacing) {
    vec2 q = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 width = max(fwidth(p), vec2(0.0001));
    return 1.0 - min(smoothstep(0.0, width.x, q.x), smoothstep(0.0, width.y, q.y));
  }
  void main() {
    vec2 p = vWorld.xz;
    float stage = exp(-dot(p * vec2(0.72, 0.9), p * vec2(0.72, 0.9)) * 0.12);
    float pool = exp(-dot(p - vec2(-0.6, -0.5), p - vec2(-0.6, -0.5)) * 0.115);
    vec3 col = uTint * (0.22 + 0.95 * stage) + vec3(0.024, 0.029, 0.033) * pool;
    col += vec3(0.006, 0.008, 0.009) * grid(p, 0.5) * exp(-dot(p, p) * 0.05);
    col += vec3(0.008, 0.010, 0.011) * grid(p, 2.0) * exp(-dot(p, p) * 0.05);
    vec2 shadowUV = (vec2(p.x, -p.y) + 2.5) / 5.0;
    float shadow = 0.0;
    for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
      shadow += texture2D(uShadow, shadowUV + vec2(float(x), float(y)) * 0.0025).r;
    }
    float coverage = min(1.0, shadow * 0.025);
    col *= 1.0 - coverage * 0.38;
    float a = sin(p.x * 11.0 + sin(p.y * 6.4 + uTime * 0.34));
    float b = sin(p.y * 12.4 - sin(p.x * 5.8 - uTime * 0.24));
    float caustic = pow(max(0.0, 1.0 - abs(a + b) * 0.75), 10.0);
    col += vec3(0.022, 0.036, 0.042) * caustic * coverage * (0.35 + uPulse * 0.45);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const SHADOW_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(position.x, 0.0, position.z, 1.0);
    gl_PointSize = 17.0 + position.y * 2.0;
  }
`;
const SHADOW_FRAGMENT = /* glsl */ `
  varying float vHeight;
  uniform float uParticleWeight;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    gl_FragColor = vec4(exp(-r * 4.0) * 0.09 * uParticleWeight / (1.0 + vHeight * 0.65), 0.0, 0.0, 1.0);
  }
`;

const MATERIALS = {
  water: { color: 0xffffff, attenuation: 0x8fdce8, distance: 3.8, transmission: 1, metalness: 0, roughness: 0.028 },
  aqua: { color: 0xffffff, attenuation: 0x77dce2, distance: 2.5, transmission: 1, metalness: 0, roughness: 0.028 },
  amber: { color: 0xfff5e0, attenuation: 0xd89534, distance: 0.9, transmission: 1, metalness: 0, roughness: 0.035 },
  ink: { color: 0x809aac, attenuation: 0x294757, distance: 0.21, transmission: 0.91, metalness: 0, roughness: 0.055 },
  chrome: { color: 0xc3d3df, attenuation: 0xffffff, distance: 1, transmission: 0, metalness: 1, roughness: 0.08 },
  mercury: { color: 0xc3d3df, attenuation: 0xffffff, distance: 1, transmission: 0, metalness: 1, roughness: 0.08 },
  polar: { color: 0xb4efff, attenuation: 0x6aacc9, distance: 2.2, transmission: 0.86, metalness: 0.18, roughness: 0.13, iridescence: 0.75, anisotropy: 0.84, sheen: 0.4, mode: 1 },
  abyss: { color: 0x234441, attenuation: 0x102f29, distance: 0.16, transmission: 0.76, metalness: 0.26, roughness: 0.07, mode: 2 },
  nacre: { color: 0xe9dbce, attenuation: 0xd9c5b0, distance: 2, transmission: 0.5, metalness: 0.34, roughness: 0.14, iridescence: 1, clearcoat: 0.9, mode: 3 },
  phase: { color: 0xdcefff, attenuation: 0xb5e8f0, distance: 4.2, transmission: 1, metalness: 0.01, roughness: 0.04, iridescence: 0.24, mode: 4 },
};

export class FluidRenderer {
  constructor(container, { onInteract } = {}) {
    this.container = container;
    this.onInteract = onInteract;
    this.radius = 0.095;
    this.quality = 'balanced';
    this.flowMode = 'liquid';
    this.vesselDilation = 0.35;
    this.vesselFlowSpeed = 0.55;
    this.vesselPulse = 0;
    this.vesselEpoch = 0;
    this.timeScale = 1;
    this.interactionMode = 'stir';
    this.isDragging = false;
    this.particleCount = 0;
    this.capacity = 0;
    this._lastTime = null;
    this._opticalTime = 0;
    this._disposed = false;
    this._surfaceBusy = false;
    this._surfaceDirty = false;
    this._lastSurfaceSent = -Infinity;
    this.optics = { smoothness: 0.7, clarity: 0.92, dispersion: 0.12 };
    this.lightPulse = 0;
    this.liquidUniforms = { uLiquidTime: { value: 0 }, uLiquidAudio: { value: 0 }, uLiquidMode: { value: 0 } };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.transmissionResolutionScale = 1;
    this.renderer.domElement.className = 'fluid-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive three dimensional water sculpture. Drag to stir the water.');
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(41, 1, 0.1, 70);
    this.camera.position.set(5.0, 3.8, 5.8);
    this.camera.lookAt(0, 1.2, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.18, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4.2;
    this.controls.maxDistance = 15;
    this.controls.minPolarAngle = 0.22;
    this.controls.maxPolarAngle = 1.48;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches.ONE = null;
    this.controls.update();
    this.baseScene = new THREE.Scene();
    this.baseScene.background = new THREE.Color(0x0b1016);
    this._buildEnvironment();
    this.keyLight = new THREE.DirectionalLight(0xd7f2ff, 2.1);
    this.keyLight.position.set(-3, 6, 2);
    this.fillLight = new THREE.DirectionalLight(0xffe3bf, 1.1);
    this.fillLight.position.set(4, 3, -4);
    this.baseScene.add(this.keyLight, this.fillLight);
    this.shadowTarget = new THREE.WebGLRenderTarget(384, 384, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.shadowMaterial = new THREE.ShaderMaterial({ uniforms: { uParticleWeight: { value: 1 } }, vertexShader: SHADOW_VERTEX, fragmentShader: SHADOW_FRAGMENT, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false });
    this.particleGeometry = new THREE.BufferGeometry();
    this.shadowParticles = new THREE.Points(this.particleGeometry, this.shadowMaterial);
    this.shadowParticles.frustumCulled = false;
    this.shadowScene = new THREE.Scene();
    this.shadowScene.add(this.shadowParticles);
    this.shadowCamera = new THREE.OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 20);
    this.shadowCamera.position.set(0, 10, 0);
    this.shadowCamera.up.set(0, 0, -1);
    this.shadowCamera.lookAt(0, 0, 0);
    this.floorMaterial = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(0.028, 0.036, 0.043) }, uTime: { value: 0 }, uPulse: { value: 0 }, uShadow: { value: this.shadowTarget.texture } },
      vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), this.floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.025;
    this.baseScene.add(this.floor);
    this._buildBoundary();
    this.surfaceGeometry = new THREE.BufferGeometry();
    this.surfaceGeometry.setDrawRange(0, 0);
    this.surfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.028, transmission: 1,
      ior: 1.333, thickness: 0.85, attenuationColor: 0x8fdce8,
      attenuationDistance: 3.8, envMapIntensity: 1.1, dispersion: 0.035,
      side: THREE.DoubleSide,
    });
    this._installExperimentalOptics();
    this.surface = new THREE.Mesh(this.surfaceGeometry, this.surfaceMaterial);
    this.surface.frustumCulled = false;
    this.baseScene.add(this.surface);
    this.setMaterial('water');
    this._startSurfaceWorker();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.interactionPlane = new THREE.Plane();
    this.interactionPoint = new THREE.Vector3();
    this.previousPoint = new THREE.Vector3();
    this._bindEvents();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();
  }
  _buildEnvironment() {
    // A local photographic studio needs no remote HDRI or network access.
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = generator.fromScene(room, 0.025);
    this.baseScene.environment = this.environmentTarget.texture;
    this.baseScene.environmentIntensity = 0.8;
    this.baseScene.environmentRotation.set(0, 0.45, 0);
    room.dispose(); generator.dispose();
  }
  _installExperimentalOptics() {
    this.surfaceMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.liquidUniforms);
      shader.vertexShader = 'varying vec3 vLiquidPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiquidPosition = position;');
      shader.fragmentShader = `
        varying vec3 vLiquidPosition;
        uniform float uLiquidTime;
        uniform float uLiquidAudio;
        uniform float uLiquidMode;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec4 diffuseColor = vec4(diffuse, opacity);
        vec3 lp = vLiquidPosition;
        float lt = uLiquidTime;
        float liquidFlow = lp.x * 2.4 + lp.y * 2.1 + sin(lp.z * 3.0 + lt * 0.2) - lt * 0.24;
        float liquidPhase = smoothstep(-0.32, 0.32, sin(liquidFlow));
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        if (uLiquidMode > 3.5) roughnessFactor = mix(0.035, 0.095, liquidPhase);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
        #include <metalnessmap_fragment>
        if (uLiquidMode > 3.5) metalnessFactor = mix(0.02, 0.99, liquidPhase);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        if (uLiquidMode > 1.5 && uLiquidMode < 2.5) {
          vec3 q = lp * 5.8 + vec3(lt * 0.13, -lt * 0.18, lt * 0.09);
          float gyroid = sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
          float vein = 1.0 - smoothstep(0.028, 0.15, abs(gyroid));
          float branch = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(q.y * 0.8 - lt), 3.0);
          totalEmissiveRadiance += vec3(0.035, 0.8, 0.53) * vein * branch * (0.16 + uLiquidAudio * 2.1);
        }
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
        #include <lights_physical_fragment>
        #ifdef USE_IRIDESCENCE
          if (uLiquidMode > 0.5 && uLiquidMode < 1.5) {
            float ribbon = 0.5 + 0.5 * sin(lp.y * 6.5 + sin(lp.x * 3.0 + lt * 0.15) + lt * 0.18);
            material.iridescenceThickness = 180.0 + ribbon * 280.0;
            float alignment = dot(normal, normalize(vec3(0.45, 0.8, 0.3)));
            float polarization = alignment * alignment;
            material.specularColor *= mix(vec3(0.48, 0.86, 1.0), vec3(1.0, 0.51, 0.9), polarization);
          }
          if (uLiquidMode > 2.5 && uLiquidMode < 3.5) {
            float strata = 0.5 + 0.5 * sin(lp.y * 4.7 + sin(lp.x * 2.7 + lp.z * 2.0) + lt * 0.1);
            material.iridescenceThickness = 280.0 + strata * 610.0 + uLiquidAudio * 50.0;
          }
          if (uLiquidMode > 3.5) material.iridescenceThickness = 250.0 + 300.0 * (1.0 - liquidPhase);
        #endif
      `);
      const transmission = THREE.ShaderChunk.transmission_fragment.replace('material.transmission = transmission;', 'material.transmission = transmission;\nif (uLiquidMode > 3.5) material.transmission *= (1.0 - liquidPhase);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', transmission);
    };
    this.surfaceMaterial.customProgramCacheKey = () => 'liquid-optics-v2';
  }
  _buildBoundary() {
    const points = [], x = 1.77, z = 1.37, y = -0.01;
    for (const [a, b] of [
      [[-x, y, -z], [x, y, -z]], [[x, y, -z], [x, y, z]],
      [[x, y, z], [-x, y, z]], [[-x, y, z], [-x, y, -z]],
    ]) points.push(...a, ...b);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      points.push(sx * x, y, sz * z, sx * x, 0.16, sz * z);
      points.push(sx * x, 3.32, sz * z, sx * x, 3.43, sz * z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.boundary = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x859aa5, transparent: true, opacity: 0.2, depthWrite: false }));
    this.baseScene.add(this.boundary);
  }
  _startSurfaceWorker() {
    this.surfaceWorker = new Worker(new URL('./surface-worker.js', import.meta.url), { type: 'module' });
    this.surfaceWorker.onmessage = ({ data }) => {
      this._surfaceBusy = false;
      if (this._disposed || data.type !== 'surface') return;
      this.surfaceDuration = data.duration;
      this._applySurface(data.positions, data.normals, data.vertices);
    };
    this.surfaceWorker.onerror = (error) => {
      this._surfaceBusy = false;
      console.error('Water surface reconstruction failed:', error.message);
    };
  }
  _applySurface(positions, normals, vertices) {
    let position = this.surfaceGeometry.getAttribute('position');
    let normal = this.surfaceGeometry.getAttribute('normal');
    let uv = this.surfaceGeometry.getAttribute('uv');
    if (!position || position.count < vertices) {
      const capacity = Math.max(vertices, 90000);
      position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      normal = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      uv = new THREE.BufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
      this.surfaceGeometry.setAttribute('position', position);
      this.surfaceGeometry.setAttribute('normal', normal);
      this.surfaceGeometry.setAttribute('uv', uv);
    }
    position.array.set(positions); normal.array.set(normals);
    for (let i = 0; i < vertices; i++) {
      uv.array[i * 2] = Math.atan2(positions[i * 3 + 2], positions[i * 3]) / (Math.PI * 2) + 0.5;
      uv.array[i * 2 + 1] = positions[i * 3 + 1] * 0.3;
    }
    for (const [attribute, length] of [[position, positions.length], [normal, normals.length], [uv, vertices * 2]]) {
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, length); attribute.needsUpdate = true;
    }
    this.surfaceGeometry.setDrawRange(0, vertices);
  }
  _scheduleSurface(time) {
    const interval = this.quality === 'fast' ? 45 : this.quality === 'balanced' ? 30 : 25;
    if (this.flowMode === 'vascular' || this._surfaceBusy || !this._surfaceDirty || !this.particleCount || time - this._lastSurfaceSent < interval) return;
    const positions = this.positionAttribute.array.slice(0, this.particleCount * 3);
    this._surfaceBusy = true; this._surfaceDirty = false; this._lastSurfaceSent = time;
    this.surfaceWorker.postMessage({ type: 'surface', positions, count: this.particleCount, radius: this.radius, quality: this.quality, smoothness: this.optics.smoothness }, [positions.buffer]);
  }
  _bindEvents() {
    const canvas = this.renderer.domElement;
    this._onDown = (event) => {
      if (this.interactionMode !== 'stir' || event.button !== 0 || event.altKey) return;
      this.isDragging = true;
      canvas.setPointerCapture(event.pointerId);
      const normal = this.camera.getWorldDirection(new THREE.Vector3());
      this.interactionPlane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, 1.25, 0));
      this._readPointer(event);
      this.previousPoint.copy(this.interactionPoint);
      this._interactionTime = performance.now();
      canvas.classList.add('is-stirring');
      this.onInteract?.({ active: true, position: this.interactionPoint.toArray(), force: [0, 0, 0] });
    };
    this._onMove = (event) => {
      if (!this.isDragging) return;
      this._readPointer(event);
      const now = performance.now();
      const dt = Math.max((now - this._interactionTime) / 1000, 0.008);
      const force = this.interactionPoint.clone().sub(this.previousPoint).divideScalar(dt).clampLength(0, 22);
      this.onInteract?.({ active: true, position: this.interactionPoint.toArray(), force: force.toArray() });
      this.previousPoint.copy(this.interactionPoint);
      this._interactionTime = now;
    };
    this._onUp = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      canvas.classList.remove('is-stirring');
      this.onInteract?.({ active: false, position: this.interactionPoint.toArray(), force: [0, 0, 0] });
    };
    this._onContextMenu = (event) => event.preventDefault();
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    canvas.addEventListener('lostpointercapture', this._onUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  _readPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.interactionPlane, this.interactionPoint);
    this.interactionPoint.x = THREE.MathUtils.clamp(this.interactionPoint.x, -1.7, 1.7);
    this.interactionPoint.y = THREE.MathUtils.clamp(this.interactionPoint.y, 0.08, 3.4);
    this.interactionPoint.z = THREE.MathUtils.clamp(this.interactionPoint.z, -1.3, 1.3);
  }

  setParticles(positions, count = positions.length / 3) {
    const n = Math.floor(count);
    if (n > this.capacity || !this.particleGeometry.getAttribute('position')) {
      this.capacity = Math.max(n, 8192);
      this.positionAttribute = new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.particleGeometry.setAttribute('position', this.positionAttribute);
    }
    this.positionAttribute.array.set(positions.subarray(0, n * 3));
    this.positionAttribute.needsUpdate = true;
    this.particleGeometry.setDrawRange(0, n);
    this.particleCount = n; this._surfaceDirty = true;
    this.shadowMaterial.uniforms.uParticleWeight.value = 3600 / Math.max(1, n);
  }
  setParticleRadius(radius) {
    const next = THREE.MathUtils.clamp(radius, 0.025, 0.2);
    if (Math.abs(next - this.radius) > 0.00001) this._surfaceDirty = true;
    this.radius = next;
  }
  setMaterial(name) {
    this.materialName = name;
    const preset = MATERIALS[name] || MATERIALS.water;
    const material = this.surfaceMaterial;
    material.color.setHex(preset.color);
    material.attenuationColor.setHex(preset.attenuation);
    material.metalness = preset.metalness;
    material.transmission = preset.transmission;
    material.roughness = preset.roughness + (1 - this.optics.clarity) * 0.085;
    material.attenuationDistance = preset.distance * (0.35 + this.optics.clarity * 0.85);
    material.iridescence = preset.iridescence || 0;
    material.iridescenceIOR = 1.38;
    material.iridescenceThicknessRange = [100, 850];
    material.anisotropy = preset.anisotropy || 0;
    material.sheen = preset.sheen || 0;
    material.sheenColor.setHex(0x96bdff);
    material.sheenRoughness = 0.23;
    material.clearcoat = preset.clearcoat || 0;
    material.clearcoatRoughness = 0.07;
    this.liquidUniforms.uLiquidMode.value = preset.mode || 0;
    material.needsUpdate = true;
    this.vesselFlow?.setMaterial(material);
  }
  setFlowMode(mode) {
    const vascular = mode === 'vascular';
    const changed = this.flowMode !== (vascular ? 'vascular' : 'liquid');
    if (vascular && !this.vesselFlow) {
      this.vesselFlow = new VesselFlow({ material: this.surfaceMaterial });
      this.vesselFlow.setDilation(this.vesselDilation);
      this.vesselFlow.setFlow(this.vesselFlowSpeed);
      this.baseScene.add(this.vesselFlow);
    }
    this.flowMode = vascular ? 'vascular' : 'liquid';
    this.surface.visible = !vascular;
    this.vesselFlow?.setEnabled(vascular);
    if (vascular && changed) this.resetVessel();
    if (!vascular) this._surfaceDirty = true;
    if (this.isDragging) this._onUp();
  }
  setVesselDilation(value) {
    this.vesselDilation = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    this.vesselFlow?.setDilation(this.vesselDilation);
  }
  setVesselFlow(value) {
    this.vesselFlowSpeed = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
    this.vesselFlow?.setFlow(this.vesselFlowSpeed);
  }
  setVesselPulse(value) {
    this.vesselPulse = THREE.MathUtils.clamp(Number(value) || 0, 0, 2);
    this.vesselFlow?.setPulse(this.vesselPulse);
  }
  resetVessel() {
    this.vesselEpoch = this._opticalTime;
    this.vesselPulse = 0;
    this.vesselFlow?.reset?.();
  }
  setTimeScale(value = 1) {
    this.timeScale = THREE.MathUtils.clamp(Number(value) || 1, 0.1, 1);
  }
  setOptics(next = {}) {
    for (const key of ['smoothness', 'clarity', 'dispersion']) if (Number.isFinite(Number(next[key]))) this.optics[key] = THREE.MathUtils.clamp(Number(next[key]), 0, 1);
    this.surfaceMaterial.dispersion = this.optics.dispersion * 0.28;
    this.surfaceMaterial.thickness = 0.75 + (1 - this.optics.clarity) * 0.85;
    this.setMaterial(this.materialName || 'water');
    this._surfaceDirty = true;
  }
  setLightPulse(value) { this.lightPulse = THREE.MathUtils.clamp(Number(value) || 0, 0, 2); }
  setQuality(quality) {
    this.quality = ['fast', 'balanced', 'high', 'ultra'].includes(quality) ? quality : 'balanced';
    this._surfaceDirty = true; this.resize();
  }
  setEnvironment(name) {
    const value = ({ studio: 0, dusk: 1, sunset: 1, warm: 1, night: 2, midnight: 2, arctic: 2, cool: 2 })[name] ?? 0;
    this.environmentName = name;
    this.floorMaterial.uniforms.uTint.value.setRGB(...(value === 1 ? [0.048, 0.031, 0.024] : value === 2 ? [0.021, 0.033, 0.063] : [0.028, 0.036, 0.043]));
    this.baseScene.background.setHex(value === 1 ? 0x15100d : value === 2 ? 0x080e1a : 0x0b1016);
    this.baseScene.environmentRotation.y = value === 1 ? 1.75 : value === 2 ? -0.75 : 0.45;
    this.keyLight.color.setHex(value === 1 ? 0xffe4ba : value === 2 ? 0x9dccff : 0xd7f2ff);
    this.fillLight.color.setHex(value === 1 ? 0xffa774 : value === 2 ? 0xa1adff : 0xffe3bf);
  }
  setAutoRotate(value) { this.controls.autoRotate = Boolean(value); }
  setPaused(value) { this.paused = Boolean(value); }
  setInteractionMode(mode) {
    this.interactionMode = mode === 'orbit' ? 'orbit' : 'stir';
    this.controls.mouseButtons.LEFT = this.interactionMode === 'orbit' ? THREE.MOUSE.ROTATE : null;
    this.controls.touches.ONE = this.interactionMode === 'orbit' ? THREE.TOUCH.ROTATE : null;
    this.renderer.domElement.style.cursor = this.interactionMode === 'orbit' ? 'grab' : 'crosshair';
    if (this.isDragging) this._onUp();
  }
  resetCamera() {
    this.camera.position.set(5.0, 3.8, 5.8);
    this.controls.target.set(0, 1.18, 0); this.controls.update();
  }
  resize() {
    if (this._disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'ultra' ? 2 : this.quality === 'fast' ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(width, height, false);
    this.renderer.transmissionResolutionScale = this.quality === 'fast' ? 0.65 : this.quality === 'balanced' ? 0.85 : 1;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  render(time = performance.now()) {
    if (this._disposed) return;
    const delta = this._lastTime === null ? 1 / 60 : Math.min((time - this._lastTime) / 1000, 0.1);
    this._lastTime = time; this.controls.update(delta); this._scheduleSurface(time);
    if (!this.paused) this._opticalTime += delta * this.timeScale;
    this.floorMaterial.uniforms.uTime.value = this._opticalTime;
    this.floorMaterial.uniforms.uPulse.value = this.lightPulse;
    this.liquidUniforms.uLiquidTime.value = this._opticalTime;
    this.liquidUniforms.uLiquidAudio.value = this.lightPulse;
    this.surfaceMaterial.anisotropyRotation = this._opticalTime * 0.075;
    if (this.flowMode === 'vascular') {
      this.vesselFlow?.setPulse(this.vesselPulse);
      this.vesselFlow?.update((this._opticalTime - this.vesselEpoch) * 1000);
    }
    this.keyLight.intensity = 2.1 + this.lightPulse * 0.45;
    this.renderer.toneMappingExposure = 1.14 + this.lightPulse * 0.055;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.shadowTarget); this.renderer.clear();
    if (this.particleCount && this.flowMode !== 'vascular') this.renderer.render(this.shadowScene, this.shadowCamera);
    this.renderer.setRenderTarget(null); this.renderer.render(this.baseScene, this.camera);
  }
  capture() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._resizeObserver.disconnect(); this.surfaceWorker.terminate(); this.controls.dispose();
    this.vesselFlow?.dispose();
    const canvas = this.renderer.domElement;
    for (const [type, fn] of [['pointerdown', this._onDown], ['pointermove', this._onMove], ['pointerup', this._onUp], ['pointercancel', this._onUp], ['lostpointercapture', this._onUp], ['contextmenu', this._onContextMenu]]) canvas.removeEventListener(type, fn);
    this.shadowTarget.dispose(); this.environmentTarget.dispose();
    for (const material of [this.shadowMaterial, this.floorMaterial, this.surfaceMaterial, this.boundary.material]) material.dispose();
    for (const geometry of [this.particleGeometry, this.surfaceGeometry, this.floor.geometry, this.boundary.geometry]) geometry.dispose();
    this.renderer.dispose(); canvas.remove();
  }
}

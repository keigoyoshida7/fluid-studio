import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Screen-space fluid: sphere depth -> bilateral surface reconstruction ->
// Beer–Lambert transmission and a procedural photographic studio reflection.
// The simulation stays in world space; no image or remote environment is used.
const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const PARTICLE_VERTEX = /* glsl */ `
  uniform float uRadius;
  uniform float uHeight;
  varying vec3 vCenter;
  void main() {
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    vCenter = p.xyz;
    gl_Position = projectionMatrix * p;
    gl_PointSize = max(1.0, uRadius * uHeight * projectionMatrix[1][1] / -p.z);
  }
`;

const DEPTH_FRAGMENT = /* glsl */ `
  uniform float uRadius;
  uniform mat4 uProjection;
  varying vec3 vCenter;
  void main() {
    vec2 xy = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(xy, xy);
    if (r2 > 1.0) discard;
    vec3 p = vCenter + vec3(xy.x, -xy.y, sqrt(1.0 - r2)) * uRadius;
    vec4 clip = uProjection * vec4(p, 1.0);
    gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    gl_FragColor = vec4(-p.z, 0.0, 0.0, 1.0);
  }
`;

const THICKNESS_FRAGMENT = /* glsl */ `
  uniform float uRadius;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(sqrt(1.0 - r2) * uRadius * 0.52, 0.0, 0.0, 1.0);
  }
`;

const BLUR_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uDepth;
  uniform vec2 uDirection;
  uniform float uSmooth;
  void main() {
    float center = texture2D(uDepth, vUv).r;
    if (center < 0.01) { gl_FragColor = vec4(0.0); return; }
    float total = 0.0;
    float weight = 0.0;
    for (int i = -7; i <= 7; i++) {
      float x = float(i);
      float z = texture2D(uDepth, vUv + uDirection * x).r;
      float dz = (z - center) / uSmooth;
      float w = exp(-x * x / 34.0 - dz * dz);
      w *= step(0.01, z);
      total += z * w;
      weight += w;
    }
    gl_FragColor = vec4(total / max(weight, 0.0001), 0.0, 0.0, 1.0);
  }
`;

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
  uniform vec3 uTint;
  uniform float uLight;
  uniform float uTime;
  uniform sampler2D uShadow;
  float grid(vec2 p, float spacing) {
    vec2 q = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 width = fwidth(p) * 0.85;
    return 1.0 - min(smoothstep(0.0, width.x, q.x), smoothstep(0.0, width.y, q.y));
  }
  void main() {
    vec2 p = vWorld.xz;
    float stage = 1.0 - smoothstep(1.5, 2.7, length(p * vec2(0.65, 0.9)));
    float light = exp(-dot(p - vec2(-1.8, -2.5), p - vec2(-1.8, -2.5)) * 0.025);
    vec3 col = uTint * (0.52 + 0.6 * light) + vec3(0.012) * stage;
    float fade = exp(-dot(p, p) * 0.025);
    col += vec3(0.007, 0.010, 0.011) * grid(p, 0.5) * fade;
    col += vec3(0.005, 0.007, 0.008) * grid(p, 2.0) * fade;
    vec2 shadowUV = (vec2(p.x, -p.y) + vec2(2.5)) / 5.0;
    float shadow = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        shadow += texture2D(uShadow, shadowUV + vec2(float(x), float(y)) * 0.003).r;
      }
    }
    col *= 1.0 - min(0.65, shadow * 0.08);
    col *= uLight;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SHADOW_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = position.y;
    vec4 p = vec4(position.x, 0.0, position.z, 1.0);
    gl_Position = projectionMatrix * viewMatrix * p;
    gl_PointSize = 15.0 + position.y * 3.0;
  }
`;
const SHADOW_FRAGMENT = /* glsl */ `
  varying float vHeight;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float opacity = exp(-r * 4.0) * 0.12 / (1.0 + vHeight * 0.6);
    gl_FragColor = vec4(opacity, 0.0, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uBackground;
  uniform sampler2D uDepth;
  uniform sampler2D uThickness;
  uniform vec2 uTexel;
  uniform mat4 uInverseProjection;
  uniform mat4 uCameraWorld;
  uniform vec3 uCameraPosition;
  uniform vec3 uAbsorption;
  uniform vec3 uScatter;
  uniform vec3 uEnvironmentTint;
  uniform float uMetalness;
  uniform float uEnvironment;
  uniform float uTime;

  vec3 viewPosition(vec2 uv, float depth) {
    vec4 p = uInverseProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    return p.xyz * (-depth / p.z);
  }

  float softbox(vec3 direction, vec3 facing, float sx, float sy, float blur) {
    facing = normalize(facing);
    float front = dot(direction, facing);
    if (front <= 0.0) return 0.0;
    vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), facing));
    vec3 vertical = cross(facing, horizontal);
    vec2 p = vec2(dot(direction, horizontal), dot(direction, vertical)) / front;
    return (1.0 - smoothstep(sx, sx + blur, abs(p.x))) *
           (1.0 - smoothstep(sy, sy + blur, abs(p.y)));
  }

  vec3 environment(vec3 r) {
    float up = smoothstep(-0.4, 0.8, r.y);
    vec3 col = mix(vec3(0.017, 0.024, 0.027), vec3(0.15, 0.20, 0.22), up);
    col *= uEnvironmentTint;
    col += vec3(1.0, 1.04, 1.02) * softbox(r, vec3(-0.5, 1.0, 0.4), 0.75, 0.22, 0.065) * 2.4;
    col += vec3(0.66, 0.86, 1.0) * softbox(r, vec3(0.9, 0.4, -0.8), 0.13, 0.72, 0.035) * 1.8;
    col += vec3(1.0, 0.90, 0.76) * softbox(r, vec3(-0.95, 0.15, -0.9), 0.11, 0.65, 0.045) * 1.0;
    col += vec3(0.43, 0.65, 0.69) * pow(max(0.0, r.y), 4.0) * 0.3;
    if (uEnvironment > 0.5 && uEnvironment < 1.5) {
      col *= vec3(1.24, 0.89, 0.68);
      col += vec3(0.48, 0.14, 0.025) * pow(max(dot(r, normalize(vec3(-1.0, 0.18, 0.6))), 0.0), 16.0);
    }
    if (uEnvironment > 1.5) {
      col *= vec3(0.63, 0.82, 1.2);
      col += vec3(0.16, 0.32, 0.7) * pow(max(dot(r, normalize(vec3(1.0, 0.2, -0.3))), 0.0), 12.0);
    }
    return col;
  }

  vec3 aces(vec3 c) {
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec3 background = texture2D(uBackground, vUv).rgb;
    float d = texture2D(uDepth, vUv).r;
    vec3 color = background;
    if (d > 0.01) {
      vec2 normalStep = uTexel * 1.8;
      float dl = texture2D(uDepth, vUv - vec2(normalStep.x, 0.0)).r;
      float dr = texture2D(uDepth, vUv + vec2(normalStep.x, 0.0)).r;
      float db = texture2D(uDepth, vUv - vec2(0.0, normalStep.y)).r;
      float dt = texture2D(uDepth, vUv + vec2(0.0, normalStep.y)).r;
      vec3 p = viewPosition(vUv, d);
      vec3 dx1 = viewPosition(vUv + vec2(normalStep.x, 0.0), dr) - p;
      vec3 dx2 = p - viewPosition(vUv - vec2(normalStep.x, 0.0), dl);
      vec3 dy1 = viewPosition(vUv + vec2(0.0, normalStep.y), dt) - p;
      vec3 dy2 = p - viewPosition(vUv - vec2(0.0, normalStep.y), db);
      vec3 dx = abs(dr - d) < abs(d - dl) ? dx1 : dx2;
      vec3 dy = abs(dt - d) < abs(d - db) ? dy1 : dy2;
      vec3 normal = normalize(cross(dx, dy));
      if (normal.z < 0.0) normal = -normal;
      vec3 worldNormal = normalize(mat3(uCameraWorld) * normal);
      vec3 worldPosition = (uCameraWorld * vec4(p, 1.0)).xyz;
      vec3 viewDirection = normalize(uCameraPosition - worldPosition);
      float facing = clamp(dot(worldNormal, viewDirection), 0.0, 1.0);
      float thickness = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          thickness += texture2D(uThickness, vUv + vec2(float(x), float(y)) * uTexel * 2.0).r;
        }
      }
      thickness = clamp(thickness / 9.0, 0.0, 3.5);
      vec2 refractUV = clamp(vUv + normal.xy * (0.013 + thickness * 0.047) / max(0.6, d * 0.12), vec2(0.002), vec2(0.998));
      vec3 refracted = texture2D(uBackground, refractUV).rgb;
      // A softened transmitted environment keeps clear water legible against a dark stage.
      vec3 refractionDirection = refract(-viewDirection, worldNormal, 1.0 / 1.333);
      refracted = mix(refracted, environment(refractionDirection), 0.16);
      vec3 transmission = exp(-uAbsorption * (thickness * 2.3 + 0.06));
      vec3 body = refracted * transmission + uScatter * (1.0 - transmission) * 0.48;
      float fresnel = 0.035 + 0.965 * pow(1.0 - facing, 5.0);
      fresnel = mix(fresnel, 0.86 + 0.14 * pow(1.0 - facing, 5.0), uMetalness);
      vec3 reflected = environment(reflect(-viewDirection, worldNormal));
      color = body * (1.0 - fresnel) + reflected * fresnel;
      // Broad photographic highlight and a small crisp grazing highlight.
      vec3 lightDirection = normalize(vec3(-0.5, 1.0, 0.4));
      vec3 halfVector = normalize(lightDirection + viewDirection);
      float specular = pow(max(dot(worldNormal, halfVector), 0.0), 170.0);
      color += vec3(0.85, 0.97, 1.0) * specular * 0.30;
      color *= mix(vec3(1.0), uScatter * 0.28 + 0.75, uMetalness);
      float coverage = smoothstep(0.001, 0.027, thickness);
      color = mix(background, color, coverage);
    }
    float vignette = 1.0 - smoothstep(0.32, 0.95, length((vUv - 0.5) * vec2(1.0, 0.85))) * 0.2;
    color *= vignette;
    color = aces(color * 1.28);
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    // Fine static dithering avoids bands on the dark exhibition background.
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    gl_FragColor = vec4(color + grain / 255.0, 1.0);
  }
`;

const MATERIALS = {
  water: { absorption: [0.78, 0.19, 0.12], scatter: [0.22, 0.74, 0.78], metalness: 0 },
  aqua: { absorption: [0.78, 0.19, 0.12], scatter: [0.22, 0.74, 0.78], metalness: 0 },
  amber: { absorption: [0.2, 1.35, 4.8], scatter: [1.0, 0.48, 0.055], metalness: 0 },
  ink: { absorption: [8.0, 6.0, 4.0], scatter: [0.055, 0.10, 0.15], metalness: 0 },
  chrome: { absorption: [4.0, 4.0, 4.0], scatter: [0.74, 0.84, 0.9], metalness: 1 },
  mercury: { absorption: [4.0, 4.0, 4.0], scatter: [0.74, 0.84, 0.9], metalness: 1 },
};

export class FluidRenderer {
  constructor(container, { onInteract } = {}) {
    this.container = container;
    this.onInteract = onInteract;
    this.radius = 0.075;
    this.quality = 'balanced';
    this.interactionMode = 'stir';
    this.isDragging = false;
    this.particleCount = 0;
    this.capacity = 0;
    this._lastTime = null;
    this._disposed = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x080c0e, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.className = 'fluid-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive three dimensional fluid simulation. Drag to stir the water.');
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(41, 1, 0.1, 70);
    this.camera.position.set(5.0, 3.8, 5.8);
    this.camera.lookAt(0, 1.2, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.18, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4.8;
    this.controls.maxDistance = 15;
    this.controls.minPolarAngle = 0.22;
    this.controls.maxPolarAngle = 1.48;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches.ONE = null;
    this.controls.update();

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(this.quadGeometry, new THREE.MeshBasicMaterial());
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.particleGeometry = new THREE.BufferGeometry();
    this.particleScene = new THREE.Scene();
    this.particleUniforms = { uRadius: { value: this.radius }, uHeight: { value: 600 }, uProjection: { value: this.camera.projectionMatrix } };
    this.depthMaterial = new THREE.ShaderMaterial({ uniforms: this.particleUniforms, vertexShader: PARTICLE_VERTEX, fragmentShader: DEPTH_FRAGMENT, depthTest: true, depthWrite: true });
    this.thicknessMaterial = new THREE.ShaderMaterial({ uniforms: this.particleUniforms, vertexShader: PARTICLE_VERTEX, fragmentShader: THICKNESS_FRAGMENT, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    this.particles = new THREE.Points(this.particleGeometry, this.depthMaterial);
    this.particles.frustumCulled = false;
    this.particleScene.add(this.particles);

    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: { uDepth: { value: null }, uDirection: { value: new THREE.Vector2() }, uSmooth: { value: 0.18 } },
      vertexShader: QUAD_VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false,
    });

    const floatType = this.renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.hasFloatTargets = floatType === THREE.HalfFloatType;
    if (!this.hasFloatTargets) throw new Error('Floating point render targets are required. Please enable hardware acceleration or use a recent browser.');
    const surfaceOptions = { type: floatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false };
    // Linear depth needs 32 bits: half precision visibly quantizes reconstructed
    // normals once the camera is several metres from a millimetre-sized texel.
    const depthFilter = this.renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, { ...surfaceOptions, type: THREE.FloatType });
    this.blurA = new THREE.WebGLRenderTarget(1, 1, { ...surfaceOptions, type: THREE.FloatType, minFilter: depthFilter, magFilter: depthFilter, depthBuffer: false });
    this.blurB = new THREE.WebGLRenderTarget(1, 1, { ...surfaceOptions, type: THREE.FloatType, minFilter: depthFilter, magFilter: depthFilter, depthBuffer: false });
    this.thicknessTarget = new THREE.WebGLRenderTarget(1, 1, { ...surfaceOptions, depthBuffer: false });
    this.backgroundTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    this.shadowTarget = new THREE.WebGLRenderTarget(384, 384, { ...surfaceOptions, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.shadowMaterial = new THREE.ShaderMaterial({ vertexShader: SHADOW_VERTEX, fragmentShader: SHADOW_FRAGMENT, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    this.shadowCamera = new THREE.OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 20);
    this.shadowCamera.position.set(0, 10, 0);
    this.shadowCamera.up.set(0, 0, -1);
    this.shadowCamera.lookAt(0, 0, 0);

    this.baseScene = new THREE.Scene();
    this.baseScene.background = new THREE.Color(0x080d10);
    this.floorMaterial = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(0.014, 0.019, 0.021) }, uLight: { value: 1 }, uTime: { value: 0 }, uShadow: { value: this.shadowTarget.texture } },
      vertexShader: FLOOR_VERTEX, fragmentShader: FLOOR_FRAGMENT,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), this.floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.048;
    this.baseScene.add(this.floor);
    this._buildBoundary();

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBackground: { value: this.backgroundTarget.texture }, uDepth: { value: this.depthTarget.texture }, uThickness: { value: this.thicknessTarget.texture },
        uTexel: { value: new THREE.Vector2(1 / 800, 1 / 600) }, uInverseProjection: { value: this.camera.projectionMatrixInverse }, uCameraWorld: { value: this.camera.matrixWorld },
        uCameraPosition: { value: this.camera.position }, uAbsorption: { value: new THREE.Vector3() }, uScatter: { value: new THREE.Vector3() },
        uMetalness: { value: 0 }, uEnvironment: { value: 0 }, uEnvironmentTint: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 },
      },
      vertexShader: QUAD_VERTEX, fragmentShader: COMPOSITE_FRAGMENT, depthTest: false, depthWrite: false,
    });
    this.setMaterial('water');
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

  _buildBoundary() {
    // An open, thin wire stage indicates the simulation domain without enclosing
    // the water in opaque glass. Short vertical corner ticks keep it unobtrusive.
    const points = [];
    const x = 1.77;
    const z = 1.37;
    const y = -0.018;
    for (const [a, b] of [
      [[-x, y, -z], [x, y, -z]], [[x, y, -z], [x, y, z]],
      [[x, y, z], [-x, y, z]], [[-x, y, z], [-x, y, -z]],
    ]) points.push(...a, ...b);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      points.push(sx * x, y, sz * z, sx * x, 0.22, sz * z);
      points.push(sx * x, 3.30, sz * z, sx * x, 3.43, sz * z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x74979c, transparent: true, opacity: 0.23, depthWrite: false });
    this.boundary = new THREE.LineSegments(geometry, material);
    this.baseScene.add(this.boundary);
    const marker = new THREE.GridHelper(3.5, 1, 0x617b80, 0x617b80);
    marker.position.y = -0.02;
    marker.scale.z = 2.74 / 3.5;
    marker.material.transparent = true;
    marker.material.opacity = 0.08;
    this.baseScene.add(marker);
    this.stageMarker = marker;
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
      this.positionAttribute = new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3);
      this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
      this.particleGeometry.setAttribute('position', this.positionAttribute);
    }
    this.positionAttribute.array.set(positions.subarray(0, n * 3));
    this.positionAttribute.needsUpdate = true;
    this.particleGeometry.setDrawRange(0, n);
    this.particleCount = n;
  }

  setParticleRadius(radius) {
    this.radius = THREE.MathUtils.clamp(radius, 0.025, 0.2);
    this.particleUniforms.uRadius.value = this.radius;
    this.blurMaterial.uniforms.uSmooth.value = this.radius * 2.4;
  }

  setMaterial(name) {
    const material = MATERIALS[name] || MATERIALS.water;
    this.materialName = name;
    this.compositeMaterial.uniforms.uAbsorption.value.fromArray(material.absorption);
    this.compositeMaterial.uniforms.uScatter.value.fromArray(material.scatter);
    this.compositeMaterial.uniforms.uMetalness.value = material.metalness;
  }

  setQuality(quality) {
    this.quality = ['fast', 'balanced', 'high', 'ultra'].includes(quality) ? quality : 'balanced';
    this.resize();
  }

  setEnvironment(name) {
    const value = ({ studio: 0, dusk: 1, sunset: 1, warm: 1, night: 2, midnight: 2, arctic: 2, cool: 2 })[name] ?? 0;
    this.environmentName = name;
    this.compositeMaterial.uniforms.uEnvironment.value = value;
    this.floorMaterial.uniforms.uTint.value.setRGB(...(value === 1 ? [0.022, 0.016, 0.012] : value === 2 ? [0.011, 0.016, 0.029] : [0.014, 0.019, 0.021]));
    this.baseScene.background.setRGB(...(value === 1 ? [0.012, 0.008, 0.007] : value === 2 ? [0.006, 0.009, 0.016] : [0.008, 0.013, 0.016]));
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
    this.controls.target.set(0, 1.18, 0);
    this.controls.update();
  }

  resize() {
    if (this._disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'ultra' ? 2 : this.quality === 'fast' ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const scale = this.quality === 'ultra' ? 0.95 : this.quality === 'high' ? 0.78 : this.quality === 'fast' ? 0.58 : 0.61;
    const maxDimension = this.quality === 'ultra' ? 1800 : this.quality === 'high' ? 1400 : 1100;
    const fluidScale = Math.min(dpr * scale, maxDimension / Math.max(width, height));
    this.fluidWidth = Math.max(2, Math.round(width * fluidScale));
    this.fluidHeight = Math.max(2, Math.round(height * fluidScale));
    for (const target of [this.depthTarget, this.blurA, this.blurB, this.thicknessTarget]) target.setSize(this.fluidWidth, this.fluidHeight);
    this.backgroundTarget.setSize(Math.round(width * dpr), Math.round(height * dpr));
    this.particleUniforms.uHeight.value = this.fluidHeight;
    this.compositeMaterial.uniforms.uTexel.value.set(1 / this.fluidWidth, 1 / this.fluidHeight);
  }

  _renderQuad(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(time = performance.now()) {
    if (this._disposed) return;
    const delta = this._lastTime === null ? 1 / 60 : Math.min((time - this._lastTime) / 1000, 0.1);
    this._lastTime = time;
    this.controls.update(delta);
    this.camera.updateMatrixWorld();
    this.compositeMaterial.uniforms.uTime.value = time / 1000;
    this.floorMaterial.uniforms.uTime.value = time / 1000;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.clear();
    if (this.particleCount) {
      this.particles.material = this.shadowMaterial;
      this.renderer.render(this.particleScene, this.shadowCamera);
    }
    this.renderer.setRenderTarget(this.backgroundTarget);
    this.renderer.render(this.baseScene, this.camera);
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.clear();
    if (this.particleCount) {
      this.particles.material = this.depthMaterial;
      this.renderer.render(this.particleScene, this.camera);
    }
    this.renderer.setRenderTarget(this.thicknessTarget);
    this.renderer.clear();
    if (this.particleCount) {
      this.particles.material = this.thicknessMaterial;
      this.renderer.render(this.particleScene, this.camera);
    }
    let input = this.depthTarget;
    const iterations = this.quality === 'ultra' ? 5 : this.quality === 'high' ? 4 : this.quality === 'fast' ? 2 : 3;
    for (let i = 0; i < iterations; i++) {
      this.blurMaterial.uniforms.uDepth.value = input.texture;
      this.blurMaterial.uniforms.uDirection.value.set(1.5 / this.fluidWidth, 0);
      this._renderQuad(this.blurMaterial, this.blurA);
      this.blurMaterial.uniforms.uDepth.value = this.blurA.texture;
      this.blurMaterial.uniforms.uDirection.value.set(0, 1.5 / this.fluidHeight);
      this._renderQuad(this.blurMaterial, this.blurB);
      input = this.blurB;
    }
    this.compositeMaterial.uniforms.uDepth.value = input.texture;
    this._renderQuad(this.compositeMaterial, null);
  }

  capture() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._resizeObserver.disconnect();
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    for (const [type, fn] of [['pointerdown', this._onDown], ['pointermove', this._onMove], ['pointerup', this._onUp], ['pointercancel', this._onUp], ['lostpointercapture', this._onUp], ['contextmenu', this._onContextMenu]]) canvas.removeEventListener(type, fn);
    for (const target of [this.depthTarget, this.blurA, this.blurB, this.thicknessTarget, this.backgroundTarget, this.shadowTarget]) target.dispose();
    for (const material of [this.depthMaterial, this.thicknessMaterial, this.blurMaterial, this.shadowMaterial, this.floorMaterial, this.compositeMaterial, this.boundary.material, this.stageMarker.material]) material.dispose();
    for (const geometry of [this.particleGeometry, this.quadGeometry, this.floor.geometry, this.boundary.geometry, this.stageMarker.geometry]) geometry.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

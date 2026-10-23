import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const SAMPLES = 256;
const PATHS = [
  { radius: 0.19, points: [[-0.25, 0.30, -0.15], [-0.16, 0.7, 0.1], [0.05, 1.18, 0.04], [0, 1.72, 0]] },
  { radius: 0.13, points: [[0, 1.53, 0], [-0.15, 1.9, 0.06], [-0.62, 2.21, 0.2], [-1.06, 2.68, 0.07], [-1.14, 3.12, -0.1]] },
  { radius: 0.13, points: [[0, 1.53, 0], [0.18, 1.92, -0.03], [0.60, 2.22, -0.08], [0.87, 2.60, -0.23], [1.2, 3.05, -0.15]] },
  { radius: 0.075, points: [[-0.52, 2.14, 0.18], [-0.85, 2.27, 0.22], [-1.24, 2.38, 0.46], [-1.48, 2.66, 0.62]] },
  { radius: 0.075, points: [[0.50, 2.15, -0.07], [0.86, 2.3, 0.18], [1.15, 2.43, 0.48], [1.39, 2.75, 0.65]] },
  { radius: 0.10, points: [[-0.05, 1.22, 0.01], [0.15, 1.50, -0.30], [0.19, 1.95, -0.68], [-0.05, 2.28, -0.96], [-0.22, 2.66, -1.03]] },
  { radius: 0.09, points: [[-0.16, 0.77, 0.08], [-0.43, 1.05, 0.39], [-0.55, 1.55, 0.65], [-0.44, 1.98, 0.91], [-0.69, 2.39, 1.04]] },
];

const VESSEL_VERTEX = /* glsl */ `
  attribute vec3 aVesselCenter;
  attribute float aVesselProgress;
  uniform float uVesselTime;
  uniform float uVesselDilation;
  uniform float uVesselPulse;
  uniform float uVesselLayer;
`;
const VESSEL_TRANSFORM = /* glsl */ `
  #include <begin_vertex>
  float vesselTaper = 0.70 + 0.30 * sin(aVesselProgress * 3.14159265);
  float vesselWave = pow(max(0.0, sin(uVesselTime * 5.0 - aVesselProgress * 14.0)), 6.0);
  float vesselScale = (1.0 + 0.65 * uVesselDilation) * (1.0 + 0.055 * uVesselPulse * vesselWave);
  transformed = aVesselCenter + (position - aVesselCenter) * vesselTaper * vesselScale * uVesselLayer;
`;

const TRACER_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aPath;
  uniform sampler2D uCenters;
  uniform sampler2D uNormals;
  uniform sampler2D uBinormals;
  uniform float uDistance;
  uniform float uVesselTime;
  uniform float uVesselDilation;
  uniform float uVesselPulse;
  varying float vAlpha;
  vec4 samplePath(sampler2D field, float progress) {
    float index = progress * 255.0;
    float first = floor(index);
    vec2 a = vec2((first + 0.5) / 256.0, aPath);
    vec2 b = vec2((min(first + 1.0, 255.0) + 0.5) / 256.0, aPath);
    return mix(texture2D(field, a), texture2D(field, b), fract(index));
  }
  void main() {
    float pathLength = texture2D(uNormals, vec2(0.5 / 256.0, aPath)).a;
    float profile = 1.0 - aSeed.y * aSeed.y;
    float progress = fract(aSeed.x + uDistance * profile / max(pathLength, 0.1));
    vec4 center = samplePath(uCenters, progress);
    vec3 normal = normalize(samplePath(uNormals, progress).xyz);
    vec3 binormal = normalize(samplePath(uBinormals, progress).xyz);
    float taper = 0.70 + 0.30 * sin(progress * 3.14159265);
    float wave = pow(max(0.0, sin(uVesselTime * 5.0 - progress * 14.0)), 6.0);
    float radius = center.a * taper * (1.0 + 0.65 * uVesselDilation) * (1.0 + 0.055 * uVesselPulse * wave);
    float theta = aSeed.z + 0.04 * sin(uVesselTime * 0.35 + progress * 6.0);
    vec3 radial = normal * cos(theta) + binormal * sin(theta);
    vec3 point = center.xyz + radial * radius * aSeed.y * 0.78;
    vec4 view = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSeed.w * 11.0 / max(1.0, -view.z), 0.65, 2.2);
    vAlpha = (0.08 + aSeed.w * 0.055) * smoothstep(0.0, 0.045, progress) * (1.0 - smoothstep(0.955, 1.0, progress));
  }
`;
const TRACER_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float distance2 = dot(p, p);
    if (distance2 > 1.0) discard;
    gl_FragColor = vec4(vec3(0.86, 0.95, 1.0), exp(-distance2 * 3.4) * vAlpha);
  }
`;

/** GPU-driven artistic vessel study; no biomedical or full-vessel CFD solver. */
export class VesselFlow extends THREE.Group {
  constructor({ material } = {}) {
    super();
    this.group = this;
    this.name = 'Vasodilation';
    this.enabled = false;
    this.visible = false;
    this.dilation = 0;
    this.dilationTarget = 0.35;
    this.flow = 0.5;
    this.flowTarget = 0.5;
    this.pulse = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.lastTime = null;
    this.uniforms = {
      uVesselTime: { value: 0 }, uVesselDilation: { value: 0 }, uVesselPulse: { value: 0 },
    };
    this._fallbackMaterial = new THREE.MeshPhysicalMaterial({ color: 0xe8f4f6, roughness: 0.055, metalness: 0, transmission: 0.88, thickness: 0.16, ior: 1.333, clearcoat: 1 });
    this.wallMaterial = new THREE.MeshPhysicalMaterial();
    this.coreMaterial = new THREE.MeshPhysicalMaterial();
    this.setMaterial(material || this._fallbackMaterial);
    this._buildVessels();
    this._buildTracers();
  }

  setMaterial(material) {
    const source = material?.isMeshPhysicalMaterial ? material : this._fallbackMaterial;
    for (const [target, layer] of [[this.wallMaterial, 1], [this.coreMaterial, 0.77]]) {
      target.copy(source);
      target.transparent = true;
      target.depthWrite = false;
      target.side = THREE.DoubleSide;
      target.forceSinglePass = true;
      target.opacity = layer === 1 ? 0.48 : 0.76;
      target.thickness = layer === 1 ? 0.095 : 0.20;
      target.transmission = layer === 1 ? clamp(source.transmission, 0.45, 0.92) : clamp(source.transmission, 0, 0.88);
      target.roughness = Math.max(0.035, source.roughness);
      if (layer === 1) target.metalness = Math.min(source.metalness, 0.22);
      const compile = source.onBeforeCompile;
      target.onBeforeCompile = (shader, renderer) => {
        compile.call(source, shader, renderer);
        Object.assign(shader.uniforms, this.uniforms, { uVesselLayer: { value: layer } });
        shader.vertexShader = VESSEL_VERTEX + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', VESSEL_TRANSFORM);
      };
      target.customProgramCacheKey = () => `vessel-flow-v1-${layer}-${source.customProgramCacheKey()}`;
      target.needsUpdate = true;
    }
  }

  _buildVessels() {
    this.paths = PATHS.map(definition => {
      const curve = new THREE.CatmullRomCurve3(definition.points.map(point => new THREE.Vector3(...point)), false, 'centripetal');
      curve.arcLengthDivisions = 500;
      curve.updateArcLengths();
      return { curve, radius: definition.radius, length: curve.getLength(), frames: curve.computeFrenetFrames(SAMPLES - 1, false) };
    });
    const pieces = this.paths.map(({ curve, radius }) => {
      const geometry = new THREE.TubeGeometry(curve, 96, radius, 24, false);
      const positions = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      const centers = new Float32Array(positions.count * 3);
      const progress = new Float32Array(positions.count);
      const center = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) {
        const t = uv.getX(index);
        curve.getPointAt(t, center);
        center.toArray(centers, index * 3);
        progress[index] = t;
      }
      geometry.setAttribute('aVesselCenter', new THREE.BufferAttribute(centers, 3));
      geometry.setAttribute('aVesselProgress', new THREE.BufferAttribute(progress, 1));
      return geometry;
    });
    this.vesselGeometry = mergeGeometries(pieces, false);
    pieces.forEach(geometry => geometry.dispose());
    this.wall = new THREE.Mesh(this.vesselGeometry, this.wallMaterial);
    this.core = new THREE.Mesh(this.vesselGeometry, this.coreMaterial);
    this.wall.frustumCulled = this.core.frustumCulled = false;
    this.wall.renderOrder = 2;
    this.core.renderOrder = 1;
    this.add(this.core, this.wall);
  }

  _texture(data) {
    const texture = new THREE.DataTexture(data, SAMPLES, this.paths.length, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  _buildTracers() {
    const centers = new Float32Array(SAMPLES * this.paths.length * 4);
    const normals = new Float32Array(centers.length), binormals = new Float32Array(centers.length);
    const point = new THREE.Vector3();
    this.paths.forEach(({ curve, radius, length, frames }, pathIndex) => {
      for (let index = 0; index < SAMPLES; index++) {
        const offset = (pathIndex * SAMPLES + index) * 4;
        curve.getPointAt(index / (SAMPLES - 1), point).toArray(centers, offset);
        centers[offset + 3] = radius;
        frames.normals[index].toArray(normals, offset);
        normals[offset + 3] = length;
        frames.binormals[index].toArray(binormals, offset);
      }
    });
    this.pathTextures = [this._texture(centers), this._texture(normals), this._texture(binormals)];
    const count = 22000;
    const seeds = new Float32Array(count * 4), path = new Float32Array(count);
    let seed = 671681;
    const random = () => { seed = Math.imul(seed ^ (seed >>> 15), 1 | seed); seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed); return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296; };
    for (let index = 0; index < count; index++) {
      seeds[index * 4] = random();
      seeds[index * 4 + 1] = Math.sqrt(random()) * 0.90;
      seeds[index * 4 + 2] = random() * Math.PI * 2;
      seeds[index * 4 + 3] = 0.65 + random() * 0.75;
      path[index] = ((index % this.paths.length) + 0.5) / this.paths.length;
    }
    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.tracerGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.tracerGeometry.setAttribute('aPath', new THREE.BufferAttribute(path, 1));
    this.tracerMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uCenters: { value: this.pathTextures[0] }, uNormals: { value: this.pathTextures[1] }, uBinormals: { value: this.pathTextures[2] }, uDistance: { value: 0 } },
      vertexShader: TRACER_VERTEX, fragmentShader: TRACER_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.tracers = new THREE.Points(this.tracerGeometry, this.tracerMaterial);
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 3;
    this.add(this.tracers);
  }

  setEnabled(value) { this.enabled = Boolean(value); this.visible = this.enabled; this.lastTime = null; }
  setDilation(value) { this.dilationTarget = clamp(number(value), 0, 1); }
  setFlow(value) { this.flowTarget = clamp(number(value), 0, 1); }
  setPulse(value) { this.pulse = Math.max(this.pulse, clamp(number(value), 0, 2)); }

  reset() {
    this.elapsed = 0;
    this.distance = 0;
    this.lastTime = null;
    this.pulse = 0;
    this.uniforms.uVesselTime.value = 0;
    this.uniforms.uVesselPulse.value = 0;
    this.tracerMaterial.uniforms.uDistance.value = 0;
  }

  update(timeMs) {
    if (!this.enabled) { this.lastTime = null; return; }
    const now = number(timeMs, this.lastTime ?? 0);
    const dt = this.lastTime === null ? 0 : clamp((now - this.lastTime) / 1000, 0, 0.06);
    this.lastTime = now;
    this.elapsed += dt;
    this.dilation += (this.dilationTarget - this.dilation) * (1 - Math.exp(-dt * 0.65));
    this.flow += (this.flowTarget - this.flow) * (1 - Math.exp(-dt * 3));
    this.distance += dt * (0.16 + this.flow * 0.9) * (1 + this.dilation * 0.65) ** 2;
    this.uniforms.uVesselTime.value = this.elapsed;
    this.uniforms.uVesselDilation.value = this.dilation;
    this.uniforms.uVesselPulse.value = this.pulse;
    this.tracerMaterial.uniforms.uDistance.value = this.distance;
    this.pulse *= Math.exp(-dt * 3.7);
  }

  dispose() {
    this.setEnabled(false);
    this.vesselGeometry.dispose();
    this.tracerGeometry.dispose();
    this.wallMaterial.dispose(); this.coreMaterial.dispose(); this.tracerMaterial.dispose();
    this.pathTextures.forEach(texture => texture.dispose());
    this._fallbackMaterial.dispose();
    this.clear();
  }
}

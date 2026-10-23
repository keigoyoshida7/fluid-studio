import * as THREE from 'three';
import { buildFilamentNetwork, FILAMENT_EVENT_COUNT } from './filament-network-core.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const MODES = { pulse: 0, vortex: 1, levitate: 2 };
const SEGMENTS = 8;

const FILAMENT_VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec3 aBow;
  attribute vec4 aMeta;
  attribute vec4 aDistanceA0;
  attribute vec4 aDistanceA1;
  attribute vec4 aDistanceB0;
  attribute vec4 aDistanceB1;
  uniform float uTime;
  uniform float uSpread;
  uniform float uTension;
  uniform float uAfterglow;
  uniform float uPulse;
  uniform float uAutonomy;
  uniform vec4 uBands;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform vec4 uEvents[12];
  uniform vec4 uEventParams[12];
  varying float vSide;
  varying float vWidth;
  varying float vEnergy;
  varying float vSeed;
  varying float vMode;
  varying float vDepth;

  float sourceDistance(vec4 first, vec4 second, float source) {
    if (source < 0.5) return first.x;
    if (source < 1.5) return first.y;
    if (source < 2.5) return first.z;
    if (source < 3.5) return first.w;
    if (source < 4.5) return second.x;
    if (source < 5.5) return second.y;
    if (source < 6.5) return second.z;
    return second.w;
  }
  vec3 nodeMotion(vec3 p) {
    // One continuous world field keeps shared graph junctions joined.
    return vec3(sin(p.y * 5.1 + p.z * 3.7 + uTime * 0.91),
      sin(p.z * 4.6 - p.x * 3.5 + uTime * 0.67),
      sin(p.x * 4.7 + p.y * 2.6 - uTime * 0.79)) * (uAutonomy * 0.0048);
  }
  void main() {
    float t = position.x;
    float seed = aMeta.y;
    float energy = 0.0;
    float vibration = 0.0;
    float strongest = 0.0;
    float waveMode = 0.0;
    for (int i = 0; i < 12; i++) {
      vec4 event = uEvents[i];
      float age = uTime - event.x;
      if (event.y > 0.001 && age >= 0.0 && age < 16.0) {
        float startDistance = sourceDistance(aDistanceA0, aDistanceA1, event.z);
        float endDistance = sourceDistance(aDistanceB0, aDistanceB1, event.z);
        // Both endpoints can receive the front. A junction cannot light before
        // its actual graph path has carried the packet there.
        float distance = min(startDistance + t * aMeta.x, endDistance + (1.0 - t) * aMeta.x);
        float traveled = age * uEventParams[i].x;
        float behind = traveled - distance;
        if (behind > -0.30) {
          float width = 0.09 + age * 0.007;
          float front = exp(-pow(behind / width, 2.0));
          float tail = step(0.0, behind) * exp(-max(0.0, behind) / (0.08 + uAfterglow * 0.82));
          float attenuation = exp(-distance * (0.08 + uEventParams[i].y * 0.35));
          float packet = (front + tail * 0.30) * event.y * attenuation;
          energy += packet;
          vibration += sin(behind * (27.0 + seed * 9.0)) * (front + tail * 0.42) * event.y * attenuation;
          if (packet > strongest) { strongest = packet; waveMode = event.w; }
        }
      }
    }
    float envelope = sin(t * 3.14159265);
    vec3 point = mix(aStart + nodeMotion(aStart), aEnd + nodeMotion(aEnd), t);
    point += aBow * envelope * (1.15 - uTension * 0.87);
    vec3 tangent = normalize(aEnd - aStart);
    vec3 sideways = normalize(cross(tangent, vec3(0.29, 0.91, 0.31)));
    float latent = sin(t * 15.0 + seed * 40.0 - uTime * (2.1 + seed)) * uAutonomy * 0.0018;
    float overtone = sin(t * 37.0 - uTime * 18.0 + seed * 22.0) * uBands.z * 0.003;
    point += sideways * envelope * (vibration * (0.024 - uTension * 0.012) + latent + overtone);
    point = (point - vec3(0.0, 1.65, 0.0)) * (0.93 + 0.20 * uSpread) + vec3(0.0, 1.65, 0.0);
    vec4 viewPoint = modelViewMatrix * vec4(point, 1.0);
    vec4 clip = projectionMatrix * viewPoint;
    vec4 clipNext = projectionMatrix * (viewPoint + modelViewMatrix * vec4(tangent * 0.02, 0.0));
    vec2 direction = (clipNext.xy / clipNext.w - clip.xy / clip.w) * uResolution;
    direction /= max(length(direction), 0.00001);
    vec2 normal = vec2(-direction.y, direction.x);
    // Fixed three-pixel support contains a subpixel core and a localized halo.
    clip.xy += normal * position.y * 1.65 * uPixelRatio * 2.0 / uResolution * clip.w;
    gl_Position = clip;
    vSide = position.y;
    vWidth = aMeta.z;
    vEnergy = min(energy, 3.0);
    vSeed = seed;
    vMode = waveMode;
    vDepth = -viewPoint.z;
  }
`;

const FILAMENT_FRAGMENT = /* glsl */ `
  uniform vec3 uThreadColor;
  uniform vec3 uWaveColor;
  uniform float uPalette;
  uniform float uPulse;
  varying float vSide;
  varying float vWidth;
  varying float vEnergy;
  varying float vSeed;
  varying float vMode;
  varying float vDepth;
  void main() {
    float across = abs(vSide) * 1.65;
    float core = exp(-pow(across / vWidth, 2.0));
    float halo = exp(-pow(across / 0.95, 2.0));
    float depthFade = clamp(1.0 - (vDepth - 5.0) * 0.027, 0.40, 1.0);
    float stillness = (0.14 + vSeed * 0.115) * depthFade;
    vec3 accent = uWaveColor;
    if (uPalette < 0.5 || uPalette > 2.5) {
      if (vMode > 0.5 && vMode < 1.5) accent = mix(accent, vec3(1.6, 0.64, 0.30), 0.28);
      if (vMode > 1.5) accent = mix(accent, vec3(0.32, 0.77, 1.65), 0.30);
    }
    // The narrow advancing crest is near white; its longer tail retains color.
    vec3 frontColor = mix(accent, vec3(1.8), smoothstep(0.55, 1.2, vEnergy) * 0.62);
    float wave = vEnergy * (core * 1.15 + halo * 0.075);
    vec3 color = uThreadColor * core * stillness + frontColor * wave;
    float alpha = clamp(core * stillness + wave * 0.84, 0.0, 0.94);
    if (alpha < 0.003) discard;
    // Additive radiance keeps crossings transparent and hair-fine.
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** An artistic, connected tension network; no anatomical vessel model. */
export class VesselFlow extends THREE.Group {
  constructor({ material } = {}) {
    super();
    this.group = this;
    this.name = 'Filament Network';
    this.enabled = false;
    this.visible = false;
    this.elapsed = 0;
    this.lastTime = null;
    this.dilation = 0.35;
    this.dilationTarget = 0.35;
    this.flow = (2.4 - 0.8) / 4.2;
    this.flowTarget = this.flow;
    this.pulse = 0;
    this.density = 0.78;
    this.autonomy = 0.30;
    this.palette = 'silver';
    this.waveParams = { speed: 2.4, strength: 1, damping: 0.28 };
    this.bands = { low: 0, mid: 0, high: 0, energy: 0 };
    this.events = Array.from({ length: FILAMENT_EVENT_COUNT }, () => new THREE.Vector4(-100, 0, 0, 0));
    this.eventParams = Array.from({ length: FILAMENT_EVENT_COUNT }, () => new THREE.Vector4(2.4, 0.28, 0, 0));
    this.eventIndex = 0;
    this.nextSource = 3;
    this.nextLatentTime = 6.8;
    this.lastExcitationTime = -100;
    this._resolution = new THREE.Vector2(1, 1);
    this.uniforms = {
      uTime: { value: 0 }, uSpread: { value: this.dilation }, uTension: { value: 0.65 },
      uAfterglow: { value: 0.45 }, uPulse: { value: 0 }, uAutonomy: { value: this.autonomy },
      uBands: { value: new THREE.Vector4() }, uEvents: { value: this.events }, uEventParams: { value: this.eventParams },
      uResolution: { value: this._resolution }, uPixelRatio: { value: 1 },
      uThreadColor: { value: new THREE.Color(0.72, 0.76, 0.82) },
      uWaveColor: { value: new THREE.Color(1.25, 1.36, 1.52) }, uPalette: { value: 0 },
    };
    this.graph = buildFilamentNetwork();
    this._buildThreads();
    this.setMaterial(material);
    this.setDensity(this.density);
  }

  _buildThreads() {
    const geometry = new THREE.InstancedBufferGeometry();
    const position = [], index = [];
    for (let i = 0; i <= SEGMENTS; i++) position.push(i / SEGMENTS, -1, 0, i / SEGMENTS, 1, 0);
    for (let i = 0; i < SEGMENTS; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    const count = this.graph.edges.length;
    const start = new Float32Array(count * 3), end = new Float32Array(count * 3), bow = new Float32Array(count * 3), meta = new Float32Array(count * 4);
    const a0 = new Float32Array(count * 4), a1 = new Float32Array(count * 4), b0 = new Float32Array(count * 4), b1 = new Float32Array(count * 4);
    this.graph.edges.forEach((edge, i) => {
      start.set(this.graph.nodes[edge.a], i * 3); end.set(this.graph.nodes[edge.b], i * 3); bow.set(edge.bow, i * 3);
      meta.set([edge.length, edge.seed, edge.width, edge.backbone ? 1 : 0], i * 4);
      this.graph.distanceFields.forEach((field, source) => {
        (source < 4 ? a0 : a1)[i * 4 + source % 4] = field[edge.a];
        (source < 4 ? b0 : b1)[i * 4 + source % 4] = field[edge.b];
      });
    });
    for (const [name, data, size] of [['aStart', start, 3], ['aEnd', end, 3], ['aBow', bow, 3], ['aMeta', meta, 4], ['aDistanceA0', a0, 4], ['aDistanceA1', a1, 4], ['aDistanceB0', b0, 4], ['aDistanceB1', b1, 4]]) geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size));
    this.threadGeometry = geometry;
    this.threadMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: FILAMENT_VERTEX, fragmentShader: FILAMENT_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.threads = new THREE.Mesh(geometry, this.threadMaterial);
    this.threads.frustumCulled = false;
    this.threads.renderOrder = 4;
    this.threads.onBeforeRender = renderer => {
      renderer.getDrawingBufferSize(this._resolution);
      this.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    this.add(this.threads);
  }

  setEnabled(value) { this.enabled = Boolean(value); this.visible = this.enabled; this.lastTime = null; }
  setDilation(value) { this.dilationTarget = clamp(number(value), 0, 1); }
  setFlow(value) { this.flowTarget = clamp(number(value), 0, 1); this.waveParams.speed = 0.8 + 4.2 * this.flowTarget; }
  setPulse(value) { this.pulse = Math.max(this.pulse, clamp(number(value), 0, 2)); }
  setDensity(value) {
    this.density = clamp(number(value, 0.78), 0, 1);
    const minimum = Math.max(this.graph.backboneCount, Math.round(this.graph.edges.length * 0.16));
    this.threadGeometry.instanceCount = Math.round(minimum + (this.graph.edges.length - minimum) * this.density);
  }
  setTension(value) { this.uniforms.uTension.value = clamp(number(value, 0.65), 0, 1); }
  setAfterglow(value) { this.uniforms.uAfterglow.value = clamp(number(value, 0.45), 0, 1); }
  setAutonomy(value) { this.autonomy = clamp(number(value, 0.30), 0, 1); this.uniforms.uAutonomy.value = this.autonomy; }
  setWaveParams(params = {}) {
    if (Number.isFinite(Number(params.speed))) { this.waveParams.speed = clamp(Number(params.speed), 0.8, 5); this.flowTarget = (this.waveParams.speed - 0.8) / 4.2; }
    if (Number.isFinite(Number(params.strength))) this.waveParams.strength = clamp(Number(params.strength), 0, 1);
    if (Number.isFinite(Number(params.damping))) this.waveParams.damping = clamp(Number(params.damping), 0, 1);
  }
  setBands(bands = {}) {
    for (const key of ['low', 'mid', 'high', 'energy']) this.bands[key] = clamp(number(bands[key]), 0, 1);
    this.uniforms.uBands.value.set(this.bands.low, this.bands.mid, this.bands.high, this.bands.energy);
  }
  setMaterial(source) {
    this.sourceMaterial = source;
    this.materialColor = source?.color?.isColor ? source.color.clone() : new THREE.Color(0.72, 0.76, 0.82);
    this.setPalette(this.palette);
  }
  setPalette(value) {
    this.palette = ['silver', 'crimson', 'graphite', 'material'].includes(value) ? value : 'silver';
    const thread = this.uniforms.uThreadColor.value, wave = this.uniforms.uWaveColor.value;
    if (this.palette === 'crimson') { thread.setRGB(0.72, 0.012, 0.028); wave.setRGB(2.0, 0.28, 0.20); this.uniforms.uPalette.value = 1; }
    else if (this.palette === 'graphite') { thread.setRGB(0.20, 0.24, 0.29); wave.setRGB(1.42, 1.48, 1.60); this.uniforms.uPalette.value = 2; }
    else if (this.palette === 'material') { thread.copy(this.materialColor).lerp(new THREE.Color(0.80, 0.84, 0.90), 0.22); wave.copy(this.materialColor).lerp(new THREE.Color(1.45, 1.55, 1.7), 0.72); this.uniforms.uPalette.value = 3; }
    else { thread.setRGB(0.72, 0.76, 0.82); wave.setRGB(1.25, 1.36, 1.52); this.uniforms.uPalette.value = 0; }
  }

  excite({ strength = 1, mode = 'pulse', source, latent = false } = {}) {
    let index;
    if (Array.isArray(source) || source?.isVector3) {
      const point = Array.isArray(source) ? source : source.toArray();
      let best = Infinity;
      this.graph.sources.forEach((node, i) => {
        const p = this.graph.nodes[node], distance = Math.hypot(p[0] - number(point[0]), p[1] - number(point[1], 1.65), p[2] - number(point[2]));
        if (distance < best) { best = distance; index = i; }
      });
    } else if (Number.isFinite(source)) index = ((Math.round(source) % 8) + 8) % 8;
    else { index = this.nextSource; this.nextSource = (this.nextSource + 3) % 8; }
    const amount = clamp(number(strength, 1), 0, 2) * this.waveParams.strength;
    const slot = this.eventIndex;
    this.events[slot].set(this.elapsed, amount, index, MODES[mode] ?? 0);
    this.eventParams[slot].set(this.waveParams.speed, this.waveParams.damping, latent ? 1 : 0, 0);
    this.eventIndex = (slot + 1) % FILAMENT_EVENT_COUNT;
    if (!latent) this.lastExcitationTime = this.elapsed;
    return { source: index, origin: [...this.graph.nodes[this.graph.sources[index]]], time: this.elapsed, strength: amount, mode };
  }

  reset() {
    this.elapsed = 0; this.lastTime = null; this.pulse = 0; this.eventIndex = 0; this.nextSource = 3;
    this.nextLatentTime = 6.8; this.lastExcitationTime = -100;
    this.events.forEach(event => event.set(-100, 0, 0, 0));
    this.uniforms.uTime.value = 0; this.uniforms.uPulse.value = 0;
  }
  update(timeMs) {
    if (!this.enabled) { this.lastTime = null; return; }
    const now = number(timeMs, this.lastTime ?? 0);
    const dt = this.lastTime === null ? 0 : clamp((now - this.lastTime) / 1000, 0, 0.08);
    this.lastTime = now; this.elapsed += dt;
    this.dilation += (this.dilationTarget - this.dilation) * (1 - Math.exp(-dt * 1.5));
    this.flow += (this.flowTarget - this.flow) * (1 - Math.exp(-dt * 3));
    this.uniforms.uTime.value = this.elapsed; this.uniforms.uSpread.value = this.dilation;
    this.uniforms.uPulse.value = this.pulse; this.pulse *= Math.exp(-dt * 4.0);
    if (this.elapsed >= this.nextLatentTime) {
      const quiet = this.bands.energy < 0.05 && this.elapsed - this.lastExcitationTime > 4.5;
      if (this.autonomy > 0.005 && quiet) this.excite({ strength: 0.14 + this.autonomy * 0.38, source: (this.nextSource + 1) % 8, latent: true });
      this.nextSource = (this.nextSource + 3) % 8;
      this.nextLatentTime = this.elapsed + 5.0 + (1 - this.autonomy) * 5.0 + Math.sin(this.elapsed * 1.73) * 0.5;
    }
  }
  dispose() {
    this.setEnabled(false); this.threadGeometry.dispose(); this.threadMaterial.dispose(); this.clear();
  }
}

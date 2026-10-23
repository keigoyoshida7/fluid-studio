import * as THREE from 'three';
import { buildCapillaryNetwork, buildCapillaryRoutes } from './capillary-core.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const MODES = { pulse: 0, vortex: 1, levitate: 2 };
const EVENT_COUNT = 12;
const TUBE_SEGMENTS = 12;
const TUBE_SIDES = 8;
const ROUTE_COUNT = 192;
const ROUTE_SAMPLES = 512;
const MAX_TRACERS = 24000;

const CAPILLARY_COMMON = /* glsl */ `
  uniform float uCapTime;
  uniform float uCapSpread;
  uniform float uCapTension;
  uniform float uCapAfterglow;
  uniform float uCapAutonomy;
  uniform float uCapLumen;
  uniform vec4 uCapBands;
  uniform vec4 uCapEvents[12];
  uniform vec4 uCapEventParams[12];
  float capSourceDistance(vec4 first, vec4 second, float source) {
    if (source < 0.5) return first.x;
    if (source < 1.5) return first.y;
    if (source < 2.5) return first.z;
    if (source < 3.5) return first.w;
    if (source < 4.5) return second.x;
    if (source < 5.5) return second.y;
    if (source < 6.5) return second.z;
    return second.w;
  }
  float capPressure(vec4 distances0, vec4 distances1) {
    float energy = 0.0;
    for (int i = 0; i < 12; i++) {
      vec4 event = uCapEvents[i];
      float age = uCapTime - event.x;
      if (event.y > 0.001 && age >= 0.0 && age < 18.0) {
        float distance = capSourceDistance(distances0, distances1, event.z);
        float behind = age * uCapEventParams[i].x - distance;
        if (behind > -0.20) {
          float front = exp(-pow(behind / 0.13, 2.0));
          float tail = step(0.0, behind) * exp(-max(0.0, behind) / (0.12 + uCapAfterglow * 0.68));
          energy += (front + tail * 0.20) * event.y * exp(-distance * (0.10 + uCapEventParams[i].y * 0.30));
        }
      }
    }
    return min(energy, 2.0);
  }
  vec3 capMotion(vec3 p) {
    float amplitude = uCapAutonomy * (0.018 - uCapTension * 0.014);
    vec3 motion = vec3(sin(p.y * 2.8 + p.z * 1.3 + uCapTime * 0.58),
      sin(p.z * 2.4 - p.x * 2.3 + uCapTime * 0.43),
      sin(p.x * 2.7 + p.y * 1.6 - uCapTime * 0.51)) * amplitude;
    motion += sin(p.zxy * 19.0 + p.yzx * 7.0 - uCapTime * 21.0) * uCapBands.z * 0.0007 * (1.0 - uCapTension * 0.7);
    return motion;
  }
  float capRadiusScale(vec3 p, float pressure) {
    float breath = sin(p.y * 2.5 - uCapTime * (0.72 + uCapBands.y * 0.4) + p.z * 1.8) * uCapAutonomy * 0.027;
    return 1.0 + breath + pressure * (0.14 - uCapTension * 0.065);
  }
  vec3 capSpreadPoint(vec3 p) {
    return (p - vec3(0.0, 1.65, 0.0)) * (0.93 + 0.20 * uCapSpread) + vec3(0.0, 1.65, 0.0);
  }
  void capFrame(vec3 tangent, out vec3 radial, out vec3 binormal) {
    vec3 reference = abs(tangent.y) < 0.91 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    radial = normalize(cross(tangent, reference));
    binormal = normalize(cross(tangent, radial));
  }
`;

const TUBE_DECLARATIONS = /* glsl */ `
  ${CAPILLARY_COMMON}
  attribute vec4 aCapMeta;
  attribute vec4 aCapDistanceA0;
  attribute vec4 aCapDistanceA1;
  attribute vec4 aCapDistanceB0;
  attribute vec4 aCapDistanceB1;
  uniform sampler2D uCapCenters;
  uniform vec2 uCapCenterSize;
  varying float vCapPressure;
  vec4 capCenter(float t) {
    float index = clamp(t, 0.0, 1.0) * (uCapCenterSize.x - 1.0);
    float first = floor(index);
    vec2 a = vec2((first + 0.5) / uCapCenterSize.x, (aCapMeta.x + 0.5) / uCapCenterSize.y);
    vec2 b = vec2((min(first + 1.0, uCapCenterSize.x - 1.0) + 0.5) / uCapCenterSize.x, a.y);
    return mix(texture2D(uCapCenters, a), texture2D(uCapCenters, b), fract(index));
  }
`;

const TUBE_NORMAL = /* glsl */ `
  float capT = position.x;
  vec4 capPath = capCenter(capT);
  vec3 capTangent = normalize(capCenter(capT + 0.035).xyz - capCenter(capT - 0.035).xyz);
  vec3 capRadial, capBinormal;
  capFrame(capTangent, capRadial, capBinormal);
  vec4 capDistances0 = min(aCapDistanceA0 + capT * aCapMeta.y, aCapDistanceB0 + (1.0 - capT) * aCapMeta.y);
  vec4 capDistances1 = min(aCapDistanceA1 + capT * aCapMeta.y, aCapDistanceB1 + (1.0 - capT) * aCapMeta.y);
  float capEnergy = capPressure(capDistances0, capDistances1);
  vec3 objectNormal = capRadial * position.y + capBinormal * position.z;
  #ifdef USE_TANGENT
    vec3 objectTangent = capTangent;
  #endif
`;
const TUBE_POSITION = /* glsl */ `
  float capRadius = capPath.w * uCapLumen * capRadiusScale(capPath.xyz, capEnergy);
  vec3 capPoint = capPath.xyz + capMotion(capPath.xyz);
  // Pressure distends each circular lumen locally; shared endpoints stay joined.
  vec3 transformed = capSpreadPoint(capPoint + objectNormal * capRadius);
  vCapPressure = capEnergy;
`;

const TRACER_VERTEX = /* glsl */ `
  ${CAPILLARY_COMMON}
  attribute vec4 aCapSeed;
  attribute vec2 aCapBubble;
  uniform sampler2D uCapRoutes;
  uniform sampler2D uCapRouteMeta;
  uniform sampler2D uCapRouteInfo;
  uniform sampler2D uCapRouteDistance0;
  uniform sampler2D uCapRouteDistance1;
  uniform vec2 uCapRouteSize;
  uniform float uCapAdvection;
  uniform float uCapPixelRatio;
  uniform float uCapViewportHeight;
  uniform float uCapVisibleEdges;
  varying float vBubbleSeed;
  varying float vBubbleEnergy;
  varying float vBubbleLife;
  vec4 capRawRoute(sampler2D field, float index) {
    return texture2D(field, vec2((index + 0.5) / uCapRouteSize.x, aCapSeed.x));
  }
  vec2 capRouteInterval(float distance, float count) {
    float low = 0.0, high = count - 1.0;
    for (int search = 0; search < 13; search++) {
      float middle = floor((low + high) * 0.5);
      if (capRawRoute(uCapRouteMeta, middle).x <= distance) low = middle;
      else high = middle;
    }
    return vec2(low, min(low + 1.0, count - 1.0));
  }
  vec4 capSampleInterval(sampler2D field, vec2 interval, float weight) {
    return mix(capRawRoute(field, interval.x), capRawRoute(field, interval.y), weight);
  }
  void main() {
    vec4 meta = texture2D(uCapRouteInfo, vec2(0.5, aCapSeed.x));
    float profile = 1.0 - aCapSeed.z * aCapSeed.z * 0.56;
    float t = fract(aCapSeed.y + uCapAdvection * meta.y * profile / max(meta.x, 0.01));
    float distance = t * meta.x;
    vec2 interval = capRouteInterval(distance, meta.z);
    vec4 intervalMeta = capRawRoute(uCapRouteMeta, interval.x);
    float nextArc = capRawRoute(uCapRouteMeta, interval.y).x;
    float weight = clamp((distance - intervalMeta.x) / max(0.000001, nextArc - intervalMeta.x), 0.0, 1.0);
    vec4 distances0 = capSampleInterval(uCapRouteDistance0, interval, weight);
    vec4 distances1 = capSampleInterval(uCapRouteDistance1, interval, weight);
    float pressure = capPressure(distances0, distances1);
    // Original arc-length knots are retained. The binary search never cuts
    // diagonally across a junction, even in a narrow lumen or a new topology.
    vec4 path = capSampleInterval(uCapRoutes, interval, weight);
    vec3 tangent = normalize(capRawRoute(uCapRoutes, interval.y).xyz - capRawRoute(uCapRoutes, interval.x).xyz);
    vec3 radial, binormal;
    capFrame(tangent, radial, binormal);
    vec3 normal = radial * cos(aCapSeed.w) + binormal * sin(aCapSeed.w);
    float radius = min(path.w, meta.w) * uCapLumen * capRadiusScale(path.xyz, pressure);
    vec3 point = capSpreadPoint(path.xyz + capMotion(path.xyz) + normal * radius * aCapSeed.z * 0.58);
    vec4 view = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * view;
    float worldDiameter = min(aCapBubble.x, radius * 0.55) * (0.95 + pressure * 0.12);
    float focal = projectionMatrix[1][1] * uCapViewportHeight * 0.5;
    gl_PointSize = clamp(worldDiameter * focal / max(0.2, -view.z), 0.68 * uCapPixelRatio, 3.8 * uCapPixelRatio);
    vBubbleSeed = aCapBubble.y;
    vBubbleEnergy = pressure;
    float routeEdge = intervalMeta.w;
    float visible = 1.0 - step(uCapVisibleEdges, routeEdge);
    vBubbleLife = smoothstep(0.0, 0.009, t) * (1.0 - smoothstep(0.991, 1.0, t)) * visible;
  }
`;
const TRACER_FRAGMENT = /* glsl */ `
  uniform vec3 uCapTracerColor;
  varying float vBubbleSeed;
  varying float vBubbleEnergy;
  varying float vBubbleLife;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 0.94 || vBubbleLife < 0.12) discard;
    float z = sqrt(max(0.0, 1.0 - r2));
    vec3 n = vec3(p, z);
    float light = 0.32 + max(0.0, dot(n, normalize(vec3(-0.45, 0.65, 0.7)))) * 0.45;
    float glint = pow(max(0.0, dot(n, normalize(vec3(-0.32, 0.46, 0.83)))), 24.0);
    vec3 color = uCapTracerColor * light * (0.72 + vBubbleSeed * 0.32) + vec3(0.48) * glint;
    color *= 1.0 + min(1.0, vBubbleEnergy) * 0.08;
    // Opaque microbubbles render into the physical material's transmission
    // buffer, so the water really refracts the moving interior details.
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A connected, water-filled capillary study, rather than an anatomical solver. */
export class VesselFlow extends THREE.Group {
  constructor({ material } = {}) {
    super();
    this.group = this; this.name = 'Capillary Water';
    this.enabled = false; this.visible = false;
    this.elapsed = 0; this.lastTime = null; this.distance = 0;
    this.dilation = 0.35; this.dilationTarget = 0.35;
    this.flow = 0.55; this.flowTarget = 0.55;
    this.pulse = 0; this.density = 0.84; this.autonomy = 0.3;
    this.lumen = 0.55; this.tracerDensity = 0.76; this.palette = 'silver';
    this.waveParams = { speed: 2.4, strength: 1, damping: 0.24 };
    this.bands = { low: 0, mid: 0, high: 0, energy: 0 };
    this.events = Array.from({ length: EVENT_COUNT }, () => new THREE.Vector4(-100, 0, 0, 0));
    this.eventParams = Array.from({ length: EVENT_COUNT }, () => new THREE.Vector4(2.4, 0.24, 0, 0));
    this.eventIndex = 0; this.nextSource = 3; this.nextLatentTime = 6.8; this.lastExcitationTime = -100;
    this._resolution = new THREE.Vector2(1, 1);
    this.uniforms = {
      uCapTime: { value: 0 }, uCapSpread: { value: this.dilation }, uCapTension: { value: 0.72 },
      uCapAfterglow: { value: 0.76 }, uCapAutonomy: { value: this.autonomy }, uCapLumen: { value: 0.7 + this.lumen * 2.0 },
      uCapBands: { value: new THREE.Vector4() }, uCapEvents: { value: this.events }, uCapEventParams: { value: this.eventParams },
      uCapAdvection: { value: 0 }, uCapPixelRatio: { value: 1 }, uCapViewportHeight: { value: 1 },
      uCapVisibleEdges: { value: 0 },
      uCapTracerColor: { value: new THREE.Color(0.54, 0.68, 0.76) },
    };
    this.graph = buildCapillaryNetwork();
    this.routes = buildCapillaryRoutes(this.graph, { count: ROUTE_COUNT });
    this._buildCapillaries(); this._buildTracers();
    this.setMaterial(material); this.setDensity(this.density); this.setTracerDensity(this.tracerDensity);
  }

  _texture(data, width, height) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  }
  _buildCapillaries() {
    const geometry = new THREE.InstancedBufferGeometry();
    const position = [], normals = [], uv = [], indices = [];
    for (let i = 0; i <= TUBE_SEGMENTS; i++) for (let side = 0; side <= TUBE_SIDES; side++) {
      const angle = side / TUBE_SIDES * Math.PI * 2;
      position.push(i / TUBE_SEGMENTS, Math.cos(angle), Math.sin(angle));
      normals.push(0, Math.cos(angle), Math.sin(angle)); uv.push(side / TUBE_SIDES, i / TUBE_SEGMENTS);
    }
    for (let i = 0; i < TUBE_SEGMENTS; i++) for (let side = 0; side < TUBE_SIDES; side++) {
      const a = i * (TUBE_SIDES + 1) + side, b = a + TUBE_SIDES + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
    const count = this.graph.edges.length;
    const samples = new Float32Array((TUBE_SEGMENTS + 1) * count * 4);
    const meta = new Float32Array(count * 4);
    const a0 = new Float32Array(count * 4), a1 = new Float32Array(count * 4), b0 = new Float32Array(count * 4), b1 = new Float32Array(count * 4);
    this.graph.edges.forEach((edge, index) => {
      samples.set(edge.samples, index * (TUBE_SEGMENTS + 1) * 4);
      meta.set([index, edge.length, edge.seed, edge.flow], index * 4);
      this.graph.distanceFields.forEach((field, source) => {
        (source < 4 ? a0 : a1)[index * 4 + source % 4] = field[edge.a];
        (source < 4 ? b0 : b1)[index * 4 + source % 4] = field[edge.b];
      });
    });
    for (const [name, data] of [['aCapMeta', meta], ['aCapDistanceA0', a0], ['aCapDistanceA1', a1], ['aCapDistanceB0', b0], ['aCapDistanceB1', b1]]) geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, 4));
    this.centerTexture = this._texture(samples, TUBE_SEGMENTS + 1, count);
    this.uniforms.uCapCenters = { value: this.centerTexture };
    this.uniforms.uCapCenterSize = { value: new THREE.Vector2(TUBE_SEGMENTS + 1, count) };
    this.vesselGeometry = this.threadGeometry = geometry;
    this.wallMaterial = new THREE.MeshPhysicalMaterial();
    this.wall = this.threads = new THREE.Mesh(geometry, this.wallMaterial);
    this.wall.frustumCulled = false; this.wall.renderOrder = 2;
    this.wall.onBeforeRender = renderer => {
      renderer.getDrawingBufferSize(this._resolution);
      this.uniforms.uCapPixelRatio.value = renderer.getPixelRatio();
      this.uniforms.uCapViewportHeight.value = this._resolution.y;
    };
    this.add(this.wall);
  }

  _buildTracers() {
    const routeCount = this.routes.length;
    const sampleWidth = Math.max(ROUTE_SAMPLES, 2 ** Math.ceil(Math.log2(Math.max(...this.routes.map(route => route.samples.length / 4)))));
    const centers = new Float32Array(sampleWidth * routeCount * 4);
    const distances0 = new Float32Array(centers.length), distances1 = new Float32Array(centers.length);
    const routeMeta = new Float32Array(centers.length);
    const routeInfo = new Float32Array(routeCount * 4);
    this.routes.forEach((route, routeIndex) => {
      const samples = route.samples, arc = route.sampleCumulative;
      const sampleCount = samples.length / 4;
      const total = arc[arc.length - 1];
      const routeSpeed = clamp(0.52 + number(route.speed, 0.5) * 0.9, 0.5, 1.6);
      routeInfo.set([total, routeSpeed, sampleCount, number(route.radius, 0.0035)], routeIndex * 4);
      let edgeIndex = 0;
      for (let i = 0; i < sampleWidth; i++) {
        const sampleIndex = Math.min(i, sampleCount - 1), distance = arc[sampleIndex];
        const offset = (routeIndex * sampleWidth + i) * 4;
        for (let axis = 0; axis < 4; axis++) centers[offset + axis] = samples[sampleIndex * 4 + axis];
        while (edgeIndex + 1 < route.edges.length && route.cumulative[edgeIndex + 1] <= distance + 0.000001) edgeIndex++;
        const edge = this.graph.edges[route.edges[edgeIndex]];
        routeMeta.set([distance, 0, 0, route.edges[edgeIndex]], offset);
        const local = clamp(distance - route.cumulative[edgeIndex], 0, edge.length);
        const fromA = route.nodes[edgeIndex] === edge.a ? local : edge.length - local;
        this.graph.distanceFields.forEach((field, source) => {
          const value = Math.min(field[edge.a] + fromA, field[edge.b] + edge.length - fromA);
          (source < 4 ? distances0 : distances1)[offset + source % 4] = value;
        });
      }
    });
    this.routeTexture = this._texture(centers, sampleWidth, routeCount);
    this.routeDistanceTexture0 = this._texture(distances0, sampleWidth, routeCount);
    this.routeDistanceTexture1 = this._texture(distances1, sampleWidth, routeCount);
    this.routeMetaTexture = this._texture(routeMeta, sampleWidth, routeCount);
    this.routeInfoTexture = this._texture(routeInfo, 1, routeCount);
    Object.assign(this.uniforms, {
      uCapRoutes: { value: this.routeTexture }, uCapRouteMeta: { value: this.routeMetaTexture },
      uCapRouteInfo: { value: this.routeInfoTexture },
      uCapRouteDistance0: { value: this.routeDistanceTexture0 }, uCapRouteDistance1: { value: this.routeDistanceTexture1 },
      uCapRouteSize: { value: new THREE.Vector2(sampleWidth, routeCount) },
    });
    const positions = new Float32Array(MAX_TRACERS * 3), seeds = new Float32Array(MAX_TRACERS * 4), bubbles = new Float32Array(MAX_TRACERS * 2);
    let randomState = 912713;
    const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
    for (let i = 0; i < MAX_TRACERS; i++) {
      const routeIndex = i % routeCount;
      seeds.set([(routeIndex + 0.5) / routeCount, random(), Math.sqrt(random()) * 0.78, random() * Math.PI * 2], i * 4);
      bubbles.set([0.0028 + Math.pow(random(), 3) * 0.0038, random()], i * 2);
    }
    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.tracerGeometry.setAttribute('aCapSeed', new THREE.BufferAttribute(seeds, 4));
    this.tracerGeometry.setAttribute('aCapBubble', new THREE.BufferAttribute(bubbles, 2));
    this.tracerMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: TRACER_VERTEX, fragmentShader: TRACER_FRAGMENT, transparent: false, depthWrite: true, depthTest: true });
    this.tracers = new THREE.Points(this.tracerGeometry, this.tracerMaterial);
    this.tracers.frustumCulled = false; this.tracers.renderOrder = 0;
    this.add(this.tracers);
  }

  setEnabled(value) { this.enabled = Boolean(value); this.visible = this.enabled; this.lastTime = null; }
  setDilation(value) { this.dilationTarget = clamp(number(value), 0, 1); }
  setFlow(value) { this.flowTarget = clamp(number(value), 0, 1); }
  setLumen(value) { this.lumen = clamp(number(value, 0.55), 0, 1); this.uniforms.uCapLumen.value = 0.7 + this.lumen * 2; }
  setTracerDensity(value) { this.tracerDensity = clamp(number(value, 0.76), 0, 1); this.tracerGeometry.setDrawRange(0, Math.round(1800 + this.tracerDensity * (MAX_TRACERS - 1800))); }
  setPulse(value) { this.pulse = Math.max(this.pulse, clamp(number(value), 0, 2)); }
  setDensity(value) {
    this.density = clamp(number(value, 0.84), 0, 1);
    const minimum = Math.max(this.graph.backboneCount, Math.round(this.graph.edges.length * 0.25));
    this.threadGeometry.instanceCount = Math.round(minimum + (this.graph.edges.length - minimum) * this.density);
    this.uniforms.uCapVisibleEdges.value = this.threadGeometry.instanceCount;
  }
  setTension(value) { this.uniforms.uCapTension.value = clamp(number(value, 0.72), 0, 1); }
  setAfterglow(value) { this.uniforms.uCapAfterglow.value = clamp(number(value, 0.76), 0, 1); }
  setAutonomy(value) { this.autonomy = clamp(number(value, 0.3), 0, 1); this.uniforms.uCapAutonomy.value = this.autonomy; }
  setWaveParams(params = {}) {
    if (Number.isFinite(Number(params.speed))) this.waveParams.speed = clamp(Number(params.speed), 0.8, 5);
    if (Number.isFinite(Number(params.strength))) this.waveParams.strength = clamp(Number(params.strength), 0, 1);
    if (Number.isFinite(Number(params.damping))) this.waveParams.damping = clamp(Number(params.damping), 0, 1);
  }
  setBands(bands = {}) {
    for (const key of ['low', 'mid', 'high', 'energy']) this.bands[key] = clamp(number(bands[key]), 0, 1);
    this.uniforms.uCapBands.value.set(this.bands.low, this.bands.mid, this.bands.high, this.bands.energy);
  }
  setMaterial(source) {
    this.sourceMaterial = source;
    const fallback = new THREE.MeshPhysicalMaterial({ color: 0xf2fbff, transmission: 1, roughness: 0.038, ior: 1.333, thickness: 0.035, attenuationColor: 0xbde8ed, attenuationDistance: 2.5 });
    const parent = source?.isMeshPhysicalMaterial ? source : fallback;
    this.wallMaterial.copy(parent);
    this.wallMaterial.transparent = false; this.wallMaterial.opacity = 1; this.wallMaterial.depthWrite = true;
    this.wallMaterial.side = THREE.FrontSide; this.wallMaterial.ior = 1.333;
    this.wallMaterial.thickness = 0.038; this.wallMaterial.attenuationDistance = Math.max(0.22, parent.attenuationDistance * 0.38);
    this.wallMaterial.roughness = Math.max(0.032, parent.roughness);
    this.wallMaterial.envMapIntensity = Math.max(1.15, parent.envMapIntensity || 1.1);
    this.wallMaterial.clearcoat = Math.max(0.2, parent.clearcoat || 0); this.wallMaterial.clearcoatRoughness = 0.045;
    const compile = parent.onBeforeCompile;
    this.wallMaterial.onBeforeCompile = (shader, renderer) => {
      compile.call(parent, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = TUBE_DECLARATIONS + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', TUBE_NORMAL);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', TUBE_POSITION);
      shader.vertexShader = shader.vertexShader.replace('vLiquidPosition = position;', 'vLiquidPosition = transformed;').replace('(modelMatrix * vec4(position, 1.0)).xyz;', '(modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'varying float vCapPressure;\n' + shader.fragmentShader;
      // The capillary's pressure already follows graph distance. The parent's
      // free-water spherical ripple would add a second, unrelated wave field.
      shader.fragmentShader = shader.fragmentShader.replace('float liquidWave = waveField(vLiquidWorldPosition);', 'float liquidWave = 0.0;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(0.022, roughnessFactor * (1.0 - min(vCapPressure, 1.0) * 0.12));');
    };
    this.wallMaterial.customProgramCacheKey = () => `capillary-water-v1-${parent.customProgramCacheKey()}`;
    this.wallMaterial.needsUpdate = true;
    this.materialColor = parent.color.clone();
    this.setPalette(this.palette);
    fallback.dispose();
  }
  setPalette(value) {
    this.palette = ['silver', 'crimson', 'graphite', 'material'].includes(value) ? value : 'silver';
    const wall = this.wallMaterial, tracer = this.uniforms.uCapTracerColor.value;
    if (this.palette === 'crimson') { wall.color.setRGB(0.96, 0.84, 0.83); wall.attenuationColor.setRGB(0.60, 0.018, 0.035); wall.attenuationDistance = 0.16; tracer.setRGB(0.65, 0.18, 0.17); }
    else if (this.palette === 'graphite') { wall.color.setRGB(0.52, 0.60, 0.65); wall.attenuationColor.setRGB(0.07, 0.12, 0.16); wall.attenuationDistance = 0.24; tracer.setRGB(0.36, 0.47, 0.53); }
    else {
      if (this.sourceMaterial?.isMeshPhysicalMaterial) {
        wall.color.copy(this.sourceMaterial.color); wall.attenuationColor.copy(this.sourceMaterial.attenuationColor);
        wall.attenuationDistance = Math.max(0.22, this.sourceMaterial.attenuationDistance * 0.38);
      } else { wall.color.setHex(0xf2fbff); wall.attenuationColor.setHex(0xbde8ed); wall.attenuationDistance = 2.5; }
      tracer.copy(this.materialColor || new THREE.Color(0.54, 0.68, 0.76)).lerp(new THREE.Color(0.40, 0.58, 0.67), 0.58);
    }
  }
  excite({ strength = 1, mode = 'pulse', source, latent = false } = {}) {
    let index;
    if (Array.isArray(source) || source?.isVector3) {
      const point = Array.isArray(source) ? source : source.toArray(); let best = Infinity;
      this.graph.sources.forEach((node, i) => { const p = this.graph.nodes[node], distance = Math.hypot(p[0] - number(point[0]), p[1] - number(point[1], 1.65), p[2] - number(point[2])); if (distance < best) { best = distance; index = i; } });
    } else if (Number.isFinite(source)) index = ((Math.round(source) % 8) + 8) % 8;
    else { index = this.nextSource; this.nextSource = (this.nextSource + 3) % 8; }
    const amount = clamp(number(strength, 1), 0, 2) * this.waveParams.strength;
    this.events[this.eventIndex].set(this.elapsed, amount, index, MODES[mode] ?? 0);
    this.eventParams[this.eventIndex].set(this.waveParams.speed, this.waveParams.damping, latent ? 1 : 0, 0);
    this.eventIndex = (this.eventIndex + 1) % EVENT_COUNT;
    if (!latent) this.lastExcitationTime = this.elapsed;
    return { source: index, origin: [...this.graph.nodes[this.graph.sources[index]]], time: this.elapsed, strength: amount, mode };
  }
  reset() {
    this.elapsed = 0; this.distance = 0; this.lastTime = null; this.pulse = 0; this.eventIndex = 0; this.nextSource = 3;
    this.nextLatentTime = 6.8; this.lastExcitationTime = -100;
    this.events.forEach(event => event.set(-100, 0, 0, 0));
    this.uniforms.uCapTime.value = 0; this.uniforms.uCapAdvection.value = 0;
  }
  regenerate(seed) {
    const nextSeed = Number.isFinite(Number(seed)) ? Math.round(Number(seed)) : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff));
    const source = this.sourceMaterial;
    const graph = buildCapillaryNetwork({ seed: nextSeed });
    const routes = buildCapillaryRoutes(graph, { count: ROUTE_COUNT, seed: nextSeed });
    this._disposeGeometry();
    this.graph = graph; this.routes = routes;
    this._buildCapillaries(); this._buildTracers();
    this.setMaterial(source); this.setDensity(this.density); this.setTracerDensity(this.tracerDensity); this.setLumen(this.lumen);
    this.reset();
    return this.graph.seed ?? nextSeed;
  }
  update(timeMs) {
    if (!this.enabled) { this.lastTime = null; return; }
    const now = number(timeMs, this.lastTime ?? 0);
    const dt = this.lastTime === null ? 0 : clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now; this.elapsed += dt;
    this.dilation += (this.dilationTarget - this.dilation) * (1 - Math.exp(-dt * 1.5));
    this.flow += (this.flowTarget - this.flow) * (1 - Math.exp(-dt * 3));
    this.distance += dt * (0.06 + this.flow * 0.62) * (1.0 + this.bands.low * 0.08);
    this.uniforms.uCapTime.value = this.elapsed; this.uniforms.uCapSpread.value = this.dilation; this.uniforms.uCapAdvection.value = this.distance;
    this.pulse *= Math.exp(-dt * 4.0);
    if (this.elapsed >= this.nextLatentTime) {
      const quiet = this.bands.energy < 0.05 && this.elapsed - this.lastExcitationTime > 4.5;
      if (this.autonomy > 0.005 && quiet) this.excite({ strength: 0.10 + this.autonomy * 0.24, source: (this.nextSource + 1) % 8, latent: true });
      this.nextSource = (this.nextSource + 3) % 8;
      this.nextLatentTime = this.elapsed + 5.0 + (1 - this.autonomy) * 5.0 + Math.sin(this.elapsed * 1.73) * 0.5;
    }
  }
  _disposeGeometry() {
    this.remove(this.wall, this.tracers);
    for (const texture of [this.centerTexture, this.routeTexture, this.routeDistanceTexture0, this.routeDistanceTexture1, this.routeMetaTexture, this.routeInfoTexture]) texture.dispose();
    this.vesselGeometry.dispose(); this.tracerGeometry.dispose(); this.wallMaterial.dispose(); this.tracerMaterial.dispose();
  }
  dispose() {
    this.setEnabled(false); this._disposeGeometry(); this.clear();
  }
}

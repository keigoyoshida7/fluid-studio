/** Deterministic connected thread graph. Distances are measured along the graph,
 * so a packet reaches a junction before it can enter any of its branches. */
export const FILAMENT_SOURCE_COUNT = 8;
export const FILAMENT_EVENT_COUNT = 12;
export const FILAMENT_HALF_WIDTH_PX = Object.freeze([0.23, 0.43]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function filamentRandom(seed = 91387) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const POCKETS = [
  { center: [-0.38, 1.63, 0.12], radius: [0.59, 0.66, 0.52] },
  { center: [0.94, 2.42, -0.50], radius: [0.41, 0.42, 0.46] },
];
function inPocket(point, margin = 1) {
  return POCKETS.some(({ center, radius }) => point.reduce((sum, value, i) => sum + ((value - center[i]) / (radius[i] * margin)) ** 2, 0) < 1);
}
function crossesPocket(a, b) {
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    if (inPocket(a.map((value, axis) => value + (b[axis] - value) * t), 0.96)) return true;
  }
  return false;
}

export function computeGeodesicDistances(nodes, edges, source) {
  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (const edge of edges) {
    adjacency[edge.a].push([edge.b, edge.length]);
    adjacency[edge.b].push([edge.a, edge.length]);
  }
  const distances = new Float32Array(nodes.length).fill(Infinity);
  const visited = new Uint8Array(nodes.length);
  distances[source] = 0;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!visited[i] && distances[i] < best) { best = distances[i]; current = i; }
    if (current < 0) break;
    visited[current] = 1;
    for (const [next, length] of adjacency[current]) distances[next] = Math.min(distances[next], best + length);
  }
  return distances;
}

/** Connected backbone is ordered first, retaining connectivity as density falls. */
export function buildFilamentNetwork({ nodeCount = 780, seed = 91387 } = {}) {
  const random = filamentRandom(seed);
  const count = clamp(Math.round(Number(nodeCount) || 780), 40, 1200);
  const nodes = [];
  while (nodes.length < count) {
    const point = [(random() * 2 - 1) * 1.74, 0.22 + random() * 2.92, (random() * 2 - 1) * 1.30];
    point[0] += Math.sin(point[1] * 2.1 + point[2] * 1.8) * 0.09;
    point[2] += Math.sin(point[1] * 1.6 - point[0]) * 0.08;
    if (!inPocket(point, 1.04)) nodes.push(point);
  }
  const edges = [], keys = new Set();
  const add = (a, b, backbone = false) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (keys.has(key)) return;
    keys.add(key);
    const seedValue = random();
    const chord = distance(nodes[a], nodes[b]);
    edges.push({ a, b, length: chord * (1.006 + seedValue * 0.012), seed: seedValue, bow: [(random() - 0.5) * 0.10, -(0.018 + random() * 0.065), (random() - 0.5) * 0.10], width: 0.23 + random() * 0.20, backbone });
  };
  // Prim's connected skeleton, with a high cost for crossing an intentional void.
  const visited = new Uint8Array(count), best = new Float64Array(count).fill(Infinity), parent = new Int32Array(count).fill(-1);
  best[0] = 0;
  for (let iteration = 0; iteration < count; iteration++) {
    let current = -1, nearest = Infinity;
    for (let i = 0; i < count; i++) if (!visited[i] && best[i] < nearest) { nearest = best[i]; current = i; }
    visited[current] = 1;
    if (parent[current] >= 0) add(current, parent[current], true);
    for (let i = 0; i < count; i++) if (!visited[i]) {
      const chord = distance(nodes[current], nodes[i]);
      // Local neighbors cannot cut across a cavity; long candidates are penalized.
      const weight = chord + (chord > 0.30 && crossesPocket(nodes[current], nodes[i]) ? 20 : 0);
      if (weight < best[i]) { best[i] = weight; parent[i] = current; }
    }
  }
  const additional = [];
  for (let a = 0; a < count; a++) {
    const nearest = [];
    for (let b = 0; b < count; b++) if (b !== a) nearest.push({ b, length: distance(nodes[a], nodes[b]) });
    nearest.sort((x, y) => x.length - y.length);
    let added = 0;
    for (const candidate of nearest) {
      if (crossesPocket(nodes[a], nodes[candidate.b])) continue;
      additional.push([a, candidate.b]);
      if (++added >= 11) break;
    }
  }
  // Cross ties make the volume read as woven tension rather than a cell lattice.
  const target = count * 16;
  let attempts = 0;
  while (additional.length < target * 1.55 && attempts++ < count * 100) {
    const a = Math.floor(random() * count), b = Math.floor(random() * count);
    const length = distance(nodes[a], nodes[b]);
    if (length > 0.60 && length < 1.65 && !crossesPocket(nodes[a], nodes[b])) additional.push([a, b]);
  }
  // Deterministic shuffle avoids a spatially biased density control.
  for (let i = additional.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [additional[i], additional[j]] = [additional[j], additional[i]];
  }
  for (const [a, b] of additional) { add(a, b); if (edges.length >= target) break; }
  const directions = [[1, 0.3, 0.1], [-1, -0.3, -0.1], [0.1, 1, 0.3], [-0.1, -1, -0.3], [0.3, 0.1, 1], [-0.3, -0.1, -1], [0.7, 0.7, -0.7], [-0.7, -0.7, 0.7]];
  const sources = directions.map(direction => {
    let index = 0, bestProjection = -Infinity;
    nodes.forEach((point, i) => {
      const projection = point[0] * direction[0] + (point[1] - 1.65) * direction[1] + point[2] * direction[2];
      if (projection > bestProjection) { bestProjection = projection; index = i; }
    });
    return index;
  });
  const distanceFields = sources.map(source => computeGeodesicDistances(nodes, edges, source));
  return { nodes, edges, sources, distanceFields, seed, backboneCount: count - 1, pockets: POCKETS };
}

/** Distance along an edge, including competing arrivals through both endpoints. */
export function edgeArrivalDistance(start, end, length, progress) {
  const t = clamp(progress, 0, 1);
  return Math.min(start + length * t, end + length * (1 - t));
}

export function sampleFilamentPacket({ distance, age, speed = 2.3, strength = 1, afterglow = 0.45 }) {
  if (!Number.isFinite(distance) || !Number.isFinite(age) || age < 0) return 0;
  const traveled = age * speed;
  const behind = traveled - distance;
  if (behind < -0.30) return 0;
  const front = Math.exp(-((behind / (0.09 + age * 0.007)) ** 2));
  const tail = behind < 0 ? 0 : Math.exp(-behind / (0.08 + afterglow * 0.82));
  return (front + tail * 0.30) * strength * Math.exp(-distance * 0.15);
}

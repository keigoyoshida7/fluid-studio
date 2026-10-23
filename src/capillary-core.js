import { filamentRandom, computeGeodesicDistances } from './filament-network-core.js';

export const CAPILLARY_SAMPLES = 13;
export const CAPILLARY_EVENT_COUNT = 12;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length3 = a => Math.hypot(a[0], a[1], a[2]);
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const distance = (a, b) => length3(subtract(a, b));
const normalize = a => { const length = length3(a) || 1; return a.map(value => value / length); };
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const POCKETS = [
  { center: [-0.34, 1.57, 0.12], radius: [0.47, 0.57, 0.43] },
  { center: [0.87, 2.39, -0.47], radius: [0.32, 0.36, 0.34] },
];
function inPocket(point, margin = 1) {
  return POCKETS.some(({ center, radius }) => point.reduce((sum, value, i) => sum + ((value - center[i]) / (radius[i] * margin)) ** 2, 0) < 1);
}
function crossesPocket(a, b) {
  for (let sample = 1; sample < 8; sample++) {
    const t = sample / 8;
    if (inPocket(a.map((value, axis) => value + (b[axis] - value) * t), 0.97)) return true;
  }
  return false;
}
function extrema(nodes) {
  const directions = [[1, 0.25, 0.1], [-1, -0.25, -0.1], [0.1, 1, 0.12], [-0.1, -1, -0.12], [0.15, 0.1, 1], [-0.15, -0.1, -1], [0.7, 0.7, -0.7], [-0.7, -0.7, 0.7]];
  const used = new Set();
  return directions.map(direction => {
    let index = 0, best = -Infinity;
    nodes.forEach((point, i) => {
      const projection = dot([point[0], point[1] - 1.65, point[2]], direction);
      if (!used.has(i) && projection > best) { best = projection; index = i; }
    });
    used.add(index);
    return index;
  });
}
function makeAdjacency(nodes, edges) {
  const adjacency = Array.from({ length: nodes.length }, () => []);
  edges.forEach((edge, index) => {
    const conductance = (edge.radius / 0.01) ** 4 / Math.max(0.06, edge.length);
    edge.conductance = conductance;
    adjacency[edge.a].push({ node: edge.b, edge: index, conductance });
    adjacency[edge.b].push({ node: edge.a, edge: index, conductance });
  });
  return adjacency;
}
/** Bounded discrete pressure potential; no anatomical or medical CFD claim. */
function solvePressure(nodes, edges, boundary, initial) {
  const adjacency = makeAdjacency(nodes, edges);
  const pressures = initial ? new Float64Array(initial) : Float64Array.from(nodes, point => clamp((point[1] - 0.25) / 2.8, 0, 1));
  for (const [index, pressure] of boundary) pressures[index] = pressure;
  let residual = Infinity;
  for (let iteration = 0; iteration < 2400; iteration++) {
    residual = 0;
    for (let node = 0; node < nodes.length; node++) {
      if (boundary.has(node)) continue;
      let weighted = 0, total = 0;
      for (const neighbor of adjacency[node]) { weighted += pressures[neighbor.node] * neighbor.conductance; total += neighbor.conductance; }
      const next = weighted / total;
      const difference = next - pressures[node];
      pressures[node] = clamp(pressures[node] + difference * 1.35, 0, 1);
      residual = Math.max(residual, Math.abs(difference));
    }
    if (residual < 2e-9) break;
  }
  let maximumFlow = 0;
  edges.forEach(edge => {
    edge.pressureDrop = pressures[edge.a] - pressures[edge.b];
    edge.direction = edge.pressureDrop >= 0 ? 1 : -1;
    edge.rawFlow = Math.abs(edge.pressureDrop) * edge.conductance;
    maximumFlow = Math.max(maximumFlow, edge.rawFlow);
  });
  edges.forEach(edge => { edge.flow = 0.055 + 0.945 * (edge.rawFlow / (maximumFlow || 1)) ** 0.30; });
  return { pressures, adjacency, maximumFlow, residual };
}
function cubic(a, ca, cb, b, t) {
  const s = 1 - t;
  return a.map((value, axis) => value * s ** 3 + ca[axis] * 3 * s * s * t + cb[axis] * 3 * s * t * t + b[axis] * t ** 3);
}

export function sampleCapillaryEdge(graph, edgeOrIndex, progress) {
  const edge = typeof edgeOrIndex === 'number' ? graph.edges[edgeOrIndex] : edgeOrIndex;
  const t = clamp(Number(progress) || 0, 0, 1);
  const controls = edge.controls;
  const point = cubic(graph.nodes[edge.a], controls.slice(0, 3), controls.slice(3, 6), graph.nodes[edge.b], t);
  return [...point, edge.radius * (0.92 + 0.08 * Math.sin(Math.PI * t))];
}

/** A sparse, locally branching capillary bed. The connected skeleton precedes
 * extra local anastomoses so every density level can retain its intake/drain. */
export function buildCapillaryNetwork({ seed = 719203, nodeCount = 580 } = {}) {
  const random = filamentRandom(seed);
  const count = clamp(Math.round(Number(nodeCount) || 580), 80, 1000);
  const nodes = [[-0.52 + random() * 0.22, 0.32, -0.16 + random() * 0.22]];
  const growthParents = [-1], growthDepths = [0], childCounts = [0];
  const tips = [{ node: 0, direction: normalize([0.15, 1, 0.12]), level: 0 }];
  const bounds = [[-1.62, 1.62], [0.28, 3.06], [-1.24, 1.24]];
  const phase = random() * Math.PI * 2;
  let attempts = 0;
  while (nodes.length < count) {
    attempts++;
    const tipIndex = Math.floor(random() * tips.length);
    const tip = tips[tipIndex], parentPoint = nodes[tip.node];
    const noise = normalize([random() - 0.5, random() - 0.5, random() - 0.5]);
    const field = [Math.sin(parentPoint[1] * 1.7 + phase) + Math.cos(parentPoint[2] * 2.1), Math.sin(parentPoint[2] * 1.6 + phase) * 0.5, Math.sin(parentPoint[0] * 1.9 - phase) - Math.cos(parentPoint[1] * 1.4)];
    const push = parentPoint.map((value, axis) => {
      const [low, high] = bounds[axis];
      return value < low + 0.35 ? (low + 0.35 - value) * 2.6 : value > high - 0.35 ? -(value - high + 0.35) * 2.6 : 0;
    });
    const direction = normalize(tip.direction.map((value, axis) => value * 0.78 + noise[axis] * (0.28 + random() * 0.20) + field[axis] * 0.13 + push[axis]));
    const step = 0.12 + random() ** 1.3 * 0.23;
    const point = parentPoint.map((value, axis) => value + direction[axis] * step);
    const outside = point.some((value, axis) => value < bounds[axis][0] || value > bounds[axis][1]);
    const close = nodes.some((existing, index) => index !== tip.node && distance(point, existing) < 0.085);
    if (outside || close || inPocket(point, 1.10) || crossesPocket(parentPoint, point)) {
      tip.direction = normalize(tip.direction.map((value, axis) => value * 0.25 + noise[axis] * 0.85 + push[axis]));
      if (attempts > count * 150) throw new Error('Capillary branch growth exceeded its bounded search');
      continue;
    }
    const index = nodes.length;
    nodes.push(point); growthParents.push(tip.node); growthDepths.push(tip.level); childCounts.push(0); childCounts[tip.node]++;
    tips[tipIndex] = { node: index, direction, level: tip.level };
    // Branch sites, fork angles, and lengths vary independently. A continuation
    // keeps directional memory while its new side branch chooses a wider turn.
    if (childCounts[tip.node] < 2 && random() < 0.26 + 0.10 * Math.sin(tip.node * 0.71 + phase)) {
      const fork = normalize(direction.map((value, axis) => value * 0.24 + noise[axis] * (random() < 0.5 ? -1 : 1) * 0.95));
      tips.push({ node: tip.node, direction: fork, level: tip.level + 1 });
    }
  }
  const candidates = [];
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
    const length = distance(nodes[a], nodes[b]);
    if (length < 1.0 && !crossesPocket(nodes[a], nodes[b])) candidates.push({ a, b, length, priority: length * (0.96 + random() * 0.08) });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const edges = [], keys = new Set(), degrees = new Uint8Array(count);
  const parent = Int32Array.from(nodes, (_, i) => i);
  const find = value => { while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value]; } return value; };
  const add = (a, b, length, backbone) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (keys.has(key)) return false;
    keys.add(key); degrees[a]++; degrees[b]++;
    edges.push({ a, b, length, chordLength: length, seed: random(), bow: [0, 0, 0], width: 0.008, radius: 0.008, backbone, direction: 1, flow: 0 });
    return true;
  };
  // Preserve the grown tree rather than replacing its hierarchy with a mesh.
  for (let node = 1; node < count; node++) {
    const parentNode = growthParents[node];
    add(parentNode, node, distance(nodes[parentNode], nodes[node]), true);
    parent[find(node)] = find(parentNode);
  }
  const backboneCount = edges.length;
  // Close terminal branches first, then add only short local junctions.
  for (let minimum = 2; minimum <= 2; minimum++) {
    for (const candidate of candidates) {
      const { a, b, length } = candidate;
      if (length > 0.72 || degrees[a] >= 4 || degrees[b] >= 4 || (degrees[a] >= minimum && degrees[b] >= minimum)) continue;
      add(a, b, length, false);
    }
  }
  const target = Math.round(count * 1.58);
  const localTies = candidates.slice();
  for (let i = localTies.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [localTies[i], localTies[j]] = [localTies[j], localTies[i]];
  }
  for (const candidate of localTies) {
    if (edges.length >= target) break;
    const { a, b, length } = candidate;
    if (length > 0.52 || degrees[a] >= 4 || degrees[b] >= 4) continue;
    add(a, b, length, false);
  }
  const sources = extrema(nodes);
  const intake = sources[2], drain = sources[3];
  const inlets = [intake], outlets = [drain];
  const boundary = new Map([[intake, 1], [drain, 0]]);
  // Secondary end faces feed smaller branch territories at compatible pressure.
  for (const index of [sources[6], sources[0]]) if (!boundary.has(index) && nodes[index][1] > 1.9) { boundary.set(index, 0.88); inlets.push(index); }
  for (const index of [sources[7], sources[1]]) if (!boundary.has(index) && nodes[index][1] < 1.4) { boundary.set(index, 0.12); outlets.push(index); }
  const treeAdjacency = Array.from({ length: count }, () => []);
  for (let i = 0; i < backboneCount; i++) { const edge = edges[i]; treeAdjacency[edge.a].push([edge.b, i]); treeAdjacency[edge.b].push([edge.a, i]); }
  const order = [intake], treeParent = new Int32Array(count).fill(-1), parentEdge = new Int32Array(count).fill(-1);
  treeParent[intake] = intake;
  for (let i = 0; i < order.length; i++) for (const [next, edge] of treeAdjacency[order[i]]) if (treeParent[next] < 0) { treeParent[next] = order[i]; parentEdge[next] = edge; order.push(next); }
  const load = new Float64Array(count).fill(1);
  for (let i = order.length - 1; i > 0; i--) { const node = order[i]; load[treeParent[node]] += load[node]; edges[parentEdge[node]].treeLoad = load[node] / count; }
  edges.forEach(edge => { edge.radius = edge.backbone ? 0.0049 + 0.0111 * (edge.treeLoad || 0) ** 0.31 : 0.0051 + edge.seed * 0.0021; });
  let hydraulic = solvePressure(nodes, edges, boundary);
  edges.forEach(edge => {
    const hierarchy = (edge.treeLoad || 1 / count) ** 0.31;
    const through = (edge.rawFlow / (hydraulic.maximumFlow || 1)) ** 0.30;
    edge.radius = clamp(0.0049 + 0.0111 * (0.72 * through + 0.28 * hierarchy), 0.005, 0.016);
    edge.width = edge.radius;
  });
  hydraulic = solvePressure(nodes, edges, boundary, hydraulic.pressures);
  const directors = Array.from({ length: count }, () => [0, 0, 0]);
  edges.forEach(edge => {
    const chord = normalize(subtract(nodes[edge.b], nodes[edge.a]));
    const flux = edge.rawFlow * edge.direction;
    for (let axis = 0; axis < 3; axis++) { directors[edge.a][axis] += chord[axis] * flux; directors[edge.b][axis] += chord[axis] * flux; }
  });
  directors.forEach((value, index) => { directors[index] = normalize(value); });
  const graph = { nodes, edges, sources, backboneCount, seed, inlets, outlets, boundary, degrees, pockets: POCKETS, growthParents: Int32Array.from(growthParents), growthDepths: Uint16Array.from(growthDepths) };
  edges.forEach(edge => {
    const a = nodes[edge.a], b = nodes[edge.b], chord = normalize(subtract(b, a));
    const da = directors[edge.a].map(value => value * edge.direction), db = directors[edge.b].map(value => value * edge.direction);
    const tangentA = normalize(chord.map((value, i) => value * 0.68 + da[i] * 0.32));
    const tangentB = normalize(chord.map((value, i) => value * 0.68 + db[i] * 0.32));
    const side = normalize([chord[1] * 0.31 - chord[2] * 0.83, chord[2] * 0.41 - chord[0] * 0.31, chord[0] * 0.83 - chord[1] * 0.41]);
    const bend = edge.chordLength * (0.045 + edge.seed * 0.11) * (edge.seed > 0.5 ? 1 : -1);
    const ca = a.map((value, i) => value + tangentA[i] * edge.chordLength * 0.35 + side[i] * bend);
    const cb = b.map((value, i) => value - tangentB[i] * edge.chordLength * 0.35 + side[i] * bend);
    edge.controls = [...ca, ...cb];
    edge.bow = ca.map((value, i) => (value + cb[i] - a[i] - b[i]) * 0.375);
    edge.samples = new Float32Array(CAPILLARY_SAMPLES * 4);
    edge.sampleCumulative = new Float32Array(CAPILLARY_SAMPLES);
    let prior = null, arcLength = 0;
    for (let sample = 0; sample < CAPILLARY_SAMPLES; sample++) {
      const point = sampleCapillaryEdge(graph, edge, sample / (CAPILLARY_SAMPLES - 1));
      edge.samples.set(point, sample * 4);
      if (prior) arcLength += distance(point.slice(0, 3), prior);
      edge.sampleCumulative[sample] = arcLength;
      prior = point.slice(0, 3);
    }
    edge.length = arcLength;
  });
  hydraulic = solvePressure(nodes, edges, boundary, hydraulic.pressures);
  graph.pressures = hydraulic.pressures;
  graph.adjacency = hydraulic.adjacency;
  graph.pressureResidual = hydraulic.residual;
  graph.distanceFields = sources.map(source => computeGeodesicDistances(nodes, edges, source));
  graph.nodeRadii = new Float32Array(count);
  edges.forEach(edge => { graph.nodeRadii[edge.a] = Math.max(graph.nodeRadii[edge.a], edge.radius); graph.nodeRadii[edge.b] = Math.max(graph.nodeRadii[edge.b], edge.radius); });
  return graph;
}

/** Routes follow the same directed edges and exact sampled lumen centers used
 * by the tube mesh. No spline shortcut can cut through a branching wall. */
export function buildCapillaryRoutes(graph, { count = 256, seed = graph.seed + 31 } = {}) {
  const random = filamentRandom(seed);
  const routeCount = clamp(Math.round(Number(count) || 256), 1, 2048);
  const outgoing = Array.from({ length: graph.nodes.length }, () => []);
  graph.edges.forEach((edge, index) => {
    if (edge.rawFlow < 1e-12) return;
    const from = edge.direction > 0 ? edge.a : edge.b, to = edge.direction > 0 ? edge.b : edge.a;
    outgoing[from].push({ edge: index, to, weight: edge.rawFlow });
  });
  const starts = graph.inlets.filter(node => outgoing[node].length);
  const interior = graph.nodes.map((_, i) => i).filter(node => outgoing[node].length && graph.pressures[node] > 0.15);
  const routes = [];
  for (let i = 0; i < routeCount; i++) {
    const start = i % 5 === 4 && interior.length ? interior[Math.floor(random() * interior.length)] : starts[i % starts.length];
    const pathNodes = [start], pathEdges = [], cumulative = [0];
    let current = start, length = 0, minimumRadius = Infinity, flowSum = 0;
    for (let step = 0; step < graph.nodes.length; step++) {
      if (step > 0 && graph.boundary.has(current)) break;
      const choices = outgoing[current];
      if (!choices.length) break;
      const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
      let pick = random() * total, chosen = choices[choices.length - 1];
      for (const choice of choices) { pick -= choice.weight; if (pick <= 0) { chosen = choice; break; } }
      const edge = graph.edges[chosen.edge];
      pathEdges.push(chosen.edge); pathNodes.push(chosen.to);
      minimumRadius = Math.min(minimumRadius, edge.radius * 0.92);
      length += edge.length; cumulative.push(length); flowSum += edge.flow;
      current = chosen.to;
    }
    if (!pathEdges.length) continue;
    const samples = [], sampleCumulative = [];
    let arc = 0, prior = null;
    pathEdges.forEach((index, pathIndex) => {
      const edge = graph.edges[index], forward = edge.a === pathNodes[pathIndex];
      for (let sample = pathIndex === 0 ? 0 : 1; sample < CAPILLARY_SAMPLES; sample++) {
        const offset = (forward ? sample : CAPILLARY_SAMPLES - 1 - sample) * 4;
        const point = [edge.samples[offset], edge.samples[offset + 1], edge.samples[offset + 2]];
        if (prior) arc += distance(prior, point);
        samples.push(...point, edge.samples[offset + 3]); sampleCumulative.push(arc); prior = point;
      }
    });
    routes.push({ nodes: pathNodes, edges: pathEdges, cumulative: Float32Array.from(cumulative), length: arc,
      speed: 0.11 + flowSum / pathEdges.length * 0.37, seed: random(), radius: minimumRadius * 0.70,
      offset: random(), samples: Float32Array.from(samples), sampleCumulative: Float32Array.from(sampleCumulative) });
  }
  return routes;
}

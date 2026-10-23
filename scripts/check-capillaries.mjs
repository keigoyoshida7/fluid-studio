import assert from 'node:assert/strict';
import { buildCapillaryNetwork, buildCapillaryRoutes, sampleCapillaryEdge, CAPILLARY_SAMPLES } from '../src/capillary-core.js';

const graph = buildCapillaryNetwork();
assert.equal(graph.nodes.length, 580);
assert.ok(graph.edges.length >= 900 && graph.edges.length <= 1100, 'sparse branching rather than a dense line lattice');
assert.equal(new Set(graph.sources).size, 8, 'eight distinct excitation locations');
assert.equal(graph.distanceFields.length, 8);
assert.ok(graph.distanceFields.every(field => field.every(Number.isFinite)), 'every node is reachable');
assert.ok(Array.from(graph.degrees).every(degree => degree >= 2 && degree <= 4), 'local capillary bifurcations');
assert.ok(Array.from(graph.degrees).some(degree => degree === 2) && Array.from(graph.degrees).some(degree => degree === 4), 'nonuniform branch density');
assert.ok(Math.max(...graph.growthDepths) >= 4, 'multiple generations of directional branch growth');
const reached = new Set([0]);
for (let pass = 0; pass < graph.nodes.length && reached.size < graph.nodes.length; pass++) {
  for (const edge of graph.edges.slice(0, graph.backboneCount)) if (reached.has(edge.a) || reached.has(edge.b)) { reached.add(edge.a); reached.add(edge.b); }
}
assert.equal(reached.size, graph.nodes.length, 'lowest density keeps a connected tree');
const radii = graph.edges.map(edge => edge.radius);
assert.ok(Math.min(...radii) >= 0.005 && Math.max(...radii) <= 0.016);
assert.ok(Math.max(...radii) / Math.min(...radii) > 2.5, 'fine tributaries and wider trunks have real radius hierarchy');
for (const edge of graph.edges) {
  assert.equal(edge.samples.length, CAPILLARY_SAMPLES * 4);
  assert.ok(edge.samples.every(Number.isFinite));
  assert.ok(edge.sampleCumulative.every(Number.isFinite));
  assert.ok(edge.length >= edge.chordLength - 1e-8, 'curved path length is physical arclength');
  assert.ok(edge.flow >= 0 && edge.flow <= 1);
  assert.ok(Number.isFinite(edge.rawFlow) && edge.rawFlow >= 0);
  const from = edge.direction > 0 ? edge.a : edge.b, to = edge.direction > 0 ? edge.b : edge.a;
  assert.ok(graph.pressures[from] >= graph.pressures[to], 'all branches follow one pressure potential');
  for (const [t, node] of [[0, edge.a], [1, edge.b]]) {
    const sampled = sampleCapillaryEdge(graph, edge, t);
    assert.ok(Math.hypot(...sampled.slice(0, 3).map((value, i) => value - graph.nodes[node][i])) < 1e-8, 'tube curve is joined exactly at its endpoint');
  }
}
assert.ok(graph.edges.reduce((sum, edge) => sum + edge.length / edge.chordLength, 0) / graph.edges.length > 1.01, 'branches have meaningful smooth curvature');
const maximumFlow = Math.max(...graph.edges.map(edge => edge.rawFlow));
for (let node = 0; node < graph.nodes.length; node++) {
  if (graph.boundary.has(node)) continue;
  const net = graph.adjacency[node].reduce((sum, neighbor) => sum + (graph.pressures[node] - graph.pressures[neighbor.node]) * neighbor.conductance, 0);
  assert.ok(Math.abs(net) / maximumFlow < 1e-6, 'interior junction conserves pressure-driven flow');
}

const routes = buildCapillaryRoutes(graph, { count: 384 });
assert.equal(routes.length, 384);
const visitedEdges = new Set();
for (const route of routes) {
  assert.ok(route.samples.every(Number.isFinite));
  assert.equal(route.samples.length / 4, route.sampleCumulative.length);
  assert.equal(route.cumulative.length, route.edges.length + 1);
  assert.ok(route.radius > 0 && Number.isFinite(route.speed));
  assert.ok(Math.abs(route.sampleCumulative.at(-1) - route.length) < 2e-6);
  assert.ok(Math.abs(route.cumulative.at(-1) - route.length) < 3e-5, 'particle route uses the tube arclength');
  assert.equal(new Set(route.nodes).size, route.nodes.length, 'no backwards flow or looping route stalls');
  route.edges.forEach((index, step) => {
    visitedEdges.add(index);
    const edge = graph.edges[index];
    const from = edge.direction > 0 ? edge.a : edge.b, to = edge.direction > 0 ? edge.b : edge.a;
    assert.equal(route.nodes[step], from); assert.equal(route.nodes[step + 1], to);
    assert.ok(route.radius <= edge.radius * 0.92, 'fine advected particles remain within every traversed lumen');
  });
  for (let point = 1; point < route.sampleCumulative.length; point++) assert.ok(route.sampleCumulative[point] > route.sampleCumulative[point - 1], 'continuous positive progress through branch junctions');
}
assert.ok(visitedEdges.size > graph.edges.length * 0.60, 'droplet routes cover fine branch territories');

const replayA = buildCapillaryNetwork({ seed: 4321, nodeCount: 120 });
const replayB = buildCapillaryNetwork({ seed: 4321, nodeCount: 120 });
assert.deepEqual(replayA.nodes, replayB.nodes, 'a selected seed can be reproduced');
assert.deepEqual(replayA.edges.map(edge => edge.samples), replayB.edges.map(edge => edge.samples));
for (const seed of [10234, 91387, 333]) {
  const other = buildCapillaryNetwork({ seed });
  assert.ok(other.distanceFields.every(field => field.every(Number.isFinite)), 'regeneration keeps the network connected');
  assert.ok(other.edges.every(edge => Number.isFinite(edge.flow) && Number.isFinite(edge.radius) && edge.samples.every(Number.isFinite)), 'regeneration preserves finite hydraulic curves');
  const change = other.nodes.reduce((sum, point, i) => sum + Math.hypot(...point.map((value, axis) => value - graph.nodes[i][axis])), 0) / graph.nodes.length;
  assert.ok(change > 0.4, 'a new seed visibly changes branching positions and directions');
  assert.notDeepEqual(other.growthParents, graph.growthParents, 'branch timing and parent hierarchy vary by seed');
}
console.log(`Capillaries: ${graph.nodes.length} nodes / ${graph.edges.length} curved branches; degree 2–4; radius hierarchy, connected regeneration, conserved pressure flow, and ${routes.length} continuous exact-lumen routes verified (${visitedEdges.size} branches reached).`);

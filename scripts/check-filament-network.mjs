import assert from 'node:assert/strict';
import { buildFilamentNetwork, edgeArrivalDistance, sampleFilamentPacket, FILAMENT_HALF_WIDTH_PX } from '../src/filament-network-core.js';
import { VesselFlow } from '../src/vessel-flow.js';

const graph = buildFilamentNetwork();
assert.equal(graph.nodes.length, 780);
assert.equal(graph.edges.length, 12480);
assert.equal(new Set(graph.sources).size, 8, 'independent spatial excitation roots');
for (const field of graph.distanceFields) assert.ok(field.every(Number.isFinite), 'all graph nodes reachable from every source');
for (const edge of graph.edges) {
  assert.ok(edge.width >= FILAMENT_HALF_WIDTH_PX[0] && edge.width <= FILAMENT_HALF_WIDTH_PX[1], 'hair-fine rather than vessel-width geometry');
  assert.ok(Number.isFinite(edge.length) && edge.length > 0);
  for (const field of graph.distanceFields) assert.ok(Math.abs(field[edge.a] - field[edge.b]) <= edge.length + 1e-5, 'geodesic distances obey graph triangle inequality');
}
// Even the least dense view retains one connected spanning skeleton.
const reached = new Set([0]);
for (let pass = 0; pass < graph.nodes.length && reached.size < graph.nodes.length; pass++) {
  for (const edge of graph.edges.slice(0, graph.backboneCount)) {
    if (reached.has(edge.a) || reached.has(edge.b)) { reached.add(edge.a); reached.add(edge.b); }
  }
}
assert.equal(reached.size, graph.nodes.length);
const repeatA = buildFilamentNetwork({ nodeCount: 80, seed: 10 });
const repeatB = buildFilamentNetwork({ nodeCount: 80, seed: 10 });
assert.deepEqual(repeatA, repeatB, 'same seed produces the same installation');

// A wave must traverse the edge, rather than lighting its entire length at once.
assert.equal(edgeArrivalDistance(0, 1, 1, 0.25), 0.25);
assert.equal(edgeArrivalDistance(0, 1, 1, 0.75), 0.75);
assert.equal(edgeArrivalDistance(1, 1, 2, 0.5), 2, 'two incoming paths meet at the center after both endpoints');
assert.equal(sampleFilamentPacket({ distance: 2.4, age: 0 }), 0, 'distant point remains dark at excitation');
assert.equal(sampleFilamentPacket({ distance: 2.4, age: 0.3, speed: 2.4 }), 0, 'no premature downstream activation');
assert.ok(sampleFilamentPacket({ distance: 2.4, age: 1, speed: 2.4 }) > 0.7, 'crest arrives after physical travel time');
assert.ok(sampleFilamentPacket({ distance: 2.4, age: 1, speed: 4.8 }) < 0.05, 'speed changes arrival time');
assert.ok(sampleFilamentPacket({ distance: 2.4, age: 1.3, afterglow: 1, speed: 2.4 }) > sampleFilamentPacket({ distance: 2.4, age: 1.3, afterglow: 0, speed: 2.4 }), 'afterglow preserves a decaying path');

const installation = new VesselFlow();
for (const attribute of Object.values(installation.threadGeometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), 'finite GPU geometry');
installation.setEnabled(true);
installation.setDensity(0);
assert.ok(installation.threadGeometry.instanceCount >= graph.backboneCount);
installation.setDensity(1);
assert.equal(installation.threadGeometry.instanceCount, graph.edges.length);
installation.setWaveParams({ speed: 2.4, strength: 1, damping: 0.28 });
const event = installation.excite({ source: graph.nodes[graph.sources[2]], strength: 1.2, mode: 'vortex' });
assert.equal(event.source, 2);
assert.deepEqual(event.origin, graph.nodes[graph.sources[2]]);
for (let i = 0; i < 100; i++) installation.excite({ strength: i % 2 ? NaN : 100, source: -100 });
assert.equal(installation.events.length, 12, 'bounded wave history');
assert.ok(installation.events.every(event => event.toArray().every(Number.isFinite)));
for (let frame = 0; frame <= 1600; frame++) {
  installation.setBands({ energy: 0.5 });
  installation.update(frame * 16.667);
}
assert.ok(installation.events.every(event => event.x < 0.1), 'music envelope suppresses autonomous excitations');
installation.reset();
assert.ok(installation.events.every(event => event.y === 0), 'reset clears packets');
assert.equal(installation.elapsed, 0);
installation.setAutonomy(1);
for (let frame = 0; frame <= 600; frame++) {
  installation.setBands({ energy: 0 });
  installation.update(frame * 16.667);
}
assert.ok(installation.events.some(event => event.y > 0), 'quiet installation has sparse autonomous activity');
installation.dispose();
console.log(`Filament network: ${graph.nodes.length} connected nodes, ${graph.edges.length} subpixel threads, 8 delayed propagation fields; density, packet timing, autonomy, reset, finite GPU attributes verified.`);

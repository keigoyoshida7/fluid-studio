import assert from 'node:assert/strict';
import { Vector3, MeshPhysicalMaterial } from 'three';
import { VesselFlow } from '../src/vessel-flow.js';

const source = new MeshPhysicalMaterial({ transmission: 1, roughness: 0.03, ior: 1.333 });
const vessel = new VesselFlow({ material: source });
const graph = vessel.graph;
assert.ok(vessel.wall.material.isMeshPhysicalMaterial && vessel.wall.material.transmission > 0.99, 'water uses a physical transmissive surface');
for (const attribute of Object.values(vessel.vesselGeometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), 'finite GPU geometry');
for (const texture of [vessel.centerTexture, vessel.routeTexture, vessel.routeMetaTexture, vessel.routeInfoTexture, vessel.routeDistanceTexture0, vessel.routeDistanceTexture1]) assert.ok(texture.image.data.every(Number.isFinite), 'finite GPU advection data');

// The GPU must preserve every original knot, especially junctions. Uniform
// resampling used to cut across corners and put particles outside fine lumens.
const width = vessel.routeTexture.image.width;
for (let row = 0; row < vessel.routes.length; row++) {
  const route = vessel.routes[row], count = route.samples.length / 4;
  assert.ok(width >= count && count <= 8192, 'all curve knots fit the bounded GPU search');
  assert.equal(vessel.routeInfoTexture.image.data[row * 4 + 2], count);
  for (let sample = 0; sample < count; sample++) {
    const offset = (row * width + sample) * 4;
    for (let axis = 0; axis < 4; axis++) assert.equal(vessel.routeTexture.image.data[offset + axis], route.samples[sample * 4 + axis], 'raw lumen centers and radii survive GPU packing exactly');
    assert.equal(vessel.routeMetaTexture.image.data[offset], route.sampleCumulative[sample], 'junction arc distance survives GPU packing');
    const edge = vessel.routeMetaTexture.image.data[offset + 3];
    assert.ok(Number.isInteger(edge) && edge >= 0 && edge < graph.edges.length, 'edge identity remains categorical');
  }
}

// Inward triangles turn a FrontSide water lumen into an opaque cable. Check
// every base triangle against the outward cylinder direction, independently
// of the index-building algorithm.
const positions = vessel.vesselGeometry.getAttribute('position'), indices = vessel.vesselGeometry.getIndex();
for (let i = 0; i < indices.count; i += 3) {
  const points = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(positions, indices.getX(i + offset)));
  const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
  const outward = points.reduce((sum, point) => sum.add(point), new Vector3());outward.x = 0;
  assert.ok(normal.dot(outward) > 0, 'all capillary wall triangles face outward');
}

vessel.setEnabled(true);vessel.setDensity(0);
assert.ok(vessel.vesselGeometry.instanceCount >= graph.backboneCount, 'minimum density keeps connected branches');
vessel.setDensity(1);assert.equal(vessel.vesselGeometry.instanceCount, graph.edges.length);
vessel.setFlow(0.2);vessel.setWaveParams({ speed: 4.8 });
assert.equal(vessel.flowTarget, 0.2, 'pressure propagation does not change internal current speed');
vessel.setFlow(0.9);assert.equal(vessel.waveParams.speed, 4.8, 'internal current does not change pulse speed');
vessel.setLumen(0.62);vessel.setTracerDensity(0.44);vessel.setPalette('crimson');
vessel.setWaveParams({ speed: 2.4, strength: 1, damping: 0.28 });
const event = vessel.excite({ source: graph.nodes[graph.sources[2]], strength: 1.2, mode: 'vortex' });
assert.equal(event.source, 2);assert.deepEqual(event.origin, graph.nodes[graph.sources[2]]);
for (let i = 0; i < 100; i++) vessel.excite({ strength: i % 2 ? NaN : 100, source: -100 });
assert.equal(vessel.events.length, 12, 'bounded pulse history');
assert.ok(vessel.events.every(event => event.toArray().every(Number.isFinite)));
for (let frame = 0; frame <= 1600; frame++) {vessel.setBands({ energy: 0.5 });vessel.update(frame * 16.667);}
assert.ok(vessel.events.every(event => event.x < 0.1), 'music suppresses autonomous pulses');
assert.ok(vessel.distance > 0, 'internal current advances between kicks');
vessel.reset();assert.equal(vessel.distance, 0);assert.ok(vessel.events.every(event => event.y === 0));
vessel.setAutonomy(1);
for (let frame = 0; frame <= 600; frame++) {vessel.setBands({ energy: 0 });vessel.update(frame * 16.667);}
assert.ok(vessel.events.some(event => event.y > 0), 'quiet capillaries have sparse autonomous activity');

// Regeneration must free the previous GPU resources and rebind the new ones.
const oldResources = [vessel.vesselGeometry, vessel.tracerGeometry, vessel.wallMaterial, vessel.tracerMaterial, vessel.centerTexture, vessel.routeTexture, vessel.routeMetaTexture, vessel.routeInfoTexture, vessel.routeDistanceTexture0, vessel.routeDistanceTexture1];
const disposed = new Set();oldResources.forEach(resource => resource.addEventListener('dispose', () => disposed.add(resource)));
vessel.regenerate(333);
assert.equal(disposed.size, oldResources.length, 'regeneration releases all previous GPU buffers/materials/textures');
assert.notDeepEqual(vessel.graph.nodes, graph.nodes, 'regeneration changes branch positions');
assert.equal(vessel.lumen, 0.62);assert.equal(vessel.tracerDensity, 0.44);assert.equal(vessel.palette, 'crimson');
assert.equal(vessel.flowTarget, 0.9);assert.ok(vessel.events.every(event => event.y === 0));
assert.equal(vessel.uniforms.uCapCenters.value, vessel.centerTexture);assert.equal(vessel.uniforms.uCapRoutes.value, vessel.routeTexture);
vessel.dispose();source.dispose();
console.log('Capillary renderer: outward physical water walls, finite GPU advection, independent flow/pulse speeds, autonomous activity and leak-free connected regeneration verified.');

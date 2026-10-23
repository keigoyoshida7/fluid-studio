import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FluidSimulation, FLUID_BOUNDS } from '../src/physics-core.js';

// Numerical smoke checks exercise collisions, incompressibility, interaction,
// and recirculating sources over real simulated time, without a renderer.
const summaries = [];
for (const preset of ['cascade', 'dam', 'orbit', 'rain']) {
  const sim = new FluidSimulation({ count: 1800, preset });
  sim.setParams({ gravity: preset === 'orbit' ? 0 : 9.81, viscosity: 0.12, turbulence: 0.2 });
  const start = performance.now();
  for (let frame = 0; frame < 420; frame++) {
    if (frame === 200) sim.setPointer({ active: true, position: [0, 0.4, 0], force: [2, 3, 0] });
    if (frame === 240) sim.setPointer({ active: false });
    sim.step(1 / 60);
    for (let i = 0; i < sim.positions.length; i++) {
      assert.ok(Number.isFinite(sim.positions[i]), `${preset}: finite particle ${i}`);
      const axis = i % 3;
      assert.ok(sim.positions[i] >= FLUID_BOUNDS.min[axis] - 1e-5 && sim.positions[i] <= FLUID_BOUNDS.max[axis] + 1e-5, `${preset}: particle within tank`);
    }
  }
  const stats = sim.stats();
  assert.ok(stats.maxDensity < 2.25, `${preset}: severe density compression ${stats.maxDensity}`);
  assert.ok(stats.maxSpeed < 16, `${preset}: unstable velocity ${stats.maxSpeed}`);
  if (preset === 'cascade' || preset === 'rain') {
    assert.ok(sim.emitterCursor > 300, `${preset}: source recirculates`);
    assert.ok(sim.positions.some((x, i) => i % 3 === 1 && x > 2.2), `${preset}: raised source remains live`);
  }
  summaries.push({ preset, count: sim.count, msPerStep: +((performance.now() - start) / 420).toFixed(2), recycled: sim.emitterCursor, ...stats });
}
console.log(JSON.stringify(summaries, null, 2));

// Pressure must actually separate an initially compressed packet.
const packet = new FluidSimulation({ count: 512, preset: 'orbit' });
packet.setParams({ gravity: 0, turbulence: 0, viscosity: 0 });
for (let i = 0; i < packet.positions.length; i += 3) {
  packet.positions[i] *= 0.70;
  packet.positions[i + 1] = 1.7 + (packet.positions[i + 1] - 1.7) * 0.70;
  packet.positions[i + 2] *= 0.70;
}
packet.predicted.set(packet.positions);
packet.buildNeighbors(); packet.solveDensity();
const densityBefore = packet.stats().maxDensity;
for (let i = 0; i < 90; i++) packet.step(1 / 120);
assert.ok(packet.stats().maxDensity < densityBefore * 0.7, 'pressure constraints relax compressed fluid');
console.log(`Pressure relaxation: ${densityBefore.toFixed(3)} → ${packet.stats().maxDensity.toFixed(3)}`);

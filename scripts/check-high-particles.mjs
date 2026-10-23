import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FluidSimulation, FLUID_BOUNDS, MAX_PARTICLES } from '../src/physics-core.js';

// A short optional benchmark for high detail; no long offline simulation required.
for (const count of [12000, MAX_PARTICLES]) {
  const simulation = new FluidSimulation({ count, preset: 'orbit' });
  simulation.setParams({ gravity: 0, viscosity: 0.1, turbulence: 0.5, surfaceTension: 0.6 });
  assert.equal(simulation.count, count);
  assert.equal(simulation.positions.length, count * 3);
  assert.equal(simulation.neighbors.length, count * simulation.maxNeighbors);
  assert.ok(Math.abs(simulation.volume * count - 0.105 ** 3 * 4000) < 1e-9, 'refinement preserves water volume');
  const start = performance.now();
  for (let frame = 0; frame < 20; frame++) {
    simulation.setAudio({ energy: 0.6, low: 0.8, mid: 0.3, high: 0.2 });
    if (frame === 10) simulation.addBeat({ strength: 1.2, mode: 'pulse' });
    simulation.step(1 / 60);
    for (let index = 0; index < simulation.positions.length; index++) {
      const value = simulation.positions[index], axis = index % 3;
      assert.ok(Number.isFinite(value), 'high-detail particles remain finite');
      assert.ok(value >= FLUID_BOUNDS.min[axis] && value <= FLUID_BOUNDS.max[axis], 'high-detail particles remain inside bounds');
      assert.ok(Number.isFinite(simulation.velocities[index]), 'high-detail velocities remain finite');
    }
  }
  console.log(JSON.stringify({ count, msPerStep: +((performance.now() - start) / 20).toFixed(1), spacing: simulation.spacing, ...simulation.stats() }));
  simulation.setAudio({ energy: Infinity, low: -10, mid: NaN, high: 100 });
  assert.equal(simulation.audio.energy, 0);
  assert.equal(simulation.audio.low, 0);
  assert.equal(simulation.audio.mid, 0);
  assert.equal(simulation.audio.high, 1);
  simulation.reset();
  assert.equal(simulation.audio.energy, 0, 'reset clears audio energy');
  assert.equal(simulation.audio.smoothedEnergy, 0, 'reset clears audio motion');
  assert.equal(simulation.beats.length, 0, 'reset clears beats');
}
for (const preset of ['cascade', 'dam', 'rain']) {
  const simulation = new FluidSimulation({ count: MAX_PARTICLES + 100, preset });
  assert.equal(simulation.count, MAX_PARTICLES, 'count is capped at supported maximum');
  for (let index = 0; index < simulation.positions.length; index++) {
    const value = simulation.positions[index], axis = index % 3;
    assert.ok(Number.isFinite(value) && value >= FLUID_BOUNDS.min[axis] && value <= FLUID_BOUNDS.max[axis], `${preset} high-detail initialization`);
  }
  if (preset !== 'dam') {
    simulation.time = 3;
    simulation.ages.fill(3);
    simulation.velocities.fill(0);
    for (let index = 1; index < simulation.positions.length; index += 3) simulation.positions[index] = 0.2;
    simulation.recycle(1 / 60);
    assert.ok(simulation.emitterCursor > 0, `${preset} source still recycles at high detail`);
    for (let index = 0; index < simulation.positions.length; index++) {
      const value = simulation.positions[index], axis = index % 3;
      assert.ok(Number.isFinite(value) && value >= FLUID_BOUNDS.min[axis] && value <= FLUID_BOUNDS.max[axis], `${preset} high-detail recycled source`);
    }
  }
}
console.log('All high-detail initialization, volume, audio/reset, and containment checks passed.');

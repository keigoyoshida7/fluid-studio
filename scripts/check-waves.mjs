import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FluidSimulation, FLUID_BOUNDS, MAX_WAVE_EVENTS, getWaveForce, getWavePacket } from '../src/physics-core.js';

// Wall-clock kicks remain independent when a slow simulation advances by less
// than the old 35 ms merge window between them (Time Lens / high detail).
const slowClock = new FluidSimulation({ count: 512, preset: 'orbit' });
slowClock.setParams({ gravity: 0, turbulence: 0 });
const sharedSource = [0, 1.7, 0];
slowClock.addBeat({ strength: 1, mode: 'pulse', position: sharedSource });
slowClock.step(0.013);
slowClock.addBeat({ strength: 0.4, mode: 'pulse', position: sharedSource });
assert.equal(slowClock.beats.length, 2, 'independent kicks 13 ms apart in simulation time retain two fronts');
assert.equal(slowClock.beats[0].strength, 1, 'a later kick does not alter the first front');
assert.equal(slowClock.beats[1].strength, 0.4, 'the later kick retains its own strength');
assert.equal(slowClock.beats[0].age, 0.013, 'the first front retains its travelled age');
assert.equal(slowClock.beats[1].age, 0, 'the second front starts at its source');
console.log('Independent kicks retain separate fronts with only 13 ms of simulated time between them');

// A distant point stays still until the travelling front reaches it. Compare
// actual positions with an unforced simulation; the two probes sit above a
// normal fluid packet so no pressure-neighbor chain can shortcut the delay.
function probeSimulation() {
  const simulation = new FluidSimulation({ count: 512, preset: 'dam' });
  simulation.setParams({ gravity: 0, turbulence: 0, viscosity: 0, surfaceTension: 0, waveSpeed: 2.4 });
  simulation.velocities.fill(0);
  for (let i = 2; i < simulation.count; i++) {
    const index = i - 2, k = i * 3;
    simulation.positions[k] = -1.3 + (index % 14) * 0.19;
    simulation.positions[k + 1] = 0.2 + Math.floor(index / (14 * 9)) * 0.19;
    simulation.positions[k + 2] = -0.8 + (Math.floor(index / 14) % 9) * 0.19;
  }
  simulation.positions.set([0.30, 2.65, 0, 1.10, 2.65, 0], 0);
  simulation.predicted.set(simulation.positions);
  return simulation;
}
const base = probeSimulation(), active = probeSimulation();
active.addBeat({ strength: 1, mode: 'pulse', position: [0, 2.65, 0] });
for (let frame = 0; frame < 14; frame++) { base.step(1 / 60); active.step(1 / 60); }
const nearEarly = active.positions[0] - base.positions[0];
const farEarly = active.positions[3] - base.positions[3];
assert.ok(nearEarly > 0.015, `near water moves after wave arrival (${nearEarly})`);
assert.ok(Math.abs(farEarly) < 1e-7, `far water waits for the front (${farEarly})`);
for (let frame = 14; frame < 38; frame++) { base.step(1 / 60); active.step(1 / 60); }
const farLater = active.positions[3] - base.positions[3];
assert.ok(farLater > 0.015, `far water moves after later arrival (${farLater})`);
console.log(`Physical propagation: near displacement ${nearEarly.toFixed(3)}, far before arrival ${farEarly.toFixed(6)}, far after arrival ${farLater.toFixed(3)}`);

// Sample spatial shells at matching time since arrival. Geometrical spreading
// and damping lower the distant force without changing the front's speed.
const nearPeak = Math.abs(getWavePacket(0.25, 0.25 / 2.4 + 0.04));
const farPeak = Math.abs(getWavePacket(2.0, 2.0 / 2.4 + 0.04));
assert.ok(farPeak > 0 && farPeak < nearPeak * 0.45, 'pressure attenuates with distance');
assert.equal(getWavePacket(2, 0.7, 2.4), 0, 'no force travels ahead of the front');
assert.equal(getWavePacket(0.2, 2, 2.4), 0, 'the packet leaves a quiet wake');
const tailSamples = Array.from({ length: 60 }, (_, i) => getWavePacket(1, 1 / 2.4 + 0.15 + i / 120));
assert.ok(tailSamples.some((value) => value < -0.02), 'afterwaves include pressure reversal');
assert.ok(tailSamples.some((value, index) => index > 20 && value > 0.01), 'more than the initial shock travels through water');
for (const mode of ['pulse', 'vortex', 'levitate']) {
  const beat = { age: 0.4, mode, strength: 1.5, position: [0, 1.7, 0], waveSpeed: 2.4 };
  for (const point of [[0, 1.7, 0], [0, 2.5, 0], [0.8, 1.7, 0], [0, 1.7, 0.8]]) {
    const force = getWaveForce(point, beat);
    assert.ok(force.every(Number.isFinite), `${mode}: axes and source core stay finite`);
  }
  assert.deepEqual(getWaveForce([0.8, 1.7, 0], beat, { waveStrength: 0 }), [0, 0, 0], `${mode}: strength OFF produces no force`);
}
assert.equal(getWavePacket(NaN, 1), 0);
assert.equal(getWavePacket(1, Infinity), 0);
assert.equal(getWavePacket(1, 1, 0), 0);

// Editing afterglow must affect new fronts without changing a front already
// represented in the optical event pool with its original damping.
const afterglow = new FluidSimulation({ count: 512, preset: 'orbit' });
afterglow.setParams({ waveDamping: 0.2 });
afterglow.addBeat({ position: [0, 1.7, 0] });
afterglow.beats[0].age = 0.5;
const forceBefore = getWaveForce([1, 1.7, 0], afterglow.beats[0], afterglow.params);
afterglow.setParams({ waveDamping: 1 });
assert.deepEqual(getWaveForce([1, 1.7, 0], afterglow.beats[0], afterglow.params), forceBefore, 'afterglow edits preserve existing physical and optical fronts');
afterglow.addBeat();
assert.equal(afterglow.beats.at(-1).waveDamping, 1, 'new fronts use the edited afterglow');

// Repeated full-strength, slow fronts overlap for many simulated frames. Test
// density, finite velocities and containment at normal and maximum detail.
for (const [count, frames] of [[3600, 140], [32000, 20]]) {
  const simulation = new FluidSimulation({ count, preset: 'orbit' });
  simulation.setParams({ gravity: 0, turbulence: 0.3, viscosity: 0.02, surfaceTension: 0.8, waveSpeed: 0.8, waveStrength: 1, waveDamping: 0 });
  const start = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    if (frame % 3 === 0) simulation.addBeat({ strength: 1.5, mode: ['pulse', 'vortex', 'levitate'][Math.floor(frame / 3) % 3] });
    simulation.step(1 / 60);
    for (let index = 0; index < simulation.positions.length; index++) {
      const value = simulation.positions[index], axis = index % 3;
      assert.ok(Number.isFinite(value) && Number.isFinite(simulation.velocities[index]), `${count}: finite liquid state`);
      assert.ok(value >= FLUID_BOUNDS.min[axis] && value <= FLUID_BOUNDS.max[axis], `${count}: confined liquid`);
    }
    assert.ok(simulation.beats.length <= MAX_WAVE_EVENTS, 'wave queue remains bounded');
    assert.ok(simulation.stats().maxDensity < 2.25, `${count}: pressure solver avoids severe compression`);
    assert.ok(simulation.stats().maxSpeed < 20, `${count}: no runaway velocity`);
  }
  const speed = simulation.beats.at(-1).waveSpeed;
  simulation.setParams({ waveSpeed: 5 });
  assert.equal(simulation.beats.at(-1).waveSpeed, speed, 'changing the speed does not teleport existing fronts');
  simulation.reset();
  assert.equal(simulation.beats.length, 0, 'reset clears all pressure fronts');
  console.log(`${count} particles: ${frames} frames of overlapping fronts stable; ${((performance.now() - start) / frames).toFixed(1)} ms / step`);
}

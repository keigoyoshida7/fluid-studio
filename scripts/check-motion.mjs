import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraDirector } from '../src/camera-director.js';
import { FluidSimulation, FLUID_BOUNDS } from '../src/physics-core.js';

function assertFluidStable(simulation, label) {
  for (let index = 0; index < simulation.positions.length; index++) {
    const value = simulation.positions[index], axis = index % 3;
    assert.ok(Number.isFinite(value), `${label}: position ${index} finite`);
    assert.ok(value >= FLUID_BOUNDS.min[axis] - 1e-5 && value <= FLUID_BOUNDS.max[axis] + 1e-5, `${label}: position ${index} contained`);
    assert.ok(Number.isFinite(simulation.velocities[index]), `${label}: velocity ${index} finite`);
  }
  assert.ok(simulation.stats().maxSpeed < 20, `${label}: bounded velocity`);
  assert.ok(simulation.beats.length <= 6, `${label}: bounded impulse queue`);
}

// Every mode must cause actual fluid movement with no pointer interaction.
for (const mode of ['pulse', 'vortex', 'levitate']) {
  const base = new FluidSimulation({ count: 512, preset: 'orbit' });
  const active = new FluidSimulation({ count: 512, preset: 'orbit' });
  base.setParams({ gravity: 0, turbulence: 0 });
  active.setParams({ gravity: 0, turbulence: 0 });
  active.addBeat({ mode, strength: 1.2 });
  for (let frame = 0; frame < 18; frame++) { base.step(1 / 60); active.step(1 / 60); }
  const displacement = active.positions.reduce((sum, value, index) => sum + Math.abs(value - base.positions[index]), 0) / active.count;
  assert.ok(displacement > 0.08, `${mode}: audible beat physically displaces fluid`);
  assertFluidStable(active, mode);
  console.log(`${mode}: mean displacement ${displacement.toFixed(3)}`);
}

// Thirty rapid transients, malformed strengths, all presets and maximum cohesion.
for (const preset of ['cascade', 'dam', 'orbit', 'rain']) {
  const simulation = new FluidSimulation({ count: 900, preset });
  simulation.setParams({ gravity: preset === 'orbit' ? 0 : 20, turbulence: 1, viscosity: 0, surfaceTension: 1, speed: 2 });
  for (let frame = 0; frame < 150; frame++) {
    if (frame < 90 && frame % 3 === 0) simulation.addBeat({ strength: frame % 9 ? 99 : NaN, mode: ['pulse', 'vortex', 'levitate'][Math.floor(frame / 3) % 3] });
    simulation.step(1 / 30);
    assertFluidStable(simulation, `${preset} rapid beats`);
  }
  simulation.addBeat({ strength: 1.5, mode: 'pulse' });
  simulation.reset({ preset });
  assert.equal(simulation.beats.length, 0, 'reset clears musical impulses');
  console.log(`${preset}: 30 rapid beats remain finite and contained`);
}

// The highest particle count needs the same containment guarantee.
const detailed = new FluidSimulation({ count: 6000, preset: 'orbit' });
detailed.setParams({ gravity: 0, viscosity: 0.03, turbulence: 1, surfaceTension: 1 });
for (let frame = 0; frame < 90; frame++) {
  if (frame % 3 === 0) detailed.addBeat({ strength: 1.5, mode: ['pulse', 'vortex', 'levitate'][Math.floor(frame / 3) % 3] });
  detailed.step(1 / 60);
  assertFluidStable(detailed, '6000-particle rapid beats');
}
console.log('6000 particles: 30 rapid beats remain finite and contained');

// Full closed paths stay continuous and retain the tank in portrait and landscape.
for (const aspect of [0.5, 1.6]) {
  const camera = new PerspectiveCamera(41, aspect, 0.1, 70);
  camera.position.set(5, 3.8, 5.8);
  const controls = { enabled: true, autoRotate: true, enableDamping: true, target: new Vector3(0, 1.55, 0), update() {} };
  const director = new CameraDirector(camera, controls);
  director.setSpeed(1);
  director.setEnabled(true);
  assert.equal(controls.enabled, false);
  assert.equal(controls.autoRotate, false);
  let now = 0;
  for (const style of ['drift', 'orbit', 'macro']) {
    const previous = camera.position.clone();
    director.setStyle(style);
    for (let frame = 0; frame < 3600; frame++) {
      now += 50;
      director.setAudioEnergy(Math.sin(frame * 0.07) * 0.5 + 0.5);
      director.update(now);
      camera.updateMatrixWorld();
      assert.ok(camera.position.distanceTo(previous) < 0.15, `${style}: camera has no cuts`);
      assert.ok(camera.position.y > 1.9, `${style}: camera above floor`);
      assert.ok(camera.position.distanceTo(controls.target) < 14.9, `${style}: orbit limits remain valid`);
      assert.ok(Number.isFinite(camera.fov), `${style}: finite lens`);
      if (frame > 80 && frame % 8 === 0) {
        for (const x of [-1.7, 1.7]) for (const y of [0, 3.4]) for (const z of [-1.3, 1.3]) {
          const corner = new Vector3(x, y, z).project(camera);
          assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1, `${style}/${aspect}: tank stays in frame`);
        }
      }
      previous.copy(camera.position);
    }
  }
  const finalPosition = camera.position.clone(), finalTarget = controls.target.clone(), finalFov = camera.fov;
  director.setEnabled(false);
  director.update(now + 5000);
  assert.equal(controls.enabled, true);
  assert.equal(controls.enableDamping, true);
  assert.deepEqual(camera.position, finalPosition, 'OFF keeps the current camera position');
  assert.deepEqual(controls.target, finalTarget, 'OFF keeps the current camera target');
  assert.equal(camera.fov, finalFov, 'OFF keeps the current lens');
  director.setStyle('__proto__');
  director.dispose();
  console.log(`Camera ${aspect}: continuous framing and exact ON/OFF pose retention`);
}

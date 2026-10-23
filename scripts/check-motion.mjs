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

// Detail focus also works while the automatic director is OFF. Returning focus
// restores the saved pose, while ordinary automatic ON/OFF still preserves it.
for (const aspect of [0.5, 1.6]) {
  const camera = new PerspectiveCamera(41, aspect, 0.1, 70);
  camera.position.set(5, 3.8, 5.8);
  const controls = { enabled: true, autoRotate: false, enableDamping: true, target: new Vector3(0, 1.55, 0), update() {} };
  const director = new CameraDirector(camera, controls);
  const original = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  let now = 0;
  const advance = (frames, check = () => {}) => {
    const previous = camera.position.clone();
    for (let frame = 0; frame < frames; frame++) {
      now += 1000 / 60;
      director.update(now);
      assert.ok(camera.position.distanceTo(previous) < 0.085, 'detail transition has no camera cut');
      assert.ok(camera.position.y > 1.9, 'detail transition remains above the ground');
      assert.ok(camera.position.distanceTo(controls.target) > 4.25, 'detail transition never enters the tubes');
      assert.ok(Number.isFinite(camera.fov), 'detail lens stays finite');
      previous.copy(camera.position);
      check(frame);
    }
  };
  director.setDetailFocus(true);
  assert.equal(director.detailFocus, true);
  assert.equal(director.enabled, false, 'manual detail focus leaves automatic mode OFF');
  assert.deepEqual(camera.position, original.position, 'focus ON never snaps');
  advance(300);
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - 4.9) < 1e-6, 'manual detail arrives at its close distance');
  assert.ok(controls.target.distanceTo(new Vector3(0, 1.6, 0.2)) < 1e-7, 'manual detail targets the vessel center');
  assert.equal(controls.enabled, true, 'manual orbit returns after the focus animation');
  if (aspect < 1) assert.ok(camera.fov > 60, 'portrait detail preserves horizontal framing with an adaptive lens');
  else assert.ok(Math.abs(camera.fov - 38) < 1e-7, 'landscape detail uses the closer lens');
  const closePosition = camera.position.clone();
  director.setDetailFocus(false);
  assert.deepEqual(camera.position, closePosition, 'focus OFF never snaps');
  advance(300);
  assert.deepEqual(camera.position, original.position, 'manual focus OFF restores the exact saved position');
  assert.deepEqual(controls.target, original.target, 'manual focus OFF restores the exact saved target');
  assert.equal(camera.fov, original.fov, 'manual focus OFF restores the exact saved lens');
  director.setDetailFocus(true); advance(90);
  director.setDetailFocus(false); advance(60);
  director.setDetailFocus(true); advance(60);
  director.setDetailFocus(false); advance(300);
  assert.deepEqual(camera.position, original.position, 'reversing focus in flight retains the original return pose');
  assert.deepEqual(controls.target, original.target, 'reversing focus in flight retains the original return target');
  assert.equal(camera.fov, original.fov, 'reversing focus in flight retains the original return lens');

  director.setEnabled(true);
  advance(300);
  const beforeAutoFocus = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  director.setDetailFocus(true);
  advance(360);
  for (const style of ['orbit', 'macro', 'drift']) {
    const beforeStyle = camera.position.clone();
    director.setStyle(style);
    assert.deepEqual(camera.position, beforeStyle, 'detail style change never snaps');
    advance(360);
    const distance = camera.position.distanceTo(controls.target);
    assert.ok(distance > 4.3 && distance < 5.65, `${style}: automatic detail uses the close path`);
  }
  const pausedPosition = camera.position.clone(), pausedTarget = controls.target.clone(), pausedFov = camera.fov;
  director.setEnabled(false);
  advance(60);
  assert.deepEqual(camera.position, pausedPosition, 'automatic OFF still holds its detail position');
  assert.deepEqual(controls.target, pausedTarget, 'automatic OFF still holds its detail target');
  assert.equal(camera.fov, pausedFov, 'automatic OFF still holds its detail lens');
  director.setEnabled(true);
  director.setDetailFocus(false);
  let returnedExactly = false;
  advance(480, () => {
    if (camera.position.distanceTo(beforeAutoFocus.position) < 1e-8 && controls.target.distanceTo(beforeAutoFocus.target) < 1e-8 && Math.abs(camera.fov - beforeAutoFocus.fov) < 1e-8) returnedExactly = true;
  });
  assert.ok(returnedExactly, 'automatic focus OFF visits the exact saved pose before smoothly resuming its path');
  assert.equal(director.enabled, true, 'focus OFF retains automatic mode');
  assert.equal(director.detailFocus, false);
  director.dispose();
  console.log(`Detail camera ${aspect}: manual close/return, automatic close paths, style morphs, portrait framing, and OFF retention pass`);
}

// The renderer reframes its live lens on resize; saved poses and animation
// endpoints must follow without correcting that live lens for a second time.
for (const resizeMoment of ['focused', 'entering', 'returning', 'automatic-entry']) {
  const camera = new PerspectiveCamera(41, 1.6, 0.1, 70);
  camera.position.set(5, 3.8, 5.8);
  const controls = { enabled: true, autoRotate: false, enableDamping: true, target: new Vector3(0, 1.55, 0), update() {} };
  const director = new CameraDirector(camera, controls);
  const originalPosition = camera.position.clone(), originalTarget = controls.target.clone();
  let now = 0;
  const advance = frames => {
    for (let frame = 0; frame < frames; frame++) { now += 1000 / 60; director.update(now); }
  };
  if (resizeMoment === 'automatic-entry') director.setEnabled(true);
  director.setDetailFocus(true);
  advance(resizeMoment === 'entering' || resizeMoment === 'automatic-entry' ? 18 : 300);
  if (resizeMoment === 'returning') { director.setDetailFocus(false); advance(18); }
  // Same correction as FluidRenderer.resize, from landscape into portrait.
  camera.fov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) / 0.5) * 180 / Math.PI;
  camera.aspect = 0.5;
  camera.updateProjectionMatrix();
  advance(1);
  assert.ok(camera.fov > 65 && camera.fov < 80, `${resizeMoment}: first frame retains the portrait lens without double correction`);
  advance(300);
  assert.ok(camera.fov > 65 && camera.fov < 80, `${resizeMoment}: animation endpoints retain portrait framing`);
  if (resizeMoment !== 'automatic-entry') {
    director.setDetailFocus(false);
    advance(300);
    const expectedFov = 2 * Math.atan(Math.tan(41 * Math.PI / 360) / 0.5) * 180 / Math.PI;
    assert.ok(Math.abs(camera.fov - expectedFov) < 1e-10, `${resizeMoment}: focus OFF restores the reframed saved lens`);
    assert.deepEqual(camera.position, originalPosition, `${resizeMoment}: saved position remains exact across resize`);
    assert.deepEqual(controls.target, originalTarget, `${resizeMoment}: saved target remains exact across resize`);
    camera.updateMatrixWorld();
    for (const x of [-1.7, 1.7]) for (const y of [0, 3.4]) for (const z of [-1.3, 1.3]) {
      const corner = new Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1, 'restored portrait view retains the tank inside the frame');
    }
  }
  director.dispose();
  console.log(`Detail resize ${resizeMoment}: stored lens synchronization and portrait framing pass`);
}

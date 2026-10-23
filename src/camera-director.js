import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const FOCUS = new Vector3(0, 1.55, 0);
const STYLES = {
  drift: {
    duration: 108,
    angles: [0.36, 0.66, 0.92, 0.78, 0.32, 0.02, -0.16, 0.08],
    heights: [0.25, 0.32, 0.43, 0.48, 0.38, 0.24, 0.29, 0.37],
    radii: [8.3, 8.7, 8.8, 8.2, 7.8, 8.2, 8.8, 8.6],
    fovs: [40, 39, 40, 42, 41, 40, 39, 40],
  },
  orbit: {
    duration: 88,
    angles: Array.from({ length: 8 }, (_, index) => 0.35 + index * Math.PI / 4),
    heights: [0.27, 0.35, 0.40, 0.31, 0.24, 0.34, 0.43, 0.36],
    radii: [8.4, 8.2, 8.6, 8.8, 8.5, 8.3, 8.6, 8.8],
    fovs: [41, 40, 40, 42, 41, 40, 41, 42],
  },
  macro: {
    duration: 116,
    angles: [0.72, 0.83, 0.90, 0.76, 0.56, 0.44, 0.52, 0.64],
    heights: [0.18, 0.23, 0.32, 0.38, 0.32, 0.22, 0.17, 0.19],
    radii: [9.2, 9.6, 9.8, 9.2, 8.8, 9.3, 9.7, 9.6],
    fovs: [34, 33, 34, 36, 35, 34, 33, 34],
  },
};

/** Continuous, authored camera paths. Disabling leaves the current composition intact. */
export class CameraDirector {
  constructor(camera, orbitControls) {
    this.camera = camera;
    this.controls = orbitControls;
    this.enabled = false;
    this.speed = 0.45;
    this.style = 'drift';
    this.energy = 0;
    this.smoothedEnergy = 0;
    this.phase = 0;
    this.entryElapsed = 0;
    this.lastTime = null;
    this._position = new Vector3();
    this._target = new Vector3();
    this._fov = new Vector3();
    this._dolly = new Vector3();
    this._blendDirection = new Vector3();
    this._entryDirection = new Vector3();
    this._entryPosition = new Vector3();
    this._entryTarget = new Vector3();
    this._entryFov = camera.fov;
    this._buildPaths();
    this._captureEntry();
  }

  _buildPaths() {
    const preset = STYLES[this.style];
    this.positionPath = new CatmullRomCurve3(preset.angles.map((angle, index) => {
      const radius = preset.radii[index], elevation = preset.heights[index];
      return new Vector3(
        Math.sin(angle) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        Math.cos(angle) * Math.cos(elevation) * radius,
      ).add(FOCUS);
    }), true, 'centripetal');
    this.targetPath = new CatmullRomCurve3(preset.angles.map((_, index) => new Vector3(
      Math.sin(index * Math.PI / 4) * 0.07,
      1.55 + Math.cos(index * Math.PI / 4) * 0.09,
      Math.sin(index * Math.PI / 2) * 0.055,
    )), true, 'centripetal');
    this.fovPath = new CatmullRomCurve3(preset.fovs.map(value => new Vector3(value, 0, 0)), true, 'centripetal');
    this.positionPath.arcLengthDivisions = 400;
    this.positionPath.updateArcLengths();
  }

  _captureEntry() {
    this._entryPosition.copy(this.camera.position);
    this._entryDirection.subVectors(this._entryPosition, FOCUS);
    this._entryRadius = this._entryDirection.length();
    this._entryDirection.normalize();
    this._entryTarget.copy(this.controls.target);
    this._entryFov = this.camera.fov;
    this.entryElapsed = 0;
    this.positionPath.getPointAt(this.phase, this._position);
    this._entryDuration = Math.max(3.2, this._entryPosition.distanceTo(this._position) * 0.9);
  }

  _alignPhase() {
    let nearest = Infinity;
    for (let index = 0; index < 240; index++) {
      this.positionPath.getPointAt(index / 240, this._position);
      const distance = this._position.distanceToSquared(this.camera.position);
      if (distance < nearest) { nearest = distance; this.phase = index / 240; }
    }
  }

  setEnabled(value) {
    const enabled = Boolean(value);
    if (enabled === this.enabled) return;
    if (enabled) {
      // Flush an old mouse gesture's damping before recording the entry pose.
      this._restoreDamping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.autoRotate = false;
      this.controls.update();
      this.controls.enabled = false;
      this._alignPhase();
      this._captureEntry();
    } else {
      this.controls.enableDamping = this._restoreDamping ?? true;
      this.controls.enabled = true;
      this.controls.autoRotate = false;
      // FOV, position, and target stay exactly where the final frame left them.
      this.controls.update();
    }
    this.enabled = enabled;
    this.lastTime = null;
  }

  setSpeed(value) { this.speed = clamp(finite(value, this.speed), 0.1, 1); }

  setStyle(value) {
    if (!Object.hasOwn(STYLES, value) || value === this.style) return;
    this.style = value;
    this._buildPaths();
    this._alignPhase();
    this._captureEntry();
  }

  setAudioEnergy(value) { this.energy = clamp(finite(value, 0), 0, 1); }

  update(timeMs) {
    if (!this.enabled) { this.lastTime = null; return; }
    const time = finite(timeMs, this.lastTime ?? 0);
    const dt = this.lastTime === null ? 0 : clamp((time - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = time;
    this.phase = (this.phase + dt * (0.35 + this.speed * 1.65) / STYLES[this.style].duration) % 1;
    this.entryElapsed += dt;
    this.smoothedEnergy += (this.energy - this.smoothedEnergy) * (1 - Math.exp(-dt * 2.2));
    this.positionPath.getPointAt(this.phase, this._position);
    this.targetPath.getPoint(this.phase, this._target);
    this.fovPath.getPoint(this.phase, this._fov);

    // Open the vertical lens in portrait view to preserve the horizontal framing.
    const aspect = clamp(finite(this.camera.aspect, 1), 0.35, 3);
    const verticalFov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(this._fov.x / 2)) / Math.min(aspect, 1)));
    const fov = clamp(verticalFov - this.smoothedEnergy * 0.45, 30, 96);
    // A musical breath in the dolly is deliberately much smaller than the path.
    this._dolly.subVectors(this._position, this._target).normalize().multiplyScalar(-this.smoothedEnergy * 0.065);
    this._position.add(this._dolly);
    this._position.y = Math.max(2.0, this._position.y);
    const alpha = MathUtils.smootherstep(this.entryElapsed, 0, this._entryDuration);
    this._dolly.subVectors(this._position, FOCUS);
    const radius = MathUtils.lerp(this._entryRadius, this._dolly.length(), alpha);
    this._dolly.normalize();
    // Blend directions around the subject so changing a style never sends the
    // lens straight through the water when the two viewpoints are far apart.
    this._blendDirection.lerpVectors(this._entryDirection, this._dolly, alpha).normalize();
    this.camera.position.copy(this._blendDirection).multiplyScalar(radius).add(FOCUS);
    this.controls.target.lerpVectors(this._entryTarget, this._target, alpha);
    this.camera.fov = MathUtils.lerp(this._entryFov, fov, alpha);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.controls.autoRotate = false;
  }

  reset() {
    this.phase = 0;
    this.energy = 0;
    this.smoothedEnergy = 0;
    this.lastTime = null;
    this._captureEntry();
  }

  dispose() { this.setEnabled(false); }
}

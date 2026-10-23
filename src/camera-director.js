import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const FOCUS = new Vector3(0, 1.55, 0);
const DETAIL_FOCUS = new Vector3(0, 1.6, 0.2);
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
    this._detailFocus = false;
    this._detailSavedPose = null;
    this._focusTransition = null;
    this._lastAspect = camera.aspect;
    this._restoreDamping = this.controls.enableDamping;
    this._pathFocus = new Vector3();
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
    this._pathFocus.copy(this._detailFocus ? DETAIL_FOCUS : FOCUS);
    this.positionPath = new CatmullRomCurve3(preset.angles.map((angle, index) => {
      const radius = this._detailFocus ? clamp(preset.radii[index] * 0.58, 4.5, 5.5) : preset.radii[index];
      const elevation = preset.heights[index];
      return new Vector3(
        Math.sin(angle) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        Math.cos(angle) * Math.cos(elevation) * radius,
      ).add(this._pathFocus);
    }), true, 'centripetal');
    this.targetPath = new CatmullRomCurve3(preset.angles.map((_, index) => new Vector3(
      Math.sin(index * Math.PI / 4) * 0.07,
      this._pathFocus.y + Math.cos(index * Math.PI / 4) * 0.09,
      this._pathFocus.z + Math.sin(index * Math.PI / 2) * 0.055,
    )), true, 'centripetal');
    this.fovPath = new CatmullRomCurve3(preset.fovs.map(value => new Vector3(this._detailFocus ? 38 + (value - 40) * 0.15 : value, 0, 0)), true, 'centripetal');
    this.positionPath.arcLengthDivisions = 400;
    this.positionPath.updateArcLengths();
  }

  _captureEntry() {
    this._syncAspect();
    this._entryPosition.copy(this.camera.position);
    this._entryDirection.subVectors(this._entryPosition, this._pathFocus);
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
    this._syncAspect();
    const enabled = Boolean(value);
    if (enabled === this.enabled) return;
    if (enabled) {
      // Flush an old mouse gesture's damping before recording the entry pose.
      if (!this._focusTransition) this._restoreDamping = this.controls.enableDamping;
      this._focusTransition = null;
      this.controls.enableDamping = false;
      this.controls.autoRotate = false;
      this.controls.update();
      this.controls.enabled = false;
      this._alignPhase();
      this._captureEntry();
    } else {
      this.controls.enableDamping = this._restoreDamping ?? true;
      this.controls.enabled = !this._focusTransition;
      this.controls.autoRotate = false;
      // FOV, position, and target stay exactly where the final frame left them.
      this.controls.update();
    }
    this.enabled = enabled;
    this.lastTime = null;
  }

  setSpeed(value) { this.speed = clamp(finite(value, this.speed), 0.1, 1); }

  setStyle(value) {
    this._syncAspect();
    if (!Object.hasOwn(STYLES, value) || value === this.style) return;
    this.style = value;
    this._buildPaths();
    this._alignPhase();
    this._captureEntry();
  }

  setAudioEnergy(value) { this.energy = clamp(finite(value, 0), 0, 1); }

  get detailFocus() { return this._detailFocus; }

  _adaptiveFov(value) {
    const aspect = clamp(finite(this.camera.aspect, 1), 0.35, 3);
    return clamp(MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(value / 2)) / Math.min(aspect, 1))), 30, 96);
  }

  _reframeFov(value, fromAspect, toAspect) {
    const from = Math.min(1, Math.max(1e-6, finite(fromAspect, 1)));
    const to = Math.min(1, Math.max(1e-6, finite(toAspect, 1)));
    if (from === to) return value;
    return MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(value / 2)) * from / to));
  }

  _syncAspect() {
    const aspect = this.camera.aspect;
    if (aspect === this._lastAspect) return;
    // FluidRenderer.resize has already reframed camera.fov. Reframe only stored
    // animation endpoints, so the next animation frame retains that correction.
    this._entryFov = this._reframeFov(this._entryFov, this._lastAspect, aspect);
    if (this._focusTransition) {
      this._focusTransition.fromFov = this._reframeFov(this._focusTransition.fromFov, this._lastAspect, aspect);
      this._focusTransition.toFov = this._reframeFov(this._focusTransition.toFov, this._lastAspect, aspect);
    }
    this._lastAspect = aspect;
  }

  _beginFocusTransition(position, target, fov, returning = false) {
    if (!this.enabled && !this._focusTransition) this._restoreDamping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.autoRotate = false;
    this.controls.update();
    this.controls.enabled = false;
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    this._focusTransition = {
      fromPosition, fromTarget, fromFov: this.camera.fov,
      toPosition: position.clone(), toTarget: target.clone(), toFov: fov,
      fromDirection: fromPosition.clone().sub(fromTarget).normalize(),
      toDirection: position.clone().sub(target).normalize(),
      fromRadius: fromPosition.distanceTo(fromTarget), toRadius: position.distanceTo(target),
      elapsed: 0, duration: Math.max(3.2, fromPosition.distanceTo(position) * 0.65), returning,
    };
    this.lastTime = null;
  }

  setDetailFocus(value) {
    this._syncAspect();
    const enabled = Boolean(value);
    if (enabled === this._detailFocus) return;
    this._detailFocus = enabled;
    if (enabled && !this._detailSavedPose) this._detailSavedPose = {
      position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov, aspect: this.camera.aspect,
    };
    this._buildPaths();
    if (enabled && this.enabled) {
      this._focusTransition = null;
      this._alignPhase();
      this._captureEntry();
    } else if (enabled) {
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      if (direction.lengthSq() < 0.5) direction.set(0.6, 0.3, 0.75).normalize();
      const position = direction.multiplyScalar(4.9).add(DETAIL_FOCUS);
      this._beginFocusTransition(position, DETAIL_FOCUS, this._adaptiveFov(38));
    } else if (this._detailSavedPose) {
      const saved = this._detailSavedPose;
      this._beginFocusTransition(saved.position, saved.target, this._reframeFov(saved.fov, saved.aspect, this.camera.aspect), true);
    }
  }

  _updateFocusTransition(dt) {
    const transition = this._focusTransition;
    transition.elapsed += dt;
    const alpha = MathUtils.smootherstep(transition.elapsed, 0, transition.duration);
    this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, alpha);
    this._blendDirection.lerpVectors(transition.fromDirection, transition.toDirection, alpha);
    if (this._blendDirection.lengthSq() < 1e-8) this._blendDirection.copy(transition.fromDirection);
    this._blendDirection.normalize();
    const radius = MathUtils.lerp(transition.fromRadius, transition.toRadius, alpha);
    this.camera.position.copy(this._blendDirection).multiplyScalar(radius).add(this.controls.target);
    this.camera.fov = MathUtils.lerp(transition.fromFov, transition.toFov, alpha);
    if (transition.elapsed >= transition.duration) {
      this.camera.position.copy(transition.toPosition);
      this.controls.target.copy(transition.toTarget);
      this.camera.fov = transition.toFov;
      this._focusTransition = null;
      if (transition.returning) this._detailSavedPose = null;
      if (this.enabled) { this._alignPhase(); this._captureEntry(); }
      else {
        this.controls.enabled = true;
        this.controls.enableDamping = this._restoreDamping ?? true;
      }
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.controls.autoRotate = false;
  }

  update(timeMs) {
    this._syncAspect();
    if (!this.enabled && !this._focusTransition) { this.lastTime = null; return; }
    const time = finite(timeMs, this.lastTime ?? 0);
    const dt = this.lastTime === null ? 0 : clamp((time - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = time;
    if (this._focusTransition) { this._updateFocusTransition(dt); return; }
    this.phase = (this.phase + dt * (0.35 + this.speed * 1.65) / STYLES[this.style].duration) % 1;
    this.entryElapsed += dt;
    this.smoothedEnergy += (this.energy - this.smoothedEnergy) * (1 - Math.exp(-dt * 2.2));
    this.positionPath.getPointAt(this.phase, this._position);
    this.targetPath.getPoint(this.phase, this._target);
    this.fovPath.getPoint(this.phase, this._fov);

    // Open the vertical lens in portrait view to preserve the horizontal framing.
    const fov = clamp(this._adaptiveFov(this._fov.x) - this.smoothedEnergy * 0.45, 30, 96);
    // A musical breath in the dolly is deliberately much smaller than the path.
    this._dolly.subVectors(this._position, this._target).normalize().multiplyScalar(-this.smoothedEnergy * 0.065);
    this._position.add(this._dolly);
    this._position.y = Math.max(2.0, this._position.y);
    const alpha = MathUtils.smootherstep(this.entryElapsed, 0, this._entryDuration);
    this._dolly.subVectors(this._position, this._pathFocus);
    const radius = MathUtils.lerp(this._entryRadius, this._dolly.length(), alpha);
    this._dolly.normalize();
    // Blend directions around the subject so changing a style never sends the
    // lens straight through the water when the two viewpoints are far apart.
    this._blendDirection.lerpVectors(this._entryDirection, this._dolly, alpha).normalize();
    this.camera.position.copy(this._blendDirection).multiplyScalar(radius).add(this._pathFocus);
    this.controls.target.lerpVectors(this._entryTarget, this._target, alpha);
    this.camera.fov = MathUtils.lerp(this._entryFov, fov, alpha);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    this.controls.autoRotate = false;
  }

  reset() {
    this._syncAspect();
    this.phase = 0;
    this.energy = 0;
    this.smoothedEnergy = 0;
    this.lastTime = null;
    this._captureEntry();
  }

  dispose() {
    this._focusTransition = null;
    this.setEnabled(false);
    this.controls.enabled = true;
    this.controls.enableDamping = this._restoreDamping ?? true;
  }
}

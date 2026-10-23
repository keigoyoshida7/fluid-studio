/**
 * Position Based Fluids, after Macklin & Müller (SIGGRAPH 2013).
 * https://mmacklin.com/pbf_sig_preprint.pdf
 *
 * Positions are predicted from forces, density constraints are solved with
 * poly6 / spiky SPH kernels, and XSPH viscosity filters the resulting velocity.
 * A uniform grid builds local neighborhoods, avoiding all-pairs particle work.
 * The raised jets recycle existing particles; particle count and mass stay fixed.
 */
export const FLUID_BOUNDS = Object.freeze({ min: [-1.7, 0, -1.3], max: [1.7, 3.4, 1.3] });
export const MAX_PARTICLES = 32000;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback) => Number.isFinite(Number(x)) ? Number(x) : fallback;

export const WAVE_DEFAULTS = Object.freeze({ waveSpeed: 2.4, waveStrength: 0.72, waveDamping: 0.24 });
const WAVE_TAIL_SECONDS = 1.2;
export const MAX_WAVE_EVENTS = 6;

/**
 * A causal pressure packet, sampled after the wave has travelled to a point.
 * The front is exactly zero ahead of its radius. A short positive kick is
 * followed by alternating, gentler ripples, so successive shells carry motion
 * through the liquid instead of accelerating the whole tank at once.
 * `speed` is measured in world units / simulated second.
 */
export function getWavePacket(distance, age, speed = WAVE_DEFAULTS.waveSpeed, damping = WAVE_DEFAULTS.waveDamping) {
  if (!Number.isFinite(distance) || !Number.isFinite(age) || !Number.isFinite(speed) || speed <= 0) return 0;
  const r = Math.max(0, distance), localAge = age - r / speed;
  if (localAge <= 0 || localAge >= WAVE_TAIL_SECONDS) return 0;
  const rise = localAge / 0.04;
  const shock = 1.4 * rise * Math.exp(1 - rise);
  const rippleAge = Math.max(0, localAge - 0.08);
  const ripples = 0.45 * Math.sin(rippleAge * Math.PI * 13) * Math.exp(-rippleAge * 4.2) * (1 - Math.exp(-rippleAge * 45));
  const tail = 1 - clamp((localAge - 0.85) / 0.35, 0, 1);
  const loss = clamp(finite(damping, WAVE_DEFAULTS.waveDamping), 0, 1);
  return (shock + ripples) * tail * tail * Math.exp(-loss * r * 0.8) / (1 + 0.8 * r + 0.22 * r * r);
}

/** Pure wave-force query, with an optional reusable output array. */
export function getWaveForce(position, beat, params = WAVE_DEFAULTS, target = [0, 0, 0]) {
  target[0] = 0; target[1] = 0; target[2] = 0;
  if (!beat || !beat.position || !position) return target;
  const dx = position[0] - beat.position[0], dy = position[1] - beat.position[1], dz = position[2] - beat.position[2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const speed = beat.waveSpeed ?? params.waveSpeed ?? WAVE_DEFAULTS.waveSpeed;
  const packet = getWavePacket(r, beat.age, speed, beat.waveDamping ?? params.waveDamping ?? WAVE_DEFAULTS.waveDamping);
  if (packet === 0) return target;
  const strength = clamp(finite(params.waveStrength, WAVE_DEFAULTS.waveStrength), 0, 1);
  if (strength === 0) return target;
  const force = packet * clamp(finite(beat.strength, 1), 0, 1.5) * strength * 52;
  // Soft core avoids a directional singularity at the source itself.
  const invRadius = 1 / Math.sqrt(r * r + 0.0036);
  if (beat.mode === 'vortex') {
    // A travelling torsion packet with a pressure component in all three axes.
    target[0] = (-dz + dx * 0.25) * invRadius * force * 1.25;
    target[1] = (dy * 0.25 * invRadius + 0.20) * force * 1.25;
    target[2] = (dx + dz * 0.25) * invRadius * force * 1.25;
  } else if (beat.mode === 'levitate') {
    target[0] = dx * invRadius * force * 0.30;
    target[1] = (0.95 + dy * invRadius * 0.35) * force;
    target[2] = dz * invRadius * force * 0.30;
  } else {
    target[0] = dx * invRadius * force;
    target[1] = dy * invRadius * force;
    target[2] = dz * invRadius * force;
  }
  return target;
}

export class FluidSimulation {
  constructor({ count = 3600, preset = 'cascade' } = {}) {
    this.params = { gravity: 9.81, viscosity: 0.12, turbulence: 0.2, speed: 1, surfaceTension: 0.3, ...WAVE_DEFAULTS };
    this.wavePoint = [0, 0, 0];
    this.waveForce = [0, 0, 0];
    this.pointer = { active: false, position: [0, 1.5, 0], force: [0, 0, 0] };
    this.reset({ count, preset });
  }

  reset({ count = this.count, preset = this.preset } = {}) {
    this.count = clamp(Math.round(finite(count, 3600)), 512, MAX_PARTICLES);
    this.preset = ['cascade', 'dam', 'orbit', 'rain'].includes(preset) ? preset : 'cascade';
    this.time = 0;
    this.pointer.active = false;
    this.beats = [];
    this.audio = { energy: 0, low: 0, mid: 0, high: 0, smoothedEnergy: 0, age: 0 };
    this.emitterDebt = 0;
    this.emitterCursor = 0;
    this.recycleCursor = 0;
    this.seed = 913713;
    const n = this.count;
    this.spacing = 0.105 * Math.cbrt(4000 / n);
    // Refine source cross sections with the particles, retaining their world size.
    this.jetSide = Math.max(3, Math.round(0.315 / this.spacing));
    this.rainColumns = this.jetSide;
    this.rainRows = Math.max(5, Math.round(0.525 / this.spacing));
    this.renderRadius = this.spacing * 0.88;
    this.wallRadius = this.spacing * 0.45;
    this.h = this.spacing * 2.05;
    this.h2 = this.h * this.h;
    this.volume = this.spacing ** 3;
    this.poly6 = 315 / (64 * Math.PI * this.h ** 3);
    this.spiky = -45 / (Math.PI * this.h ** 4) * this.volume;
    this.restDensity = this.latticeDensity();
    this.invRest = 1 / this.restDensity;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.predicted = new Float32Array(n * 3);
    this.corrections = new Float32Array(n * 3);
    this.velocityDelta = new Float32Array(n * 3);
    this.lambdas = new Float32Array(n);
    this.densities = new Float32Array(n);
    this.ages = new Float32Array(n);
    this.neighborCounts = new Uint16Array(n);
    this.maxNeighbors = 144;
    this.neighbors = new Int32Array(n * this.maxNeighbors);
    this.next = new Int32Array(n);
    // The neighbor list has a safety shell for motion during solver iterations.
    this.cellSize = this.h * 1.24;
    this.invCell = 1 / this.cellSize;
    this.gridX = Math.ceil(3.4 * this.invCell) + 2;
    this.gridY = Math.ceil(3.4 * this.invCell) + 2;
    this.gridZ = Math.ceil(2.6 * this.invCell) + 2;
    this.gridXY = this.gridX * this.gridY;
    this.head = new Int32Array(this.gridXY * this.gridZ);
    this.initializeParticles();
    this.predicted.set(this.positions);
    return this;
  }

  random() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  latticeDensity() {
    let density = 0;
    const reach = Math.ceil(this.h / this.spacing);
    for (let z = -reach; z <= reach; z++) {
      for (let y = -reach; y <= reach; y++) {
        for (let x = -reach; x <= reach; x++) {
          const r2 = (x * x + y * y + z * z) * this.spacing ** 2;
          if (r2 < this.h2) density += this.volume * this.poly6 * (1 - r2 / this.h2) ** 3;
        }
      }
    }
    return density;
  }

  initializeParticles() {
    const n = this.count, s = this.spacing, p = this.positions, v = this.velocities;
    if (this.preset === 'orbit') {
      const side = Math.ceil(Math.cbrt(n) * 1.35);
      const points = [];
      const half = (side - 1) * 0.5;
      for (let z = 0; z < side; z++) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const dx = (x - half) * s, dy = (y - half) * s, dz = (z - half) * s;
        points.push([dx, dy, dz, dx * dx + dy * dy + dz * dz]);
      }
      points.sort((a, b) => a[3] - b[3]);
      for (let i = 0; i < n; i++) {
        const k = i * 3, [x, y, z] = points[i];
        p[k] = x; p[k + 1] = y + 1.7; p[k + 2] = z;
        v[k] = -z * 1.4; v[k + 1] = Math.sin(x * 2.5) * 0.15; v[k + 2] = x * 1.4;
      }
    } else {
      const rain = this.preset === 'rain';
      const cascade = this.preset === 'cascade';
      const nx = Math.max(2, Math.floor((rain ? 2.7 : cascade ? 1.28 : 1.15) / s));
      const nz = Math.max(2, Math.floor((rain ? 1.95 : 1.82) / s));
      const ny = Math.ceil(n / (nx * nz));
      const sx = rain ? 2.7 / nx : s;
      const sy = rain ? 2.7 / Math.max(1, ny) : s;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        const ix = i % nx, iz = Math.floor(i / nx) % nz, iy = Math.floor(i / (nx * nz));
        const jitter = s * 0.018;
        p[k] = (rain ? -1.35 : -1.51) + ix * sx + (this.random() - 0.5) * jitter;
        const stagger = rain ? ((ix * 0.618 + iz * 0.414) % 1) * sy : 0;
        p[k + 1] = (rain ? 0.35 : cascade ? 0.88 : 0.15) + iy * sy + stagger + (this.random() - 0.5) * jitter;
        p[k + 2] = -(nz - 1) * s * 0.5 + iz * s + (this.random() - 0.5) * jitter;
        v[k] = cascade ? 1.65 : rain ? 0.1 * Math.sin(iz) : 0;
        v[k + 1] = rain ? -0.7 : 0;
        v[k + 2] = cascade ? (p[k] + 0.8) * 0.15 : 0;
      }
    }
    // Quality levels can round a final row upward; keep it within the tank.
    this.constrain(this.positions);
  }

  setParams(next = {}) {
    this.params.gravity = clamp(finite(next.gravity, this.params.gravity), 0, 20);
    this.params.viscosity = clamp(finite(next.viscosity, this.params.viscosity), 0, 1);
    this.params.turbulence = clamp(finite(next.turbulence, this.params.turbulence), 0, 1);
    this.params.speed = clamp(finite(next.speed, this.params.speed), 0.05, 2);
    this.params.surfaceTension = clamp(finite(next.surfaceTension, this.params.surfaceTension), 0, 1);
    this.params.waveSpeed = clamp(finite(next.waveSpeed, this.params.waveSpeed), 0.8, 5);
    this.params.waveStrength = clamp(finite(next.waveStrength, this.params.waveStrength), 0, 1);
    this.params.waveDamping = clamp(finite(next.waveDamping, this.params.waveDamping), 0, 1);
  }

  setPointer(next = {}) {
    this.pointer.active = Boolean(next.active);
    if (Array.isArray(next.position) && next.position.length >= 3) {
      this.pointer.position = next.position.slice(0, 3).map((x) => clamp(finite(x, 0), -5, 5));
    }
    if (Array.isArray(next.force) && next.force.length >= 3) {
      this.pointer.force = next.force.slice(0, 3).map((x) => clamp(finite(x, 0), -25, 25));
    }
  }

  addBeat({ strength = 1, mode = 'pulse', position } = {}) {
    const amount = clamp(finite(strength, 1), 0, 1.5);
    if (amount === 0) return;
    const style = ['pulse', 'vortex', 'levitate'].includes(mode) ? mode : 'pulse';
    const center = [0, this.preset === 'orbit' ? 1.7 : 0.32, 0];
    if (Array.isArray(position) && position.length >= 3) {
      for (let axis = 0; axis < 3; axis++) {
        center[axis] = clamp(finite(position[axis], center[axis]), FLUID_BOUNDS.min[axis], FLUID_BOUNDS.max[axis]);
      }
    }
    // Audio scheduling already emits one event per kick. Simulation time may
    // advance slowly at high detail or in Time Lens, so age cannot identify
    // duplicate callbacks: two independent kicks must retain separate fronts.
    if (this.beats.length >= MAX_WAVE_EVENTS) this.beats.shift();
    const waveSpeed = this.params.waveSpeed;
    const maxDistance = Math.hypot(...center.map((value, axis) => Math.max(Math.abs(value - FLUID_BOUNDS.min[axis]), Math.abs(value - FLUID_BOUNDS.max[axis]))));
    this.beats.push({ strength: amount, mode: style, position: center, age: 0, waveSpeed, waveDamping: this.params.waveDamping, lifetime: maxDistance / waveSpeed + WAVE_TAIL_SECONDS });
  }

  setAudio(next = {}) {
    for (const band of ['energy', 'low', 'mid', 'high']) this.audio[band] = clamp(finite(next[band], 0), 0, 1);
    this.audio.age = 0;
  }

  constrain(p) {
    const r = this.wallRadius;
    const lx = -1.7 + r, hx = 1.7 - r, ly = r, hy = 3.4 - r, lz = -1.3 + r, hz = 1.3 - r;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = clamp(p[i], lx, hx);
      p[i + 1] = clamp(p[i + 1], ly, hy);
      p[i + 2] = clamp(p[i + 2], lz, hz);
    }
  }

  buildNeighbors() {
    const p = this.predicted, n = this.count, inv = this.invCell, gx = this.gridX, gy = this.gridY;
    const gxy = this.gridXY, head = this.head, next = this.next;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const x = Math.floor((p[k] + 1.7) * inv) + 1;
      const y = Math.floor(p[k + 1] * inv) + 1;
      const z = Math.floor((p[k + 2] + 1.3) * inv) + 1;
      const cell = x + y * gx + z * gxy;
      next[i] = head[cell]; head[cell] = i;
    }
    const cutoff2 = this.cellSize ** 2, max = this.maxNeighbors, nb = this.neighbors;
    for (let i = 0; i < n; i++) {
      const k = i * 3, px = p[k], py = p[k + 1], pz = p[k + 2];
      const cx = Math.floor((px + 1.7) * inv) + 1;
      const cy = Math.floor(py * inv) + 1;
      const cz = Math.floor((pz + 1.3) * inv) + 1;
      let count = 0;
      for (let z = cz - 1; z <= cz + 1; z++) for (let y = cy - 1; y <= cy + 1; y++) {
        const row = y * gx + z * gxy;
        for (let x = cx - 1; x <= cx + 1; x++) {
          // The padded grid makes each scanned coordinate valid.
          let j = head[x + row];
          while (j !== -1 && j !== undefined) {
            if (j !== i) {
              const q = j * 3, dx = px - p[q], dy = py - p[q + 1], dz = pz - p[q + 2];
              if (dx * dx + dy * dy + dz * dz < cutoff2 && count < max) nb[i * max + count++] = j;
            }
            j = next[j];
          }
        }
      }
      this.neighborCounts[i] = count;
    }
  }

  solveDensity() {
    const p = this.predicted, n = this.count, h = this.h, h2 = this.h2;
    const nb = this.neighbors, nc = this.neighborCounts, max = this.maxNeighbors;
    const scale = this.volume * this.poly6 * this.invRest;
    const gradScale = this.spiky * this.invRest;
    const lambda = this.lambdas;
    const regularization = 0.0003 / (this.spacing * this.spacing);
    for (let i = 0; i < n; i++) {
      const k = i * 3, px = p[k], py = p[k + 1], pz = p[k + 2];
      let density = scale, gx = 0, gy = 0, gz = 0, sumGrad2 = 0;
      const start = i * max;
      for (let a = 0; a < nc[i]; a++) {
        const q = nb[start + a] * 3;
        const dx = px - p[q], dy = py - p[q + 1], dz = pz - p[q + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= h2) continue;
        const t = 1 - r2 / h2;
        density += scale * t * t * t;
        if (r2 < 1e-10) continue;
        const r = Math.sqrt(r2), d = 1 - r / h;
        const grad = gradScale * d * d / r;
        const x = grad * dx, y = grad * dy, z = grad * dz;
        gx += x; gy += y; gz += z;
        sumGrad2 += x * x + y * y + z * z;
      }
      this.densities[i] = density;
      // Free-surface particles have missing neighbors, so use unilateral pressure.
      const constraint = Math.max(density - 1, 0);
      lambda[i] = -constraint / (sumGrad2 + gx * gx + gy * gy + gz * gz + regularization);
    }
    const corr = this.corrections;
    const antiClump = 0.002 * this.spacing * this.spacing;
    const reference = (1 - 0.3 * 0.3) ** 3;
    const maxCorrection = this.spacing * 0.24;
    for (let i = 0; i < n; i++) {
      const k = i * 3, px = p[k], py = p[k + 1], pz = p[k + 2];
      let cx = 0, cy = 0, cz = 0;
      const start = i * max;
      for (let a = 0; a < nc[i]; a++) {
        const j = nb[start + a], q = j * 3;
        const dx = px - p[q], dy = py - p[q + 1], dz = pz - p[q + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= h2 || r2 < 1e-10) continue;
        const r = Math.sqrt(r2), d = 1 - r / h, t = 1 - r2 / h2;
        const ratio = t * t * t / reference;
        const pressure = lambda[i] + lambda[j] - antiClump * ratio ** 4;
        const factor = pressure * gradScale * d * d / r;
        cx += factor * dx; cy += factor * dy; cz += factor * dz;
      }
      const length = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const limit = length > maxCorrection ? maxCorrection / length : 1;
      corr[k] = cx * limit; corr[k + 1] = cy * limit; corr[k + 2] = cz * limit;
    }
    for (let i = 0; i < p.length; i++) p[i] += corr[i];
    this.constrain(p);
  }

  recycle(dt) {
    if ((this.preset !== 'cascade' && this.preset !== 'rain') || this.time < 2.6) return;
    const n = this.count, p = this.positions, v = this.velocities, s = this.spacing;
    this.emitterDebt = Math.min(this.emitterDebt + n * dt * 0.17, n * 0.02);
    let budget = Math.floor(this.emitterDebt), checked = 0;
    const emissionBudget = budget;
    while (budget > 0 && checked < n) {
      const i = this.recycleCursor++ % n, k = i * 3;
      checked++;
      if (p[k + 1] > 0.65 || this.ages[i] < 2.7) continue;
      const speed2 = v[k] ** 2 + v[k + 1] ** 2 + v[k + 2] ** 2;
      if (speed2 > 3.5) continue;
      const e = this.emitterCursor++;
      if (this.preset === 'cascade') {
        // A compact cross section and closely spaced emission layers form a jet.
        // Birth times span this substep so more than nine arrivals never coincide.
        const birthOffset = dt * (1 - budget / emissionBudget);
        const side = this.jetSide, half = (side - 1) * 0.5;
        p[k] = -1.3 + ((e % side) - half) * s + 1.9 * birthOffset;
        p[k + 1] = 3.10 - 1.65 * birthOffset;
        p[k + 2] = ((Math.floor(e / side) % side) - half) * s;
        v[k] = 1.9; v[k + 1] = -1.65; v[k + 2] = 0.12 * Math.sin(this.time * 1.5);
      } else {
        // Four separated overhead streams, each with a small physical cross section.
        const stream = e % 4;
        const row = Math.floor(e / 4);
        const columns = this.rainColumns, rows = this.rainRows;
        p[k] = [-1.02, -0.34, 0.34, 1.02][stream] + ((row % columns) - (columns - 1) * 0.5) * s;
        p[k + 1] = 3.13;
        p[k + 2] = ((Math.floor(row / columns) % rows) - (rows - 1) * 0.5) * s;
        v[k] = 0.10 * Math.sin(this.time + stream); v[k + 1] = -2.3; v[k + 2] = 0;
      }
      this.ages[i] = 0;
      this.emitterDebt--; budget--;
    }
  }

  substep(dt) {
    const n = this.count, p = this.positions, v = this.velocities, q = this.predicted;
    const { gravity, turbulence } = this.params;
    const pointer = this.pointer;
    const beats = this.beats;
    const wavePoint = this.wavePoint, waveForce = this.waveForce;
    const audio = this.audio;
    audio.age += dt;
    // A missing analyser stream settles back to silence without retaining data.
    const audioTarget = audio.age < 0.3 ? audio.energy : 0;
    audio.smoothedEnergy += (audioTarget - audio.smoothedEnergy) * (1 - Math.exp(-dt * 7));
    const audioSway = audio.smoothedEnergy * 0.55;
    const orbit = this.preset === 'orbit';
    const t = this.time;
    const audioX = audioSway * Math.cos(t * 0.65) * (0.3 + audio.mid * 0.7);
    const audioY = audioSway * 0.55 * (0.25 + audio.low * 0.75);
    const audioZ = audioSway * Math.sin(t * 0.65) * (0.3 + audio.high * 0.7);
    this.recycle(dt);
    for (let i = 0; i < n; i++) {
      const k = i * 3, x = p[k], y = p[k + 1], z = p[k + 2];
      let ax = audioX, ay = -gravity + audioY, az = audioZ;
      if (orbit) {
        // A weak physical central force holds the zero-gravity spinning droplet.
        const dy = y - 1.7;
        ax -= x * 1.45; ay -= dy * 1.45; az -= z * 1.45;
      }
      if (turbulence > 0) {
        // Smooth curl-like external forcing creates eddies; pressure still drives flow.
        const force = turbulence * 2.3;
        ax += force * Math.sin(y * 2.7 + t * 0.9) * Math.cos(z * 2.1 - t * 0.4);
        ay += force * 0.28 * Math.sin(z * 2.4 + t * 0.7) * Math.cos(x * 2.5);
        az -= force * Math.cos(y * 2.7 + t * 0.9) * Math.sin(x * 2.1 - t * 0.4);
      }
      if (pointer.active) {
        const dx = x - pointer.position[0], dy = y - pointer.position[1], dz = z - pointer.position[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const radius = 0.72;
        if (r2 < radius * radius) {
          const falloff = (1 - r2 / (radius * radius)) ** 2;
          ax += (pointer.force[0] * 7 - dx * 4) * falloff;
          ay += (pointer.force[1] * 7 + 3.0 - dy * 4) * falloff;
          az += (pointer.force[2] * 7 - dz * 4) * falloff;
        }
      }
      wavePoint[0] = x; wavePoint[1] = y; wavePoint[2] = z;
      for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
        getWaveForce(wavePoint, beats[beatIndex], this.params, waveForce);
        ax += waveForce[0]; ay += waveForce[1]; az += waveForce[2];
      }
      const drag = Math.max(0, 1 - dt * 0.045);
      v[k] = (v[k] + ax * dt) * drag;
      v[k + 1] = (v[k + 1] + ay * dt) * drag;
      v[k + 2] = (v[k + 2] + az * dt) * drag;
      const speed = Math.hypot(v[k], v[k + 1], v[k + 2]);
      if (speed > 13) { const f = 13 / speed; v[k] *= f; v[k + 1] *= f; v[k + 2] *= f; }
      q[k] = x + v[k] * dt; q[k + 1] = y + v[k + 1] * dt; q[k + 2] = z + v[k + 2] * dt;
      this.ages[i] += dt;
    }
    this.constrain(q);
    this.buildNeighbors();
    for (let iteration = 0; iteration < 3; iteration++) this.solveDensity();
    const invDt = 1 / dt;
    for (let k = 0; k < p.length; k++) v[k] = (q[k] - p[k]) * invDt;
    this.applyViscosity(dt);
    const r = this.wallRadius, edge = r + this.spacing * 0.03;
    const lx = -1.7 + edge, hx = 1.7 - edge, hz = 1.3 - edge;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (q[k] < lx || q[k] > hx) {
        v[k] *= 0.1; v[k + 1] *= 0.98; v[k + 2] *= 0.98;
      }
      if (q[k + 1] < edge) {
        v[k + 1] = Math.max(0, v[k + 1]) * 0.08;
        v[k] *= 0.985; v[k + 2] *= 0.985;
      }
      if (Math.abs(q[k + 2]) > hz) { v[k + 2] *= 0.1; v[k] *= 0.98; v[k + 1] *= 0.98; }
    }
    p.set(q);
    for (let index = beats.length - 1; index >= 0; index--) {
      beats[index].age += dt;
      if (beats[index].age > beats[index].lifetime) beats.splice(index, 1);
    }
    this.time += dt;
  }

  applyViscosity(dt) {
    const n = this.count, p = this.predicted, v = this.velocities;
    const nb = this.neighbors, nc = this.neighborCounts, max = this.maxNeighbors;
    const delta = this.velocityDelta;
    const h2 = this.h2;
    // At 60 Hz: a small water baseline, up to a thick syrup at the high end.
    const blend = 1 - Math.exp(-(0.9 + this.params.viscosity * 55) * dt);
    const cohesion = this.params.surfaceTension * 48 * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 3, start = i * max;
      let dx = 0, dy = 0, dz = 0, cx = 0, cy = 0, cz = 0, weight = 0;
      for (let a = 0; a < nc[i]; a++) {
        const q = nb[start + a] * 3;
        const x = p[k] - p[q], y = p[k + 1] - p[q + 1], z = p[k + 2] - p[q + 2];
        const r2 = x * x + y * y + z * z;
        if (r2 >= h2) continue;
        const t = 1 - r2 / h2, w = t * t * t;
        weight += w;
        dx += (v[q] - v[k]) * w; dy += (v[q + 1] - v[k + 1]) * w; dz += (v[q + 2] - v[k + 2]) * w;
        // Pairwise attraction cancels inside the liquid and draws the exposed
        // surface inward. Equal particle masses make the force momentum neutral.
        cx -= x * w; cy -= y * w; cz -= z * w;
      }
      const factor = weight > 0 ? blend / weight : 0;
      delta[k] = dx * factor + cx * cohesion;
      delta[k + 1] = dy * factor + cy * cohesion;
      delta[k + 2] = dz * factor + cz * cohesion;
    }
    for (let k = 0; k < v.length; k++) v[k] += delta[k];
  }

  step(seconds = 1 / 60) {
    const elapsed = clamp(finite(seconds, 1 / 60), 0, 1 / 24) * this.params.speed;
    if (elapsed <= 0) return this.positions;
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 60)));
    const dt = elapsed / steps;
    for (let i = 0; i < steps; i++) this.substep(dt);
    return this.positions;
  }

  stats() {
    let kinetic = 0, maxDensity = 0, meanDensity = 0, maxSpeed = 0;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const speed2 = this.velocities[k] ** 2 + this.velocities[k + 1] ** 2 + this.velocities[k + 2] ** 2;
      kinetic += speed2;
      maxSpeed = Math.max(maxSpeed, Math.sqrt(speed2));
      meanDensity += this.densities[i]; maxDensity = Math.max(maxDensity, this.densities[i]);
    }
    return { time: this.time, kinetic: kinetic / this.count, maxSpeed, maxDensity, meanDensity: meanDensity / this.count };
  }
}

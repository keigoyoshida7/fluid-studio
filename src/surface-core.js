import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

// The particle solver and the rendered surface are intentionally independent.
// A compact C2-continuous SPH field produces a single watertight surface, with
// gradient normals, rather than thousands of visible particle impostors.
const RESOLUTIONS = { fast: 56, balanced: 76, high: 92, ultra: 108 };
const EXTENT = 2.04;
const CENTER_Y = 1.7;

export class LiquidSurface {
  constructor() {
    this.resolution = 0;
    this.smoothness = 0.7;
  }

  reconstruct(positions, count, radius, quality = 'balanced', smoothness = 0.7) {
    const resolution = RESOLUTIONS[quality] || RESOLUTIONS.balanced;
    if (resolution !== this.resolution) {
      this.cubes?.geometry.dispose();
      this.cubes = new MarchingCubes(resolution, undefined, false, false, 100000);
      this.resolution = resolution;
    }
    const cubes = this.cubes;
    const field = cubes.field;
    field.fill(0);
    cubes.normal_cache.fill(0);
    // A low isovalue preserves detached drops while the overlapping kernels
    // merge densely packed particles into a continuous sheet of water.
    cubes.isolation = 0.64;
    const s = resolution;
    const s2 = s * s;
    const scale = s / (2 * EXTENT);
    const physicalSupport = radius / 0.88 * (1.72 + smoothness * 0.43);
    // At very high particle counts a particle can be smaller than a voxel.
    // Widen only the sampling kernel and preserve its integrated mass so the
    // surface remains continuous without inflating the liquid's volume.
    const support = Math.max(physicalSupport, 2.1 / scale);
    const kernelWeight = Math.min(1, (physicalSupport / support) ** 3);
    const supportGrid = support * scale;
    const invSupport2 = 1 / (supportGrid * supportGrid);
    const half = s / 2;

    for (let i = 0; i < count * 3; i += 3) {
      const cx = positions[i] * scale + half;
      const cy = (positions[i + 1] - CENTER_Y) * scale + half;
      const cz = positions[i + 2] * scale + half;
      const x0 = Math.max(1, Math.floor(cx - supportGrid));
      const x1 = Math.min(s - 2, Math.ceil(cx + supportGrid));
      const y0 = Math.max(1, Math.floor(cy - supportGrid));
      const y1 = Math.min(s - 2, Math.ceil(cy + supportGrid));
      const z0 = Math.max(1, Math.floor(cz - supportGrid));
      const z1 = Math.min(s - 2, Math.ceil(cz + supportGrid));
      for (let z = z0; z <= z1; z++) {
        const dz = z - cz;
        for (let y = y0; y <= y1; y++) {
          const dy = y - cy;
          const yz = (dy * dy + dz * dz) * invSupport2;
          if (yz >= 1) continue;
          const row = y * s + z * s2;
          for (let x = x0; x <= x1; x++) {
            const dx = x - cx;
            const t = 1 - yz - dx * dx * invSupport2;
            if (t > 0) field[row + x] += t * t * t * kernelWeight;
          }
        }
      }
    }
    cubes.update();
    const vertices = Math.min(cubes.count, cubes.positionArray.length / 3);
    const surfacePositions = cubes.positionArray.slice(0, vertices * 3);
    const surfaceNormals = cubes.normalArray.slice(0, vertices * 3);
    for (let i = 0; i < surfacePositions.length; i += 3) {
      surfacePositions[i] *= EXTENT;
      surfacePositions[i + 1] = Math.max(0.012, surfacePositions[i + 1] * EXTENT + CENTER_Y);
      surfacePositions[i + 2] *= EXTENT;
    }
    return { positions: surfacePositions, normals: surfaceNormals, vertices };
  }
}

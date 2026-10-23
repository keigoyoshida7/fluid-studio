import { LiquidSurface } from './surface-core.js';

const surface = new LiquidSurface();
self.onmessage = ({ data }) => {
  if (data.type !== 'surface') return;
  const started = performance.now();
  try {
    const mesh = surface.reconstruct(data.positions, data.count, data.radius, data.quality, data.smoothness);
    self.postMessage({ type: 'surface', ...mesh, duration: performance.now() - started, generation: data.generation }, [mesh.positions.buffer, mesh.normals.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message || error) });
  }
};

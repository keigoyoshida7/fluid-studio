import { FluidSimulation, FLUID_BOUNDS } from './physics-core.js';

let simulation;
let busy = false;

function sendFrame(stepMs = 0) {
  // Copy before transfer: the solver retains its own persistent state arrays.
  const positions = simulation.positions.slice();
  self.postMessage({
    type: 'frame', positions, count: simulation.count, renderRadius: simulation.renderRadius,
    simTime: simulation.time, stepMs,
  }, [positions.buffer]);
}

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init' || data.type === 'reset') {
      if (!simulation) simulation = new FluidSimulation(data);
      else simulation.reset(data);
      if (data.params) simulation.setParams(data.params);
      self.postMessage({ type: 'ready', count: simulation.count, bounds: FLUID_BOUNDS, renderRadius: simulation.renderRadius, spacing: simulation.spacing, preset: simulation.preset });
      sendFrame();
    } else if (data.type === 'params' && simulation) {
      simulation.setParams(data.params || data);
    } else if (data.type === 'pointer' && simulation) {
      simulation.setPointer(data);
    } else if (data.type === 'step' && simulation && !busy) {
      busy = true;
      const start = performance.now();
      simulation.step(data.dt);
      sendFrame(performance.now() - start);
      busy = false;
    }
  } catch (error) {
    busy = false;
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

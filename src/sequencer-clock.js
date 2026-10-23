// A small pure clock keeps Web Audio scheduling independent of render frames.
export function stepDuration(bpm, swing = 0, step = 0) {
  const tempo = Math.max(40, Math.min(200, Number(bpm) || 120));
  const amount = Math.max(0, Math.min(0.5, Number(swing) || 0));
  return (60 / tempo / 4) * (step % 2 === 0 ? 1 + amount : 1 - amount);
}

export function createClock(now, step = 0, lead = 0.035) {
  return { nextTime: now + lead, step: ((Math.trunc(step) % 16) + 16) % 16 };
}

export function advanceClock(clock, now, { bpm = 120, swing = 0, lookahead = 0.12, lead = 0.035 } = {}) {
  let nextTime = clock.nextTime;
  let step = clock.step;
  const resynced = !Number.isFinite(nextTime) || nextTime < now - 0.04;
  // A backgrounded tab can miss minutes. Never enqueue the missed notes at once.
  if (resynced) nextTime = now + lead;
  const steps = [];
  while (nextTime < now + lookahead && steps.length < 64) {
    steps.push({ step, time: nextTime });
    nextTime += stepDuration(bpm, swing, step);
    step = (step + 1) % 16;
  }
  return { clock: { nextTime, step }, steps, resynced };
}

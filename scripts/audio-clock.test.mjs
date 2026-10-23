import assert from 'node:assert/strict';
import { advanceClock, createClock, stepDuration } from '../src/sequencer-clock.js';

for (const bpm of [40, 110, 200]) {
  for (const swing of [0, 0.15, 0.5]) {
    assert.ok(Math.abs(stepDuration(bpm, swing, 0) + stepDuration(bpm, swing, 1) - 60 / bpm / 2) < 1e-12, 'Swing must preserve beat duration.');
    let clock = createClock(0);
    const events = [];
    for (let now = 0; now < 10; now += 0.025) {
      const result = advanceClock(clock, now, { bpm, swing });
      events.push(...result.steps);
      clock = result.clock;
    }
    assert.ok(events.length > 20, 'Clock must continue scheduling.');
    for (let i = 1; i < events.length; i++) {
      assert.equal(events[i].step, (events[i - 1].step + 1) % 16, 'The pattern must wrap after 16 steps.');
      assert.ok(Math.abs(events[i].time - events[i - 1].time - stepDuration(bpm, swing, events[i - 1].step)) < 1e-10, 'Audio times must retain their exact rhythm independently of timer jitter.');
    }
  }
}

const stalled = advanceClock({ nextTime: 0.5, step: 11 }, 3600, { bpm: 200, swing: 0.5 });
assert.equal(stalled.resynced, true);
assert.equal(stalled.steps[0].step, 11, 'Resume must retain the next pattern position.');
assert.ok(stalled.steps.length < 4, 'Missed notes must not be emitted in a burst.');
assert.ok(stalled.steps.every(event => event.time >= 3600), 'Resume must schedule future notes.');
const next = advanceClock(stalled.clock, 3600.1, { bpm: 200, swing: 0.5 });
assert.ok(next.steps.length > 0, 'A resumed clock must keep advancing.');
assert.equal(createClock(10, 16).step, 0);
assert.equal(createClock(10, -1).step, 15);
console.log('Audio clock: BPM, swing, 16-step phase and background recovery passed.');

import assert from "node:assert/strict";
import { test } from "node:test";
import { playFocusAlarm } from "./useAudio.ts";

test("focus alarm schedules a distinct multi-note bell chime", () => {
  const oscillators = [];
  const envelopes = [];
  const context = {
    currentTime: 10,
    destination: {},
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect(target) { return target; },
        start(at) { this.startedAt = at; },
        stop(at) { this.stoppedAt = at; },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      const events = [];
      const gain = {
        gain: {
          value: 0,
          setValueAtTime(value, at) { events.push(["set", value, at]); },
          exponentialRampToValueAtTime(value, at) { events.push(["ramp", value, at]); },
        },
        connect(target) { return target; },
      };
      envelopes.push(events);
      return gain;
    },
  };

  playFocusAlarm(context);

  assert.equal(oscillators.length, 10);
  assert.equal(envelopes.filter((events) => events.length === 3).length, 5);
  assert.deepEqual([...new Set(oscillators.map((oscillator) => oscillator.startedAt.toFixed(2)))], ["10.02", "10.24", "10.50", "11.07", "11.30"]);
  assert.ok(oscillators.every((oscillator) => Math.abs(oscillator.stoppedAt - oscillator.startedAt - 0.86) < 1e-9));
});

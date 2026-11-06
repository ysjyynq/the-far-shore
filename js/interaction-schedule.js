// Touch picking can sample less often than the render/spring loop.
// A moving finger is sampled at 30 Hz; stationary contacts refresh at 10 Hz.
export function createPickSchedule() {
  let last = -Infinity,
    x = Infinity,
    y = Infinity,
    cameraKey = '',
    state = '';
  return {
    due(now, sx, sy, key, nextState) {
      const moved = sx !== x || sy !== y || key !== cameraKey;
      if (nextState === state && now - last < (moved ? 1000 / 30 : 100))
        return false;
      last = now;
      x = sx;
      y = sy;
      cameraKey = key;
      state = nextState;
      return true;
    },
    reset() {
      last = -Infinity;
    }
  };
}

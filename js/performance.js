// Measure completed scene frames, not a separate animation loop.
export function createFPSMeter(element) {
  let start = null,
    frames = 0;
  return {
    reset() {
      start = null;
      frames = 0;
      element.textContent = '— FPS';
    },
    frame(now) {
      if (start === null) {
        start = now;
        return;
      }
      frames++;
      const duration = now - start;
      if (duration >= 750) {
        element.textContent = `${Math.round((frames * 1000) / duration)} FPS`;
        start = now;
        frames = 0;
      }
    }
  };
}

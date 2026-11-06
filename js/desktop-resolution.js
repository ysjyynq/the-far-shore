// Keep MSAA and all scene detail; reduce pixel workload only after sustained
// slow rendering. Hold the chosen scale to avoid sharp/soft oscillation.
export function createDesktopResolution(maxRatio, onChange) {
  let ratio = maxRatio,
    last = null,
    elapsed = 0,
    frames = 0,
    warmup = 2000;
  const minimum = Math.min(maxRatio, 0.75);
  function reset() {
    last = null;
    elapsed = 0;
    frames = 0;
    warmup = 2000;
  }
  return {
    reset,
    frame(now) {
      if (last === null) {
        last = now;
        return;
      }
      const dt = now - last;
      last = now;
      // Ignore background throttling, startup and isolated long stalls.
      if (dt <= 0 || dt > 100) {
        elapsed = 0;
        frames = 0;
        return;
      }
      if (warmup > 0) {
        warmup -= dt;
        return;
      }
      elapsed += dt;
      frames++;
      if (elapsed < 1500) return;
      const fps = (frames * 1000) / elapsed;
      elapsed = 0;
      frames = 0;
      if (fps >= 54 || ratio <= minimum) return;
      const next = Math.max(
        minimum,
        Math.round(ratio * Math.max(0.85, Math.sqrt(fps / 60)) * 100) / 100
      );
      if (next >= ratio) return;
      ratio = next;
      onChange(ratio);
      warmup = 2000;
    }
  };
}

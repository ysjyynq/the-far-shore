export function createTimeDial(onTime) {
  const panel = document.createElement('section');
  panel.className = 'time-control';
  panel.setAttribute('aria-label', 'Universe time');
  panel.innerHTML =
    '<div class="time-dial" role="slider" tabindex="0" aria-label="Universe time" aria-valuemin="0" aria-valuemax="1439"><span class="dial-noon" aria-hidden="true">☼</span><span class="dial-midnight" aria-hidden="true">☾</span><i class="dial-handle"></i></div><output class="time-label"></output><button class="time-live" type="button" aria-pressed="false">Live</button>';
  document.body.append(panel);
  const dial = panel.querySelector('.time-dial'),
    label = panel.querySelector('output'),
    handle = panel.querySelector('i'),
    liveButton = panel.querySelector('button');
  let target = 120,
    current = 120,
    live = false,
    dragging = false,
    lastLive = -1;
  function paint() {
    const minutes = Math.round(target) % 1440,
      h = Math.floor(minutes / 60),
      m = minutes % 60;
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    label.textContent = text;
    dial.setAttribute('aria-valuenow', minutes);
    dial.setAttribute('aria-valuetext', text);
    const a = (target / 1440) * Math.PI * 2;
    handle.style.left = `${50 - Math.sin(a) * 43}%`;
    handle.style.top = `${50 + Math.cos(a) * 43}%`;
  }
  function set(value) {
    target = ((value % 1440) + 1440) % 1440;
    paint();
  }
  function manual() {
    live = false;
    liveButton.setAttribute('aria-pressed', 'false');
  }
  function point(e) {
    const r = dial.getBoundingClientRect(),
      x = e.clientX - r.left - r.width / 2,
      y = e.clientY - r.top - r.height / 2;
    if (Math.hypot(x, y) < 5) return;
    manual();
    set((Math.atan2(-x, y) / Math.PI / 2) * 1440);
  }
  dial.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    point(e);
  });
  dial.addEventListener('pointermove', (e) => {
    if (dragging) point(e);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    dial.addEventListener(name, () => (dragging = false));
  dial.addEventListener('keydown', (e) => {
    let value;
    if (['ArrowRight', 'ArrowUp'].includes(e.key)) value = target + 15;
    else if (['ArrowLeft', 'ArrowDown'].includes(e.key)) value = target - 15;
    else if (e.key === 'Home') value = 0;
    else if (e.key === 'End') value = 1439;
    else return;
    e.preventDefault();
    manual();
    set(value);
  });
  liveButton.addEventListener('click', () => {
    live = !live;
    liveButton.setAttribute('aria-pressed', String(live));
    lastLive = -1;
  });
  paint();
  onTime(current);
  return {
    update(dt) {
      if (live) {
        const now = new Date(),
          minute = now.getHours() * 60 + now.getMinutes();
        if (minute !== lastLive) {
          lastLive = minute;
          set(minute);
        }
      }
      const delta = ((target - current + 2160) % 1440) - 720;
      if (Math.abs(delta) < 0.001) return;
      current = (current + delta * (1 - Math.exp(-8 * dt)) + 1440) % 1440;
      onTime(current);
    }
  };
}

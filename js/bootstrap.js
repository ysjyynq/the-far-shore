// A small classic script owns startup so even a failed module import replaces
// the loading screen with a useful message. No Three.js dependency here.
(() => {
  const byId = (id) => document.getElementById(id);
  const controller = new AbortController();
  const profiling = new URLSearchParams(location.search).has('profile'),
    started = performance.now();
  let lastStage = '';
  // Safari can otherwise interpret two taps on the startup overlay as page zoom.
  byId('loading').addEventListener(
    'touchend',
    (event) => {
      if (event.cancelable) event.preventDefault();
    },
    { passive: false }
  );
  byId('loading').addEventListener('dblclick', (event) =>
    event.preventDefault()
  );
  let percent = 0,
    stage = 'Opening the meadow',
    failed = false,
    finished = false,
    deadline;
  const fail = (error) => {
    if (failed) return;
    failed = true;
    controller.abort();
    clearTimeout(deadline);
    console.error('Meadow startup failed at ' + stage, error);
    document.documentElement.dataset.ready = 'false';
    byId('loading').hidden = true;
    const message = String(error?.message || error);
    byId('error-message').textContent =
      /WebGL|graphics|GPU|context|shader/i.test(message)
        ? /shader/i.test(message)
          ? 'The scene’s graphics could not be prepared. Please reload the latest version and try again.'
          : 'The browser couldn’t open the scene’s graphics. Please reload the page and try again.'
        : /timeout|timed out/i.test(message)
          ? 'Loading took too long. Check your connection and try again.'
          : /import map|importmap/i.test(message)
            ? 'Please update your browser to open this scene.'
            : 'Some scene files couldn’t load. Please check that the complete website folder was published.';
    byId('error').hidden = false;
    if (!/WebGL|graphics|GPU|context|shader/i.test(message)) {
      byId('error-message').textContent +=
        ' [' + percent + '% · ' + stage + '] ' + message;
      const link = document.createElement('a');
      link.href = './deployment-check.html';
      link.textContent = 'Check uploaded files';
      link.style.cssText = 'display:block;margin-top:16px;color:inherit';
      byId('error').append(link);
    }
    if (/WebGL|graphics|GPU|context|shader/i.test(message)) {
      const detail = error?.graphicsDetails || message;
      byId('error-message').textContent +=
        ' [ice-03c, ' + percent + '%] ' + detail;
    }
  };
  const progress = (value, label) => {
    if (failed) return;
    percent = Math.max(percent, Math.min(100, Math.round(value)));
    stage = label;
    if (profiling && stage !== lastStage) {
      console.info(
        '[startup]',
        Math.round(performance.now() - started) + 'ms',
        percent + '%',
        stage
      );
      lastStage = stage;
    }
    byId('loading-percent').textContent = percent + '%';
    byId('loading-progress').setAttribute('aria-valuenow', String(percent));
    // Work updates reset this timer. It never fabricates progress.
    clearTimeout(deadline);
    if (percent < 100)
      deadline = setTimeout(() => fail(new Error('Loading timed out')), 120000);
  };
  window.addEventListener('error', (event) => {
    if (!finished && event.error) fail(event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!finished) fail(event.reason);
  });
  progress(2, 'Loading scene files');
  if (!HTMLScriptElement.supports?.('importmap')) {
    fail(new Error('Import maps are unavailable'));
    return;
  }
  import('./scene.js')
    .then((module) => {
      if (controller.signal.aborted) return;
      return module.startScene({ progress, signal: controller.signal, fail });
    })
    .then(() => {
      if (failed) return;
      finished = true;
      progress(100, 'Ready');
      clearTimeout(deadline);
      // Let the final value paint before the loading screen fades away.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => byId('loading').classList.add('loaded'))
      );
    })
    .catch(fail);
})();

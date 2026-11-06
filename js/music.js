(() => {
  const button = document.createElement('button');
  button.id = 'music-toggle';
  button.type = 'button';
  button.textContent = '♫';
  button.setAttribute('aria-label', 'Play Somnium');
  button.setAttribute('aria-pressed', 'false');
  button.title = 'Play Somnium';
  document.body.append(button);
  const music = new Audio('./audio/somnium.mp3');
  music.preload = 'none';
  music.loop = true;
  music.volume = 0.3;
  let wanted = false,
    request = 0;
  function paint() {
    button.setAttribute('aria-pressed', String(wanted));
    button.title = wanted ? 'Pause Somnium' : 'Play Somnium';
    button.setAttribute('aria-label', button.title);
  }
  async function play() {
    const current = ++request;
    try {
      await music.play();
      if (current !== request || !wanted || document.hidden) music.pause();
    } catch {
      if (current === request) {
        wanted = false;
        paint();
        button.title = 'Music could not load — click to retry';
      }
    }
  }
  button.addEventListener('click', () => {
    wanted = !wanted;
    paint();
    if (wanted) play();
    else {
      request++;
      music.pause();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      request++;
      music.pause();
    } else if (wanted) play();
  });
})();

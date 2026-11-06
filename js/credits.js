const creditsDialog = document.getElementById('credits');
let closeTimer;
function closeCredits() {
  creditsDialog.classList.remove('is-open');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(
    () => creditsDialog.close(),
    matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
  );
}
document.getElementById('credits-open').addEventListener('click', () => {
  clearTimeout(closeTimer);
  if (!creditsDialog.open) creditsDialog.showModal();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (creditsDialog.open) creditsDialog.classList.add('is-open');
    })
  );
});
creditsDialog.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  closeCredits();
});
creditsDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeCredits();
});
creditsDialog.addEventListener('click', (event) => {
  if (event.target === creditsDialog) {
    const r = creditsDialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeCredits();
  }
});
creditsDialog.addEventListener('close', () =>
  creditsDialog.classList.remove('is-open')
);

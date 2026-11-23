'use strict';
(() => {
  const dialog = document.querySelector('#club-video-dialog');
  if (!dialog) return;
  const video = dialog.querySelector('video');
  const error = dialog.querySelector('.video-playback-error');
  let trigger = null, previousOverflow = '';
  document.querySelectorAll('[data-open-video]').forEach(control => control.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    trigger = control;
    previousOverflow = document.body.style.overflow;
    error.hidden = true;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    video.play().catch(() => { error.hidden = false; });
  }));
  dialog.querySelector('.video-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    video.pause();
    document.body.style.overflow = previousOverflow;
    document.body.classList.remove('video-playing');
    trigger?.focus({preventScroll:true});
  });
  video.addEventListener('play', () => document.body.classList.add('video-playing'));
  ['pause','ended'].forEach(type => video.addEventListener(type, () => document.body.classList.remove('video-playing')));
})();

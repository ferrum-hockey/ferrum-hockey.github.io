'use strict';
(() => {
  document.querySelectorAll('[data-gallery]').forEach((gallery) => {
    const slides = [...gallery.querySelectorAll('.coach-slide')];
    const controls = gallery.querySelector('.gallery-controls');
    const status = gallery.querySelector('.gallery-status');
    if (slides.length < 2) return;
    let index = 0;
    controls.hidden = false;
    gallery.tabIndex = 0;
    gallery.setAttribute('aria-description', 'Листайте фотографии стрелками влево и вправо или свайпом.');
    function show(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => { slide.hidden = i !== index; });
      status.textContent = `${index + 1} / ${slides.length}`;
      const caption = gallery.querySelector('.gallery-caption');
      if (caption) caption.textContent = slides[index].querySelector('img').dataset.caption;
    }
    gallery.querySelector('.gallery-prev').addEventListener('click', () => show(index - 1));
    gallery.querySelector('.gallery-next').addEventListener('click', () => show(index + 1));
    gallery.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      show(index + (event.key === 'ArrowRight' ? 1 : -1));
    });
    let start = null;
    gallery.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || event.target.closest('button')) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    });
    gallery.addEventListener('pointerup', (event) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) show(index + (dx < 0 ? 1 : -1));
    });
    gallery.addEventListener('pointercancel', () => { start = null; });
    show(0);
  });
})();

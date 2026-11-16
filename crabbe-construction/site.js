// Photo viewer: tap a photo to see it large. Arrow keys or the buttons move between photos;
// Esc, the close button or a tap outside the photo closes it. Without JS the links just open the photo.
const shots = [...document.querySelectorAll('a.zoom')];
if (shots.length && window.HTMLDialogElement) {
  const box = document.createElement('dialog');
  box.className = 'lightbox';
  box.innerHTML = '<img alt="">'
    + '<button type="button" data-act="close" aria-label="Close">&times;</button>'
    + (shots.length > 1
      ? '<button type="button" data-act="prev" aria-label="Previous photo">&lsaquo;</button>'
        + '<button type="button" data-act="next" aria-label="Next photo">&rsaquo;</button>'
      : '');
  document.body.append(box);
  const img = box.querySelector('img');
  let at = 0;
  const show = (n) => {
    at = (n + shots.length) % shots.length;
    img.src = shots[at].href;
    img.alt = shots[at].querySelector('img').alt;
  };
  shots.forEach((a, n) => a.addEventListener('click', (e) => { e.preventDefault(); show(n); box.showModal(); }));
  box.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (act === 'prev') show(at - 1);
    else if (act === 'next') show(at + 1);
    else if (e.target !== img) box.close();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
}

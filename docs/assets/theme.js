(() => {
  'use strict';
  document.documentElement.classList.add('js');
  try {
    const saved = localStorage.getItem('aperture-appearance');
    document.documentElement.dataset.theme = ['auto', 'light', 'dark'].includes(saved) ? saved : 'auto';
  } catch { document.documentElement.dataset.theme = 'auto'; }
})();

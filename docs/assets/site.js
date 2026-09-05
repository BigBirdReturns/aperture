(() => {
  'use strict';
  const $ = (q, root = document) => root.querySelector(q);
  const docnav = $('#docnav');
  if (docnav && matchMedia('(max-width:760px)').matches) docnav.open = false;
  const install = $('.install-command');
  if (install) {
    const platform = $('#platform'), distribution = $('#distribution');
    platform.value = /Win/i.test(navigator.platform) ? 'windows' : 'posix';
    const update = () => {
      const exe = platform.value === 'windows' ? 'npx.cmd' : 'npx';
      const suffix = distribution.value === 'git' ? `github:BigBirdReturns/aperture#${install.dataset.tag}` : `--package=${install.dataset.package} aperture`;
      $('#install-code').textContent = `${exe} --yes ${suffix}`;
      $('#command-label').textContent = `${platform.options[platform.selectedIndex].text} · ${distribution.value === 'git' ? 'Git required' : 'release package'}`;
      $('.copy-status', install).textContent = ''; $('.copy', install).textContent = 'Copy command';
    };
    platform.addEventListener('change', update); distribution.addEventListener('change', update); update();
  }
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const code = document.getElementById(button.dataset.copy), status = $('.copy-status', button.closest('.codebox'));
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = 'Copied'; status.textContent = 'Command copied. Paste it into your terminal when ready.';
      } catch {
        const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(code); selection.removeAllRanges(); selection.addRange(range);
        status.textContent = 'Clipboard unavailable. The text is selected; copy it using your keyboard or device menu.';
      }
    });
  });
  const search = $('#search'), panel = $('#search-results'), list = $('ul', panel), status = $('#search-status');
  let indexPromise, sequence = 0;
  const searchIndex = () => indexPromise ||= fetch('search-index.json').then(r => {
    if (!r.ok) throw new Error('Search unavailable'); return r.json();
  });
  search.addEventListener('input', async () => {
    const request = ++sequence, query = search.value.trim().toLowerCase();
    list.replaceChildren();
    if (query.length < 2) { panel.hidden = true; return; }
    panel.hidden = false; status.textContent = 'Searching documentation…';
    try {
      const entries = await searchIndex(); if (request !== sequence) return;
      const words = query.split(/\s+/);
      const matches = entries.map(entry => ({entry, score: words.reduce((n, word) => n + (entry.title.toLowerCase().includes(word) ? 10 : 0) + (entry.text.toLowerCase().includes(word) ? 1 : 0), 0)}))
        .filter(({entry}) => words.every(word => `${entry.title} ${entry.text}`.toLowerCase().includes(word)))
        .sort((a,b) => b.score-a.score).slice(0, 8);
      status.textContent = `${matches.length} ${matches.length === 1 ? 'page' : 'pages'} found`;
      for (const {entry} of matches) {
        const li = document.createElement('li'), a = document.createElement('a'), title = document.createElement('strong'), snippet = document.createElement('small');
        a.href = entry.url; title.textContent = entry.title; snippet.textContent = entry.description;
        a.append(title,snippet); li.append(a); list.append(li);
      }
      if (!matches.length) status.textContent = 'No matching pages. Browse the documentation navigation or try a different term.';
    } catch { if (request === sequence) status.textContent = 'Search is unavailable. All guides remain accessible through the documentation navigation.'; }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { ++sequence; panel.hidden = true; search.value = ''; search.focus(); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.searchbox')) panel.hidden = true; });
  search.addEventListener('focus', () => { if (search.value.trim().length > 1 && status.textContent) panel.hidden = false; });
})();

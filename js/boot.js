/* Runs before first paint (classic script, blocking in <head>): applies theme/language so the page never flashes. */
(function () {
  let theme = 'auto';
  let lang = 'fa';
  try {
    // first launch after the upgrade from Nimbus: the old settings are still there until the app module migrates them
    const raw = localStorage.getItem('skyview1.settings') || localStorage.getItem('nimbus3.settings') || '{}';
    const s = JSON.parse(raw);
    if (s.theme === 'dark' || s.theme === 'light') theme = s.theme;
    if (s.lang === 'en') lang = 'en';
  } catch (e) {
    /* storage blocked: use defaults */
  }
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = theme === 'auto' ? (dark ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.setAttribute('data-theme', effective);
  root.lang = lang;
  root.dir = lang === 'fa' ? 'rtl' : 'ltr';
})();

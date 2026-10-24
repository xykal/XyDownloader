// Keep real anchors and native <details> usable if JavaScript/network fails.
const chooser = document.querySelector('#download-options');
for (const link of document.querySelectorAll('[data-download-chooser]')) {
  link.addEventListener('click', () => { if (chooser) chooser.open = true; });
}
if (location.hash === '#download' && chooser) chooser.open = true;

(async () => {
  try {
    const response = await fetch('/releases.json');
    if (!response.ok) return;
    const release = await response.json();
    document.querySelectorAll('[data-version]').forEach(el => { el.textContent = release.version; });
    for (const asset of release.assets || []) {
      document.querySelectorAll(`[data-size="${asset.arch}"]`).forEach(el => {
        el.textContent = `${(asset.size / 1024 / 1024).toFixed(1)} MB`;
      });
    }
  } catch { /* APK links are server-side redirects and work without JavaScript. */ }
})();

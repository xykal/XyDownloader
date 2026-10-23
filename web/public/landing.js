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

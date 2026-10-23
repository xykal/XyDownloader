const CANONICAL = 'https://dlaja.xyverse.my.id';
const RELEASES = 'https://github.com/xykal/XyDownloader/releases/latest';
const ARCHES = new Set(['arm64-v8a', 'armeabi-v7a', 'x86_64']);

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return secure(new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}}));
    }
    if (url.hostname === 'dlaja-web.dikanjut.workers.dev') {
      return secure(Response.redirect(CANONICAL + url.pathname + url.search, 308));
    }
    if (url.hostname === 'dlaja.projectkal.my.id') {
      return secure(Response.redirect(CANONICAL + url.pathname + url.search, 308));
    }
    if (url.pathname === '/api/health') {
      return secure(Response.json({ok: true, service: 'DownloadAja APK landing', hosting: 'cloudflare', mode: 'apk-only', backend_required: false}));
    }
    if (url.pathname.startsWith('/api/')) {
      return secure(Response.json({ok: false, error: 'web_downloader_retired', message: 'Download lewat APK Android. Ekstraksi berjalan di perangkat, bukan server.', apk: CANONICAL + '/#download'}, {status: 410}));
    }
    if (url.pathname.startsWith('/download/')) {
      const arch = url.pathname.slice('/download/'.length);
      if (!ARCHES.has(arch)) return secure(new Response('Architecture not found', {status: 404}));
      try {
        const manifest = await env.ASSETS.fetch(new Request(new URL('/releases.json', url)));
        if (!manifest.ok) throw new Error('No release manifest');
        const data = await manifest.json();
        const apk = data.assets.find(a => a.arch === arch);
        const target = new URL(apk?.url);
        if (target.origin !== 'https://github.com' || !target.pathname.startsWith('/xykal/XyDownloader/releases/download/') || !target.pathname.endsWith('.apk')) throw new Error('Invalid release');
        return secure(new Response(null, {status: 302, headers: {Location: target.href, 'Cache-Control': 'no-store'}}));
      } catch {
        return secure(new Response(null, {status: 302, headers: {Location: RELEASES, 'Cache-Control': 'no-store'}}));
      }
    }
    if (url.pathname === '/apk' || url.pathname === '/apk.html') {
      return secure(Response.redirect(CANONICAL + '/#download', 302));
    }
    const response = await env.ASSETS.fetch(request);
    const result = secure(response);
    if (response.status >= 400 || url.pathname === '/releases.json' || url.pathname.endsWith('/provenance.json')) {
      result.headers.set('X-Robots-Tag', 'noindex');
    }
    return result;
  },
};

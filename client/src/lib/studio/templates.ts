/**
 * Local-only deterministic page scaffolds for Coderax Studio.
 * This is NOT an AI generation adapter. Never put model keys or run generated
 * code in the browser's origin. The preview is rendered in a sandboxed iframe.
 */
export type StudioKind = 'landing' | 'dashboard' | 'store' | 'booking';

export type StudioProject = {
  prompt: string;
  title: string;
  kind: StudioKind;
  html: string;
};

export const MAX_PROMPT_LENGTH = 320;
export const MAX_HTML_LENGTH = 200_000;

export function escapeHtml(value: string): string {
  const chars: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => chars[char]);
}

function detectKind(prompt: string): StudioKind {
  if (/\b(dashboard|analytics|metrics|admin|reporting)\b/i.test(prompt)) return 'dashboard';
  if (/\b(shop|store|e-?commerce|products|catalog|retail)\b/i.test(prompt)) return 'store';
  if (/\b(booking|appointment|reserve|calendar|schedule)\b/i.test(prompt)) return 'booking';
  return 'landing';
}

function cards(kind: StudioKind): string {
  if (kind === 'dashboard') {
    return [
      '<p class="eyebrow">SAMPLE DATA — NOT LIVE</p>',
      '<section class="grid">',
      '<article class="card"><span class="muted">Visitors</span><strong>24,800</strong><small>Example value</small></article>',
      '<article class="card"><span class="muted">Conversion</span><strong>8.4%</strong><small>Example value</small></article>',
      '<article class="card"><span class="muted">Revenue</span><strong>$12,400</strong><small>Example value</small></article>',
      '</section>',
      '<section class="panel"><h2>Activity overview</h2><div class="chart" aria-label="Decorative sample chart"><i style="height:42%"></i><i style="height:65%"></i><i style="height:48%"></i><i style="height:80%"></i><i style="height:62%"></i><i style="height:92%"></i><i style="height:72%"></i></div></section>',
    ].join('');
  }
  if (kind === 'store') {
    return [
      '<p class="eyebrow">EXAMPLE PRODUCTS — NO CHECKOUT CONNECTED</p>',
      '<section class="grid">',
      '<article class="card product"><div class="product-art art-one"></div><h2>Everyday essential</h2><p>Thoughtfully designed for everyday life.</p><strong>$49</strong></article>',
      '<article class="card product"><div class="product-art art-two"></div><h2>Modern classic</h2><p>Good design meets simple utility.</p><strong>$79</strong></article>',
      '<article class="card product"><div class="product-art art-three"></div><h2>Signature collection</h2><p>Made for the moments that matter.</p><strong>$99</strong></article>',
      '</section>',
    ].join('');
  }
  if (kind === 'booking') {
    return [
      '<p class="eyebrow">EXAMPLE SESSIONS — NO BOOKING BACKEND CONNECTED</p>',
      '<section class="grid">',
      '<article class="card"><span class="muted">Service 01</span><h2>Introduction</h2><p>30 minute sample appointment.</p><span class="tag">Demo only</span></article>',
      '<article class="card"><span class="muted">Service 02</span><h2>Consultation</h2><p>60 minute sample appointment.</p><span class="tag">Demo only</span></article>',
      '<article class="card"><span class="muted">Service 03</span><h2>Follow-up</h2><p>15 minute sample appointment.</p><span class="tag">Demo only</span></article>',
      '</section>',
    ].join('');
  }
  return [
    '<section class="grid">',
    '<article class="card"><div class="card-icon">✦</div><h2>Thoughtful design</h2><p>A clean foundation for your product.</p></article>',
    '<article class="card"><div class="card-icon">◈</div><h2>Built to adapt</h2><p>Responsive layouts for any device.</p></article>',
    '<article class="card"><div class="card-icon">↗</div><h2>Make it yours</h2><p>Edit the HTML and see changes instantly.</p></article>',
    '</section>',
  ].join('');
}

export function generateStudioProject(input: string): StudioProject {
  const prompt = input.trim().slice(0, MAX_PROMPT_LENGTH);
  const kind = detectKind(prompt);
  const title = kind === 'dashboard' ? 'Insight dashboard'
    : kind === 'store' ? 'Modern storefront'
    : kind === 'booking' ? 'Appointment studio'
    : 'Your next big idea';
  const summary = escapeHtml(prompt || 'A beautiful, responsive website for your next idea.');
  const markup = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>', escapeHtml(title), '</title>',
    '<style>',
    ':root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#17233b;background:#f6f8fc}',
    '*{box-sizing:border-box}body{margin:0}header{background:white;border-bottom:1px solid #e6ebf3}',
    '.wrap{max-width:1120px;margin:auto;padding:0 32px}.nav{display:flex;justify-content:space-between;align-items:center;height:80px}',
    '.brand{font-weight:850;font-size:21px;letter-spacing:-.5px}.brand span{color:#5b5ee5}.nav small{color:#72809a}',
    '.hero{padding:94px 0 72px;position:relative}.eyebrow{color:#5e63cc;letter-spacing:.12em;font-weight:800;font-size:11px}',
    'h1{font-size:clamp(38px,6vw,68px);line-height:1.07;letter-spacing:-.055em;margin:18px 0 20px;max-width:840px}',
    '.lead{font-size:18px;line-height:1.7;color:#66748c;max-width:700px;overflow-wrap:anywhere}',
    '.pill{display:inline-block;color:#fff;background:#5658d9;padding:14px 24px;border-radius:14px;font-weight:700;margin-top:24px}',
    '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding-bottom:52px}',
    '.card,.panel{background:white;border:1px solid #e4eaf4;border-radius:20px;padding:26px;box-shadow:0 9px 30px #27385608}',
    '.card{min-height:200px}.card h2,.panel h2{font-size:19px;letter-spacing:-.02em}.card p{line-height:1.6;color:#72809a}',
    '.card strong{display:block;font-size:30px;letter-spacing:-.04em;margin:14px 0}.card small{color:#8b96aa}',
    '.card-icon{font-size:30px;color:#686fe6}.muted{color:#71809a}.tag{display:inline-block;background:#eef0ff;color:#5358ad;padding:9px 14px;border-radius:10px}',
    '.panel{margin-bottom:70px}.chart{display:flex;align-items:flex-end;gap:20px;height:190px;border-bottom:1px solid #e5eaf2;margin-top:28px}',
    '.chart i{display:block;flex:1;background:linear-gradient(#aaaefa,#595de0);border-radius:9px 9px 0 0}',
    '.product-art{height:140px;border-radius:15px}.art-one{background:linear-gradient(140deg,#e2ebff,#95a9ee)}',
    '.art-two{background:linear-gradient(140deg,#ffe5df,#e5a5a9)}.art-three{background:linear-gradient(140deg,#d8f4e8,#85beaf)}',
    'footer{color:#8e99ab;border-top:1px solid #e1e7f0;padding:24px 0;font-size:12px}',
    '@media(max-width:760px){.wrap{padding:0 20px}.nav{height:68px}.hero{padding:56px 0 36px}.grid{grid-template-columns:1fr}.card{min-height:0}}',
    '</style></head><body>',
    '<header><div class="wrap nav"><div class="brand">Studio<span>✦</span></div><small>Concept preview</small></div></header>',
    '<main class="wrap"><section class="hero"><p class="eyebrow">MADE WITH CODERAX STUDIO</p>',
    '<h1>', escapeHtml(title), '</h1><p class="lead">', summary, '</p>',
    '<span class="pill">Preview concept</span></section>',
    cards(kind),
    '</main><footer><div class="wrap">Generated starter template · Customize before publishing</div></footer>',
    '</body></html>',
  ].join('');
  return { prompt, kind, title, html: markup };
}

/** The preview is passive, unauthenticated and intentionally unable to run JS. */
export const STUDIO_PREVIEW_CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; font-src &#39;none&#39;; form-action &#39;none&#39;; connect-src &#39;none&#39;; base-uri &#39;none&#39;">';

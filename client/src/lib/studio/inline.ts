export type StudioRemoteFile = { path: string; content: string };

/** Resolves an href relative to the entry; `null` for remote, absolute-URL or escaping paths. */
export function resolveStudioPath(entry: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return null;
  const base = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  const raw = (href.startsWith('/') ? href.slice(1) : base + href).split(/[?#]/)[0];
  const out: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

/**
 * Builds a single passive HTML document for the sandboxed preview: project stylesheets
 * linked from the entry are inlined; any other stylesheet link is dropped (the CSP
 * would block it anyway). Scripts are left as-is; sandbox="" never runs them.
 */
export function inlineStudioCss(files: StudioRemoteFile[], entry: string): string {
  const byPath = new Map(files.map((file) => [file.path.toLowerCase(), file.content]));
  const html = byPath.get(entry.toLowerCase()) ?? '';
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) return tag;
    const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = match?.[1] ?? match?.[2] ?? match?.[3];
    const path = href ? resolveStudioPath(entry, href) : null;
    if (!path || !/\.css$/i.test(path)) return '';
    const css = byPath.get(path.toLowerCase());
    if (css === undefined) return '';
    // Prevent the stylesheet from closing the <style> element early.
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
}
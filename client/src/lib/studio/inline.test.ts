import { inlineStudioCss, resolveStudioPath } from './inline';

describe('Studio CSS inlining', () => {
  it('resolves relative paths and refuses escapes and remote URLs', () => {
    expect(resolveStudioPath('pages/index.html', 'css/a.css')).toBe('pages/css/a.css');
    expect(resolveStudioPath('pages/index.html', '../a.css')).toBe('a.css');
    expect(resolveStudioPath('index.html', '../a.css')).toBeNull();
    expect(resolveStudioPath('index.html', 'https://evil.test/a.css')).toBeNull();
    expect(resolveStudioPath('index.html', '//evil.test/a.css')).toBeNull();
  });

  it('inlines linked project stylesheets and drops the rest', () => {
    const html = inlineStudioCss(
      [
        {
          path: 'index.html',
          content:
            '<head><link rel="stylesheet" href="src/app.css"><link rel="stylesheet" href="https://x.test/y.css"><link rel="icon" href="a.svg"></head>',
        },
        { path: 'src/app.css', content: 'body{color:red}' },
      ],
      'index.html',
    );
    expect(html).toContain('<style>body{color:red}</style>');
    expect(html).not.toContain('x.test');
    expect(html).toContain('rel="icon"');
  });

  it('cannot break out of the style element', () => {
    const html = inlineStudioCss(
      [
        { path: 'index.html', content: '<link rel="stylesheet" href="a.css">' },
        { path: 'a.css', content: '</style><img src=x>' },
      ],
      'index.html',
    );
    expect(html).not.toContain('</style><img');
  });
});
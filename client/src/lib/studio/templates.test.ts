import {
  escapeHtml,
  generateStudioProject,
  MAX_PROMPT_LENGTH,
  STUDIO_PREVIEW_CSP,
} from './templates';

describe('Visual App Studio deterministic templates', () => {
  test.each([
    ['sales analytics dashboard', 'dashboard'],
    ['online product store', 'store'],
    ['appointment booking calendar', 'booking'],
    ['a modern marketing site', 'landing'],
  ] as const)('recognizes %s as a %s scaffold', (prompt, kind) => {
    const project = generateStudioProject(prompt);
    expect(project.kind).toBe(kind);
    expect(project.html).toContain('<!doctype html>');
    expect(project.html).toContain('name="viewport"');
    expect(project.html).toContain('Generated starter template');
  });

  test('escapes user-supplied HTML rather than executing it', () => {
    const prompt = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
    const project = generateStudioProject(prompt);
    expect(project.html).toContain('&lt;script&gt;');
    expect(project.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(project.html).not.toContain('<script>');
    expect(project.html).not.toContain('<img src=x');
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('bounds prompt length and generates a usable blank fallback', () => {
    expect(generateStudioProject('x'.repeat(MAX_PROMPT_LENGTH + 50)).prompt)
      .toHaveLength(MAX_PROMPT_LENGTH);
    expect(generateStudioProject('   ').html)
      .toContain('A beautiful, responsive website');
  });

  test('protects previews from network requests, forms and scripts', () => {
    expect(STUDIO_PREVIEW_CSP).toContain("default-src &#39;none&#39;");
    expect(STUDIO_PREVIEW_CSP).toContain("form-action &#39;none&#39;");
    expect(STUDIO_PREVIEW_CSP).toContain("connect-src &#39;none&#39;");
    expect(STUDIO_PREVIEW_CSP).not.toContain('script-src');
  });

  test('marks simulated dashboard and booking data as examples', () => {
    expect(generateStudioProject('analytics dashboard').html).toContain('SAMPLE DATA — NOT LIVE');
    expect(generateStudioProject('appointment booking').html).toContain('NO BOOKING BACKEND CONNECTED');
  });
});

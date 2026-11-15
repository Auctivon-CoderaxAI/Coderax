import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import SkillMarkdownRenderer from '../SkillMarkdownRenderer';

function LocationProbe() {
  const location = useLocation();

  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderMarkdown(content: string, currentFilePath = 'SKILL.md') {
  return render(
    <MemoryRouter initialEntries={['/skills/skill-id']}>
      <SkillMarkdownRenderer
        content={content}
        skillId="skill-id"
        currentFilePath={currentFilePath}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('SkillMarkdownRenderer', () => {
  /* MarkdownLite is a lazy chunk. Compile it before the timed test. */
  beforeAll(async () => {
    await import('~/components/Chat/Messages/Content/MarkdownLiteContent');
  }, 120000);

  it('routes relative links from SKILL.md to the skill file viewer', async () => {
    renderMarkdown('[source selection](references/source-selection.md)');

    const link = await screen.findByRole('link', { name: 'source selection' }, { timeout: 15000 });
    expect(link).toHaveAttribute('href', '/skills/skill-id?file=references%2Fsource-selection.md');

    fireEvent.click(link);

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/skills/skill-id?file=references%2Fsource-selection.md',
    );
  }, 30000);

  it('normalizes relative links from a nested markdown file', async () => {
    renderMarkdown(
      [
        '[sibling](./source.md)',
        '[parent](../overview.md)',
        '[encoded](../source%20selection.md#details)',
      ].join('\n\n'),
      'references/guides/current.md',
    );

    expect(
      await screen.findByRole('link', { name: 'sibling' }, { timeout: 15000 }),
    ).toHaveAttribute('href', '/skills/skill-id?file=references%2Fguides%2Fsource.md');
    expect(await screen.findByRole('link', { name: 'parent' }, { timeout: 15000 })).toHaveAttribute(
      'href',
      '/skills/skill-id?file=references%2Foverview.md',
    );
    expect(
      await screen.findByRole('link', { name: 'encoded' }, { timeout: 15000 }),
    ).toHaveAttribute('href', '/skills/skill-id?file=references%2Fsource%20selection.md#details');
  });

  it.each([
    ['external URL', 'https://example.com/docs'],
    ['mailto link', 'mailto:person@example.com'],
    ['telephone link', 'tel:+1234567890'],
    ['page anchor', '#section'],
    ['absolute app path', '/settings'],
    ['protocol-relative URL', '//cdn.example.com/file.md'],
  ])('leaves %s unchanged', async (label, href) => {
    renderMarkdown(`[${label}](${href})`);

    expect(await screen.findByRole('link', { name: label }, { timeout: 15000 })).toHaveAttribute(
      'href',
      href,
    );
  });

  it('continues to sanitize unsafe URL protocols', async () => {
    renderMarkdown('[unsafe](javascript:alert(1))');

    expect(await screen.findByRole('link', { name: 'unsafe' }, { timeout: 15000 })).toHaveAttribute(
      'href',
      '',
    );
  });
});

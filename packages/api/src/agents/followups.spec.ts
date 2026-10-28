import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { AppConfig } from '@coderax/data-schemas';
import type { FollowupSuggestion } from './followups';
import {
  MAX_FOLLOWUPS,
  SUGGEST_FOLLOWUPS_TOOL,
  SuggestFollowupsToolDefinition,
  createFollowupTools,
  isSuggestFollowupsAdminDisabled,
  normalizeFollowups,
  suggestFollowups,
} from './followups';

function suggestion(label: string, prompt: string): FollowupSuggestion {
  return { label, prompt };
}

async function invokeSuggest(suggestions: unknown): Promise<Record<string, unknown>> {
  const [suggest] = createFollowupTools() as unknown as Array<DynamicStructuredTool<unknown>>;
  const result = await suggest.invoke({ suggestions } as never);
  return JSON.parse(result as string) as Record<string, unknown>;
}

describe('normalizeFollowups', () => {
  test('collapses whitespace in labels and prompts', () => {
    const normalized = normalizeFollowups([
      suggestion('  Add\n retry  tests ', 'Add  retry\nto  the poller'),
    ]);
    expect(normalized).toEqual([{ label: 'Add retry tests', prompt: 'Add retry to the poller' }]);
  });

  test('drops blank prompts instead of rejecting the call', () => {
    expect(
      normalizeFollowups([suggestion('Blank', '   '), suggestion('Keep', 'Split the provider')]),
    ).toEqual([{ label: 'Keep', prompt: 'Split the provider' }]);
  });

  test('falls back to the prompt when the label is blank', () => {
    expect(normalizeFollowups([suggestion('  ', 'Harden the deploy poller')])).toEqual([
      { label: 'Harden the deploy poller', prompt: 'Harden the deploy poller' },
    ]);
  });

  test('de-duplicates by prompt, ignoring case', () => {
    expect(
      normalizeFollowups([
        suggestion('First', 'Add retry with backoff'),
        suggestion('Second', 'add retry with backoff'),
      ]),
    ).toEqual([{ label: 'First', prompt: 'Add retry with backoff' }]);
  });

  test('caps the list at the maximum', () => {
    const many = Array.from({ length: MAX_FOLLOWUPS + 3 }, (_, index) =>
      suggestion(`Chip ${index}`, `Prompt ${index}`),
    );
    expect(normalizeFollowups(many)).toHaveLength(MAX_FOLLOWUPS);
  });

  test('truncates an over-long label rather than dropping the suggestion', () => {
    const long = 'x'.repeat(120);
    const [normalized] = normalizeFollowups([suggestion(long, 'Do the thing')]);
    expect(normalized?.label.length).toBeLessThan(long.length);
    expect(normalized?.prompt).toBe('Do the thing');
  });
});

describe('suggestFollowups', () => {
  test('echoes the normalized chips with a count', () => {
    const result = suggestFollowups([
      suggestion('Add retry tests', 'Add retry with backoff tests'),
      suggestion('Split the provider', 'Split the provider into two files'),
    ]);
    expect(result.count).toBe(2);
    expect(result.suggestions.map((item) => item.label)).toEqual([
      'Add retry tests',
      'Split the provider',
    ]);
  });

  test('reports an empty result when every prompt was blank', () => {
    expect(suggestFollowups([suggestion('A', '  ')])).toEqual({ suggestions: [], count: 0 });
  });
});

describe('createFollowupTools', () => {
  test('exposes a single suggest_followups tool with a matching definition', () => {
    const created = createFollowupTools();
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe(SUGGEST_FOLLOWUPS_TOOL);
    expect(SUGGEST_FOLLOWUPS_TOOL).toBe('suggest_followups');
    expect(SuggestFollowupsToolDefinition.name).toBe(SUGGEST_FOLLOWUPS_TOOL);
    expect(SuggestFollowupsToolDefinition.schema.properties.suggestions.items.required).toEqual([
      'label',
      'prompt',
    ]);
  });

  test('returns the stored chips as JSON for the model to read back', async () => {
    const parsed = await invokeSuggest([
      suggestion('Add retry tests', 'Add retry with backoff tests'),
      suggestion('Split the provider', 'Split the provider into two files'),
    ]);
    expect(parsed.count).toBe(2);
    expect(parsed.suggestions).toEqual([
      { label: 'Add retry tests', prompt: 'Add retry with backoff tests' },
      { label: 'Split the provider', prompt: 'Split the provider into two files' },
    ]);
  });

  test('rejects a single suggestion', async () => {
    await expect(invokeSuggest([suggestion('One', 'Only one')])).rejects.toBeDefined();
  });

  test('rejects more suggestions than the card can show', async () => {
    const many = Array.from({ length: MAX_FOLLOWUPS + 1 }, (_, index) =>
      suggestion(`Chip ${index}`, `Prompt ${index}`),
    );
    await expect(invokeSuggest(many)).rejects.toBeDefined();
  });

  test('rejects a suggestion with no prompt', async () => {
    await expect(
      invokeSuggest([suggestion('Add retry tests', ''), suggestion('Split', 'Split the file')]),
    ).rejects.toBeDefined();
  });
});

describe('isSuggestFollowupsAdminDisabled', () => {
  test('is disabled when the allowlist omits it', () => {
    expect(isSuggestFollowupsAdminDisabled({ includedTools: ['web_search'] } as AppConfig)).toBe(
      true,
    );
  });

  test('is enabled when the allowlist includes it', () => {
    expect(
      isSuggestFollowupsAdminDisabled({ includedTools: [SUGGEST_FOLLOWUPS_TOOL] } as AppConfig),
    ).toBe(false);
  });

  test('is disabled by the exclude list', () => {
    expect(
      isSuggestFollowupsAdminDisabled({ filteredTools: [SUGGEST_FOLLOWUPS_TOOL] } as AppConfig),
    ).toBe(true);
  });

  test('is enabled with no filter configured', () => {
    expect(isSuggestFollowupsAdminDisabled(undefined)).toBe(false);
  });
});

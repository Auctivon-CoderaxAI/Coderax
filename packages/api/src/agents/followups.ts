import { z } from 'zod';
import { tool } from '@librechat/agents/langchain/tools';
import type { AppConfig } from '@coderax/data-schemas';
import type { GenericTool } from '@librechat/agents';

/**
 * Tool name. Shared verbatim with the client card that renders the chips, the
 * same way `ask_user_question` and `write_todos` key their pipelines on one
 * string.
 */
export const SUGGEST_FOLLOWUPS_TOOL = 'suggest_followups';

export interface FollowupSuggestion {
  /** Chip text — what the reader scans when choosing a direction. */
  label: string;
  /** The whole prompt, inserted into the composer when the chip is clicked. */
  prompt: string;
}

export interface SuggestFollowupsResult {
  suggestions: FollowupSuggestion[];
  count: number;
}

/** A chip wider than this stops reading as a chip; the prompt carries the detail. */
const LABEL_MAX = 48;

/** Roughly a short message. Long enough for a real prompt, short enough to read. */
const PROMPT_MAX = 400;

export const MIN_FOLLOWUPS = 2;
export const MAX_FOLLOWUPS = 4;

const LABEL_DESCRIPTION =
  'Two to five words the reader scans to pick a direction ("Add retry tests", ' +
  '"Split the provider"). Not a sentence, no trailing punctuation.';

const PROMPT_DESCRIPTION =
  'The complete instruction the reader would send: self-contained, naming the target ' +
  'clearly enough to stand alone, written in the imperative. Do not include file paths ' +
  'or step-by-step sequencing unless that is itself the request.';

const SUGGEST_FOLLOWUPS_DESCRIPTION = [
  'Offer the user next steps after finishing a turn. Each suggestion becomes a chip under',
  'your reply; clicking one inserts its `prompt` into the message box, so the reader can',
  'edit before sending.',
  'Call this at most once per turn, as your very last action, only after the answer or the',
  'work is complete — never mid-task, never to narrate progress, and never as a substitute',
  'for an `ask_user_question` pause you actually need.',
  `Send ${MIN_FOLLOWUPS} to ${MAX_FOLLOWUPS} genuinely different next steps, ordered by usefulness:`,
  'the natural next step first, then one or two directions a little further out such as a',
  'related improvement or a way to test or harden what you just built.',
  'Skip the call when the turn ended in a question you already asked the user, when the work',
  'is blocked on them, or when there is nothing sensible to suggest — an obvious filler chip',
  'is worse than none.',
].join(' ');

const followupSchema = z.object({
  label: z.string().min(1).max(LABEL_MAX).describe(LABEL_DESCRIPTION),
  prompt: z.string().min(1).max(PROMPT_MAX).describe(PROMPT_DESCRIPTION),
});

export const suggestFollowupsSchema = z.object({
  suggestions: z
    .array(followupSchema)
    .min(MIN_FOLLOWUPS)
    .max(MAX_FOLLOWUPS)
    .describe(
      `The follow-up prompts, in the order they should be shown. Between ${MIN_FOLLOWUPS} and ${MAX_FOLLOWUPS} items.`,
    ),
});

export type SuggestFollowupsInput = z.infer<typeof suggestFollowupsSchema>;

/** JSON-schema twin of {@link suggestFollowupsSchema}, for the schema-only registry. */
export interface SuggestFollowupsToolDefinitionShape {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: {
      suggestions: {
        type: 'array';
        minItems: number;
        maxItems: number;
        description: string;
        items: {
          type: 'object';
          properties: {
            label: { type: 'string'; minLength: number; maxLength: number; description: string };
            prompt: { type: 'string'; minLength: number; maxLength: number; description: string };
          };
          required: string[];
        };
      };
    };
    required: string[];
  };
}

export const SuggestFollowupsToolDefinition: SuggestFollowupsToolDefinitionShape = {
  name: SUGGEST_FOLLOWUPS_TOOL,
  description: SUGGEST_FOLLOWUPS_DESCRIPTION,
  schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: MIN_FOLLOWUPS,
        maxItems: MAX_FOLLOWUPS,
        description: `The follow-up prompts, in the order they should be shown. Between ${MIN_FOLLOWUPS} and ${MAX_FOLLOWUPS} items.`,
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              minLength: 1,
              maxLength: LABEL_MAX,
              description: LABEL_DESCRIPTION,
            },
            prompt: {
              type: 'string',
              minLength: 1,
              maxLength: PROMPT_MAX,
              description: PROMPT_DESCRIPTION,
            },
          },
          required: ['label', 'prompt'],
        },
      },
    },
    required: ['suggestions'],
  },
};

/** Collapses model-authored whitespace; chips and prompts are single paragraphs. */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Normalize a call into what the card renders: collapse whitespace, drop blank
 * entries, and de-duplicate by prompt so the same direction cannot appear twice
 * under different labels. A blank label falls back to the prompt's opening
 * words rather than losing an otherwise useful suggestion.
 */
export function normalizeFollowups(
  suggestions: readonly FollowupSuggestion[],
): FollowupSuggestion[] {
  const seen = new Set<string>();
  const normalized: FollowupSuggestion[] = [];
  for (const suggestion of suggestions.slice(0, MAX_FOLLOWUPS)) {
    const prompt = normalizeText(suggestion.prompt).slice(0, PROMPT_MAX);
    if (prompt.length === 0) {
      continue;
    }
    const key = prompt.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    const label = normalizeText(suggestion.label).slice(0, LABEL_MAX) || prompt.slice(0, LABEL_MAX);
    seen.add(key);
    normalized.push({ label, prompt });
  }
  return normalized;
}

/** Stateless like `write_todos`: the card is rebuilt from the args on every render. */
export function suggestFollowups(
  suggestions: readonly FollowupSuggestion[],
): SuggestFollowupsResult {
  const normalized = normalizeFollowups(suggestions);
  return { suggestions: normalized, count: normalized.length };
}

export function createFollowupTools(): GenericTool[] {
  const suggest = tool(
    async ({ suggestions }: SuggestFollowupsInput) => JSON.stringify(suggestFollowups(suggestions)),
    {
      name: SUGGEST_FOLLOWUPS_TOOL,
      description: SUGGEST_FOLLOWUPS_DESCRIPTION,
      schema: suggestFollowupsSchema,
    },
  );

  return [suggest];
}

/**
 * Admin kill switch, mirroring `isWriteTodosAdminDisabled`: the `includedTools`
 * allowlist wins over `filteredTools`, and an affordance that spends the
 * reader's attention cannot be one an operator has no lever over.
 */
export function isSuggestFollowupsAdminDisabled(appConfig?: AppConfig): boolean {
  const included = appConfig?.includedTools;
  if (included != null && included.length > 0) {
    return !included.includes(SUGGEST_FOLLOWUPS_TOOL);
  }
  return appConfig?.filteredTools?.includes(SUGGEST_FOLLOWUPS_TOOL) === true;
}

import { ContentTypes } from 'coderax-data-provider';
import type { TMessage, TMessageContentParts, TextData } from 'coderax-data-provider';
import { scanFenceLine } from '~/utils/markdownFence';

/** An editable part holds either a bare string or a `{ value, annotations }` object,
 *  which is how the Assistants thread sync stores a response that carries file
 *  citations. Reads and writes both go through this, so an edit lands in the same
 *  shape it was read from. */
export const getPartValue = (part: TMessageContentParts): string | TextData | undefined => {
  if (part.type === ContentTypes.TEXT) {
    return part.text;
  }
  if (part.type === ContentTypes.THINK) {
    return part.think;
  }
  return undefined;
};

export const getPartText = (part: TMessageContentParts): string | undefined => {
  const value = getPartValue(part);
  return typeof value === 'string' ? value : value?.value;
};

export const withPartText = (part: TMessageContentParts, text: string): string | TextData => {
  const value = getPartValue(part);
  return value != null && typeof value === 'object' ? { ...value, value: text } : text;
};

const ARTIFACT_DIRECTIVE = /^ {0,3}:{2,}artifact\b/;

/** Artifact directives inside fenced code are content, not renderable artifacts. */
const containsArtifact = (text: string): boolean => {
  if (!text.includes('artifact')) {
    return false;
  }

  let fence: { marker: string; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const scanned = scanFenceLine(line, fence);
    fence = scanned.fence;
    if (scanned.isFenceLine) {
      continue;
    }
    if (fence == null && ARTIFACT_DIRECTIVE.test(line)) {
      return true;
    }
  }
  return false;
};

/**
 * Whether the editor gives this part a field to type in. Tool-call output and
 * artifact-bearing text keep their specialized renderers and stay read-only, so
 * neither becomes a textarea.
 */
export const isEditablePart = (part?: TMessageContentParts | null): boolean => {
  if (!part || (part.type !== ContentTypes.TEXT && part.type !== ContentTypes.THINK)) {
    return false;
  }
  if (part.type === ContentTypes.TEXT && part.tool_call_ids != null) {
    return false;
  }
  const text = getPartText(part);
  return text != null && !containsArtifact(text);
};

/**
 * Whether opening the editor on this message would show any field at all. A
 * message with no content array is edited as plain text, so it always would; a
 * turn made only of a summary, an error, tool calls or an artifact would not, and
 * on a turn that also has no user turn to replay its editor is inert.
 *
 * The artifact check parses markdown, so callers resolve this only for the rows
 * that can act on the answer.
 */
export const hasEditablePart = (message?: Pick<TMessage, 'content'> | null): boolean => {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return true;
  }
  return content.some(isEditablePart);
};

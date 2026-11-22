const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 24_000;
const MAX_HISTORY_MESSAGE_CHARS = 4_000;

/** Bounded context so a long task cannot turn every follow-up into a giant prompt. */
export function buildEnginePrompt(
  history: ReadonlyArray<{ text: string; isCreatedByUser: boolean }>,
  request: string,
): string {
  const selected = history.slice(-MAX_HISTORY_MESSAGES);
  const lines: string[] = [];
  let used = 0;
  for (const message of selected.slice().reverse()) {
    const text = message.text.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS);
    if (!text) {
      continue;
    }
    const line = `${message.isCreatedByUser ? 'User' : 'Assistant'}: ${text}`;
    if (used + line.length > MAX_HISTORY_CHARS) {
      break;
    }
    used += line.length;
    lines.push(line);
  }
  lines.reverse();
  return lines.length > 0
    ? `Earlier in this Work conversation:\n${lines.join('\n')}\n\nCurrent request:\n${request}`
    : request;
}

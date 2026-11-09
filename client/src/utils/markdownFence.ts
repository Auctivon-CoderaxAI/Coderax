type Fence = { marker: string; length: number };

/** Track CommonMark fence lines without parsing the rest of the document. */
export function scanFenceLine(
  line: string,
  open: Fence | null,
): { fence: Fence | null; isFenceLine: boolean } {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (match == null) {
    return { fence: open, isFenceLine: false };
  }

  const [, run, rest] = match;
  if (open != null) {
    const closes = run[0] === open.marker && run.length >= open.length && rest.trim() === '';
    return { fence: closes ? null : open, isFenceLine: true };
  }

  // Backticks in a backtick fence's info string make the opener invalid.
  if (run[0] === '`' && rest.includes('`')) {
    return { fence: null, isFenceLine: false };
  }
  return { fence: { marker: run[0], length: run.length }, isFenceLine: true };
}

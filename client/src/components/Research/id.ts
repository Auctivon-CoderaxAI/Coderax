/**
 * Source and claim ids are client-generated because a dossier is saved as one
 * document. `randomUUID` is available in every supported browser, but tests and
 * older webviews get a collision-resistant fallback that matches the server's
 * id pattern.
 */
export function newResearchId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid;
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

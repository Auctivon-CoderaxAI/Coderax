export function isCyvoxFreeOrLocalModel(model: string): boolean {
  return (
    model === 'cyvox/auto' ||
    model === 'openrouter/free' ||
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*:free$/.test(model) ||
    /^ollama[:/][A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*(?::[A-Za-z0-9._-]+)?$/.test(model)
  );
}

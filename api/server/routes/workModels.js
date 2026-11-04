/**
 * Pure projections between native Coderax shapes and the Work contract.
 *
 * Kept free of server imports so they can be tested without Mongo, module
 * aliases or the generation runtime.
 */

/** Endpoints whose models run locally and therefore cost nothing per call. */
const LOCAL_ENDPOINTS = new Set(['ollama', 'lmstudio', 'local', 'llamacpp']);

const isLocalEndpoint = (endpoint) => LOCAL_ENDPOINTS.has(String(endpoint).toLowerCase());

/**
 * `loadModels` returns a per-endpoint config object. Work needs a flat list, and
 * local endpoints must carry `local` so the free/local filter keeps them.
 */
function flattenModelConfig(config) {
  const models = [];
  const push = (entry, endpoint) => {
    if (!entry) {
      return;
    }
    if (typeof entry === 'string') {
      models.push({
        id: entry,
        label: entry,
        provider: endpoint,
        ...(isLocalEndpoint(endpoint) ? { local: true } : {}),
      });
      return;
    }
    const id = entry.id ?? entry.model ?? entry.name;
    if (!id) {
      return;
    }
    models.push({
      id: String(id),
      label: String(entry.label ?? entry.name ?? id),
      provider: endpoint,
      ...(isLocalEndpoint(endpoint) ? { local: true } : {}),
      ...(entry.free === true ? { free: true } : {}),
    });
  };

  for (const [endpoint, value] of Object.entries(config ?? {})) {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(entry, endpoint));
    } else {
      push(value, endpoint);
    }
  }
  return models;
}

/** Only persisted Work fields are read; nothing is inferred. */
function toWorkConversation(conversation) {
  if (!conversation) {
    return null;
  }
  return {
    conversationId: String(conversation.conversationId),
    title: conversation.title,
    isWork: conversation.isWork === true,
    workModel: conversation.workModel,
    workState: conversation.workState,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/** Work history is Work conversations: an ordinary chat never appears there. */
function onlyWorkRows(rows) {
  return (rows ?? []).filter((row) => row != null && row.isWork === true);
}

/** `getConvosByCursor` returns a page; tolerate the array and page shapes. */
function rowsFromCursor(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return result?.conversations ?? result?.data ?? [];
}

module.exports = {
  flattenModelConfig,
  toWorkConversation,
  onlyWorkRows,
  rowsFromCursor,
  isLocalEndpoint,
};

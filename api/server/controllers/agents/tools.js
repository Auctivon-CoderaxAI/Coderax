const { processCodeOutput, runPreviewFinalize, buildPreviewUpdatePayload } = require('~/server/services/Files/Code/process');

// Direct tool endpoint has no stream to write to; still use the shared
// helper so the overlay semantics stay identical even though the result
// is discarded / logged rather than streamed.
runPreviewFinalize({
  finalize,
  fileId: fileMetadata.file_id,
  onResolved: (updated) => {
    const payload = buildPreviewUpdatePayload(updated, {
      runMessageId: metadata.run_id,
      toolCallId: metadata.tool_call_id,
    });
    if (!payload) {
      return;
    }
    // No SSE stream for the direct tool endpoint — no-op/log only.
    logger.debug('[tools] code execution preview resolved', { fileId: fileMetadata.file_id });
  },
});
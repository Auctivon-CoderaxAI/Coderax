# Independent multimodal and provider review

Review the exact branch head and pull request diff for `codex/multimodal` in `CoderaxAI/Coderax`. Treat the checked out source and its executed tests as evidence; do not infer support from names, configuration examples, mocks, or UI labels.

## Review scope

- Trace model discovery from configured provider through the server response and selector. Check cache keys, per-user credentials and headers, configured model overrides, model capability metadata, and what the UI does when discovery fails or a model is unavailable.
- Trace each supported attachment from browser validation and cancellation through upload authorization, storage ownership, extraction, message persistence, provider encoding, and preview. Check malformed and oversized files, MIME spoofing, path traversal, archive expansion, cross-user access, and sanitized errors.
- Verify image understanding only reaches a selected, configured vision-capable model and that unsupported image input fails clearly.
- Verify image generation only reports success after an authorized provider returns a usable artifact. Check disabled and absent provider behavior, cancellation, persistence, and rendered previews.
- Review speech input and output against actual browser/device APIs or configured services. Flag claims of real-time voice or media support without an implemented transport and provider.
- Check the attachment and media UI for keyboard access, accessible names and status, mobile layouts, restored messages, and failure/cancellation states.
- Check that Chat and native Work keep their existing request, streaming, and persistence contracts. Flag unrelated orchestration or deployment-configuration changes.
- Review provider-contract tests for disabled capabilities, authentication failures, malformed files, size boundaries, and safe error handling. Separate mocked contract evidence from a real provider call.

## Required review report

Return findings ordered by severity. For each finding give the exact file and line, the affected request or user flow, why the behavior is unsafe or incorrect, and a focused reproduction or test. Distinguish confirmed source defects from questions that require a real provider or device. State which provider and model you actually inspected or exercised, how their identity was verified, and which parts could not be exercised. Do not assume a provider or model is Claude 5; report the exact selected identifier from evidence. Do not copy credentials, tokens, uploaded private content, or raw provider payloads into the report. Make no code changes and do not publish or merge anything.

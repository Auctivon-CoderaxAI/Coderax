# Knowledge, projects, search, and MCP review

## Review status

No Freebuff MCP or A2A reviewer is connected to this Codex session. The installed Freebuff CLI is version 0.2.35; its help exposes an interactive client and `login`, but no non-interactive repository review command. No Freebuff review was requested or completed, and no result should be inferred from the existing `freebuff/*` Git branch.

The review below is a handoff checklist for a Freebuff reviewer with authorized, read-only access to the exact commit. Run tests against that commit and report findings with file paths and evidence. Do not connect live MCP servers or execute external actions during review.

## Required checks

1. **Project ownership and persistence**
   - Create, rename, list, and delete a project as user A; read it again from a fresh request/session.
   - Verify user B cannot read, change, delete, assign conversations to, or attach files to A's project, including when owner IDs are identical across different tenant IDs.
   - Move conversations between projects, delete a project, and confirm conversations remain intact and project counts recover after a fresh read.
   - Exercise stale `contextRevision` updates and file deletion during attachment; stale writes must fail without losing newer context or consuming an attachment hold.

2. **Conversation search and project scope**
   - Search both conversation titles and message content, then verify results are restricted to the authenticated user and requested project after database hydration.
   - Include archived/retention-hidden and unassigned conversations; they must follow the route filters.
   - Use a fixture with more than the search index's hit limit and matches spread across projects. Confirm project-scoped results are complete or explicitly expose the provider's result limit rather than silently omitting matches.

3. **Persistent memory controls**
   - Create, inspect, correct, disable, and delete a memory; verify deletion from a fresh request and confirm disabled memories are not loaded into a later turn.
   - Verify agent-scoped memory is isolated and cannot be read or deleted through another agent's partition.
   - Exercise sensitive-content guards with credentials, authentication tokens, and sensitive personal data. Confirm guarded content is neither persisted nor included in model context.

4. **Project files and citations**
   - Retrieve an authorized uploaded file through a project and verify the returned source reference points to that file.
   - Attempt retrieval as another user/tenant and with deleted, expired, unindexed, or agent-scoped files; none may expose file content.
   - Verify the assistant receives project resources only from the conversation's authoritative project membership, not a request override or instructions embedded in retrieved content.

5. **MCP discovery and execution**
   - Use a local mock MCP server to verify discovery schemas, connection state, tool-call timeouts, transport failures, and safe user-facing errors.
   - Confirm a tool denied by per-tool permissions cannot execute; a write action requires its action-specific approval and creates the expected audit record.
   - Put an instruction to call a tool inside a retrieved document and verify it is treated as untrusted content and cannot approve or trigger that action.

## Existing focused suites

- `packages/data-schemas/src/methods/chatProject.spec.ts`
- `packages/data-schemas/src/methods/conversation.spec.ts`
- `packages/data-schemas/src/methods/file.acl.spec.ts`
- `packages/data-schemas/src/methods/memory.spec.ts`
- `packages/api/src/projects/context.spec.ts`
- `packages/api/src/projects/handlers.spec.ts`
- `packages/api/src/memory/handlers.spec.ts`
- `packages/api/src/memory/protection.spec.ts`
- `packages/api/src/files/rag/context.spec.ts`
- `packages/api/src/mcp/authorization.spec.ts`
- `packages/api/src/mcp/tools.spec.ts`


## Coderax implementation status

- Existing project/workspace assignment, conversation search, file retrieval, memory controls, and MCP registration are present in the repository. This branch adds run-level action review for every registered MCP spelling and for inline `set_memory` / `delete_memory`, including tool names discovered after a lazy agent resolves. Administrator denies remain higher priority; unrelated tools retain the configured endpoint behavior.
- The supported Freebuff A2A/MCP bridge is unavailable in this environment. The installed CLI was reported as 0.2.35 and exposes an interactive client/login, but no non-interactive repository review command. No connection was made and no independent Freebuff result is claimed.
- Focused tests for the new approval policy, runtime policy refresh, and run tool-name collection: 3 suites passed; 5 selected tests passed (154 unrelated tests skipped by the name filter). `npx tsc --noEmit --pretty false` passed in `packages/api`.
- Database-backed project tests could not run: `mongodb-memory-server` failed to start within its 10-second startup window, before application assertions. No conclusion is drawn from those failures.
- The existing admin append-only audit log is not yet wired to MCP approval decisions or execution outcomes. The audit check above remains a release follow-up; approvals and tool execution were not independently verified on a live MCP server.
- Production persistence, tenant-isolation, Freebuff integration, and live MCP behavior have not been verified by this local run.

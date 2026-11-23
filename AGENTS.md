# Coderax contributor and agent guidance

`AGENTS.md` is the repository's contributor guidance. Backend code lives in `packages/api`
(TypeScript) and `packages/data-schemas` (database methods); `api` is legacy Express wiring.
Shared API types and services live in `packages/data-provider`, and the React app lives in
`client` with shared primitives in `packages/client`.

## Branching and pull requests

Normally branch off `dev` and target `dev`; `gh pr create` defaults to `main`, so pass `--base dev`
explicitly. `main` is the released branch, kept as a fast-forward of `dev` and synced as-is — never
open a backport pull request to `main`, because anything merged to `dev` reaches it at the next
sync. Pull requests opened against `main` are retargeted automatically.

**Maintainer-directed canary exception:** Experimental work, or a PR ready to merge after review but
not yet suitable for the next `main` sync, may instead target `canary`. The maintainer may choose
this before work starts or while reviewing a stale PR. For new canary work, branch from the current
`origin/canary` and pass `--base canary` explicitly; do not silently retarget an existing PR or
promote canary code to `dev`. If a stale PR is redirected to canary, first check its base, diff and
reviewed head against current canary; coordinate any rebase or new PR with the maintainer. A PR
explicitly based on `canary` stays there; the main-to-dev retarget workflow does not move it.

Still link related issues in the PR (for example, `Related to #N`) so the work remains
traceable. `Fixes #N` does not close an issue on a `dev` or `canary` merge — GitHub honors closing
keywords only on the default branch. Close resolved issues by hand after merging. Worktrees share
one stash stack, so never use a bare `git stash pop`. Prefer a WIP commit; if a stash is necessary,
apply the specific tagged entry. The `target: main` label and release-bound upstream branches are
exempt from the main-to-dev retarget workflow; do not use either to backport ordinary work.

Write the description for a reader who has not followed the branch: what breaks, what triggers it,
how it behaves after the change, then one or two views of the mechanism — a focused diff, a call
tree, a shallow file tree, or a Mermaid sequence. Keep only what the change carries, and describe
the code as it stands rather than narrating earlier commits or review rounds. Naming the merged
pull request that caused the bug is not the same thing; that is history the reader needs. The
formats and examples live in `.github/pull_request_template.md`.

## Review and completion

Read the inline review threads themselves — a summary comment or notification list omits findings.
Audit each one against the current code, fix what is valid, and reject what is obsolete in a reply
that says why. After each round: focused tests, `npx tsc --noEmit` in every workspace you changed,
push, then request the next review naming the pull request's exact remote head — a clean review of
an earlier head says nothing about what you just pushed, and CI runs on its own clock. Reply on
each resolved thread with the resolving commit and evidence. After two actionable rounds, stop
patching thread by thread and read the subsystem by invariant instead: identity, authorization,
persistence, retry, cancellation, cleanup and mixed-version behavior where relevant. Which reviewer
and what phrase triggers it will change; that the review must cover the exact pushed head will not.

A clean review is one completion signal, not the definition of done. Ship the observable experience
— loading, empty, success, failure, cancellation, retry, restored session — with strings localized,
accessibility intact, defaults and stored data preserved, and no backend capability left without a
frontend entry point. Keep fixes small and test the missed behavior. Report the pushed head, what you
ran locally, CI state, the review result at that head, any finding you rejected with the reasoning,
and checks you could not run.

## Verification

Local repository work has no model-selection or model-identity prerequisite. Follow the active
task's authorization, privacy, cost and validation requirements without adding a model identity gate.

For startup, auth, config, file, or message-loading changes, avoid serial database
reads and reuse loaded request data. Run `npm run lighthouse` before completion:
the CI lane adds 250 ms per Mongo query and checks the visible conversation's LCP.
See [budgets, reproduction and failure diagnosis](e2e/lighthouse/README.md).

A green build is not a typecheck: `packages/api`, `packages/client` and `packages/data-schemas` build
with `tsdown`, which emits without checking types. Run `npx tsc --noEmit` in the workspace you
changed. `packages/client` excludes `*.spec.ts(x)` and `*.test.ts(x)` from typechecking entirely.
`npm run sort-imports` with no arguments rewrites every source root — pass the paths you touched.
Run `npm run static-checks -- --against origin/dev` to reproduce the PR's static checks; use
`npm run static-checks:full` for the slower gates. Fix all formatting, lint, and TypeScript
warnings/errors in the code you change.

Hosted CI is billing-blocked on this repository, so `npm run verify` is the acceptance gate for a
pull request. One command runs the four gates a merge has to show, in order:

1. TypeScript for every workspace affected by the committed diff, staged or unstaged edits,
   or non-ignored untracked files.
2. The Work Jest suites (`packages/api/src/engines/workChat*`), after building data-provider.
3. `npm run build:api`.
4. The `--full` static-check tier for the same committed and local paths, with the TypeScript check
   left to step 1 so no project is compiled twice.

Then any additional focused test command and the manual observation:

    npm run verify -- --against origin/main \
      --test "cd packages/api && npx jest src/engines/workChat.spec.ts --ci" \
      --manual "Sent one Work message; the stream rendered and the transcript survived reload."

It prints a Markdown block naming the commit, the base, the working-tree state and every gate's
result. **Paste that block into the pull request's Testing section: it is the PR's acceptance
artifact.** A review that cannot see it has no evidence the change was checked, and a merge recorded
without one is unverified. At least one `--test` or `--manual` is required, and a dirty working tree
is called out in the artifact because the commit then does not identify what ran. `--skip-static`
skips the four built-in gates for a quick re-run while iterating, and says so in the artifact.

## Module boundaries and configuration

All new backend behavior belongs in TypeScript under `packages/api`; database-specific shared logic
belongs in `packages/data-schemas`, and frontend/backend shared API logic belongs in
`packages/data-provider`. Build data-provider from the project root with `npm run build:data-provider`.

`/api` holds wiring, not behavior. When a change would add logic to a CJS file there — a branch, a
helper, a validation step, a service call — the logic belongs in `packages/api`, and the JS file
keeps requires, route registration and the call into the TS module (`MCPRequestContext.js` is the
shape, thirteen lines of re-export). "Minimum" means how much behavior `/api` gains, not how small
the diff is, and the rule applies to editing existing CJS, which is the common case.

Database contracts belong to `packages/data-schemas`. Keep Mongoose types (`FilterQuery`,
`Types.ObjectId`, `Document`) out of exported signatures in `packages/api`, `packages/data-provider`
and `client`, because they make the storage engine part of that module's public API. Take and return
plain typed objects and express the query behind a data-schemas method. The boundary already leaks
across `packages/api`, so stop widening it rather than rewriting what exists; the client carries none
of it and must stay that way.

New levers ship configurable: a limit, timeout, toggle or capability introduced in code earns a field
on `configSchema` (`packages/data-provider/src/config.ts`) so it can be set in `coderax.yaml`, with
a default that reproduces today's behavior. Hard-coded constants and env-only switches need a reason.
Modules take their dependencies rather than reaching for them: code in `packages/api` receives its
config, database methods and clients from the caller, the way `createModels(mongoose)` receives the
app's connection, instead of importing app singletons or reading global state. Integrations (provider
SDKs, storage backends, vector stores, OAuth servers) arrive through an interface the caller
supplies, so a second implementation is a new argument instead of a new branch. The static singletons
under `packages/api/src/mcp` are the shape to stop extending, not a pattern to copy. This is the
backend half of client state ownership: pass it in, do not reach for it.

## Service failures and user-facing errors

This section applies to backend services (`packages/api`) and database methods/repositories
(`packages/data-schemas`), not to React components. For new or substantially changed code in
those layers, choose failure behavior at the contract boundary instead of treating every
unsuccessful outcome as an exception:

- Return a plain value on success. Use `null` only for a documented absence (for example, a
  successful lookup with no record), never to hide a query failure.
- For an expected failure the caller can handle without aborting the operation, prefer a typed
  discriminated result such as `{ ok: true; value: T } | { ok: false; error: { code: string;
message?: string } }`. Keep an existing domain-specific result shape when changing it would
  break callers; do not introduce interchangeable `ok`, `valid`, and bare `{ message }` contracts
  in the same service. Codes should be stable, machine-readable identifiers when the caller
  needs to distinguish failures. Internal validation helpers may use the existing local pattern.
- Throw for unexpected operational failures (database, provider, network) and violated invariants.
  Use a typed/coded error when a boundary must recognize a particular failure. Catch where you can
  recover or translate it; otherwise let it reach the owning request or job boundary. Do not catch
  an exception and return a truthy record, `null`, or `{ message }` in its place: callers can then
  mistake an outage for data or send it as an HTTP 200. Keep separate migrations for existing
  contracts, with their callers and tests, rather than changing wire shapes incidentally.
- At the HTTP, stream, or job boundary, map failures to the existing status and response contract.
  Only expose intentionally approved codes and helpful user-safe information. Error disclosure is
  a security boundary: never forward raw exceptions, stacks, query text, credentials, request
  bodies, headers, provider payloads, or arbitrary `error.message` to a client or persisted
  user-visible status. Sanitize diagnostics and log only what the path can safely retain. For
  errors that may echo submitted content, prefer `getSafeErrorMetadata` over error text;
  `packages/api/src/utils/errors.ts` documents when redacted error text is appropriate.
- Localization is a UI responsibility, not a database-method return shape. When a failure reaches
  a user-facing surface, expose a safe, stable code the UI can map to localized, actionable copy
  and a fallback. See `client/src/components/Messages/Content/Error/registry.ts` and
  `client/src/components/Chat/Trace/Viewer.tsx`. Keep any intentionally disclosed provider detail
  behind its existing protection policy rather than treating arbitrary upstream text as safe.

Examples of local contracts, not a mandate to copy their shapes: `packages/api/src/admin/auditLog.ts`
uses a parsing result, `packages/api/src/agents/openai/service.ts` validates before mapping to an
OpenAI-compatible response, and `packages/api/src/skills/sync/errors.ts` names a sync failure by
stable code. `packages/data-schemas/src/methods/prompt.ts` currently returns `{ message }` on query
failure; do not extend that pattern. Test absence versus failure, the boundary's non-success response,
and that sensitive diagnostics cannot reach a user-visible surface.

## Frontend theming and styling

For frontend work, compose existing `@coderax/client` primitives and variants before adding
feature-local styles. Use semantic theme/Tailwind roles for color and shared appearance; do not
introduce raw palette utilities, hard-coded colors, or arbitrary theme CSS. If the system cannot
express a reusable design need, deepen the shared primitive or versioned theme-token registry
instead of copying classes into a feature. Theme definitions select semantic colors and appearance,
not selectors, app behavior, or alternate layouts. Keep genuine layout and behavior local, and
explain why any new custom CSS cannot use shared primitives. Support light/dark and reduced motion;
preserve defaults and test a deliberately different reference theme for reusable new variants.

## Backend auth cache

When adding or changing code that mutates user documents, invalidate the auth user document cache
for affected users, including bulk role and user mutations. Otherwise burst-cached JWT requests can
serve a stale `req.user` until the cache expires.

## Client state ownership

The client is migrating from Recoil to Jotai. New state is always Jotai, even in a file that already
imports Recoil; many files import both, so mixed imports say nothing about which to use. For existing
state the unit of conversion is one atom plus every file that reads or writes it, because an atom
cannot be half converted — convert the areas you touch, not the whole store.
Split by ownership: state a feature both writes and reads is feature-owned, so convert it to Jotai
and keep it inside the feature; app-global preferences and shell state a feature merely consumes
(`maximizeChatSpace`, `showScrollButton`, `enterToSend`, artifact visibility) must be passed in
through props or a small host-supplied context rather than reached for through `~/store`; when a
consumer sits outside the feature you are changing, leave that atom on Recoil and pass it in. Passing
them in is what lets a feature move to its own workspace later without a rewrite, and it keeps the
Jotai conversion scoped to the state a feature owns. For persisted atoms, use the helpers in
`client/src/store/jotai-utils.ts`.

## Code style and performance

Use short, single-word file names when possible; group related modules in a single-word directory.
Prefer flat early returns, pure functions, and explicit types. Avoid `any`, broad `unknown`/casts,
duplicated types, and dynamic imports. Extract genuinely repeated logic instead of copying it;
write comments only for non-obvious behavior or public API contracts.

Imports have three sections: package values (shortest line first, with `react` first), `import type`
(longest line first, package types before local types), and local/project values (longest line first).
Use standalone `import type { ... }`, not inline `type` within a value import. Run the scoped
import sorter on files you change.

Avoid extra passes over shared message arrays and unnecessary allocations. For startup and
request paths, reuse already-loaded user/config data, avoid serial database reads, and start
independent reads in parallel. Do not weaken authorization or tenant checks or write a response
before those checks succeed.

## Frontend rules

Use the chat Share/Export action-menu pattern: `DropdownPopup` from `@coderax/client` with
`Ariakit.MenuButton` (see `HeaderMenu.tsx` and `useExportShare.tsx`). Never introduce or reintroduce
the Radix `DropdownMenu` family for app action or sort menus. Preserve the Share/Export
dialog-item contract (`hideOnClick: false`, item ref, button render, and dialog `triggerRef`)
when a menu action opens a dialog.

Use `useLocalize()` for all visible copy and update only English keys in
`client/src/locales/en/translation.json`. Use semantic HTML, keyboard behavior, and ARIA labels.
Use React Query for API interactions and invalidate related queries after mutations; define query
and mutation keys in `packages/data-provider/src/keys.ts`. Put shared endpoint definitions, types,
and data services in `packages/data-provider`, and encode dynamic URL parameters. Cover loading,
success, and failure states in focused component tests.

## Testing

Run focused Jest tests from the owning workspace, not the entire monorepo. Prefer real logic and
spies over mocked internals; use `mongodb-memory-server` for database queries and the real MCP SDK
for MCP behavior. Mock only external HTTP APIs or uncontrollable services. For frontend tests use
the component's colocated `__tests__` and `test/layout-test-utils` where applicable.

<!-- BEGIN pr-review-policy -->

## Mandatory Pull Request Review & Automated Remediation

**This policy applies to every agent session and every authorized repository.**

### 1. Pull Requests Must Be Ready for Review

- NEVER push directly to `main`, `master`, or another protected branch.
- ALWAYS create or update a feature branch and open a pull request.
- NEVER create draft pull requests.
- Existing draft PRs must be converted to **Ready for review** when their changes are ready for validation.
- Run applicable tests, linting, builds, and security checks before submitting the PR.
- Reuse existing PRs instead of creating duplicate branches or pull requests.

### 2. Mandatory AI Reviewer Workflow

- Request reviews from authorized, configured AI reviewers, including GitHub Copilot, CodeRabbit, and Greptile where available.
- Do not assume that opening a PR automatically triggers reviewers.
- Confirm that review requests were accepted and actual reviews were submitted.
- Never fabricate approvals, impersonate reviewers, or bypass required human approval.
- If a reviewer is unavailable, report the exact blocker.

### 3. Read ALL Pull Request Feedback

The agent MUST retrieve and inspect:

- PR conversation comments.
- Inline code-review comments.
- Review summaries and requested changes.
- Unresolved review threads.
- CI failures and security findings.
- Comments added after subsequent commits.

Retrieve all pages of feedback through GitHub CLI or authenticated GitHub APIs. Do not rely exclusively on `gh pr view --comments`.

### 4. Automatically Implement Review Fixes

For every actionable comment:

1. Inspect the referenced code and understand the requested change.
2. Implement the appropriate fix on the EXISTING PR branch.
3. Run relevant tests, builds, and security validation.
4. Commit and push the correction to the same branch.
5. Reply to the original comment with the fix and commit reference.
6. Resolve review threads only after the underlying issue has genuinely been addressed.

If a suggestion is incorrect or unsafe, explain why on the PR rather than blindly applying it.

### 5. Mandatory Re-Review

- After every corrective push, request a new review unless automatic review of new pushes is confirmed enabled.
- Check review decisions against the latest commit SHA.
- Repeat the review -> fix -> test -> push -> re-review cycle until all actionable comments are addressed.
- Never count an old, dismissed, or stale approval as approval of the latest commit when current-head approval is required.

### 6. Automated Merge Gates

Where the repository owner has authorized auto-merge:

- Merge only when all required current-HEAD checks, builds, tests, security checks, reviews, approvals, and branch-protection rules pass.
- All required review threads must be resolved.
- Never bypass protection, use administrator override, self-approve, or force-merge.
- After merging, verify the merged SHA, deployment status where relevant, and required runtime checks.

If merging is not authorized or any gate remains blocked, keep the PR unmerged and report the exact blocker.

### 7. Continuation Across Sessions

At the beginning of every agent session:

- Identify the current GitHub account, repository, and active PRs.
- Check for outstanding review feedback before starting duplicate work.
- Continue authorized unfinished remediation on the existing PR.
- Revalidate the repository, branch, and latest SHA before writing.
- Report the PR URL, review status, fixes completed, remaining blockers, and merge status.

**Opening a PR is not completion. The agent is responsible for the review-and-remediation lifecycle within its authorized execution scope.**

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:58930069f2afeed8bec32313f0b88c524e628fa6f84d03c7aefb14d13b34a4f9 -->

### 8. Command Reference (use these exact commands)

Run from the repository root with `gh` authenticated (`gh auth status`). `gh` resolves `{owner}/{repo}` itself; replace `PR_NUMBER` with the numeric PR number.

```bash
# Check whether the PR is a draft and inspect reviews/checks
gh pr view PR_NUMBER --json number,url,isDraft,headRefOid,reviewDecision,reviews,statusCheckRollup

# Convert an existing draft PR to ready for review
gh pr ready

# Read conversation comments and general reviews
gh pr view PR_NUMBER --comments

# Read ALL inline code-review comments
gh api "repos/{owner}/{repo}/pulls/PR_NUMBER/comments" --paginate

# Read ALL review threads and their resolution state (one JSON object per thread)
gh api graphql --paginate -F owner='{owner}' -F repo='{repo}' -F number=PR_NUMBER \
  -f query='query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $endCursor) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 1) { nodes { id databaseId } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'

# Resolve a review thread only after the fix is pushed to the PR branch
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
  }' -F threadId=THREAD_ID

# Read submitted reviews
gh api "repos/{owner}/{repo}/pulls/PR_NUMBER/reviews" --paginate

# Read general PR conversation comments
gh api "repos/{owner}/{repo}/issues/PR_NUMBER/comments" --paginate

# Inspect CI status
gh pr checks PR_NUMBER
```

- Keep `--paginate` on every `gh api` call. One page is not "all feedback" (section 3).
- `gh pr checks` and `headRefOid` describe the current head. Re-check them after every corrective
  push, and compare approvals against that SHA (section 5).
- `isDraft` must be `false` before review is requested (section 1). `gh pr ready` targets the PR for
  the branch you are on; pass the PR number explicitly when you are elsewhere.
- Inspect every thread returned above: `isResolved: false` identifies an unresolved thread.
  Verify all required threads are resolved before passing the merge gate (section 6).
- An empty `reviews` or comment list is a result to report, not proof that reviewers accepted the
  request. Confirm the review was actually submitted (section 2).

<!-- /coderabbit-ai-generated:v1 --><!-- END pr-review-policy -->

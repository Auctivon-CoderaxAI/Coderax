# Coderax Capability Registry

**Version:** 1.2  
**Baseline:** main at `2cdce45c`, full re-read 25 November 2026; v1.0 reviewed `ea16749`.  
**Purpose:** Track evidence-backed status and prevent roadmap descriptions from becoming shipped-feature claims.

## Status meanings

- **Evidenced:** Current README, route, source or documentation names it. Not end-to-end certification.
- **Partial:** Some support is visible, while the scope in the product vision is larger.
- **Planned:** Requested by the vision; no implementation evidence was found in this bounded audit.
- **Unverified:** Not inspected enough to determine status.
- **Blocked:** A known prerequisite prevents safe operation; record the exact blocker and owner.

Every row below was re-read at `2cdce45c` against `packages/api/src/`, `api/server/routes/`, `client/src/` and `scripts/`. A row is no longer `Unverified`: where inspection found a real but narrower implementation the status is `Partial`, and where it found nothing the status is `Planned` with the search that established it. “Planned” is a statement about this SHA, not a permanent one. Before changing a status, add an exact source path, revision, test or live evidence.

| ID | Capability | Status | Evidence / limitation | Next proof | Priority |
| --- | --- | --- | --- | --- | --- |
| CX-01 | Conversation | Evidenced | README and ChatRoute name multimodal chat, search, export and branching | Verify live flows and route preservation | P0 |
| CX-02 | Native agent | Partial | Agents, APIs, skills and tools are documented; native independence is not certified | Trace runtime selection, policy and isolation | P0 |
| CX-03 | Work engine | Partial | Work engine (`packages/api/src/work/`), routes and a Work home listing, starting and cancelling tasks (`client/src/routes/NativeWorkHome.tsx`); production lifecycle is not certified | Run one Work task end to end and retain stream, cancellation and reload evidence | P0 |
| CX-04 | Model Intelligence Lab | Partial | Zero-cost routing catalog, quota ledger, health/cooldown and probes (`packages/api/src/routing/`, `packages/data-provider/src/free-inference.ts`); no evaluation datasets, model-vs-model runs or lab UI | Run one reproducible evaluation at a recorded SHA and retain the result | P2 |
| CX-05 | AI Council | Planned | No council workflow confirmed in bounded audit | Verify coordination and independent evidence contract | P5 |
| CX-06 | Digital workforce | Partial | Agents, skills, MCP and subagents documented; full team lifecycle unverified | Audit scopes, workload and metrics | P2 |
| CX-07 | Memory Graph | Partial | Memory service with authorization, protection and handlers (`packages/api/src/memory/`); no provenance graph, duplicate consolidation or graph UI | Verify project boundaries and correction/deletion with a negative test | P5 |
| CX-08 | Time Machine / Undo | Planned | No cross-artifact restoration system confirmed | Define state coverage and restore contracts | P5 |
| CX-09 | Project Center | Partial | Project/workspace concepts exist; dedicated hub not verified | Audit project entity, list and contextual workspace | P1 |
| CX-10 | Engineering environment | Partial | Code execution/workspaces are documented | Verify indexing, impact and multi-repository workflows | P2 |
| CX-11 | Cloud IDE | Partial | Attached code workspaces are experimental; cloud guarantees unverified | Verify runtime, terminal, preview and cost | P2 |
| CX-12 | GitHub integration | Partial | Read-only pull-request and check-run observer (`packages/api/src/pulls/`); OAuth sign-in requests `user:email` and `read:user` only (`api/server/routes/oauth.js`), which is not repository access (see `docs/ROADMAP.md` GH-01) | Authorize a least-privilege GitHub App flow, then verify identity read-back and scopes | P2 |
| CX-13 | Native code review | Planned | No native review workflow confirmed | Define exact-head finding and independent review contract | P2 |
| CX-14 | Reliability engineering | Partial | Telemetry, Langfuse and trace surfaces exist (`packages/api/src/telemetry.ts`, `traces/`, `langfuse/`, `insights/`); no incident investigation, reproduction or self-repair loop | Demonstrate one reproduced failure repaired through the review gate | P3 |
| CX-15 | Testing Lab | Partial | Jest suites, the `e2e/` harness and `scripts/verify.mjs` exist; no project test lab UI, cloud runners or coverage history | Run one suite in a verified cloud runner and retain the report | P2 |
| CX-16 | Backend Factory | Planned | `autobuild` compiles plans, roles and gates, but no database schema, API, auth or migration generator exists | Generate one schema-to-API slice with tests in a verified workspace | P3 |
| CX-17 | Design templates | Partial | Studio ships four deterministic scaffolds — landing, dashboard, store, booking (`client/src/lib/studio/templates.ts`); the 50-template library is a design target only | Land the template schema and the first ten genuinely distinct templates | P3 |
| CX-18 | Visual Editor / Application DNA | Partial | [Visual App Studio](../visual-app-studio.md) explicitly lists MVP limitations | Inspect live UI and cloud rendering boundary | P3 |
| CX-19 | Mobile/desktop distribution | Partial | Windows desktop artifact documented; iOS/Android unverified | Verify platform projects, signing and owner controls | P4 |
| CX-20 | Coderax Flow | Partial | Workflow engine and durable flow state (`packages/api/src/workflows/`, `flow/manager.ts`) plus a `/workflows` view; visual node editor, triggers and replay are unverified | Verify one scheduled and one event-triggered run end to end | P3 |
| CX-21 | Skills/integrations marketplace | Partial | Skills, MCP and agent marketplace documented | Verify provenance, permission diff and isolation | P2 |
| CX-22 | Cloud Computer | Partial | Backend browser automation (`packages/api/src/web/agent.ts`); no cloud session surface, takeover control or recording | Verify an isolated cloud session with takeover and stop | P4 |
| CX-23 | Deep Research | Partial | Web search documented; source-led research workflow not verified | Verify citations and research plan lifecycle | P3 |
| CX-24 | Notebook/Knowledge | Planned | No notebook, source-grounded answer surface or knowledge library was found at this SHA | Define the source and citation model before any UI | P3 |
| CX-25 | Office suite | Planned | Only code and Mermaid artifacts with downloads exist (`client/src/components/Artifacts/`); no document, spreadsheet or slide editor | Ship one editable artifact type with export and version history | P4 |
| CX-26 | Learning Academy | Planned | No learning workspace, progress model or exercise engine was found at this SHA | Define progress and assessment contracts first | P4 |
| CX-27 | Interactive artifacts | Evidenced | README describes code artifacts and Mermaid export | Verify sandbox, versioning and project conversion | P3 |
| CX-28 | Voice/vision | Partial | Speech and multimodal files documented; live screen/voice not audited | Verify permissions, consent, transcript and shutdown | P4 |
| CX-29 | Asset Factory | Partial | Image generation sessions with authorization (`packages/api/src/images/`); no asset library, licence metadata or provenance UI | Record source, licence and version for one generated asset | P4 |
| CX-30 | Movie Studio | Planned | No screenplay, storyboard, shot generation or assembly pipeline was found at this SHA | Remains blocked until verified video generation capacity exists | P4 |
| CX-31 | Avatar Lab | Planned | Only agent avatar image storage exists (`packages/api/src/agents/avatars.ts`); no synthetic human, voice, animation or consent pipeline | Define consent and provenance records before any synthesis work | P4 |
| CX-32 | Game Studio | Partial | Owner-gated project lifecycle and editable design brief at `/games`, `/games/new`, `/games/templates`, `/games/:gameId` — `client/src/components/Games/`, `packages/api/src/games/`, `api/server/routes/games.js`; build, playtest and agent tabs render unavailable because no verified cloud executor exists | Queue one real build in a verified cloud executor and retain the artifact at a recorded SHA | P4 |
| CX-33 | Gaming Agent | Blocked | The workspace's agent tab exists only as an honest unavailable state; no game-input environment or session adapter | Verify a permitted environment, bounded input control, takeover and stop before claiming a session | P4 |
| CX-34 | Invention Lab | Planned | No CAD, simulation, bill-of-materials or experiment workspace was found at this SHA | Separate theory, simulation and measured results in the data model | P4 |
| CX-35 | Business/Career | Planned | No venture, career or application workflow was found at this SHA | Define per-submission authorization and receipts | P4 |
| CX-36 | Operations/Observability | Partial | OpenTelemetry, Langfuse, traces and Insights named | Verify live coverage, masking and actions | P2 |
| CX-37 | Security/Privacy | Partial | Auth, permissions and admin surfaces exist; owner-only boundary unresolved | Verify deployment audience, isolation and scopes | P0 |
| CX-38 | Cloud Resource Governor | Blocked | $0/cloud requirement exists; verified capacity contract absent from audit | Verify free quota, admission, cleanup and stop | P0 |
| CX-39 | Original differentiators | Planned | Workflow host receipts and autobuild verification exist (`packages/api/src/workflows/host.ts`, `autobuild/`), but none of the eighteen named services is implemented as a service | Specify the Evidence Engine receipt schema first | P5 |
| CX-40 | Competitive intelligence | Planned | `docs/ROADMAP.md` is a hand-maintained ledger; no automated competitive scan or deduplicated intake exists | Establish a primary-source scan and deduplication process | P5 |
| CX-41 | Cloudflare canonical edge | Blocked | Worker host gate, client-IP forwarding and fail-closed proxy are tested (17/17); anonymous access gate passes 8/8 and the full `npm run verify` gate passes. Live API is still `503` until the owner sets `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET`; the Oracle public host is not recorded in the repository. The PR #302 verifier and the PR #303 release gate are merged. | Owner sets the two Worker bindings and the VM canonical origin, then runs an authenticated journey on `https://coderax.nnabdelshahid.workers.dev`. | P0 |

CX-41 was added on 2026-11-25 against `main` at `7c9147e7460d6b2e987b7294da49c6a4c20293cd`. Its `Blocked` status covers the
infrastructure/credential boundary, not source completeness; the verifier and release gate landed in PR #302 and PR #303. The Worker and access
tests are recorded in the evidence section of [`docs/ROADMAP.md`](../ROADMAP.md).

## Evidence rules

- A README bullet proves advertising, not production behavior.
- A local test proves only the code and behavior it covers.
- Preview, commit, push, PR, approval, merge and deployment are separate states.
- A status change records exact SHA, path/test, environment, date and observed outcome.
- Blocked requires a specific prerequisite or failed gate plus owner and next action.
- Revisit this registry when a relevant PR lands, documentation changes or a competitive scan discovers a material capability.

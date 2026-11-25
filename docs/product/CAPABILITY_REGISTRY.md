# Coderax Capability Registry

**Version:** 1.0  
**Baseline:** main at ea167498e639fddffa14d0dd2770bc77f5721d32, reviewed 24 November 2026.  
**Purpose:** Track evidence-backed status and prevent roadmap descriptions from becoming shipped-feature claims.

## Status meanings

- **Evidenced:** Current README, route, source or documentation names it. Not end-to-end certification.
- **Partial:** Some support is visible, while the scope in the product vision is larger.
- **Planned:** Requested by the vision; no implementation evidence was found in this bounded audit.
- **Unverified:** Not inspected enough to determine status.
- **Blocked:** A known prerequisite prevents safe operation; record the exact blocker and owner.

The bounded audit covered the root README, AGENTS.md, route inventory, App shell, shared theme documentation and Visual App Studio documentation. “Planned” or “Unverified” does not prove absence from all code. Before changing status, add an exact source path, revision, test or live evidence.

| ID | Capability | Status | Evidence / limitation | Next proof | Priority |
| --- | --- | --- | --- | --- | --- |
| CX-01 | Conversation | Evidenced | README and ChatRoute name multimodal chat, search, export and branching | Verify live flows and route preservation | P0 |
| CX-02 | Native agent | Partial | Agents, APIs, skills and tools are documented; native independence is not certified | Trace runtime selection, policy and isolation | P0 |
| CX-03 | Work engine | Partial | Work is documented; production lifecycle is not certified in README | Exact-head tests and deployed evidence | P0 |
| CX-04 | Model Intelligence Lab | Unverified | Provider/model selection exists; account entitlement and $0 evaluation UX not audited | Verify quota, entitlement and evaluation authorization | P2 |
| CX-05 | AI Council | Planned | No council workflow confirmed in bounded audit | Verify coordination and independent evidence contract | P5 |
| CX-06 | Digital workforce | Partial | Agents, skills, MCP and subagents documented; full team lifecycle unverified | Audit scopes, workload and metrics | P2 |
| CX-07 | Memory Graph | Unverified | Context/settings exist; project-scoped provenance graph not audited | Inspect storage, isolation, correction and deletion | P5 |
| CX-08 | Time Machine / Undo | Planned | No cross-artifact restoration system confirmed | Define state coverage and restore contracts | P5 |
| CX-09 | Project Center | Partial | Project/workspace concepts exist; dedicated hub not verified | Audit project entity, list and contextual workspace | P1 |
| CX-10 | Engineering environment | Partial | Code execution/workspaces are documented | Verify indexing, impact and multi-repository workflows | P2 |
| CX-11 | Cloud IDE | Partial | Attached code workspaces are experimental; cloud guarantees unverified | Verify runtime, terminal, preview and cost | P2 |
| CX-12 | GitHub integration | Unverified | Repository-management UX not established in bounded audit | Verify auth, identity, PR/check and branch policy | P2 |
| CX-13 | Native code review | Planned | No native review workflow confirmed | Define exact-head finding and independent review contract | P2 |
| CX-14 | Reliability engineering | Unverified | Observability exists; autonomous recovery flow not audited | Verify telemetry, action scopes and recovery | P3 |
| CX-15 | Testing Lab | Partial | Code interpreter/tests exist; project test lab not confirmed | Verify cloud runners and skipped-check evidence | P2 |
| CX-16 | Backend Factory | Unverified | End-to-end app backend generator not verified | Audit schema/API generation, auth and cost | P3 |
| CX-17 | Design templates | Unverified | Extensible design catalog not verified | Inventory templates, source and licensing | P3 |
| CX-18 | Visual Editor / Application DNA | Partial | [Visual App Studio](../visual-app-studio.md) explicitly lists MVP limitations | Inspect live UI and cloud rendering boundary | P3 |
| CX-19 | Mobile/desktop distribution | Partial | Windows desktop artifact documented; iOS/Android unverified | Verify platform projects, signing and owner controls | P4 |
| CX-20 | Coderax Flow | Unverified | Workflow automation UX/service not confirmed | Verify triggers, history, retries and credentials | P3 |
| CX-21 | Skills/integrations marketplace | Partial | Skills, MCP and agent marketplace documented | Verify provenance, permission diff and isolation | P2 |
| CX-22 | Cloud Computer | Unverified | Remote computer contract not verified | Verify cloud session, takeover, redaction and stop | P4 |
| CX-23 | Deep Research | Partial | Web search documented; source-led research workflow not verified | Verify citations and research plan lifecycle | P3 |
| CX-24 | Notebook/Knowledge | Unverified | Complete project-scoped library not verified | Audit sources, retrieval isolation and provenance | P3 |
| CX-25 | Office suite | Unverified | Integrated editable suite not verified | Inventory editors, versioning and exports | P4 |
| CX-26 | Learning Academy | Unverified | Learning workspace not verified | Verify plans, progress and accessible exercises | P4 |
| CX-27 | Interactive artifacts | Evidenced | README describes code artifacts and Mermaid export | Verify sandbox, versioning and project conversion | P3 |
| CX-28 | Voice/vision | Partial | Speech and multimodal files documented; live screen/voice not audited | Verify permissions, consent, transcript and shutdown | P4 |
| CX-29 | Asset Factory | Partial | Image generation/edit documented; provenance/licensing library not verified | Verify model cost, rights metadata and versioning | P4 |
| CX-30 | Movie Studio | Unverified | End-to-end production workflow not verified | Identify actual generation/rendering scope and cost | P4 |
| CX-31 | Avatar Lab | Unverified | Consent/provenance pipeline not verified | Audit identity, consent, disclosure and render path | P4 |
| CX-32 | Game Studio | Unverified | No Game Studio contract found on reviewed main baseline | Inspect active branch/PR, runtime and scope | P4 |
| CX-33 | Gaming Agent | Unverified | No permitted game adapter/session confirmed in main | Verify allowed environment, bounds and takeover | P4 |
| CX-34 | Invention Lab | Unverified | CAD/simulation/experiment workflow not verified | Separate theory, simulation and physical validation | P4 |
| CX-35 | Business/Career | Unverified | Complete evidence-led workspace not verified | Verify sources and submission authorization | P4 |
| CX-36 | Operations/Observability | Partial | OpenTelemetry, Langfuse, traces and Insights named | Verify live coverage, masking and actions | P2 |
| CX-37 | Security/Privacy | Partial | Auth, permissions and admin surfaces exist; owner-only boundary unresolved | Verify deployment audience, isolation and scopes | P0 |
| CX-38 | Cloud Resource Governor | Blocked | $0/cloud requirement exists; verified capacity contract absent from audit | Verify free quota, admission, cleanup and stop | P0 |
| CX-39 | Original differentiators | Unverified | Vision names 18 services; service-backed status not audited | Map each to source, receipt, owner and criteria | P5 |
| CX-40 | Competitive intelligence | Planned | Permanent source-to-registry workflow not verified | Establish primary-source scan and deduplication process | P5 |
| CX-41 | Cloudflare canonical edge | Blocked | Worker host gate, client-IP forwarding and fail-closed proxy are tested (17/17); owner-only access gate passes 8/8 and the full `npm run verify` gate passes. Live API is still `503` until the owner sets `CODERAX_API_ORIGIN` and `CODERAX_PROXY_SECRET`; the Oracle public host is not recorded in the repository. `--live-url` still rejects the canonical origin until PR #302 merges, and full release verification also needs PR #303. | Owner sets the two Worker bindings and the VM canonical origin, merges PR #302 and #303, then runs an authenticated journey on `https://coderax.nnabdelshahid.workers.dev`. | P0 |

CX-41 was added on 2026-11-25 against `main` at `7c9147e7460d6b2e987b7294da49c6a4c20293cd`. Its `Blocked` status covers the
infrastructure/credential boundary and the unmerged verifier and release-gate changes in PR #302 and #303, not source
completeness; the Worker and access tests are recorded in the evidence section of [`docs/ROADMAP.md`](../ROADMAP.md).

## Evidence rules

- A README bullet proves advertising, not production behavior.
- A local test proves only the code and behavior it covers.
- Preview, commit, push, PR, approval, merge and deployment are separate states.
- A status change records exact SHA, path/test, environment, date and observed outcome.
- Blocked requires a specific prerequisite or failed gate plus owner and next action.
- Revisit this registry when a relevant PR lands, documentation changes or a competitive scan discovers a material capability.

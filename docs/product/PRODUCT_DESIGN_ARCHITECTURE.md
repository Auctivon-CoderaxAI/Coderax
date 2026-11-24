# Coderax Product Design Architecture

**Version:** 1.0  
**Audience:** FreeBuff design and frontend contributors; Coderax Full Engineering  
**Status:** Design architecture and implementation brief. This does not claim that planned modules are implemented.  
**Baseline reviewed:** Coderax main at ea167498e639fddffa14d0dd2770bc77f5721d32, 24 November 2026. This was a source-level review, not a live visual inspection or full source audit.

## 1. Product direction and boundaries

Coderax is intended as one private, owner-controlled AI work environment spanning conversations, projects, software engineering, research, creative production, automation, learning and operations. The interface must make those capabilities feel connected while keeping every project, agent, provider, tool and workload inside an explicit permission boundary.

This is an architecture target, not a feature-completion claim. The repository already includes substantial chat, agent, tool, artifact, search, settings, workspace and observability surfaces. It does not follow that every capability in this product vision is present or production-ready. See [CAPABILITY_REGISTRY.md](CAPABILITY_REGISTRY.md) for the evidence level and next verification step for each module.

### Non-negotiable product rules

1. **Owner control:** The intended product is private and owner-only. Do not design public workspaces, memberships, tenant onboarding, public sharing or commercial subscription flows. The current repository is public and describes a multi-user, self-hostable platform; this gap must be addressed at deployment and authorization boundaries, not by visual treatment.
2. **No added spend:** Every model, integration and workload must show its verified cost boundary before it starts. If a $0 entitlement, quota or capacity cannot be verified, show Blocked and keep execution disabled.
3. **Cloud execution:** The browser is the control and presentation surface. Builds, tests, databases, inference, rendering, agents, simulations and game sessions must use an authorized, verified cloud environment. Never label browser-local state or execution as cloud compute.
4. **Native agent first:** Coderax Native is the default. External agents must be explicitly selected, named, scoped and isolated; never silently route the native agent to a third-party runtime.
5. **One conversation shell:** Chat and Work stay in the same conversation interface and URL. Work adds planning, execution and evidence to current context; it does not create a second history or force a route switch.
6. **Honest status:** Every destination and control reports Available, Experimental, Planned, Unavailable or Blocked based on evidence. Planned and simulated content is never presented as a live service.
7. **Preserve the product:** Add capabilities within the current Coderax identity, themes, shared components and workflows. Do not replace the shell, palette or interaction model without explicit owner direction.

## 2. Existing interface and audit limits

The reviewed main baseline has:

- Routes for Chat, Work, Studio, Marketplace, Search, settings and authentication.
- A root README describing model selection, agents, MCP, skills, subagents, code execution, artifacts, search, multimodal files, speech, themes, conversation export and observability.
- A Visual App Studio document that calls Studio a deterministic MVP and explicitly says model-backed generation, arbitrary multi-file React apps, GitHub export, remote persistence, isolated build services, collaboration and deployment are not built.
- A versioned shared theme system with semantic roles, light/dark support, typography, shape, density, elevation and motion settings.

The audit did not inspect every route, API, permission check, environment or live deployment. Unverified does not mean absent. Before visual execution, FreeBuff must inspect the live product in an owner-authorized environment and map the actual desktop, tablet and phone shell, themes, settings and current workflows. Use existing components rather than inventing replacements. This document does not authorize a redesign or frontend code changes.

## 3. Information architecture

Keep global navigation short. The owner sees stable destinations; a project workspace exposes only tools relevant to that project type.

| Global destination | Contents | Primary job |
| --- | --- | --- |
| Chat / Work | Conversations, task plans, running sessions, results | Ask, plan, execute and verify in one continuing context |
| Projects | All, recent and pinned projects; creation and project health | Organize work and enter a project workspace |
| Build | Engineering, cloud IDE, app/backend, game, movie and invention studios | Create and improve products and artifacts |
| Research & Knowledge | Deep Research, Notebook, library, sources and learning | Gather, organize and reuse evidence |
| Create | Design templates, visual editor, office artifacts, generated assets and media | Produce editable deliverables |
| Automate | Coderax Flow, skills, integrations and scheduled work | Design and operate approved workflows |
| Operations | Agents, models, AI Council, cloud capacity, security and observability | Inspect capability, authorization, cost and health |
| Settings | Account, appearance, privacy, integrations, data and accessibility | Configure the product |

Do not list forty future features at the top level. Use a permission-aware project launcher, command palette and global search to open modules. Unavailable modules belong in a clearly marked roadmap or blocked view, never as normal working pages with dead buttons.

### Project workspace

A project opens into one consistent shell with title, type, goal, status, owner scope, last verified activity and contextual actions. Tabs are capability-driven:

- **Overview:** objective, status, next action, milestone and blockers.
- **Plan:** requirements, acceptance criteria, dependencies and task graph.
- **Work:** agent sessions, jobs, checkpoints, results and handoff.
- **Files:** source and generated artifacts with provenance.
- **Design:** references, templates, components and previews where supported.
- **Data:** schemas, datasets, notebooks or project knowledge when relevant.
- **Runs:** tests, simulations, builds, deployments and execution receipts.
- **History:** diffs, checkpoints, decisions and eligible restore actions.
- **Access:** owner, agent, integration and cloud-resource scopes.

Hide irrelevant tabs. A missing backend capability gets a planned/blocked state and dependency explanation, not a fake control.

## 4. Navigation and project creation

### Navigation behavior

- Keep conversation identity in the URL. Chat/Work mode changes view state, not path, query, hash or stored history.
- Preserve drafts, attachments, scroll position and selected project when opening contextual panels.
- Desktop uses the existing collapsible navigation pattern; the main workspace owns the canvas and an inspector opens only when useful.
- Tablet collapses navigation to a drawer or rail. Mobile uses one content column, a compact top bar and accessible drawer/sheet navigation. Do not force side-by-side editing on narrow screens.
- Global search and command actions use the same permission-aware capability catalog.
- Virtualize long histories and lists; lazy-load previews; stop subscriptions and media capture when views close.

### Project creation flow

1. Choose **Create project** and start blank or select an honestly labeled template.
2. Capture name, goal, type, intended users, references, constraints and success criteria.
3. Resolve project type and show only real tools; label experimental/unavailable tools before use.
4. Set owner-only access, connected repositories/integrations, permitted actions, cloud environment and verified $0 basis. If cost or authorization cannot be verified, save a plan but block execution.
5. Review and edit requirements, acceptance criteria and dependencies. A generated task list is not authorization.
6. Create the workspace with a useful empty state. Do not seed fake metrics, execution receipts or live resources.
7. Show plan, selected Native agent, model identity, scopes, cloud target, capacity and cancellation controls before starting.
8. Show artifacts, evidence, gaps and accurate status. Offer export/review only where implemented.

## 5. Reusable component inventory

Compose current @coderax/client primitives and semantic theme tokens first. These are product compositions, not a mandate to duplicate shared primitives.

| Component | Responsibility and contract |
| --- | --- |
| ProductShell | Navigation, project context, canvas and announcements; preserves route/context; responsive drawer and keyboard landmarks |
| CapabilityLauncher | Searchable modules/actions; permission and status aware; keyboard navigable |
| ProjectCard / ProjectHeader | Identity, goal, type, status and next step; never imply execution from a prompt |
| CapabilityStatus | Available, Experimental, Planned, Unavailable or Blocked; text plus icon, never color alone |
| PermissionSummary | Agent/integration/repository/cloud scopes, action classes, expiry, quota and revoke path |
| CostAndCapacityGate | Verified $0 basis, quota, expiry and fail-closed blocked state |
| WorkPlan | Tasks, dependencies and approval; review/edit/reject/authorize remain distinct |
| RunTimeline | Ordered phases, tools, retries and checkpoints; cancellable, resumable and redacted |
| EvidenceReceipt | Actual tests, artifacts, sources, reviewed commit and deployed SHA when those events happened |
| ArtifactWorkbench | Preview, source, version, export and project linkage; isolated trust boundary |
| ReviewDiff | Exact-revision changes, findings, severity and feedback; keyboard accessible |
| EmptyBlockedErrorState | Useful next step that distinguishes empty, unavailable, blocked and failed |
| SourceCitation | Source, date and claim linkage; no fabricated citation |
| AuditEventRow | Actor, action, scope, time and outcome; redacted with accessible details |
| UsageMeter | Measured model/provider/workload usage; does not call an estimate “free” |

## 6. Visual and interaction system

Preserve Coderax identity and theme behavior. Do not invent palette values or global layout CSS. Use shared semantic color, typography, spacing, control, radius, elevation and motion roles. New reusable appearance belongs in the shared primitive or versioned theme-token system, with existing defaults unchanged. Support light/dark, high contrast, text scaling and reduced motion.

Use a calm, high-information hierarchy: clear title, one primary action, contextual secondary actions, permission and status next to the action they govern, details in expandable panels. The amount of interface grows with the owner's task, not with the roadmap.

Long-running work shows state, phase, elapsed time, environment, cancel and supported pause/takeover. Retry says what repeats and which inputs/version it uses. Destructive/external actions show the target and confirmation. Restore previews affected data and protects later changes. Safe localized error codes replace raw provider errors. External agents/integrations are labeled at selection and during execution.

Target WCAG 2.2 AA: semantic landmarks/headings, visible focus, keyboard operation, screen-reader labels and status announcements, adequate contrast, zoom, reduced motion, accessible tables/diffs, captions/transcripts. Keep focus stable when opening panels or switching modes. Narrow screens must not require horizontal scrolling for primary actions.

## 7. Module design contracts

All modules inherit shared loading, empty, success, failure, unavailable and blocked states. Each line defines the purpose/journey, views, inputs/actions, boundary, responsive/accessibility behavior and relationships.

| ID | Module | Purpose, views, inputs and actions | Permission, states, accessibility and relationships |
| --- | --- | --- | --- |
| CX-01 | Conversational intelligence | Multimodal thread, branch, search and attachment preview; text/files/media; edit, regenerate, branch, export and save artifacts | Project scope governs retrieval and tools; streaming/reconnect/interrupted states; accessible transcript/composer; links Work, Projects, Research and Artifacts |
| CX-02 | Coderax Native agent | Default agent identity, model/task header, agent detail; choose project/tools/skills; inspect, switch or revoke | Native policy owns its permissions; external choices are explicit, labeled and isolated; links Work, Workforce, Security and Model Lab |
| CX-03 | Autonomous Work engine | Plan, timeline, checkpoints, artifacts and receipts; objective, criteria, dependencies, authorized destination; pause/resume/cancel/retry | Server scopes, expiry, quota and $0/cloud gates; blocked work queues or stops; accessible live status; links every execution module |
| CX-04 | Model Intelligence Lab | Catalog, comparison, evaluations, quotas and regressions; task profile and evaluation suite | No inference/benchmark without verified zero-cost scope; distinguish provider catalog from account access; accessible tables/charts; links Work and Resource Governor |
| CX-05 | AI Council | Independent perspectives, evidence, disagreement and decision; question, roles, sources and verification | Identify every agent/model; parallel work requires scope/capacity; accessible dissent; links Research, Workforce, Security and Work |
| CX-06 | Digital workforce | Agent directory, team, task board, workload and agent detail; roles, tasks, scopes, tools | Least privilege per agent; no default access to all project data; grid/list keyboard parity; links Native, Council, Skills and Work |
| CX-07 | Memory Graph | Project memory search, provenance, timeline and relationship view; correct, merge, exclude, export or delete | Project boundaries explicit; external agent receives none by default; list alternative for graph; links Notebook, Projects, Work and Time Machine |
| CX-08 | Time Machine / Undo | Timeline, checkpoint, diff and restore preview; select eligible state/component | Confirm impact and protect newer changes; show unavailable restore targets; keyboard diff; links Projects, IDE, Memory, Artifacts and Work |
| CX-09 | Project Center | Project list, filters, health, milestones, workspace and settings; create, rename, pin, archive, attach source | Owner-only, no public-share controls; search isolation; virtualized list/mobile cards; launches project modules |
| CX-10 | Engineering environment | Repo map, semantic search, symbols, dependency, impact, API and migration views; repo/issue/refactor goals | Verify repository and write scope; isolated diffs; graph text summaries; links IDE, GitHub, Review and Testing |
| CX-11 | Cloud IDE | Remote editor, file tree, terminal, debug, diff, service preview; authorized repo/command/test | Remote execution only; show environment/network/filesystem; no verified runtime means terminal disabled; links GitHub, Work, Testing |
| CX-12 | GitHub integration | Repo, issue, branch, PR, check and release views; create authorized issue/branch/PR/comment | Verify repo identity; honor PR-only/main-promotion policy; separate commit/push/PR/merge/deploy states; links Engineering, Review, Operations |
| CX-13 | Native code review | Exact-revision summary, inline findings, severity and proposed patch | Independent reviewer where possible; findings cite evidence and SHA; supplements required reviews; links GitHub, Security and Testing |
| CX-14 | Reliability engineering | Incident, alert, regression and recovery plan; service and telemetry window | Evidence-backed suggestions; restart/rollback needs action scope; textual event timeline; links Observability, Security and Work |
| CX-15 | Testing Lab | Test plan, environment matrix, queue, log, artifact and results; requirement/command/device | Cloud runner only; skipped/unverified distinguished from passed; accessible filters/logs; links Engineering, IDE, Game and Deployment |
| CX-16 | Backend Factory | Data model, API contract, auth, schema and service preview; entities, validation and integrations | DB/network/secrets/compute scoped; unknown cost blocks; diagram plus text view; links Projects, Engineering, Testing and Security |
| CX-17 | Design templates | Searchable catalog with preview, inputs, requirements and provenance | Show supported/experimental/unavailable engine and license; keyboard filters; links Visual Editor, Projects, Assets and Create |
| CX-18 | Visual editor / Application DNA | Canvas, component tree, inspector, source/diff, versions and app profile; prompt/template/reference/breakpoint | Isolated preview; browser-local rendering is not labeled cloud; honor current Studio MVP limits; non-drag controls; links Design, Engineering and History |
| CX-19 | Mobile/desktop distribution | Target platform, build, package, signing and release checklist | No visible signing secrets; publish blocked without account/cost authorization; device previews have text equivalents; links Testing, IDE and Projects |
| CX-20 | Coderax Flow | Workflow canvas, trigger/node catalog, run history and version diff; trigger/data/conditions/retry/destination | Draft/test/active distinct; activation shows effects/rollback; credentials scoped/redacted; outline alternative; links Integrations, Work and Operations |
| CX-21 | Skills/integrations marketplace | Catalog, install review, permission manifest, updates, disable/remove | External content untrusted; installation cannot silently expand scope; accessible permission diff; links Agents, MCP and Security |
| CX-22 | Cloud Computer | Remote browser/desktop, objective, activity log and takeover; permitted URL/actions/stop conditions | Visible remote indicator, redaction and emergency stop; never use owner's PC as workload; mobile pause/takeover; links Work and Testing |
| CX-23 | Deep Research | Question, source set, source table, notes, report and citation audit; scope/date/source restrictions | Show source/date; unsupported claims marked; external search only by scope; keyboard source list; links Notebook, Business and Chat |
| CX-24 | Notebook/Knowledge Library | Notebooks, collections, source viewer, search, notes and project map | Project-only retrieval; retain source attribution; accessible file preview; links Memory, Research, Office and Projects |
| CX-25 | Office productivity | Editable document, spreadsheet, slide, PDF, diagram, board and export | Preserve originals and versions; email/calendar require scope; keyboard editor commands, mobile focused editing; links Projects, Notebook and Work |
| CX-26 | Learning Academy | Plan, lesson, exercise, progress, flashcards and practice; goal/level/topic/material | Progress isolated to learning project; no false credential claims; accessible text/audio alternatives; links Research and Notebook |
| CX-27 | Interactive Artifacts | Preview, source, edit, version, export and project link; spec/data/output | Sandboxed executable content; sharing off; label static/simulated/live; text alternative; links Chat, Studio and Office |
| CX-28 | Voice/Vision | Voice session, transcript, captions, language and selected visual context | Permission/consent/recording/retention visible; never background capture; keyboard transcript; links Chat and Cloud Computer |
| CX-29 | Asset Factory | Asset library, generation/edit history, provenance, license and export | Verify model cost and rights; record source and usage; accessible preview labels; links Design, Movie, Game and Avatar |
| CX-30 | Movie Studio | Script, scenes, storyboard, shot list, timeline and export state | Distinguish script/storyboard/video/final movie; cloud rendering only; keyboard scene navigation; links Assets, Avatar and Audio |
| CX-31 | Avatar Laboratory | Character appearance, voice, behavior, consent, preview and asset record | Consent/provenance/synthetic disclosure mandatory; prohibit deceptive impersonation; captions/reduced motion; links Assets, Movie and Voice |
| CX-32 | Game Studio | Brief, scene/level editor, assets, playable preview, test report and export | Original assets/code; verified remote runtime; label prototype and unsupported targets; accessible object tree; links Assets, Testing and Gaming Agent |
| CX-33 | Gaming Agent | Game/session objective, view, actions, progress, log and replay; bounded controls/retries | Honor game rules; pause/takeover/emergency stop; no anti-cheat bypass; mobile prioritizes stop; links Game Studio and Cloud Computer |
| CX-34 | Invention Lab | Problem, research, model/CAD/circuit/simulation, BOM and validation | Separate theory/simulation/prototype/physical proof; qualified review for risk; units and text descriptions; links Research, Assets and Testing |
| CX-35 | Business/Career | Market evidence, assumptions, plan, financial model, CRM and career workspace | No fabricated credentials or financial certainty; external submissions need authorization; accessible assumptions; links Research, Office and Projects |
| CX-36 | Operations/Observability | Health, logs, errors, traces, resource use, release and incident views | Mask personal data/secrets; production changes scoped; charts have tables; links Reliability, Security and Resource Governor |
| CX-37 | Security/Privacy | Access matrix, sessions, audit, vulnerability/license and data controls | Controls cannot be hidden or weakened to finish a task; sensitive mutation reviewed/logged; accessible filters; connects all modules |
| CX-38 | Cloud Resource Governor | Verified free capacity, active jobs, quotas, provider status, expiry and queue | Fail closed when cost/quota/scope uncertain; pause/queue/stop instead of paid or local; chart text summary; links Model Lab, Work and Studios |
| CX-39 | Original differentiators | Evidence Engine, Failure Memory, Agent Passport, Project Genome, Digital Twin, Instruction Compiler, Intent Preservation, Blocker Resolver, Archaeologist, Abandoned Project Recovery, Compatibility Engine, Conflict Detector, Autonomous Documentation, Requirement-to-Test, Capability Black Box, Portable Intelligence, Counterfactual Simulator and Self-Improvement Lab | Each is a real service with evidence and scope; no unreviewed production security/authorization self-modification; links Projects, Work, Security and Operations |
| CX-40 | Competitive Intelligence | Capability registry, dated source, gap, feasibility, priority and implementation history | Primary sources; deduplicate; roadmap ≠ shipped; searchable/ exportable; links Product Design, Engineering and Work |

## 8. Template system

Templates are starting points, not claims that a feature works. Each records ID/version, project type, supported engine, available capabilities, prerequisites, inputs, permission scope, cloud/cost requirements, accessibility baseline, acceptance criteria, source/license and outputs.

Required families: software/API, mobile/desktop, dashboards, research/notebooks, office, automations, design systems, games, movie production, avatars, learning, business, experiments and inventions. Every preview includes the status legend and sample-data label. Unsupported backends, payments, publishing, rendering and multiplayer are visibly disabled with a dependency explanation.

## 9. Competitive research translated into design

Official product documentation supports durable patterns, not copying another product's visual identity:

- ChatGPT Projects keep related chats, files and instructions together and support recurring work: [OpenAI Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt). Coderax should use project-scoped context while retaining owner-only access.
- GitHub Copilot describes agents that research repositories, plan and implement tasks, review PRs and leave approval to the owner: [Copilot overview](https://docs.github.com/en/copilot/get-started/about-github-copilot) and [Copilot code review](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/code-review). Coderax should surface plan, work and approval separately.
- Replit documents task boards and checkpoints/rollback for agent work: [task board](https://docs.replit.com/references/agent/task-board) and [version control](https://docs.replit.com/replit-workspace/workspace-features/version-control). Coderax should make task states and recoverable checkpoints inspectable without overstating its own restore capability.
- Figma documents isolated design branches, review, merge and version history: [Figma branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching). Coderax should keep design experiments separate from accepted project state.
- n8n exposes execution history and retries against current or original workflow versions: [n8n executions](https://docs.n8n.io/workflows/executions/all-executions/). Coderax Flow should show the version and inputs a retry uses.

This is a dated seed scan, not an exhaustive audit. Add products to the registry only after reviewing primary documentation or observed behavior and checking Coderax implementation evidence.

## 10. Prioritized implementation roadmap

### P0 — Safety and baseline
Verify owner-only deployment/API authorization; establish $0/cloud admission; resolve release branch rules and active PR ownership; visually inspect current shell; preserve Chat/Work route, drafts, history, theme and settings.

### P1 — Shared product foundation
Build project identity and source provenance; shared status/permission/cost/state/evidence components; Work plan/lifecycle/cancel/checkpoint/receipt; permission-filtered search, pins, recents and command palette.

### P2 — Engineering confidence
Verify repo identity and scopes; establish cloud IDE/runtime and preview contract; add independent review, testing and release evidence; back model UI with actual account entitlement and free-capacity proof.

### P3 — Create and automate
Add templates and visual editing only for implemented types; build workflow draft/test/history/retry; review skills/integrations permissions; version editable artifacts and exports.

### P4 — Specialized studios
Implement game, movie, assets, avatars, science/invention, learning and business slices behind verified cloud runtimes and narrow acceptance. Do not claim AAA, long-form video, physical validation or platform distribution from prototypes.

### P5 — Cross-cutting intelligence
Implement memory graph, universal restoration, AI Council, Failure Memory, Agent Passport, Digital Twin and competitive intelligence only with provenance, isolation, recovery, authorization and measurable evaluation.

## 11. FreeBuff handoff and completion

FreeBuff owns visual exploration and UI/UX. Deliver:
1. Annotated current-interface audit with desktop/tablet/phone states.
2. Information architecture and navigation map.
3. Reusable component inventory tied to current @coderax/client primitives.
4. Responsive screen specifications for CX-01 through CX-40, including all states.
5. Project creation journey, status vocabulary, permission/cost gates and artifact review flows.
6. Original visual variations that preserve Coderax identity, plus reusable templates.
7. Prioritized prototype plan with dependencies and honest blocked-capability states.
8. Handoff to Coderax Full Engineering listing ownership boundaries, interfaces and acceptance criteria.

Do not implement or merge frontend changes as part of this design handoff unless separately authorized. Do not change shell, access audience, security policy, model provider or deployment config. Avoid parallel UI branches until the current ownership lane and release target are confirmed.

This architecture is complete as a design brief only. Product completion requires functioning service-backed behavior, exact permission enforcement, verified $0/cloud execution, accessibility/responsive review, implementation tests, independent review and evidence recorded in the acceptance matrix.

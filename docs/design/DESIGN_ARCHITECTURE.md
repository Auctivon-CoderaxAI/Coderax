# Coderax Design Architecture

**Module, navigation and interface specification — v1.0**

|                   |                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document**      | Master design architecture for the Coderax application shell and every module in the product vision                                                                                                                                                  |
| **Status**        | Design specification. Not a claim of implementation.                                                                                                                                                                                                 |
| **Date**          | 24 November 2026                                                                                                                                                                                                                                     |
| **Author role**   | Visual design and UI/UX contributor (FreeBuff), per the product brief §3                                                                                                                                                                             |
| **Evidence base** | Repository `Auctivon-CoderaxAI/Coderax`, branch `freebuff/a1b038f05f3ba748796db084`, HEAD `ea16749`                                                                                                                                                  |
| **Scope**         | Information architecture, navigation, design system, interaction contracts, project creation, per-module specifications, capability registry schema, acceptance matrix, delivery plan                                                                |
| **Out of scope**  | Backend implementation, security policy ownership, deployment, production merges                                                                                                                                                                     |
| **Companions**    | `docs/product/PRODUCT_DESIGN_ARCHITECTURE.md` is the short product brief; this document is the detailed interface specification beneath it. `docs/product/CAPABILITY_REGISTRY.md` and `docs/product/ACCEPTANCE_MATRIX.md` remain the owner's records |

## 0. How to read this document

Every module carries one of six statuses. The words are load-bearing and must never be used loosely:

| Status           | Meaning                                                    | What the interface may show                                      |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| **Live**         | Implemented in this repository and reachable in production | Full controls                                                    |
| **Preview**      | Implemented, reachable, with known limits documented       | Full controls plus an availability note                          |
| **Experimental** | Implemented but default-off behind server configuration    | Entry hidden unless enabled; visible "Experimental" chip when on |
| **Planned**      | Designed here, not built                                   | Route reserved; honest empty state; no working controls          |
| **Blocked**      | Designed, but a named external prerequisite is missing     | Route reserved; blocker stated in plain language                 |
| **Retired**      | Superseded by another surface                              | Redirect, never a dead link                                      |

The repository already encodes this discipline twice, and this document extends it rather than replacing it:

- `packages/product-registry/index.js` states its own truthfulness rule — _"`status` may only describe functionality that exists and has been verified. Do not promote a product to 'live' from this file alone."_
- `docs/visual-app-studio.md` ships an explicit **"Not yet built"** section for `/studio`.

A design that cannot say "this does not work yet" is not usable for a private platform whose owner must trust what he sees. That is the single most important constraint in this document.

## 1. Audit: what the application actually is today

This section exists because a design architecture written without it would be fiction. Each row was verified by reading the file named.

### 1.1 Surfaces that exist

| Surface                                                       | Route                                                                 | Implementation                                                                 | Status                                                          | Evidence                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------- |
| Chat                                                          | `/c/:conversationId?`                                                 | `ChatRoute`                                                                    | **Live**                                                        | `client/src/routes/index.tsx`     |
| Work                                                          | `/work/:conversationId?`                                              | `WorkRoute` → `<ChatRoute workMode />`                                         | **Preview** — shares the chat shell; no separate run canvas yet | `client/src/routes/WorkRoute.tsx` |
| Message search                                                | `/search`                                                             | `Search`                                                                       | **Live** (config-gated)                                         | routes + `useSearchEnabled`       |
| Projects list                                                 | `/projects`                                                           | lazy `ProjectsView`                                                            | **Preview**                                                     | routes                            |
| Project workspace                                             | `/projects/:projectId`                                                | lazy `ProjectWorkspace`                                                        | **Preview**                                                     | routes                            |
| Studio                                                        | `/studio`                                                             | `Studio` + `lib/studio/templates`                                              | **Preview**, MVP with documented gaps                           | `docs/visual-app-studio.md`       |
| Workflows                                                     | `/workflows`                                                          | lazy `WorkflowsView`                                                           | **Preview**                                                     | routes                            |
| Skills                                                        | `/skills`, `/skills/new`, `/skills/:skillId`, `/skills/:skillId/edit` | lazy `SkillsView`                                                              | **Preview**                                                     | routes                            |
| Agent marketplace                                             | `/agents`, `/agents/:category`                                        | `MarketplaceRoute`                                                             | **Preview**                                                     | routes                            |
| Insights                                                      | `/insights`                                                           | lazy `Insights`                                                                | **Preview**                                                     | routes                            |
| Prompt library                                                | `/prompts/:promptId` (dialog-created)                                 | `InlinePromptsView`                                                            | **Live**                                                        | routes                            |
| Shared conversation                                           | `/share/:shareId`                                                     | `ShareRoute`                                                                   | **Live**                                                        | routes                            |
| CyVox add-on                                                  | `/cyvox/:tool`                                                        | `CyVoxAddon`                                                                   | **Preview**                                                     | routes                            |
| Legacy dashboard                                              | `/d/*`                                                                | redirects to `/c/new`                                                          | **Retired**                                                     | `routes/Dashboard.tsx`            |
| Marketing                                                     | `/welcome`                                                            | `LandingPage` outside the app shell                                            | **Live**                                                        | routes                            |
| Settings                                                      | dialog, not a route                                                   | `components/Nav/Settings`                                                      | **Live**                                                        | `routes/Root.tsx`                 |
| Scheduled chats                                               | side panel entry                                                      | server-opted-in, default off                                                   | **Experimental**                                                | `hooks/Nav/useSideNavLinks.ts`    |
| Agent builder                                                 | side panel                                                            | `AgentPanelSwitch`                                                             | **Live**                                                        | same                              |
| Memories, Bookmarks, Parameters, MCP builder, Prompts, Skills | side panel                                                            | accordion panels                                                               | **Live/Preview**                                                | same                              |
| Security Lab                                                  | in-app component + package + doc                                      | `components/SecurityLab`, `packages/security-lab-core`, `docs/security-lab.md` | **Preview**                                                     | packages list                     |

### 1.2 The shell, precisely

- `Root.tsx` renders `UnifiedSidebar` + a single flex content pane + `<Outlet />`. Mobile is a translated drawer with a scrim, swipe gestures, an optional 80% "strip" mode, reduced-motion snapping, and a `visibility: hidden` settled state.
- The rail is **52px** collapsed and **≥360px** expanded, capped at **40%** of viewport width, persisted at `side:width`; the transition is **300ms** `cubic-bezier(0.32, 0.72, 0, 1)`.
- The active side panel persists at `side:active-panel`; `DEFAULT_PANEL` is `conversations`.
- **The rail is deliberately not an app launcher.** `useUnifiedSidebarLinks.ts` says so in a comment: _"Keep the sidebar as a chat navigation surface, not a general app launcher."_ It exposes exactly one link — chat history.
- Modules are therefore discovered today by URL, the product switcher, or nothing at all. There is no unified module navigation. **This is the central IA gap this document closes.**

### 1.3 The design system, precisely

| Layer                       | What exists                                                                                                                                                                                                                                                                                                | Source of truth                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Colour                      | ~150 **semantic** tokens (`surface-*`, `text-*`, `border-*`, `status-*`, `series-*`, `file-*`) resolved from bare `R G B` triplets, rewritten at runtime                                                                                                                                                   | `packages/client/src/theme/tokens.css`, `defaults.css` |
| Radius, type scale, shadows | Theme-owned properties mapped through `@theme inline`, so themes reshape `rounded-*`, `text-*`, `shadow-*` with no call-site migration                                                                                                                                                                     | `tokens.css`                                           |
| Themes                      | `default`, `dark`, `highContrast`, `clickui`, `clickhouse`                                                                                                                                                                                                                                                 | `theme/themes/`                                        |
| Controls                    | Theme-owned heights, WCAG 2.5.8 **24px minimum target** (`theme-target`), tab/list minimums                                                                                                                                                                                                                | `packages/client/tailwind.preset.cjs`                  |
| Primitives                  | **115** shared components in `packages/client/src/components`, including `EmptyState`, `RetryableError`, `Progress`, `Skeleton`, `Pagination`, `DataTable`, `Badge`, `Chip`, `Breadcrumb`, `Tabs`, `Select`, `Dialog`, `AlertDialog`, `Toast`, `Tooltip`, `ThemeSelector`, `SegmentedMeter`, `SeriesLabel` | `packages/client`                                      |
| Menus                       | Ariakit `MenuButton` + `DropdownPopup` for action menus; Radix `DropdownMenu` is banned                                                                                                                                                                                                                    | `AGENTS.md`                                            |
| Motion                      | Existing keyframes; `prefers-reduced-motion` respected in drawer, scrim, transitions                                                                                                                                                                                                                       | `client/tailwind.config.cjs`, `Root.tsx`               |
| Copy                        | `useLocalize()`, **3,711** keys in English only                                                                                                                                                                                                                                                            | `client/src/locales/en/translation.json`               |
| State                       | Recoil → Jotai migration in progress; **new state must be Jotai**                                                                                                                                                                                                                                          | `AGENTS.md`                                            |
| Data                        | React Query; keys declared in `packages/data-provider/src/keys.ts`                                                                                                                                                                                                                                         | `AGENTS.md`                                            |

The token layer is unusually strong: it already supports per-theme control geometry, fill-versus-ring field focus, soft-versus-solid destructive buttons, and disabled-by-fill. **The design system does not need replacing. It needs a module-scale vocabulary built on top of it.**

### 1.4 Constraints the design must obey

1. **No rail explosion.** Forty module icons would violate the codebase's own stated intent and destroy the chat-first shell.
2. **One breakpoint convention exists** — `useMediaQuery('(max-width: 768px)')`. There is no three-column layout anywhere yet.
3. **Settings is a dialog.** Module-level settings need a route namespace or a deep-linkable dialog contract.
4. **`/work` is the chat route in another mode.** Persistent runs, approvals and evidence have no visual home yet.
5. **No capability registry exists** — a repository-wide search found none, despite the product brief requiring one. It must be created, and it needs a UI.
6. **Every string is localized.** A design that invents 400 strings without keys creates 400 blockers.
7. **Themes own appearance, not layout or behaviour.** New modules must not smuggle layout into theme definitions.

## 2. Design principles

These eight rules resolve most future disagreements without escalation.

1. **One shell, many canvases.** Chat and Work share an interface and a conversation identity. A module is a destination of the content canvas, never a second website.
2. **Never fake a control.** A disabled control states why. A planned module renders its plan, not a dead button. The status chip is part of the product, not decoration.
3. **Evidence before completion.** Any surface that reports done must be able to show the receipt — test output, commit SHA, preview URL, diff, or an explicit "unverified" label. `Evidence` is a first-class object in the UI, not a toast.
4. **Progressive disclosure over completeness.** Rail → workspace chip → command palette → canvas → inspector. Depth is earned by use, not preloaded.
5. **Budgeted everything.** Every module declares its cost: initial JS, idle requests, render surfaces, and the cap on simultaneously live previews.
6. **Authorization is visible at the point of action.** A permission is never a settings-page abstraction; it is a chip on the button that spends it.
7. **Reversible by default.** Anything that mutates project state offers a checkpoint first and a restore path after.
8. **Semantic tokens only.** No raw palette utilities, no hard-coded hex outside a theme definition, no feature-local CSS when a primitive or token already expresses the need.

### Anti-patterns, stated so reviews can cite them

| Anti-pattern                                        | Why it is rejected                                       |
| --------------------------------------------------- | -------------------------------------------------------- |
| A grid of 40 module icons in the rail               | Contradicts the chat-first shell; unscannable at 52px    |
| "Coming soon" buttons that do nothing               | Trains the owner to distrust every control               |
| A dashboard of zeros presented as telemetry         | Invents data; violates the truthfulness rule             |
| Auto-playing template previews                      | Unbounded CPU/RAM; violates the performance budget       |
| Per-module design languages                         | Fragments an identity the brief requires to be preserved |
| Deep linking to a dialog that loses state on reload | Settings must survive refresh and share                  |
| Silent agent switching                              | The brief forbids it outright                            |
| Tests reported as passing from mocks                | The brief forbids it; evidence engine must distinguish   |

## 3. Information architecture

### 3.1 Domain model

The interface is a projection of seven objects. Every screen is a view of one of them, and every navigation decision can be answered by asking which object the owner is looking at.

| Object        | Definition                                                                                              | Owns                                                             | Survives             |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| **Workspace** | The owner's single private tenancy                                                                      | Grants, quotas, agents, memory policy                            | Everything           |
| **Project**   | The unit of isolation and delivery — a website, film, game, investigation, automation, invention        | Files, artifacts, milestones, members, memory scope, checkpoints | Indefinitely         |
| **Session**   | A conversation. Either a _Chat_ session or a _Work_ session — same object, different mode               | Messages, attachments, model selection, branch tree              | Indefinitely         |
| **Run**       | One durable execution of a Work objective or a workflow                                                 | Plan, steps, checkpoints, approvals, cost, outputs               | Until purged         |
| **Artifact**  | A produced thing: file, document, design, image, build, dataset, report                                 | Version history, provenance, export formats                      | With the project     |
| **Evidence**  | A receipt proving something happened: test output, commit SHA, preview URL, diff, screenshot, signature | Immutable record, verifier identity                              | Immutable            |
| **Grant**     | A scoped authorization: category, destinations, quota, expiry                                           | Enforcement inputs                                               | Auditable, revocable |

Two rules follow, and they resolve most ambiguity:

1. **A session belongs to a project or to no project.** Project-less chat is legitimate and must stay frictionless. Promotion into a project is an explicit, undoable action.
2. **A Run without Evidence is `Unverified`, not `Complete`.** The UI has a state for this and uses it.

### 3.2 Navigation architecture: five zones, one shell

The application is one shell with five persistent or contextual zones. Modules occupy the **Canvas**; nothing else competes for that space.

```
┌──────┬──────────────────────────────────────────────┬──────────────┐
│      │  Workspace chip · breadcrumb · run status     │              │
│ Rail ├──────────────────────────────────────────────┤  Inspector   │
│      │                                              │              │
│ 52px │                 CANVAS                       │  320–420px   │
│  ⇅   │      (chat · work · module · editor)         │  contextual  │
│ 360px│                                              │              │
│      ├──────────────────────────────────────────────┤              │
│      │  Timeline dock: runs, evidence, checkpoints   │              │
└──────┴──────────────────────────────────────────────┴──────────────┘
                    ⌘K Command palette (overlay)
```

| Zone                | Purpose                                                                                | Persistence                                   | Collapse rule                              |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| **Rail**            | Chat history and conversations only — unchanged in intent                              | Persisted (`side:width`, `side:active-panel`) | 52px icon rail; 360px panel; ≤40% viewport |
| **Top bar**         | Workspace chip (module switcher), breadcrumb, run status pill, global actions          | Always                                        | Merges into canvas header below 768px      |
| **Canvas**          | The routed surface                                                                     | Route-driven                                  | Single column; full width                  |
| **Inspector**       | Contextual detail for the selected object: permissions, evidence, versions, properties | Persisted per module                          | Overlay sheet below 1280px                 |
| **Timeline dock**   | Chronology of runs, checkpoints and evidence for the current project                   | Collapsed by default                          | Hidden below 1280px; reachable as a sheet  |
| **Command palette** | Universal navigation, actions and search                                               | Overlay                                       | Always available via ⌘K / Ctrl-K           |

**Why the rail does not become a launcher.** The codebase deliberately keeps it chat-only. Forty icons at 52px are unscannable and would make the shell read as a launcher for a product that is, first, a conversation. Instead, modules are reached through three surfaces that scale to hundreds of entries without growing the chrome:

1. **Workspace chip** — a single top-left control naming the current module, opening a grouped module menu with search, recents and favourites.
2. **Command palette** — the primary power path: every module, object, action and setting is addressable by name.
3. **Deep links and recents** — every module has a stable URL; the chip remembers the last three per project.

The rail gains exactly one addition: when the canvas is not a conversation, a **Return to chat** affordance appears at the top of the rail, so the owner is never stranded in a module.

### 3.3 Route grammar

All routes follow one shape so deep links are predictable and middleware-free:

```
/{module}[/{object}][/{id}][/{view}]
```

- `view` is from a closed set: `overview`, `runs`, `files`, `evidence`, `settings`, `members`.
- Unknown `view` falls back to `overview` with a non-destructive notice, never a 404 wall.
- Object ids are opaque; nothing about type is inferred from the path beyond the module.
- **Every route state that matters is in the URL** — selected tab, open inspector object, filter set. A copied link reproduces the screen. This is the contract that makes settings dialogs acceptable.

### 3.4 Master module map

Routes marked _(existing)_ are already in `client/src/routes/index.tsx` and must not be renamed without a redirect.

#### Group A — Conversation and project core

| ID  | Module         | Route                                            | Status       | Wave |
| --- | -------------- | ------------------------------------------------ | ------------ | ---- |
| A1  | Chat           | `/c/:conversationId?` _(existing)_               | Live         | 1    |
| A2  | Work           | `/work/:conversationId?` _(existing)_            | Preview      | 1    |
| A3  | Search         | `/search` _(existing)_                           | Live         | 1    |
| A4  | Projects       | `/projects`, `/projects/:projectId` _(existing)_ | Preview      | 1    |
| A5  | Artifacts      | inspector + `/projects/:id/files`                | Preview      | 1    |
| A6  | Prompt library | `/prompts/:promptId` _(existing)_                | Live         | 1    |
| A7  | Bookmarks      | side panel                                       | Live         | 1    |
| A8  | Schedules      | side panel                                       | Experimental | 1    |
| A9  | Memory Graph   | `/memory`                                        | Planned      | 4    |
| A10 | Time Machine   | `/timemachine`                                   | Planned      | 2    |

#### Group B — Agents and models

| ID  | Module                 | Route                                       | Status  | Wave |
| --- | ---------------------- | ------------------------------------------- | ------- | ---- |
| B1  | Agent Builder          | side panel _(existing)_                     | Live    | 1    |
| B2  | Agent Marketplace      | `/agents`, `/agents/:category` _(existing)_ | Preview | 1    |
| B3  | Workforce              | `/workforce`, `/workforce/:teamId`          | Planned | 5    |
| B4  | AI Council             | `/council`, `/council/:sessionId`           | Planned | 5    |
| B5  | Model Intelligence Lab | `/models`, `/models/:modelId`               | Planned | 5    |
| B6  | Performance Passports  | `/passports`                                | Planned | 5    |
| B7  | Interop (MCP / A2A)    | `/interop`                                  | Preview | 5    |

#### Group C — Engineering

| ID  | Module                  | Route                                      | Status  | Wave |
| --- | ----------------------- | ------------------------------------------ | ------- | ---- |
| C1  | Cloud IDE               | `/ide`, `/ide/:workspaceId`                | Planned | 2    |
| C2  | Repository Intelligence | `/eng/repos`, `/eng/repos/:repoId/:view?`  | Planned | 2    |
| C3  | Code Review             | `/review`, `/review/:reviewId`             | Planned | 2    |
| C4  | Testing Lab             | `/tests`, `/tests/:suiteId`                | Planned | 2    |
| C5  | Reliability Center      | `/reliability`, `/reliability/:incidentId` | Planned | 2    |
| C6  | Backend Factory         | `/backend`, `/backend/:appId`              | Planned | 3    |
| C7  | Distribution            | `/distribute`, `/distribute/:projectId`    | Planned | 3    |
| C8  | Evidence Explorer       | `/evidence`, `/evidence/:receiptId`        | Planned | 2    |

#### Group D — Creation

| ID  | Module                  | Route                               | Status  | Wave |
| --- | ----------------------- | ----------------------------------- | ------- | ---- |
| D1  | Studio (umbrella)       | `/studio` _(existing)_              | Preview | 1    |
| D2  | Template Library        | `/studio/templates`                 | Planned | 3    |
| D3  | Visual Editor + App DNA | `/studio/editor/:projectId`         | Planned | 3    |
| D4  | Asset Factory           | `/studio/assets`                    | Planned | 3    |
| D5  | Movie Studio            | `/film`, `/film/:productionId`      | Planned | 6    |
| D6  | Avatar Lab              | `/avatars`, `/avatars/:characterId` | Blocked | 6    |
| D7  | Game Studio             | `/games`, `/games/:gameId`          | Planned | 6    |
| D8  | Gaming Agent            | `/games/agent/:sessionId`           | Blocked | 6    |

#### Group E — Knowledge and productivity

| ID  | Module               | Route                                  | Status  | Wave |
| --- | -------------------- | -------------------------------------- | ------- | ---- |
| E1  | Deep Research        | `/research`, `/research/:studyId`      | Planned | 4    |
| E2  | Notebook             | `/notebooks`, `/notebooks/:notebookId` | Planned | 4    |
| E3  | Knowledge Library    | `/library`                             | Planned | 4    |
| E4  | Office               | `/office`, `/office/:docId`            | Planned | 4    |
| E5  | Learning Academy     | `/learn`                               | Planned | 4    |
| E6  | Invention Laboratory | `/invent`, `/invent/:projectId`        | Planned | 4    |
| E7  | Business & Career    | `/business`, `/business/:ventureId`    | Planned | 4    |

#### Group F — Automation, cloud and operations

| ID  | Module              | Route                                           | Status  | Wave |
| --- | ------------------- | ----------------------------------------------- | ------- | ---- |
| F1  | Flow                | `/workflows` _(existing)_                       | Preview | 1    |
| F2  | Skills & Extensions | `/skills*` _(existing)_                         | Preview | 1    |
| F3  | Cloud Computer      | `/cloud/computer`, `/cloud/computer/:sessionId` | Planned | 7    |
| F4  | Cloud Resources     | `/cloud/resources`                              | Planned | 7    |
| F5  | Observability       | `/ops`                                          | Planned | 7    |
| F6  | Security Center     | `/security`                                     | Preview | 2    |
| F7  | Capability Registry | `/registry`                                     | Planned | 2    |

#### Group G — Shell services

| ID  | Module           | Route                                    | Status         |
| --- | ---------------- | ---------------------------------------- | -------------- |
| G1  | Settings         | `/settings/:section` (+ existing dialog) | Live → Preview |
| G2  | Share            | `/share/:shareId` _(existing)_           | Live           |
| G3  | Notifications    | overlay, no route                        | Live           |
| G4  | Voice & Vision   | overlay, no route                        | Planned        |
| G5  | Product switcher | overlay _(existing)_                     | Live           |

### 3.5 The workspace chip

One control in the top-left of the canvas, replacing the ambiguous "product switcher" duplication over time.

**Anatomy:** current module icon · module name · project name (when scoped) · chevron.
**Opens:** a searchable, grouped menu with five sections — _Pinned_, _Recent_, _Conversation_ (Chat, Work, Search), _Build_ (Projects, IDE, Review, Tests, Studio, Flow), _Everything else_ (alphabetical, grouped by group letter).
**Behaviour rules:**

- Groups are collapsible and remember state per owner.
- Disabled entries show the reason inline (`Requires a connected repository`), never a tooltip-only explanation.
- `⌘K` inside the menu promotes to the global palette.
- The chip never shows more than 12 entries expanded; the rest are filtered by typing.

### 3.6 Command palette

The palette is the primary navigation surface for a platform expected to reach hundreds of capabilities. It must exist in Wave 0, before any new module, or every module will invent its own search.

**Sources** (ranked, then merged):

| Rank | Source                                                     | Example                   |
| ---- | ---------------------------------------------------------- | ------------------------- |
| 1    | Exact module or object name                                | `timemachine`             |
| 2    | Recent destinations                                        | last 8 visited            |
| 3    | Actions on the current object                              | `checkpoint this project` |
| 4    | Conversations (title, message content when search enabled) | `deployment migration`    |
| 5    | Files and artifacts                                        | `schema.prisma`           |
| 6    | Settings                                                   | `theme`, `permissions`    |
| 7    | Help and shortcuts                                         | `keyboard shortcuts`      |

**Rules:**

- Results are de-duplicated by target; a conversation and its project collapse to the project with a secondary line.
- Each result states its scope (`Project · Aurora`, `Workspace`).
- Unavailable results are shown, dimmed, with the blocker — hiding them makes the platform feel smaller than it is.
- Keyboard: ↑↓ move, ⏎ open, ⌘⏎ open in inspector, Esc dismiss, ⌘K toggle.
- The palette issues at most one network request per federated source per open, with per-source 1500ms timeout and graceful partial results.

### 3.7 Global search versus the palette

They are different jobs and must not be merged.

|             | Palette                   | Search (`/search`)                           |
| ----------- | ------------------------- | -------------------------------------------- |
| Question    | "Take me to…"             | "Find everything about…"                     |
| Scope       | Navigation + light recall | Messages, files, artifacts, memory, evidence |
| Result      | A destination             | A ranked corpus with facets                  |
| Persistence | Dismissed on select       | A page with URL state                        |

Search inherits the existing message-search implementation and extends it by source, not by rewriting it. Facets: type, project, date, agent, verification status.

## 4. Design system

The system is not replaced. It is **extended in one direction only**: from conversation-scale components to module-scale composition, using the same semantic tokens, the same primitives and the same theme contract.

### 4.1 Token usage contract

Roles are assigned by meaning, never by appearance. A surface that needs a new meaning gets a new semantic token; it does not borrow a near-match.

| Need                    | Token family                                                    | Never                                                          |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Page background         | `surface-canvas`                                                | `surface-primary` (that is a raised panel)                     |
| Panel, card, dialog     | `surface-primary`, `surface-card`, `surface-dialog`             | raw `bg-white` / `bg-gray-*`                                   |
| Selected navigation row | `surface-nav-selected`                                          | `surface-active` (that is a pressed control)                   |
| Hover chrome            | `surface-nav-hover`, `surface-hover`                            | opacity on a text colour                                       |
| Body copy               | `text-primary` / `text-secondary`                               | `text-gray-500`                                                |
| Metadata, counts        | `text-tertiary` / `text-muted`                                  | a lighter alpha of body copy                                   |
| Verified state          | `status-verified`                                               | `status-success` (success is an outcome, verified is evidence) |
| Warning / blocker       | `status-warning`, `status-error` + `*-subtle` fill + `*-border` | a red literal                                                  |
| Charts                  | `series-1…8`                                                    | colour picked by eye                                           |
| Files by type           | `file-document`, `file-code`, `file-video`…                     | a rainbow of arbitrary hues                                    |

**Rule:** a module that needs colour beyond these families is making an argument for a new semantic role, not a local exception. That argument is made in `packages/client/src/theme/defaults.css` plus a `tokens.spec.ts` entry, so every theme inherits it and `@shadcn/lint` can see it.

### 4.2 Tokens this architecture requires

The following semantics have no home today. They are additive, defaulted in `defaults.css`, and must be added with theme coverage rather than inline CSS:

| Token                                     | Meaning                                                                          | Default derivation                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `status-blocked` (+ `-subtle`, `-border`) | Capability cannot run; prerequisite missing                                      | Derived from `status-neutral` shifted to warning hue |
| `status-planned`                          | Designed, not built                                                              | `status-neutral`                                     |
| `status-live`                             | Verified and operating                                                           | `status-success`                                     |
| `status-verified`                         | Evidence attached                                                                | exists                                               |
| `surface-run`                             | Run/timeline dock surface                                                        | `surface-secondary-alt`                              |
| `surface-inspector`                       | Inspector panel                                                                  | `surface-primary`                                    |
| `surface-evidence`                        | Evidence receipt card                                                            | `surface-card`                                       |
| `border-evidence`                         | Receipt edge                                                                     | `border-medium`                                      |
| `agent-1…6`                               | Agent identity accents, used only for presence and attribution                   | Harmonics of `accent-primary`                        |
| `--theme-density-row`                     | Row height for dense tables (`compact` 32px, `default` 40px, `comfortable` 48px) | new theme-owned property                             |

Density must be theme-owned for the same reason control heights already are: a theme may draw a denser product without any module opting out.

### 4.3 Typography, space, radius, elevation

- **Type:** the theme-owned scale (`--theme-text-xs … 2xl`) is authoritative. No module declares a font size. New UI uses `text-sm` for body in panels, `text-xs` for metadata, `text-base` for transcript prose, `text-lg/xl` for canvas titles.
- **Measure:** prose columns cap at **72ch**; the canvas caps at **1400px** and centres beyond that, so long-form reading never spans an ultrawide monitor.
- **Space:** 4px base; component rhythm uses 8/12/16/24. Module screens use a 24px gutter at ≥768 and 16px below.
- **Radius:** theme-owned (`--theme-radius-*`). Cards use `rounded-xl`, controls `rounded-lg`, chips `rounded-full` — expressed as utilities so a theme reshapes them.
- **Elevation:** `shadow-sm` for cards, `shadow-lg` for popovers, `shadow-2xl` for sheets. No module invents a shadow.

### 4.4 Motion

| Interaction           | Duration                       | Easing                           |
| --------------------- | ------------------------------ | -------------------------------- |
| Drawer, pane shift    | 300ms (existing)               | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Panel/inspector slide | 220ms                          | same                             |
| Row hover, chip state | 120ms                          | `ease-out`                       |
| Progress pulse        | 1.6s loop, opacity only        | `ease-in-out`                    |
| Step completion       | 180ms check + 240ms row settle | `ease-out`                       |

Rules: never animate layout properties on lists longer than 20 rows; never loop an animation that is not a live-status indicator; `prefers-reduced-motion` collapses every transform to a cut and keeps opacity changes ≤120ms. The existing drawer already does this correctly and is the reference implementation.

### 4.5 Component inventory

**Existing — reuse first.** 115 primitives live in `packages/client/src/components`. The ones this architecture composes most:

`Accordion` · `Alert` · `AlertDialog` · `AnimatedTabs` · `Avatar` · `Badge` · `Breadcrumb` · `Button` · `Checkbox` · `Chip` · `Collapsible` · `Combobox` · `Composer` · `DataTable` · `Dialog` · `DialogTemplate` · `DisclosureChevron` · `DropdownPopup` · `EmptyState` · `Field` · `FieldMessage` · `FileUpload` · `FilterInput` · `FormInput` · `HoverCard` · `IconButton` · `InfoHoverCard` · `Input` · `InputNumber` · `InputOTP` · `Label` · `LoadingDots` · `MorphIcon` · `MultiSelect` · `OGDialogTemplate` · `Pagination` · `PixelCard` · `Progress` · `Radio` · `Resizable` · `RetryableError` · `SecretInput` · `SegmentedMeter` · `Select` · `Separator` · `SeriesLabel` · `Skeleton` · `Slider` · `Switch` · `Table` · `Tabs` · `Tag` · `Textarea` · `TextareaAutosize` · `ThemeSelector` · `TimePicker` · `Toast` · `Tooltip`

**Net-new shared components.** Each is justified by at least two consuming modules. They belong in `packages/client`, not in `client/src/components/<feature>`.

| #   | Component                       | Purpose                                                                                | Consumers                               | Built on                            |
| --- | ------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| N1  | `ModuleShell`                   | Canvas frame: breadcrumb slot, title, action bar, tab strip, body, empty/blocked slots | All                                     | `Breadcrumb`, `Tabs`, `Separator`   |
| N2  | `SplitWorkspace`                | List · canvas · inspector layout with collapse rules                                   | Projects, IDE, Review, Research, Studio | `Resizable`                         |
| N3  | `CapabilityBadge`               | The six-status chip with icon + text + reason popover                                  | All module entries                      | `Badge`, `Tooltip`                  |
| N4  | `ScopeChip`                     | Shows the grant an action spends; opens the grant sheet                                | Work, Flow, Cloud, IDE                  | `Chip`, `HoverCard`                 |
| N5  | `ApprovalSheet`                 | Request, review and grant a scoped permission                                          | Work, Flow, Cloud Computer              | `Dialog`, `Checkbox`, `InputNumber` |
| N6  | `RunProgress`                   | Plan tree with per-step state, retries, durations                                      | Work, Flow, Tests, Reliability          | `Progress`, `Collapsible`           |
| N7  | `StepTimeline`                  | Chronological steps and tool calls with expandable detail                              | Work, Council, Gaming Agent             | `Accordion`                         |
| N8  | `EvidenceCard` / `EvidenceList` | Signed receipt with verifier, artifact links, timestamp                                | Work, Review, Tests, Ops                | `Badge`, `Table`, `Tooltip`         |
| N9  | `VerificationBadge`             | `Verified` / `Unverified` / `Failed` with reason                                       | Every completion claim                  | `Badge`                             |
| N10 | `ObjectInspector`               | Host frame for contextual detail panels, URL-synced                                    | All                                     | `Tabs`, `Resizable`                 |
| N11 | `DiffViewer`                    | Side-by-side and unified diff with hunk actions                                        | Review, Time Machine, IDE               | `Table`                             |
| N12 | `VersionRail`                   | Scrubber over checkpoints with before/after compare                                    | Time Machine, Artifacts, Studio         | `Slider`, `Timeline` (new)          |
| N13 | `CommandPalette`                | Ranked federated navigation and actions                                                | Global                                  | `Combobox`, `Dialog`                |
| N14 | `ArtifactFrame`                 | Sandboxed preview host with poster, reload, fullscreen, CSP badge                      | Studio, Gallery, Games                  | `Dialog`                            |
| N15 | `PlanPreview`                   | Editable plan before execution: steps, cost, grants                                    | Work, Flow                              | `RunProgress`                       |
| N16 | `GraphCanvas`                   | Node/edge view with clustering cap                                                     | Memory, Repo graph, Lineage             | `Resizable`                         |
| N17 | `MetricStrip`                   | A small set of labelled measurements with window and source                            | Ops, Insights, Cloud                    | `SeriesLabel`, `SegmentedMeter`     |
| N18 | `BlockedState`                  | Named blocker, prerequisite, and the exact next action                                 | All planned modules                     | `EmptyState`                        |
| N19 | `PresenceBar`                   | Which agents are active, on what, since when                                           | Workforce, Council, Work                | `Avatar`, `Tooltip`                 |
| N20 | `TemplateCard`                  | Preview poster, category, stack, licence, use action                                   | Templates, Studio, Projects             | `PixelCard`, `Badge`                |
| N21 | `BudgetMeter`                   | Quota consumed vs remaining, fail-closed state                                         | Cloud, Models, Flow                     | `SegmentedMeter`                    |
| N22 | `RecordTable`                   | `DataTable` + filter bar + saved views + URL state                                     | Review, Tests, Registry, Library        | `DataTable`, `FilterInput`          |

**Rule of two.** A component used once stays feature-local. Only the second consumer promotes it. Promoting means: move to `packages/client`, add a colocated spec, cover loading/success/failure, and document any new token.

### 4.6 Status and evidence language

Status is a first-class visual grammar, used identically in the chip, the inspector and the receipt.

| Status       | Icon         | Text           | Colour role       | Where it appears        |
| ------------ | ------------ | -------------- | ----------------- | ----------------------- |
| Live         | filled dot   | `Live`         | `status-live`     | Module menu, header     |
| Preview      | half dot     | `Preview`      | `status-info`     | Module menu, header     |
| Experimental | flask        | `Experimental` | `status-warning`  | Entry + header banner   |
| Planned      | outline dot  | `Planned`      | `status-planned`  | Menu, route empty state |
| Blocked      | slash        | `Blocked`      | `status-blocked`  | Menu, route, action     |
| Verified     | check-shield | `Verified`     | `status-verified` | Evidence, completion    |
| Unverified   | dashed check | `Unverified`   | `status-neutral`  | Completion claims       |
| Failed       | cross        | `Failed`       | `status-error`    | Runs, tests, receipts   |

Every badge carries text, never colour alone. `CapabilityBadge` supports a `reason` prop that renders in a popover **and** as an inline sentence in the blocked state — a tooltip is not sufficient disclosure for a control that cannot be used.

### 4.7 Accessibility contract

WCAG 2.2 AA is the floor. The codebase already sets a 24px minimum target (`theme-target`) and a `LiveAnnouncer`; modules must use both.

- **Keyboard:** every canvas action is reachable in order. `⌘K` palette, `⌘/` shortcut help, `Esc` closes the innermost layer only. Focus is trapped in sheets and restored to the opener.
- **Focus:** visible ring from `focus-control`; the existing `inert`-the-covered-pane pattern applies to every overlay, not only the mobile drawer.
- **Announcements:** run state changes announce once per transition (`Run started`, `Step 3 of 7 complete`, `Run blocked: repository not connected`), throttled to one per 3s. Streaming tokens are never announced.
- **Colour independence:** status, verification and severity always pair an icon and a word.
- **Zoom:** 200% zoom with no horizontal scroll at 1280px; the layout collapses rather than compressing.
- **Tables:** `RecordTable` exposes row actions through a keyboard-reachable menu, not hover-only.
- **Motion:** reduced-motion honoured per §4.4.

### 4.8 Responsive strategy

`useMediaQuery('(max-width: 768px)')` is the existing convention and remains the only boolean the shell branches on. Two additive hooks are required: `useWideLayout()` (≥1280) and `useUltraLayout()` (≥1600).

| Range         | Rail                                 | Canvas                | Inspector            | Timeline                  | Tables                  |
| ------------- | ------------------------------------ | --------------------- | -------------------- | ------------------------- | ----------------------- |
| **<768**      | Drawer, 100% or 80% strip (existing) | Single column         | Full-height sheet    | Hidden, sheet from header | Card list               |
| **768–1023**  | 52px rail                            | Single column         | Overlay, 380px       | Hidden                    | Card list ≥2 cols       |
| **1024–1279** | 52 or 360px                          | Single column         | Overlay, 400px       | Collapsed bar             | Table, 2 sticky columns |
| **≥1280**     | Persistent, resizable                | Column with inspector | Persistent 320–420px | Collapsed bar, expandable | Full table              |
| **≥1600**     | Persistent                           | Centred, ≤1400px      | Persistent           | Optionally docked         | Full table              |

**Collapse order** when space is short — never reorder arbitrarily:

1. Breadcrumb collapses to the last two segments.
2. Secondary header actions move into an overflow menu.
3. Timeline collapses to a status bar.
4. Inspector becomes an overlay sheet.
5. Tab strip becomes a select.
6. Side-by-side diff becomes unified.
7. Rail collapses to 52px (never below).

Mobile-specific rules: no hover-only affordance; every drag has a menu equivalent; sheets use `100dvh` and respect safe areas; the composer stays above the keyboard; long module names truncate with a full-name tooltip.

### 4.9 Performance budgets

Declared per module and checked at review. These are ceilings, not targets.

| Budget                      | Ceiling                                                               | Mechanism                                                |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Route chunk, initial        | 180KB gzip                                                            | `lazyWithRecovery` / `importWithRecovery` (both exist)   |
| Live preview surfaces       | 1 at a time                                                           | `ArtifactFrame` renders a poster for any non-active card |
| Idle requests (tab visible) | ≤1 per 10s per module; 0 hidden                                       | SSE for runs; no polling loops                           |
| Lists                       | Virtualized above 100 rows                                            | existing conversation list pattern                       |
| Transcript                  | `content-visibility: auto` per message                                | avoids off-screen layout                                 |
| Graph rendering             | ≤400 rendered nodes, cluster beyond                                   | `GraphCanvas` cap                                        |
| Animation                   | ≤32 simultaneous animated elements                                    | no staggered entrance on long lists                      |
| Chart updates               | ≤4Hz                                                                  | throttle streaming metrics                               |
| Cleanup                     | Every subscription, observer, worker disposed on unmount/route change | review checklist                                         |
| LCP                         | No regression on visible conversation                                 | `npm run lighthouse` (repo gate)                         |

A module that cannot meet its budget ships with a **degraded mode** it can name, rather than silently exceeding it.

### 4.10 Iconography, imagery and voice

- Icons: `lucide-react`, 20px in canvas chrome, 16px inline, 24px in empty states. One icon per concept, registered in the module registry so the chip, palette and empty state agree.
- Imagery: original or licensed only; no third-party UI screenshots as decoration; film/game/avatar imagery always labelled with its generator and licence in the inspector.
- Voice: sentence case for controls, title case for module names, no exclamation marks, no anthropomorphising of agents. Blockers are written as _fact · prerequisite · next action_.

## 5. Interaction specifications

### 5.1 The Chat ↔ Work continuum

The brief requires Chat and Work to coexist in the same interface and URL. The implementation already half-does this: `/work/:conversationId?` renders `ChatRoute` with `workMode`. The design completes it.

**Identity.** A conversation is one object with one id. `mode` is a property of a **turn**, not of the page. Switching to Work does not create a second thread, and returning to Chat does not end a run.

**Mode control.** A segmented control in the composer's left cluster: `Chat · Work`. Persistent per conversation, defaulting to the last used. The current agent and model sit immediately beside it, so the owner always knows who acts and with what.

**Escalation (Chat → Work) is proposed, never silent.**

1. The owner sends a request that implies multiple steps.
2. The assistant replies with a **PlanPreview**: objective restated, numbered steps, expected artifacts, required grants, estimated wall-clock and resource class.
3. Three actions: `Run as Work`, `Answer only`, `Edit plan`.
4. `Run as Work` converts the turn in place — the transcript keeps the plan as a card, and the run streams into the same canvas below it.

**De-escalation (Work → Chat) is free.** In a Work conversation, a simple question is answered inline without spawning a run. A run is never paused because the owner typed a question into the same composer.

**Returning.** A conversation with an active run shows a status pill in the header (`Running · step 4/9`, `Blocked`, `Paused by owner`). Navigating away does not cancel it. Re-entering restores scroll position, the run's current step and the live stream if it is still open.

**Branching.** Editing a message in a conversation that has spawned runs offers: `Edit and re-run on a branch` (default, non-destructive) or `Edit only`. The original branch and its evidence remain addressable.

### 5.2 The run lifecycle

Every durable execution — a Work run, a Flow execution, a test suite, a reliability investigation, a game-agent session — uses the same nine states. One state machine, one component, one vocabulary.

```
draft ──plan──▶ planned ──approve──▶ queued ──admit──▶ running
  │                 │                  │                 │
  │                 │                  │                 ├─pause──▶ paused ──resume──▶ running
  │                 │                  │                 ├─block──▶ blocked ──resolve──▶ queued
  │                 │                  │                 ├─fail───▶ failed ──retry───▶ queued
  │                 │                  │                 └─cancel─▶ cancelled
  │                 └──deny──▶ planned   (reason recorded; plan revised in place, never cancelled)
  └──discard──▶ (deleted)

blocked ──deny──▶ blocked   (reason recorded; blocker and next action restated)

running ──finish──▶ verifying ──evidence──▶ complete
                         │
                         └─no evidence──▶ unverified
unverified ──re-verify or attach evidence──▶ verifying

cancel, available in every non-terminal state ──▶ cancelled
  draft · planned · queued · running · paused · blocked · failed · verifying · unverified
```

| State        | Meaning                            | Header pill                        | Primary actions                                                         |
| ------------ | ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `draft`      | Objective captured, no plan        | `Draft`                            | Edit objective, plan, cancel                                            |
| `planned`    | Plan exists, not authorised        | `Needs approval`                   | Approve, edit plan, discard, cancel                                     |
| `queued`     | Authorised, awaiting capacity      | `Queued · position 2`              | Cancel, view queue                                                      |
| `running`    | Executing a step                   | `Running · 4/9`                    | Pause, cancel, take control                                             |
| `paused`     | Owner-stopped, state preserved     | `Paused`                           | Resume, inspect, cancel                                                 |
| `blocked`    | Needs a decision or a prerequisite | `Blocked: needs repository access` | Resolve, skip step, cancel                                              |
| `failed`     | Terminal failure, retryable or not | `Failed`                           | Retry, inspect evidence, clone to new run                               |
| `cancelled`  | Stopped by owner or policy         | `Cancelled`                        | Clone, view partial artifacts                                           |
| `verifying`  | Work claims done, checks running   | `Verifying`                        | View checks, cancel                                                     |
| `complete`   | Verification passed                | `Complete · verified`              | Review evidence, merge, export                                          |
| `unverified` | Finished without evidence          | `Complete · unverified`            | Attach evidence or re-verify (both return to `verifying`), accept as-is |

**Non-negotiables:**

- `complete` is only reachable through `verifying`. A model's claim of success is not a transition.
- `unverified` is a first-class outcome, not an error. It is honest, and the UI must make it easy to accept without pretending.
- Cancellation is always available in every non-terminal state, in the same place.
- `blocked` always names the blocker, the prerequisite and the exact next action. A spinner is never a legitimate response to a blocker.
- Retry preserves the previous attempt as evidence rather than overwriting it.

### 5.3 Permissions and approval

Authorization is designed as a visible object, not a settings abstraction.

**Four tiers.**

| Tier                      | Examples                                                                     | Default                                        | Confirmation                                     |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| **T0 · Read**             | Read repository, search memory, list files                                   | Always allowed                                 | None                                             |
| **T1 · Reversible write** | Edit a branch, create a file, change a draft                                 | Standing grant allowed                         | Scope chip on the action                         |
| **T2 · External effect**  | Open a PR, send an email, deploy a preview, call a paid API                  | Standing grant required, scoped by destination | Approval sheet, once per scope                   |
| **T3 · Irreversible**     | Merge to a protected branch, delete data, publish to production, spend money | Never standing                                 | Explicit per action, typed confirmation, re-auth |

**Grant anatomy.** A grant is `{ category, destinations[], quota, budget, expiresAt, requiresReview }`. The UI shows it as a sentence, never as JSON: _"Open pull requests on `Auctivon-CoderaxAI/Coderax`, max 3 per day, expires in 24 hours."_

**Approval sheet.** Opens from `ScopeChip` or a `blocked` run. Contains: what will happen, the exact destinations, what it can and cannot touch, expiry, quota, a `Requires my review before merge` checkbox (default on), and two buttons — `Grant` and `Deny`. Denying records a reason, which the run uses to re-plan rather than fail blindly.

**Where grants surface.**

- `ScopeChip` beside the action that spends them.
- The run's inspector tab, as `Authorised actions`.
- Security Center, as the complete revocable list with last-used timestamps.
- Every use writes an evidence receipt.

**Fail closed.** If a quota, expiry or destination cannot be verified, the action is disabled with a `Blocked` badge and the reason. The UI never offers an optimistic path around an unverifiable grant, and never proposes a paid fallback.

### 5.4 Time Machine and restore

Restoration is the most dangerous routine action in the product, so it has the most explicit interaction.

**Browsing.** `/timemachine` shows a vertical chronology grouped by day, with a horizontal scrubber for within-day granularity. Each entry is a checkpoint with: what changed, who caused it (owner, agent, workflow), scope (file, schema, design, conversation, prompt, config), and evidence link.

**Restore flow (never one click):**

1. **Select** a checkpoint. The canvas switches to a comparison against current state.
2. **Impact preview** answers four questions explicitly: components affected, changes made _after_ the checkpoint, conflicts, and what cannot be restored (with the reason).
3. **Choose a policy:** `Preserve newer work` (default — restore only what is untouched), `Restore exact state` (destructive, requires typed confirmation), or `Restore to a branch` (safest; produces a reviewable change instead of mutating).
4. **Confirm.** A pre-restore checkpoint is created automatically, always, even for the safest policy.
5. **Receipt.** The result is an evidence record: what was restored, what was skipped, verification status.

**Protected resources** — databases, deployments, protected branches — additionally require the owning grant tier and are never restored by a background run.

### 5.5 Keyboard model

One map, documented in the existing `KeyboardShortcutsDialog` and reachable with `⌘/`.

| Shortcut                 | Action                               | Scope      |
| ------------------------ | ------------------------------------ | ---------- |
| `⌘K` / `Ctrl-K`          | Command palette                      | Global     |
| `⌘/`                     | Shortcut help                        | Global     |
| `⌘⇧N`                    | New chat                             | Global     |
| `⌘⇧W`                    | Toggle Chat / Work mode              | Composer   |
| `⌘B`                     | Toggle rail                          | Global     |
| `⌘I`                     | Toggle inspector                     | Modules    |
| `⌘J`                     | Toggle timeline dock                 | Modules    |
| `⌘⏎`                     | Run / approve plan                   | Work, Flow |
| `⌘.`                     | Pause run                            | Active run |
| `⌘⇧.`                    | Cancel run (double-press to confirm) | Active run |
| `Esc`                    | Close innermost layer                | Global     |
| `G` then `C` / `W` / `P` | Go to Chat / Work / Projects         | Global     |

Rules: shortcuts never fire while a text field has focus, except `⌘K` and `⌘⇧W`, whose declared scope includes the composer and which stay live there; `Esc` never cancels a run by itself; destructive shortcuts require a second press within 2s and announce the pending state.

### 5.6 State taxonomy for every surface

Seven states, defined once, reused everywhere. A module that invents an eighth must justify it.

| State                     | Trigger                           | Structure                 | Required elements                                            |
| ------------------------- | --------------------------------- | ------------------------- | ------------------------------------------------------------ |
| **First use**             | No objects yet                    | Centred card              | One-line value statement, primary create action, one example |
| **No results**            | Filters excluded everything       | Inline block              | What was filtered, `Clear filters`, count of hidden items    |
| **Cleared**               | Everything done                   | Quiet block               | Confirmation, next suggested action                          |
| **Not configured**        | Prerequisite missing              | Banner + disabled content | What is missing, where to fix it, deep link                  |
| **Blocked**               | External prerequisite unavailable | `BlockedState`            | Fact · prerequisite · next action · what still works         |
| **Unavailable (Planned)** | Capability designed, not built    | `BlockedState` variant    | Status chip, one paragraph of intent, roadmap link           |
| **Error**                 | Operation failed                  | `RetryableError`          | Safe message, code, retry, copy diagnostics (redacted)       |

Loading uses the existing `Skeleton` in the shape of the eventual content — never a centred spinner for a layout that has structure. Streaming and long operations use `Progress` with a named current step, not an indeterminate bar.

### 5.7 Attention and notification model

Four severities, each with one home:

| Severity          | Examples                                         | Surface                             |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| **Blocking**      | Run blocked, approval required, security finding | Timeline dock + header pill + toast |
| **Completed**     | Run finished, PR opened, deploy verified         | Timeline dock, coalesced            |
| **Informational** | Model fallback used, cache warmed                | Timeline only                       |
| **Failure**       | Test failed, provider outage                     | Timeline + toast, with retry        |

Rules: at most one toast visible; identical events within 60s coalesce (`3 runs completed`); no badge counts on more than three destinations; the timeline dock is the durable record, so dismissing a toast loses nothing; nothing uses a modal for a non-blocking event.

### 5.8 Multi-agent presence and handoff

The owner must never wonder who is acting.

- `PresenceBar` sits under the canvas header during any multi-agent activity: one avatar per active agent, the current step in a single line, elapsed time.
- Selecting an avatar opens that agent's inspector: role, model, scope, steps owned, evidence produced.
- A **handoff** is a visible timeline entry (`Architect → Engineer: implementation plan v2`), never a silent reassignment.
- The personal native agent is always labelled `Coderax Native`. An external agent is labelled with its provider and a `Third party` chip; switching requires the owner's explicit selection and is recorded as evidence.

### 5.9 Session continuity

- Reload restores: route, scroll, open inspector object, expanded groups, active panel, composer draft, run subscription.
- Returning after an absence shows a **resume summary** instead of replaying the stream: last step, what changed, what needs the owner.
- A cancelled network stream reconnects with a fresh authorization ticket and reconciles by sequence number; it never duplicates messages.
- Drafts are per conversation, cleared on send, and never silently discarded when switching modules (a confirm appears only if the draft is non-trivial).

## 6. Project creation

### 6.1 Principles

1. **Type first, then depth.** The owner picks what they are making before choosing a stack, so the flow can show only relevant questions.
2. **Honest catalogue.** A project type that cannot yet be scaffolded is shown as `Planned` with its blocker — it is not offered and then failed after creation. The brief forbids empty shells that claim capability.
3. **Two speeds.** `Quick create` (2 steps, sensible defaults) and `Guided setup` (5 steps, full control). The flow defaults to Quick and offers Guided inline; it never forces a wizard on someone who knows what they want.
4. **Non-destructive.** Abandoning creation before the final confirmation saves nothing — no project, no half-built workspace. Once confirmed, the project exists in `draft` until it has produced an artifact. Creating never mutates an existing project; `Duplicate` and `Create from template` are separate explicit actions.
5. **Scaffold, don't promise.** What the flow creates is stated before creation: number of files, what runs, what does not. A preview thumbnail is labelled `Example preview`, never presented as the owner's output.

### 6.2 Entry points

| Entry                                | Behaviour                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Workspace chip → `New project`       | Starts at type selection                                                      |
| Palette → `New project`              | Same, with type prefix if typed (`new project film`)                          |
| Projects → `New project`             | Same                                                                          |
| Chat → `Promote to project`          | Skips type selection if inferable; pre-fills requirements from the transcript |
| Template card → `Use template`       | Skips to step 3 with the template's DNA applied                               |
| Flow → `Create project for workflow` | Creates a `automation` project pre-bound to the workflow                      |

### 6.3 The five steps

**Step 1 — Type.** A searchable grid grouped by discipline: _Software, Creative, Knowledge, Business, Physical_. Each card shows name, one-line output, status chip and prerequisites. `Planned` cards are selectable only to read their blocker and roadmap.

**Step 2 — Starting point.** Three choices: `Blank` (default), `Template` (opens the template picker with filters), `Import` (GitHub repository, existing files, URL, or a previous Coderax project). Import requires a T2 grant for repository access and states exactly what will be read.

**Step 3 — Requirements.** The minimum that makes the project real:

- Name (unique within workspace; slug derived and editable).
- Objective in one sentence.
- Acceptable definition of done (free text, with suggested acceptance criteria the owner can accept or edit).
- Optional: audience, constraints, references.

The flow converts this into structured requirements the rest of the platform can test against (§7.2 · C4), and shows the conversion before proceeding.

**Step 4 — Agents and permissions.**

- Assigned agents: default `Coderax Native`; optional specialists (architect, engineer, reviewer, tester) shown with their roles.
- Execution environment: `Cloud workspace` only. The UI states plainly that local execution is unavailable by policy rather than offering a disabled local option that implies it might work.
- Grants required by the chosen type, pre-listed with destinations and quotas. Nothing is granted implicitly at creation.
- Isolation: memory scope (`project only`, the default), artifact visibility, and whether shared components may be reused (§7.3, Application DNA).

**Step 5 — Plan and create.**

- A generated plan: files to scaffold, first milestone, estimated steps, what will be verified automatically, and what the owner must verify by hand.
- Explicit `Create project` action. On success: route to the workspace `Overview`, with the first run queued only if the owner ticked `Start the first step`.

**Validation rules.** Name required; objective required; type required. Everything else has a default. No step blocks on an optional field, and the flow never requires an account, a payment method, or a paid model.

### 6.4 Project type catalogue

Status here describes **scaffolding** capability, which is narrower than the module status elsewhere.

| Type                  | Scaffold | Prerequisite                                    | First real artifact                                       | Specialised view           |
| --------------------- | -------- | ----------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| Website               | Preview  | None                                            | Static page + preview URL                                 | Files, Preview             |
| Full-stack app        | Planned  | Cloud execution + database binding              | Schema, API, UI, tests                                    | Files, API, DB             |
| Dashboard             | Preview  | None (template-driven)                          | Editable page with sample data labelled                   | Files, Data                |
| API service           | Planned  | Cloud execution                                 | OpenAPI spec + handlers + tests                           | Endpoints, Tests           |
| Database              | Planned  | Provisioned instance                            | Schema + migration + seed                                 | Schema, Lineage            |
| Mobile app            | Blocked  | Signing accounts for device builds              | Expo/React Native scaffold, web preview                   | Devices, Builds            |
| Desktop app           | Blocked  | OS signing certificates                         | Electron/Tauri scaffold, unsigned local preview           | Builds, Distribution       |
| CLI tool              | Planned  | Cloud execution                                 | Command scaffold + tests                                  | Commands, Tests            |
| Browser extension     | Planned  | Store accounts for publishing                   | Manifest + popup + background worker                      | Permissions, Builds        |
| AI agent              | Preview  | Model access                                    | Agent config + tools + eval set                           | Behaviour, Evals           |
| Mobile game           | Planned  | Engine selection                                | Playable prototype                                        | Scene, Playtest            |
| Web game              | Preview  | None                                            | Playable prototype in a sandboxed frame                   | Scene, Playtest            |
| Film / video          | Blocked  | Verified video generation capacity              | Screenplay, shot list, storyboards                        | Scenes, Timeline, Renders  |
| Realistic avatar      | Blocked  | Verified avatar/voice capacity + consent record | Character sheet, voice config, consent declaration        | Appearance, Voice, Consent |
| Music / podcast       | Planned  | Audio generation or licensed assets             | Script, timeline, asset list                              | Timeline, Mix              |
| Book / long-form      | Planned  | None                                            | Structured outline + draft chapters                       | Outline, Draft             |
| Presentation          | Planned  | None                                            | Slide deck, editable                                      | Slides                     |
| Research study        | Preview  | None (network egress policy)                    | Question, sources, evidence table                         | Sources, Findings          |
| Scientific experiment | Planned  | Simulation environment                          | Protocol, parameters, simulated results (labelled)        | Protocol, Runs             |
| Invention             | Planned  | CAD/simulation environment                      | Requirements, drawings, BOM                               | Models, Calculations       |
| Robotics              | Blocked  | Hardware access + safety review                 | Spec, wiring, simulation only                             | Diagrams, Simulation       |
| 3D model              | Planned  | Rendering capacity                              | Parametric model + renders                                | Viewport, Materials        |
| Business              | Preview  | None                                            | One-page plan + financial model with explicit assumptions | Model, Plan                |
| Automation            | Preview  | None                                            | Workflow draft with dry-run                               | Graph, Runs                |

**Reading the Blocked rows.** Each is blocked on a named external prerequisite, not on design or effort — video generation, avatar synthesis, OS code-signing, store accounts, hardware. The project type stays in the catalogue, opens to a `BlockedState` explaining the prerequisite, and reserves its route. That is how the roadmap survives contact with reality without misleading the owner.

### 6.5 Created workspace anatomy

Every project, regardless of type, opens to the same frame with type-specific tabs appended. This is what makes twenty-four project types feel like one product.

| Tab              | Content                                                             | Notes                                           |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| **Overview**     | Objective, definition of done, status, next action, recent evidence | The only tab guaranteed to be useful on day one |
| **Requirements** | Structured requirements and acceptance criteria                     | Editable; feeds the test compiler               |
| **Plan**         | Milestones, steps, dependencies, assigned agents                    | The Work plan preview, persisted                |
| **Files**        | Tree + editor + preview                                             | Artifacts, versions, provenance                 |
| **Runs**         | Every execution with state and evidence                             | Shared `RunProgress`                            |
| **Evidence**     | Verification receipts                                               | Immutable                                       |
| **Preview**      | Sandboxed output when one exists                                    | `ArtifactFrame`, one at a time                  |
| _Type tabs_      | e.g. Scenes, Schema, Evals, Endpoints                               | Only when the type supports them                |
| **Settings**     | Members, memory scope, grants, integrations, danger zone            | Route-backed (`/projects/:id/settings`)         |

**Isolation defaults:** project memory is scoped to the project; artifacts are private; cross-project reuse is off until enabled; deleting a project requires typed confirmation and offers export first.

### 6.6 Partial creation and failure

Creation is a durable job, so it can fail halfway. Rules:

- The project exists from the moment of confirmation, in `draft`. A creation abandoned before that confirmation is not saved and appears nowhere in Projects; `draft` never describes an unconfirmed creation.
- A failed scaffold shows the exact step, the safe error message and a retry — never a blank workspace pretending success.
- Partially created files are listed and individually removable.
- If a prerequisite turns out to be missing at scaffold time, the project moves to `blocked` with the reason, and keeps everything already produced.

## 7. Module specifications

### 7.0 The module contract

Every module inherits the following unless its block states a deviation. This is what prevents forty modules from becoming forty products.

| Contract          | Rule                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Frame**         | `ModuleShell`: breadcrumb, title, `CapabilityBadge`, actions, tab strip, body. No module draws its own header.           |
| **States**        | The seven-state taxonomy in §5.6. A module must implement at least First use, Not configured, Blocked and Error.         |
| **Loading**       | Skeletons in the eventual layout shape. Streaming work shows a named current step.                                       |
| **Permissions**   | Every mutating action shows its `ScopeChip` when it costs T1+; nothing is granted implicitly.                            |
| **Evidence**      | Anything reporting completion emits an `EvidenceCard` with a verifier and timestamp, or is labelled `Unverified`.        |
| **Accessibility** | §4.7 in full; the module's primary object is reachable by keyboard in ≤6 tab stops.                                      |
| **Responsive**    | §4.8 collapse order; card-list fallback for tables below 768px.                                                          |
| **Budget**        | Declared chunk, idle-request and preview limits before implementation.                                                   |
| **Localisation**  | Every string through `useLocalize()`; no inline English in components.                                                   |
| **Deep links**    | Selection and filters live in the URL.                                                                                   |
| **Empty honesty** | A `Planned` module renders `BlockedState` with intent, dependencies and roadmap — never a skeleton that implies loading. |

---

### 7.1 Wave 1 — Make the existing surfaces coherent

These are already in the application. The work is unification, not invention: one frame, one status language, one inspector, one run surface.

**A1 · Chat** — `Live` — `/c/:conversationId?`

- **Purpose:** the default surface; multimodal conversation with the native agent.
- **Journey:** open → type or attach → stream → inspect artifact or citation → branch, share or promote to Work.
- **Screens/zones:** transcript canvas; composer with mode, model, agent, attachments; inspector (artifacts, citations, message details); rail.
- **Components:** `Composer`, `Messages/*`, `Artifacts` panel, `Share` menu, `DropdownPopup` action menus.
- **Inputs:** text, images, documents, code, spreadsheets, audio where supported; model and agent selection.
- **Actions:** send, stop, regenerate, edit, branch, copy, share, export, bookmark, promote to project.
- **Permissions:** T0 by default; tools that act externally raise `ScopeChip`.
- **Deviations:** stop must be reachable during stream without scrolling; attachments show upload state per file.
- **Relationships:** the entry point to every module; A2 shares identity; A4 receives promotions; A5 holds artifacts.

**A2 · Work** — `Preview` — `/work/:conversationId?`

- **Purpose:** turn an objective into a persistent, resumable, verified execution.
- **Journey:** switch mode → describe objective → review `PlanPreview` → grant → watch `RunProgress` → resolve a blocker → review evidence → accept.
- **Screens/zones:** same canvas as Chat plus a run strip; timeline dock; run inspector (`Steps`, `Authorised actions`, `Evidence`, `Resources`).
- **Components:** `PlanPreview`, `RunProgress`, `StepTimeline`, `ApprovalSheet`, `EvidenceList`, `BudgetMeter`.
- **Inputs:** objective, constraints, definition of done, model/agent, grants.
- **Actions:** plan, approve, pause, resume, cancel, retry, take control, skip step, attach evidence, clone run.
- **Permissions:** T1 standing optional; T2 per scope; T3 always per action.
- **Deviations:** the run pill persists in the header across navigation; cancellation is in the same position in every state.
- **Relationships:** writes evidence into C8, checkpoints into A10, files into A5, PRs into C3.

**A3 · Search** — `Live` — `/search`

- **Purpose:** find anything the workspace knows.
- **Journey:** open → query → facet → open result at the exact position.
- **Components:** `FilterInput`, `RecordTable`, `Pagination`, source tabs.
- **Inputs:** query, facets (type, project, date, agent, verification).
- **Actions:** open, jump to message, save query, export results.
- **Permissions:** respects existing per-conversation access; never leaks another project's memory.
- **Deviations:** results from an inaccessible source are counted, not silently dropped.
- **Relationships:** distinct from the palette (§3.7); feeds E3 Library.

**A4 · Projects** — `Preview` — `/projects`, `/projects/:projectId`

- **Purpose:** the unit of isolation and delivery.
- **Journey:** list → open → Overview's next action → work → review evidence → export or distribute.
- **Screens:** list (grid/list toggle, filters, sort); workspace tabs per §6.5; settings sub-route.
- **Components:** `ModuleShell`, `SplitWorkspace`, `TemplateCard`, `RunProgress`, `EvidenceList`.
- **Actions:** create (§6), open, archive, duplicate, export, delete (typed), manage members and grants.
- **Permissions:** project-scoped; deletion is T3.
- **Deviations:** list must remain useful at 200 projects — virtualize, and show `needs attention` first.
- **Relationships:** owns A2 runs, A5 artifacts, A10 checkpoints, every module's object graph.

**A5 · Artifacts** — `Preview`

- **Purpose:** every produced thing, versioned and attributable.
- **Journey:** open panel → preview or source → compare versions → export or promote to project.
- **Components:** `ArtifactFrame`, `DiffViewer`, `VersionRail`.
- **Inputs:** files, generated documents, images, code, decks.
- **Actions:** preview, edit, download, copy, version-compare, restore version, open in Studio.
- **Permissions:** T0 read; edits follow the project's T1 grant.
- **Deviations:** exactly one live preview surface (§4.9); others render posters.
- **Relationships:** referenced by A1, A2, D1-D8, E2, E4.

**A6 · Prompt library** — `Live` — `/prompts/:promptId`

- **Purpose:** reusable, versioned instructions.
- **Journey:** open library → create from dialog → insert into composer → edit and version.
- **Components:** prompts accordion, dialog composer, version list.
- **Permissions:** existing `PROMPTS` permission (`USE`).
- **Deviations:** `new` has no page by design; keep the redirect.
- **Relationships:** feeds agents (B1), Flow (F1), Council (B4).

**A7 · Bookmarks** — `Live` — side panel

- **Purpose:** tag conversations for retrieval. **Permissions:** `BOOKMARKS · USE`.
- **Deviations:** none; keep as a panel rather than a module route.

**A8 · Schedules** — `Experimental` — side panel

- **Purpose:** scheduled chats. **Permissions:** `SCHEDULES · USE`, server opt-in.
- **Deviations:** entry hidden when the server config is absent, not merely disabled; when enabled, an `Experimental` chip appears in the panel header.
- **Relationships:** conceptually a subset of F1 Flow; document the overlap and do not build two schedulers.

**B1 · Agent Builder** — `Live` — side panel

- **Purpose:** compose an agent: instructions, model, tools, capabilities, skills.
- **Journey:** open → pick base → configure → test in a sandbox conversation → save.
- **Components:** form sections, capability toggles, skills accordion, test drawer.
- **Permissions:** `AGENTS · USE` + `CREATE`; tool grants per tool.
- **Deviations:** an agent whose required model is unavailable shows `Blocked` with the model, not a silent fallback.
- **Relationships:** B3 Workforce builds on it; B6 passports measure it.

**B2 · Agent Marketplace** — `Preview` — `/agents`, `/agents/:category`

- **Purpose:** discover and install agents and MCP servers.
- **Journey:** browse category → inspect permissions → install → configure → use.
- **Components:** `TemplateCard`, category rail, permission summary, install dialog.
- **Actions:** install, clone, disable, uninstall, view source.
- **Permissions:** installation states every capability it will request before install; nothing is auto-granted.
- **Deviations:** an unavailable item is listed with its blocker; the marketplace never shows an installed item as working when its model or server is offline.
- **Relationships:** F2 Skills, B7 Interop, F6 Security Center (supply-chain view).

**D1 · Studio** — `Preview` — `/studio`

- **Purpose:** visual application and page building. Today: deterministic templates with passive preview.
- **Journey:** choose kind → prompt → edit HTML → preview → download.
- **Screens:** `/studio` (build), `/studio/templates`, `/studio/assets`, `/studio/editor/:projectId`.
- **Components:** prompt panel, code editor, `ArtifactFrame` preview, `TemplateCard`.
- **Permissions:** none for local drafts; export to project is T1.
- **Deviations:** `/studio` must render its documented limitations (`docs/visual-app-studio.md`) in an `Unavailable` note, not bury them in a README.
- **Relationships:** D2 templates, D3 editor, D4 assets, A4 projects, C7 distribution.

**F1 · Flow** — `Preview` — `/workflows`

- **Purpose:** visual automation with triggers, conditions, waits and approvals.
- **Journey:** new workflow → pick trigger → add nodes → dry-run → enable → monitor runs.
- **Components:** node canvas (lazy), node inspector, `RunProgress`, execution history, `ApprovalSheet`.
- **Permissions:** each node states its grant; enabling a workflow lists every grant in one place.
- **Deviations:** dry-run is mandatory before enable; a workflow with an unresolvable node cannot be enabled.
- **Relationships:** invokes agents, tools, C3, C4; shares the run state machine.

**F2 · Skills & Extensions** — `Preview` — `/skills*`

- **Purpose:** reusable capabilities, connectors and prompt packages.
- **Journey:** list → create/edit → configure → test → enable per agent.
- **Components:** list/table, editor, test panel, permission summary.
- **Permissions:** `SKILLS · USE`; connectors declare scopes.
- **Relationships:** B1 agents, F1 Flow, B7 Interop.

**G1 · Settings** — `Live` → `Preview`

- **Purpose:** the single place for account, appearance, data, models, permissions, integrations and advanced configuration. Existing dialog tabs are the content source.
- **Change:** add `/settings/:section` routes that render the same panels, with the dialog remaining as a shortcut. This is what makes hub-and-spoke settings deep-linkable (§3.3).
- **Components:** section rail, panel, search within settings.
- **Deviations:** every setting that gates a capability links to that capability's blocked state, and vice versa.

**G2 · Share** — `Live` — `/share/:shareId`

- **Purpose:** public, read-only view of a conversation or artifact.
- **Deviations:** shared views never expose evidence containing secrets, tool payloads or internal paths; a shared artifact states its verification status.

**G3 · Notifications** — `Live` — overlay. See §5.7.

**G4 · Voice & Vision** — `Planned` — overlay

- **Purpose:** speech in/out, captions, image discussion, screen-aware assistance.
- **Design:** a mic affordance in the composer; a voice sheet with transcript, language, output device and privacy indicator; push-to-talk shortcut; interruptible playback.
- **Blocked detail:** requires verified audio providers; the control shows `Blocked: no audio provider` rather than recording silently.

**G5 · Product switcher** — `Live` — overlay. Preserved for the five-product ecosystem; the workspace chip takes over in-app module navigation. Neither duplicates the other's destinations.

---

### 7.2 Wave 2 — Engineering, evidence and safety

This wave establishes the shared runtime surfaces the rest of the platform depends on. Nothing later should ship before the Evidence Explorer and Time Machine exist.

**A10 · Time Machine** — `Planned` — `/timemachine`

- **Purpose:** restore any eligible component or project to a prior state, safely.
- **Journey:** browse chronology → select checkpoint → impact preview → choose policy → restore → receipt.
- **Components:** `VersionRail`, `DiffViewer`, `EvidenceCard`, restore sheet.
- **Inputs:** scope (project, file, schema, design, prompt, config), checkpoint, policy.
- **Permissions:** T1 for reversible scopes; T3 for databases and deployments.
- **States:** `No checkpoints yet` (First use), `Nothing to compare` (Cleared), `Blocked: resource protected`.
- **Relationships:** produced by A2, C1, D1, F1; verified through C8.

**C1 · Cloud IDE** — `Planned` — `/ide`, `/ide/:workspaceId`

- **Purpose:** browser editor over cloud-hosted execution.
- **Journey:** open workspace → edit → terminal → run → preview → commit/PR.
- **Screens:** file tree | editor + tabs | panel (terminal, problems, tests, preview, ports) | inspector (git, agent activity).
- **Components:** editor host (lazy), `SplitWorkspace`, terminal, `DiffViewer`, `ArtifactFrame`, `PresenceBar`.
- **Inputs:** repository, branch, files, commands.
- **Actions:** edit, save, run, test, commit, branch, open PR, stop session.
- **Permissions:** T1 write to branch; T2 PR; terminal commands are listed before execution.
- **Deviations:** the editor is the heaviest module — it loads on explicit entry only, never from a chat route; one workspace live at a time, others show a resume card with cost.
- **Relationships:** C2, C3, C4, A10, A4.

**C2 · Repository Intelligence** — `Planned` — `/eng/repos`

- **Purpose:** understand a repository: architecture, symbols, dependencies, ownership, impact.
- **Journey:** connect repo → index → explore graph → open a symbol → trace references → plan a change.
- **Components:** `GraphCanvas`, `RecordTable`, symbol view, impact panel.
- **Inputs:** repository, branch, query, symbol.
- **Actions:** search, navigate, trace callers, view history, open in IDE, create task.
- **Permissions:** T0 read; indexing is a background run with progress and cancel.
- **Deviations:** index staleness is always visible (`Indexed 3 commits ago · Refresh`); a stale index never claims completeness.
- **Relationships:** C3, C4, C1, G5 registry.

**C3 · Code Review** — `Planned` — `/review`, `/review/:reviewId`

- **Purpose:** native review supplementing the required external reviewers.
- **Journey:** select PR or branch → review runs → read findings by severity → apply patch or reply → re-check exact head.
- **Components:** `DiffViewer`, findings list with severity/category filters, evidence panel, `VerificationBadge`.
- **Inputs:** repository, PR/branch, exact head SHA, review profile.
- **Actions:** comment, suggest patch, apply patch to branch, re-review, mark resolved, request external review.
- **Permissions:** T0 to review; T1 to push fixes to the PR branch; T3 to merge.
- **Deviations:** every finding shows file, line, severity, evidence and consequence; a stale-head review is labelled `Reviewed an earlier commit`.
- **Relationships:** C4 tests, A2 runs, the repository's PR-only policy (§12).

**C4 · Testing Lab** — `Planned` — `/tests`, `/tests/:suiteId`

- **Purpose:** requirements → acceptance criteria → executed tests, with honest evidence.
- **Journey:** import requirements → generate cases → review → run in the cloud → inspect failures → fix → re-run.
- **Components:** suite table, case detail, run matrix, coverage meter, `EvidenceCard`.
- **Inputs:** requirements, suite selection, environment, dataset.
- **Actions:** generate, edit, run, cancel, compare runs, export report.
- **Permissions:** T1 to add tests; T2 for environments with external effects.
- **Deviations:** mocked runs are labelled `Mocked`, never `Passed`; a test that did not execute is `Skipped` with a reason.
- **Relationships:** C3, C5, A2 verification, §10 acceptance matrix.

**C5 · Reliability Center** — `Planned` — `/reliability`, `/reliability/:incidentId`

- **Purpose:** investigate and resolve failures rather than restating them.
- **Journey:** incident detected → cluster → reproduce → root cause → fix proposal → review → verify after release.
- **Components:** incident table, cluster view, timeline, log viewer, evidence list, fix proposal card.
- **Inputs:** service, window, severity, error grouping.
- **Actions:** investigate (spawns a Work run), reproduce, propose fix, open PR, acknowledge, resolve.
- **Permissions:** T0 read; T1 branch; T2 PR; deploys T3.
- **Deviations:** an incident with no logs shows `Insufficient evidence` rather than a generated hypothesis presented as cause.
- **Relationships:** F5 Observability supplies data; C3/C4 close the loop; failure memory in §9.

**C8 · Evidence Explorer** — `Planned` — `/evidence`, `/evidence/:receiptId`

- **Purpose:** the audit surface for every claim the platform makes.
- **Journey:** filter by project/type/verifier/window → open receipt → inspect inputs, outputs, environment, signature → link to the originating run.
- **Components:** `RecordTable`, `EvidenceCard`, receipt detail, `VerificationBadge`.
- **Inputs:** filters; receipt id.
- **Actions:** verify, export, copy, open source run, revoke a derived claim.
- **Permissions:** T0 read within the owning project.
- **Deviations:** receipts are immutable; corrections are additive with a supersedes link.
- **Relationships:** every module writes here; §10 reads from here.

**F6 · Security Center** — `Preview` — `/security`

- **Purpose:** the owner's single view of grants, sessions, findings and supply chain.
- **Journey:** review posture → inspect a finding → fix or accept with reason → revoke a grant → confirm audit trail.
- **Components:** posture summary (real counts, no zeros for unmeasured areas), grant table with revoke, findings list, dependency and SBOM views, session list.
- **Inputs:** grant, finding, dependency, session.
- **Actions:** revoke, rotate, acknowledge, open fix PR, export audit log.
- **Permissions:** T0 to view; revocation is immediate and unconfirmed for T1, confirmed for T3.
- **Deviations:** unmeasured categories are labelled `Not monitored`, never `0 issues`.
- **Relationships:** `packages/security-lab-core`, `docs/security-lab.md`; enforces §5.3 grants.

**F7 · Capability Registry** — `Planned` — `/registry`

- **Purpose:** the owner's view of what Coderax can actually do versus what competitors can, and what is next.
- **Journey:** browse by category → open a capability → see evidence of our status and competitor sources → follow the linked PRs.
- **Components:** `RecordTable`, status filters, competitor matrix, roadmap lane, `CapabilityBadge`.
- **Inputs:** capability id, product, status, evidence, priority.
- **Actions:** open implementation, open evidence, re-verify, change priority, export.
- **Permissions:** T0 read; editing priority is T1.
- **Deviations:** a capability cannot be marked `Live` without a linked evidence receipt; the UI refuses and explains.
- **Relationships:** §9 schema, §11 plan, competitive intelligence job.

### 7.3 Wave 3 — Creation and delivery

**C6 · Backend Factory** — `Planned` — `/backend`, `/backend/:appId`

- **Purpose:** generate a usable backend — schema, auth, roles, APIs, storage, queues, webhooks, jobs, realtime, secrets — without assembling primitives by hand.
- **Journey:** define entities → relationships and indexes → auth model → endpoints → generate → review migration → deploy to preview → connect app.
- **Screens:** visual schema editor | API explorer | auth & roles | storage | webhooks | jobs | secrets | migrations | monitoring.
- **Components:** `SplitWorkspace`, entity canvas, `RecordTable`, `DiffViewer` for migrations, `SecretInput`, `BudgetMeter`.
- **Permissions:** T1 to edit schema; **migration execution is T3** and always previewed as a diff; secrets are write-only in the UI and never rendered back.
- **Deviations:** a generated endpoint that has not been called successfully is labelled `Generated`, not `Working`; payment scaffolding is created **inactive** with explicit “no paid resource provisioned” copy.
- **Relationships:** C1, C4, C7, A4; consumes Cloud Resources (F4) for capacity.

**C7 · Distribution** — `Planned` — `/distribute`, `/distribute/:projectId`

- **Purpose:** the truth about where an artifact can actually run.
- **Journey:** pick target → see requirements → build → download artifact or publish → verify install.
- **Screens:** target matrix (web, PWA, Android, iOS, Windows, macOS, Linux, extension, CLI) with status per target.
- **Components:** target cards with `CapabilityBadge`, build list, artifact table, `EvidenceCard`.
- **Permissions:** T2 to publish, T3 to sign with a certificate.
- **Deviations:** a target blocked by an account, certificate or store policy shows `Blocked: requires an Apple Developer account` — never a build button that fails at the end. Signing keys are never displayed.
- **Relationships:** D1, C1, A10 (release rollback), G2 (share a build).

**D2 · Template Library** — `Planned` — `/studio/templates`

- **Purpose:** the catalogue described in §8.
- **Journey:** browse/filter → compare → preview (on demand) → customise tokens → use.
- **Components:** `TemplateCard`, filter bar, comparison tray, `ArtifactFrame` for the active preview only.
- **Inputs:** category, density, industry, stack, accessibility profile, licence.
- **Actions:** preview, favourite, compare up to 3, customise, use, export, duplicate as custom.
- **Permissions:** T0 to browse; T1 to create a project from one.
- **Deviations:** a template with a paid dependency is labelled and excluded by default; unlicensed assets are not in the catalogue at all.
- **Relationships:** D1, D3, A4, §6 step 2.

**D3 · Visual Editor + Application DNA** — `Planned` — `/studio/editor/:projectId`

- **Purpose:** edit individual components without regenerating a project, and transplant reusable _functional_ architecture between projects.
- **Journey:** select node → edit props/style from tokens → responsive preview → save version → (DNA) pick a capability → compatibility check → attach.
- **Screens:** canvas | layer tree | property inspector | tokens panel | breakpoint switcher | DNA browser.
- **Components:** `SplitWorkspace`, `DiffViewer`, token editor, `ArtifactFrame`, compatibility report.
- **Permissions:** T1 to edit; DNA import requires licence and security review before attach.
- **Deviations:** DNA transfer shows a compatibility report — dependencies, licence, security findings, conflicting tokens — and refuses on a blocking conflict instead of merging silently. Existing project design is never restyled without an explicit action.
- **Relationships:** D2, A5, A10, C6 (backend DNA), C4 (testing DNA).

**D4 · Asset Factory** — `Planned` — `/studio/assets`

- **Purpose:** original and properly licensed assets with provenance.
- **Journey:** request or upload → generate/edit → review licence → add to library → use in a project.
- **Components:** asset grid with lazy thumbnails, generator panel, licence badge, provenance inspector.
- **Inputs:** prompt or source file, format, dimensions, style, licence requirement.
- **Actions:** generate, edit, regenerate one variant, download, attach to project, archive.
- **Permissions:** generation spends external capacity → T2 with quota; attaching is T1.
- **Deviations:** prompts and scripts are stored **separately** from the media they produced; every asset shows generator, model, date and licence. Synthetic media is labelled in-product where it appears.
- **Relationships:** D5, D6, D7, E4, A5.

---

### 7.4 Wave 4 — Knowledge, memory and productivity

**A9 · Memory Graph** — `Planned` — `/memory`

- **Purpose:** make the platform's memory inspectable, correctable and scoped.
- **Journey:** open graph → filter by project/type/time → select a memory → see its source and dependents → correct, merge or delete.
- **Screens:** graph canvas | list view (authoritative) | memory detail | contradiction queue | project memory settings.
- **Components:** `GraphCanvas`, `RecordTable`, source attribution, `DiffViewer` for merges.
- **Permissions:** T1 to edit; deletion is T2 with an export offer; cross-project disclosure requires an explicit grant.
- **Deviations:** every memory shows **source** and **timestamp** or is labelled `Inferred`; contradictions are surfaced as a queue rather than silently resolved; the graph is a view, never the only way to reach a memory.
- **Relationships:** A1, A2, B3, E3; isolation defaults in §6.5.

**E1 · Deep Research** — `Planned` — `/research`

- **Purpose:** multi-source investigation with traceable claims.
- **Journey:** define question → select source policy → run searches → review evidence table → resolve conflicts → generate report → monitor.
- **Screens:** question & scope | sources | evidence table | claims graph | report editor | monitoring.
- **Components:** `RecordTable`, citation chips, claim/evidence matrix, `DiffViewer` for report revisions.
- **Permissions:** network access is a listed capability; fetching a private URL requires a grant.
- **Deviations:** each claim is tagged `Established`, `Interpreted`, `Uncertain` or `Speculative`; a report cannot be exported with unsupported claims unflagged.
- **Relationships:** E2, E3, C8; feeds E6 and E7.

**E2 · Notebook** — `Planned` — `/notebooks`

- **Purpose:** source-grounded answers and study material over the owner's own corpus.
- **Journey:** create notebook → add sources → ask → inspect grounding → generate study aids → export.
- **Components:** source list with ingestion status, grounded answer with inline citations, generator panel (summary, guide, quiz, cards, mind map, timeline, audio script).
- **Permissions:** T0 within the notebook; ingestion of external URLs is a listed capability.
- **Deviations:** an answer with no supporting passage says so instead of answering from general knowledge; audio output is `Blocked` without an audio provider.
- **Relationships:** E3, E5, E1, A5.

**E3 · Knowledge Library** — `Planned` — `/library`

- **Purpose:** one indexed, searchable home for documents and artifacts.
- **Journey:** search or browse → open → inspect relationships → act (cite, attach, archive).
- **Components:** `RecordTable`, `FilterInput`, tag editor, duplicate and staleness suggestions, backup verification panel.
- **Permissions:** T0 read; T1 organise; deletion is T2 with export.
- **Deviations:** duplicate and obsolete items are **recommendations** with evidence, never auto-deleted; OCR and indexing show per-file status; “backup verified” appears only after a restore test.
- **Relationships:** A3, A9, E1, E2, E4.

**E4 · Office** — `Planned` — `/office`, `/office/:docId`

- **Purpose:** editable documents, sheets, decks, forms, diagrams and boards with one editing experience.
- **Journey:** choose type → write/edit → collaborate with an agent → export in a standard format.
- **Components:** one artifact editor shell with type-specific toolbars, formula bar, slide canvas, whiteboard, kanban.
- **Permissions:** T1 edit; sharing is T2; email/calendar integrations are separate grants per destination.
- **Deviations:** agent edits are attributed and reversible per block; a deck or sheet is never presented as “done” without a rendered check; calendar or email actions name the exact recipient before sending.
- **Relationships:** A5, E2, E7, F1 (approval steps in documents).

**E5 · Learning Academy** — `Planned` — `/learn`

- **Purpose:** adaptive learning with measurable progress.
- **Journey:** pick a goal → diagnostic → plan → lessons and exercises → assessment → review gaps.
- **Components:** roadmap, lesson workspace, exercise runner, quiz, flashcards, knowledge map.
- **Permissions:** T0; generated assessments stay local unless exported.
- **Deviations:** progress is computed from completed, checked work — never from time spent or self-report alone; “mastered” requires a passing assessment with evidence.
- **Relationships:** E2, E1, A9.

**E6 · Invention Laboratory** — `Planned` — `/invent`

- **Purpose:** legitimate invention and engineering exploration with honest validation levels.
- **Journey:** problem → prior art → concept → requirements → model or schematic → simulation → BOM → prototype plan.
- **Components:** requirement sheet, calculation workspace, parametric model viewer, schematic/BOM tables, simulation results, validation ladder.
- **Permissions:** T0 for analysis; CAD/PCB execution requires a verified environment.
- **Deviations:** every result carries a validation level — `Calculated`, `Simulated`, `Prototyped`, `Physically validated` — and the UI never promotes one to another. Qualified human review is stated where required.
- **Relationships:** E1, C6, D4, A5.

**E7 · Business & Career** — `Planned` — `/business`

- **Purpose:** build and operate a small venture, or run a truthful job search.
- **Journey:** idea → market evidence → plan → model → site/materials → operate; or profile → target roles → tailored application → interview prep.
- **Components:** one-page plan, financial model with an explicit assumptions table, competitor table, brand kit, CRM/inventory tables, application tracker.
- **Permissions:** sending applications or emails is T2 per destination, always with a preview of the exact text.
- **Deviations:** financial figures show their assumption source; applications never invent qualifications, and any generated claim is linked to a fact the owner supplied; platform automation rules are stated before any external action.
- **Relationships:** E1, D1, E4, F1.

### 7.5 Wave 5 — Agents, models and councils

**B3 · Workforce** — `Planned` — `/workforce`

- **Purpose:** a team of specialised agents with distinct scopes, tools, models, workloads and results.
- **Journey:** create team → assign roles → set scopes and models → assign objectives → watch workload → review each agent's output and evidence.
- **Screens:** teams list | team board (roles, workloads, current tasks) | agent detail | objective assignment | review queue.
- **Components:** `PresenceBar`, role cards, `RunProgress`, `RecordTable`, `EvidenceList`.
- **Permissions:** each role carries its own grant set; a team never inherits a broader grant than its members have; delegation cannot escalate.
- **Deviations:** **conflict prevention is visible** — two agents touching the same resource produce a `Conflict` banner and a lock indicator, not a silent race. Workload is measured from queued/running items, not estimated.
- **Relationships:** B1, B4, B6, C3 (independent reviewer), A2.

**B4 · AI Council** — `Planned` — `/council`, `/council/:sessionId`

- **Purpose:** better decisions through independent, adversarial, evidence-checked analysis — not five copies of one answer.
- **Journey:** state the decision → assign roles (architect, engineer, security, critic, tester) → independent proposals → cross-examination → evidence requests → recommendation → verification.
- **Screens:** question | participants and assignments | proposals side by side | disagreement map | evidence | final decision.
- **Components:** `SplitWorkspace`, side-by-side proposal columns, `DiffViewer` for competing designs, `EvidenceCard`, decision card.
- **Permissions:** inherits the narrowest grant among participants; the council cannot approve its own T3 actions.
- **Deviations:** proposals are generated **independently** (no shared draft), and the UI marks the point where they were compared. Unresolved disagreement is shown as unresolved, with each side's evidence — the council is forbidden from manufacturing consensus. The final recommendation names which claims were actually tested and which remain judgement.
- **Relationships:** B3, B5, C4 (verification), A2 (executing the chosen design).

**B5 · Model Intelligence Lab** — `Planned` — `/models`, `/models/:modelId`

- **Purpose:** choose models from measured capability under a zero-cost constraint.
- **Journey:** discover available models → run standard evaluations → compare → set routing policy → monitor quota and outages → re-test after changes.
- **Screens:** model list with availability | capability profile | evaluation runs | head-to-head | routing policy | quota and credit expiry | outage board.
- **Components:** `RecordTable`, `MetricStrip`, radar/scorecard charts, `BudgetMeter`, eval comparison table.
- **Inputs:** model, task class, eval dataset, prompt version, temperature/effort.
- **Actions:** run eval, compare, pin a model to a task, re-run after a provider change, export results.
- **Permissions:** evaluation spends capacity → quota-bounded; a model whose cost status is unknown is **excluded**, not guessed.
- **Deviations:** a model with no evaluation shows `Unmeasured` — never a default score. Routing explanations are shown for real decisions (`routed to model B: lower latency, equal coding score`), and quota exhaustion degrades to a queued state rather than a paid fallback.
- **Relationships:** B6, A2, F4; registry entries in §9.

**B6 · Performance Passports** — `Planned` — `/passports`

- **Purpose:** evidence of what each agent has actually done well and badly.
- **Journey:** open passport → filter by task class → inspect outcome history → see failure patterns → decide assignment.
- **Components:** `MetricStrip`, outcome table, failure-memory links, task-class breakdown.
- **Deviations:** every metric states its sample size and window; metrics with fewer than 5 samples are labelled `Insufficient sample`; the passport never displays a synthetic aggregate score.
- **Relationships:** B3, B5, C5, §9 failure memory.

**B7 · Interop (MCP / A2A)** — `Preview` — `/interop`

- **Purpose:** verified interoperability with MCP servers and A2A agents, explicitly authorised.
- **Journey:** add server → inspect declared capabilities → grant scopes → test → enable per agent.
- **Components:** server table, capability inspector, permission summary, test console, health status.
- **Permissions:** installation grants nothing; each tool is a separate T2 grant; third-party access is labelled with provider and terms.
- **Deviations:** a server that fails its handshake is `Blocked: handshake failed` with the safe reason; the UI distinguishes `Connected`, `Degraded` and `Unreachable`.
- **Relationships:** B1, B2, F2, F6 (supply chain).

---

### 7.6 Wave 6 — Media studios

These modules are the ones most likely to be misrepresented by a UI. Every one of them must be able to say “this is a storyboard, not a film”.

**D5 · Movie Studio** — `Planned` / partly `Blocked` — `/film`, `/film/:productionId`

- **Purpose:** take an original film from idea to assembled cut.
- **Journey:** concept → screenplay → scene breakdown → shot list → storyboard → casting and looks → generation (where available) → assembly → sound → captions → export.
- **Screens:** production overview | script editor | scenes | storyboard board | shot list | cast and characters | timeline | assets | renders | export.
- **Components:** timeline editor, scene cards, shot table, `ArtifactFrame` for shot previews, continuity panel, `EvidenceCard` for renders.
- **Permissions:** generation is T2 with quota; likeness use requires a consent record.
- **Deviations:** every shot carries its own status (`Idea`, `Storyboarded`, `Generated`, `Approved`, `In cut`). A production with no generated footage cannot be exported as a film, and the export dialog says exactly what is missing. Continuity conflicts (costume, prop, time of day, character look) are surfaced as findings, not silently smoothed.
- **Relationships:** D4, D6, A5, A10 (cut versions).

**D6 · Avatar Lab** — `Blocked` (synthesis) — `/avatars`, `/avatars/:characterId`

- **Purpose:** original, consented synthetic humans and avatars.
- **Journey:** create character → appearance → voice → personality and scoped memory → animation → environment → preview → export to a project.
- **Screens:** character list | appearance editor | voice | personality | animation | preview | consent and provenance.
- **Components:** 3D/2D preview host, parameter panels, voice recorder/player, consent record form.
- **Permissions:** T2 for generation; **identity provenance and consent are required fields**, not optional metadata.
- **Deviations:** the module cannot produce a likeness of a real person without a recorded consent declaration, and every export carries a synthetic-media disclosure flag. Impersonation use cases are refused by policy, stated in the UI.
- **Relationships:** D5, D7, E4, F6.

**D7 · Game Studio** — `Planned` — `/games`, `/games/:gameId`

- **Purpose:** original playable games with real code, assets and evidence.
- **Journey:** genre and pillars → design document → scene → mechanics and controls → assets → playable build → playtest → export.
- **Screens:** overview | design doc | scenes/levels | entity and mechanic editor | assets | playtest | builds.
- **Components:** level canvas, inspector, playable `ArtifactFrame`, playtest report, build table.
- **Permissions:** T1 edit; build/export T2.
- **Deviations:** originality is a first-class constraint — assets and code are original or licensed, and a genre reference never becomes a copied asset, character, map or brand. Playtest reports distinguish automated runs from human play.
- **Relationships:** D8, D4, C7, C4 (gameplay tests).

**D8 · Gaming Agent** — `Blocked` — `/games/agent/:sessionId`

- **Purpose:** an agent that plays an authorised game toward a measurable objective, and tests games built in this platform.
- **Journey:** choose permitted game → state objective → grant input permission → observe → play → checkpoint → verify completion → review replay.
- **Screens:** objective | live view | agent status | action log | progress | permissions | replay.
- **Components:** game viewport, `StepTimeline`, checkpoint control, emergency stop, `BudgetMeter`.
- **Permissions:** input control is T2 per session, time-bounded; external games require explicit authorisation and must not violate anti-cheat or platform terms — the UI states this before the session starts.
- **Deviations:** emergency stop is always visible and always one action; the action log is complete and replayable; “objective complete” requires an observable condition, not a model's opinion.
- **Blocked on:** a verified execution environment for game input plus per-platform authorisation review.

---

### 7.7 Wave 7 — Cloud, automation and operations

**F3 · Cloud Computer** — `Planned` — `/cloud/computer`

- **Purpose:** authorised browsing and desktop-style work in a cloud session, with owner takeover.
- **Journey:** start session → state objective → agent acts → owner takes control when challenged (login, MFA, captcha) → return control → review recording and evidence.
- **Screens:** live viewport | objective | action log | session controls | downloads | recording | takeover banner.
- **Components:** viewport host, `PresenceBar`, action log, take-control/return-control, emergency stop, `BudgetMeter`.
- **Permissions:** per-session T2 with destination allowlist and time limit; credentials entered by the owner are never stored or logged; a takeover session pauses agent input entirely.
- **Deviations:** the UI never offers to bypass access controls, identity checks or prohibited automation; when a site blocks automation, the session is `Blocked` with a takeover path. Recordings are opt-in and labelled.
- **Relationships:** B3, C3 (visual checks), F4.

**F4 · Cloud Resources** — `Planned` — `/cloud/resources`

- **Purpose:** the governor's face: what is available, what is running, what is admitted, what is refused.
- **Journey:** view capacity → inspect a workload → see admission decision → queue, pause or stop → read forecast.
- **Screens:** capacity summary | workloads | queue | quotas and credits | refusals | forecast.
- **Components:** `MetricStrip`, `BudgetMeter`, workload table, admission explanation card.
- **Permissions:** stop/kill is T1 for the owner's own workloads; nothing here can enable a paid tier.
- **Deviations:** **fail closed is visible.** A refused workload states which limit was hit and shows the queue position instead of a retry button that cannot succeed. Expiring credits show a date. Unknown cost status renders `Unverified — blocked`, never “free”.
- **Relationships:** A2, C1, F3, B5, D7.

**F5 · Observability** — `Planned` — `/ops`

- **Purpose:** operational evidence, not model narration.
- **Journey:** overview → drill into a signal → correlate with a deploy → open an incident in C5.
- **Screens:** service health | logs | traces | errors | latency | database | deployments | flags and experiments.
- **Components:** `MetricStrip`, time-series charts from `series-*` tokens, log viewer, trace waterfall, deployment table.
- **Permissions:** T0 read; rollback and flag changes are T3.
- **Deviations:** every panel names its window and source; empty series say `No data for this window` rather than drawing a flat zero line; session replay is privacy-masked and opt-in.
- **Relationships:** C5, F4, A10, C7.

---

### 7.8 Cross-cutting capabilities

The brief's original differentiators (§43) are not modules. They are **behaviours of the surfaces above**, and each needs one visible home or it does not exist.

| Capability                   | Where it lives in the UI       | Contract                                                                               |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Evidence Engine              | C8, and every completion state | No claim without a receipt or an `Unverified` label                                    |
| Failure Memory               | B6, C5, and inline test hints  | A recorded failure must name the later check that covers it                            |
| Agent Performance Passport   | B6                             | Sample sizes shown; no synthetic score                                                 |
| Project Genome               | A4 → Settings → Genome         | Requirements, architecture, dependencies, reusable capabilities in one readable record |
| Digital Twin                 | A4 → Environments              | A labelled replica; never called production                                            |
| Instruction Compiler         | G1 → Policies                  | Standing instructions shown as enforceable rules with scope and expiry                 |
| Intent Preservation          | A2 → Verifying                 | The run is checked against the original objective, displayed verbatim                  |
| Autonomous Blocker Resolver  | A2 → blocked state             | Up to three alternatives proposed with their trade-offs before asking the owner        |
| Project Archaeologist        | C2 → History                   | Reconstructed architecture labelled `Inferred from commits`                            |
| Abandoned Project Recovery   | A4 → filter `Needs attention`  | Evidence-based resume plan, never automatic deletion                                   |
| Universal Compatibility      | D3 → DNA import                | Blocking conflicts refuse the transfer                                                 |
| Agent Conflict Detector      | B3, C1                         | Resource locks visible before collision                                                |
| Autonomous Documentation     | A4 → Docs                      | Regenerated from verified implementation, diff-reviewed                                |
| Requirement-to-Test Compiler | C4                             | Every requirement maps to at least one case or is flagged                              |
| Capability Black Box         | A2, C8                         | Tool calls, decisions, results, failures replayable                                    |
| Portable Intelligence        | G1 → Export                    | Agent config, skills, memory exported in a documented format                           |
| Counterfactual Simulator     | B4, A10                        | Alternative decisions compared in isolation, labelled simulated                        |
| Self-Improvement Lab         | F7 → Proposals                 | Proposed changes tested in a sandbox; never auto-applied to security or authorization  |

## 8. Template library

Fifty-six templates ship in Wave 3, expanding toward one hundred with no long-term cap. The brief forbids padding the count with recolours, so every template below differs in **at least four** of: layout topology, typographic scale and family, navigation model, density, component styling, responsive behaviour and colour role.

### 8.1 Rules

- **Original only.** Layouts, copy, iconography and imagery are original or properly licensed. No template reproduces a proprietary product's design.
- **Token-native.** Each template is a token set plus a layout composition. It inherits light/dark, radius, type scale and density from the theme system rather than shipping fixed colours.
- **Honest previews.** Exactly one template preview renders at a time (`ArtifactFrame`); all others are cheap posters. A template whose data is simulated says so on the card and in the preview.
- **Comparable.** Any three templates can be compared side by side on density, navigation, accessibility profile and stack.
- **Regenerable, not destructive.** “Regenerate” offers structural variants and never overwrites owner edits without a version checkpoint.
- **Declared licence and dependencies.** A template with a paid dependency is excluded from default results and labelled where shown.

### 8.2 The catalogue

| ID  | Template            | Category  | Layout DNA                              | Type & density                    | Distinctive detail                           |
| --- | ------------------- | --------- | --------------------------------------- | --------------------------------- | -------------------------------------------- |
| L1  | Monolith            | Landing   | Full-bleed hero, single column, one CTA | Display serif, 3 sizes only, airy | Oversized numerals in the hero stat          |
| L2  | Split Ledger        | Landing   | 50/50 split, form pinned right          | Sans, compact form, dense labels  | Live field validation summary                |
| L3  | Terminal            | Landing   | Dark canvas, mono, command demo         | Mono throughout, tight leading    | Copyable command blocks                      |
| L4  | Gallery Scroll      | Landing   | Horizontal snap sections                | Large serif captions, minimal UI  | Progress rail replaces a nav bar             |
| L5  | Bento Grid          | Landing   | Asymmetric 12-column bento              | Mixed scale, medium density       | Tiles resize by content importance           |
| L6  | Long Read           | Landing   | Narrow measure with chapter nav         | Editorial serif, footnotes        | Sticky chapter index                         |
| L7  | Waitlist Minimal    | Landing   | Centred, one input, counter             | Single family, very airy          | Real count only, or “count unavailable”      |
| L8  | Comparison Matrix   | Landing   | Feature table as hero                   | Compact tabular, sticky header    | Row-level “why it matters” expander          |
| L9  | Poster First        | Landing   | Poster + captions, no autoplay          | Bold sans, sparse                 | Caption track and transcript                 |
| L10 | Local Business      | Landing   | Map + hours + action panel              | Warm sans, medium                 | Hours computed from timezone, not hard-coded |
| S1  | Command Deck        | SaaS      | Dense rail + KPI strip + table          | Small sans, compact rows          | Keyboard-first command bar                   |
| S2  | Calm Workspace      | SaaS      | Single column, generous gutters         | Large body, low density           | One primary action per screen                |
| S3  | Ops Console         | SaaS      | Dark, mono tables, status LEDs          | Mono numerals, dense              | Live status without colour-only cues         |
| S4  | Document First      | SaaS      | Editor + outline rail                   | Readable serif body               | Outline generated from structure             |
| S5  | Inbox Triage        | SaaS      | Three-pane mail model                   | Dense lists, short previews       | Bulk actions with undo                       |
| S6  | Board               | SaaS      | Kanban columns + swimlanes              | Compact cards                     | WIP limits surfaced per column               |
| S7  | Week Grid           | SaaS      | Calendar as the primary canvas          | Small labels, time grid           | Drag-to-create with keyboard parity          |
| S8  | Record Grid         | SaaS      | Dense grid + side peek                  | Tabular, compact                  | Saved views in the URL                       |
| S9  | Metrics Studio      | SaaS      | Chart canvas + filter bar               | Chart labels small, titles large  | Every chart states window and source         |
| S10 | Guided Setup        | SaaS      | Full-screen stepper                     | Large headings, one field group   | Progress survives reload                     |
| C1  | Editorial Store     | Commerce  | Full-bleed imagery, serif               | Editorial, airy                   | Product story sections                       |
| C2  | Catalogue           | Commerce  | Filter rail + 4-column grid             | Compact cards                     | Facet counts update live                     |
| C3  | Single Product      | Commerce  | Long scroll, sticky buy bar             | Large type, medium                | Sticky bar collapses on scroll               |
| C4  | Marketplace         | Commerce  | Search-first, card grid                 | Dense cards, trust badges         | Seller verification shown per listing        |
| C5  | Plan Matrix         | Commerce  | Plan comparison table                   | Compact                           | Price, limits and overage stated plainly     |
| C6  | Digital Goods       | Commerce  | Minimal, licence-focused                | Small print present, not hidden   | Licence summary before checkout              |
| P1  | Case Study          | Portfolio | Index → detail with figures             | Mixed display/body                | Before/after figure pairs                    |
| P2  | Photographer        | Portfolio | Masonry, EXIF captions                  | Minimal chrome                    | Keyboard lightbox                            |
| P3  | Developer Portfolio | Portfolio | Mono, repo cards, changelog             | Mono + sans, compact              | Commit activity from real data or omitted    |
| P4  | Personal Blog       | Portfolio | Typographic, almost no chrome           | Serif body, wide margins          | Reading progress as a thin rule              |
| P5  | Documentation       | Docs      | Three-pane with version switch          | Readable, medium                  | Version selector changes all links           |
| P6  | API Reference       | Docs      | Endpoint rail + try-it panel            | Mono code, compact                | “Try it” disabled without a key, with reason |
| A1  | Chat Workspace      | AI        | Session rail + thread                   | Comfortable body                  | Mode and model always visible                |
| A2  | Prompt Studio       | AI        | Library + variables + diff              | Compact forms, mono output        | Variable preview before run                  |
| A3  | Agent Console       | AI        | Run timeline + tool calls               | Dense mono metadata               | Expandable tool payloads, redacted           |
| A4  | Model Compare       | AI        | Two-column outputs, one prompt          | Neutral, medium                   | Diff view between responses                  |
| A5  | Notebook            | AI        | Sources left, grounded answer right     | Readable, medium                  | Citation hover reveals passage               |
| A6  | Voice Assistant     | AI        | Waveform + transcript                   | Large, sparse                     | Push-to-talk and captions                    |
| M1  | Production Board    | Film      | Scenes × status grid                    | Compact cards                     | Call-sheet style day grouping                |
| M2  | Storyboard Strip    | Film      | 16:9 panels in sequence                 | Caption micro-type                | Continuity flags per panel                   |
| M3  | Music Studio        | Audio     | Track timeline + mixer                  | Mono numerals, dense              | Meter values sourced, never decorative       |
| M4  | Podcast Studio      | Audio     | Episode list + waveform editor          | Readable, medium                  | Chapter markers from transcript              |
| M5  | Design System       | Design    | Token tables + component gallery        | Mono labels, medium               | Live states: hover, focus, disabled, error   |
| M6  | Model Viewer        | 3D        | Full viewport + material rail           | Minimal UI                        | Performance badge for polygon budget         |
| G1  | Arcade              | Game      | Attract screen → HUD                    | Display type, minimal             | Input remap screen                           |
| G2  | Level Editor        | Game      | Canvas + entity palette                 | Compact inspector                 | Grid snapping and bounds warnings            |
| G3  | Lobby               | Game      | Roster + ready state                    | Medium, playful                   | Connection quality per player                |
| G4  | Puzzle Grid         | Game      | Centred grid, large targets             | Very large numerals               | Full keyboard and screen-reader play         |
| B1  | Pitch Deck          | Business  | 12-slide arc                            | Large headings, sparse            | Each slide one claim, one proof              |
| B2  | Financial Model     | Business  | Assumptions → outputs                   | Tabular nums, dense               | Assumption provenance per cell               |
| B3  | Research Report     | Knowledge | Findings-first with evidence table      | Readable, medium                  | Confidence tag per finding                   |
| B4  | Course              | Knowledge | Modules, progress, quiz                 | Comfortable                       | Progress from completed checks               |
| B5  | Pipeline Lite       | Business  | Contacts + stage board                  | Compact                           | Activity timeline per contact                |
| W1  | App Shell           | Mobile    | Bottom tabs, list → detail              | Touch-scale type                  | Safe-area and gesture aware                  |
| W2  | Feed                | Mobile    | Card stack, virtualized                 | Comfortable                       | Skeleton placeholders on load                |
| W3  | Cards & Wallet      | Mobile    | Stacked cards + transactions            | Numeric emphasis                  | Masked values until revealed                 |

**Coverage check:** 10 landing, 10 SaaS, 6 commerce, 6 portfolio/docs, 6 AI, 6 creative, 4 game, 5 business/knowledge, 3 mobile. Every category in the brief is represented, and the distribution is deliberate: the owner's most common jobs (landing, SaaS, documentation) get the most starting points.

### 8.3 What makes them more than recolours

A template is rejected at review if it differs from an existing one only in colour, imagery or copy. The minimum bar is four axes from the list in §8.1, and the comparison view exposes those axes so the judgement is not a matter of taste.

### 8.4 Expansion path

| Milestone | Count | Composition                                                                             |
| --------- | ----- | --------------------------------------------------------------------------------------- |
| Wave 3    | 56    | The table above                                                                         |
| Wave 5    | 72    | 8 industry landing pages, 8 data-heavy admin views                                      |
| Wave 7    | 100+  | Owner-authored templates promoted from projects, plus generator output reviewed by hand |

Owner-authored templates enter the same catalogue with a `Custom` origin label and the same licence and dependency checks. Generated templates are reviewed before they are published to the library — an unreviewed generated layout is a variant, not a template.

## 9. Capability registry

A repository-wide search found no capability registry, although the brief requires one. It is the mechanism that keeps the roadmap from becoming a wish list, so it is specified here in full — schema, lifecycle and UI contract.

### 9.1 Record schema

The eight fields the brief requires map to this shape. It belongs in `packages/product-registry` as a new export; `ProductStatus` must **not** be widened, because it is consumed by the CLI and the Electron shell.

```ts
/** Capability vocabulary for the product, distinct from ProductStatus. */
type CapabilityStatus = 'live' | 'preview' | 'experimental' | 'planned' | 'blocked' | 'retired';

type CapabilityKind = 'surface' | 'behaviour' | 'integration' | 'platform' | 'differentiator';

interface Capability {
  id: string; // stable, kebab-case: 'review.inline-findings'
  title: string;
  kind: CapabilityKind;
  module: ModuleId; // 'C3' — the owning module from §3.4
  summary: string; // one sentence, no marketing

  competitors: Array<{
    product: string; // 'CodeRabbit'
    evidenceUrl: string; // official docs or observable product behaviour
    observedAt: string; // ISO date the claim was checked
    note: string; // what they do, factually
  }>;

  implementation: {
    paths: string[]; // repo files proving the state
    evidenceIds: string[]; // C8 receipts; required for 'live'
    issueRefs: string[];
    prRefs: string[];
    commitRefs: string[];
  };

  status: CapabilityStatus;
  dependencies: string[]; // capability ids or external prerequisites
  security: {
    grantTier: 0 | 1 | 2 | 3;
    dataClasses: string[]; // what it may read or emit
    notes: string;
  };
  freeCloud: {
    feasible: boolean;
    requirement: string; // 'no paid inference', 'signing certificate'
    verifiedAt: string | null;
  };
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  acceptance: string[]; // measurable criteria, per §10
  blockers: string[]; // named prerequisites, never 'not enough time'
  nextAction: string;
}
```

### 9.2 Lifecycle rules

| Rule                                                                    | Enforcement                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `live` requires at least one evidence receipt and one repo path         | Registry UI refuses the edit; the API rejects it                     |
| `planned` requires a non-empty `acceptance` and `dependencies`          | Prevents “someday” entries                                           |
| A competitor claim requires `evidenceUrl` and `observedAt`              | No unsourced competitive claims                                      |
| Duplicates are merged, not added                                        | Search by id and title before create; merge keeps both evidence sets |
| `freeCloud.feasible: false` requires a stated requirement and a blocker | This is the honest-blocker path, not a rejection path                |
| Roadmap presence never implies possession                               | The UI never renders a competitor feature as ours                    |

### 9.3 Competitive intelligence loop

The loop is a scheduled Work run, not a manual chore:

1. **Discover** — check official changelogs and docs for the products named in the brief.
2. **Verify** — confirm the feature exists and what it actually does; discard marketing-only claims.
3. **Search our code** — locate an implementation or prove its absence.
4. **Assess** — technical feasibility, zero-cost feasibility, security impact.
5. **Propose** — create a deduplicated capability with acceptance criteria, or update an existing record's evidence.
6. **Surface** — appear in `/registry` under `New findings` for the owner to prioritise. Nothing is promoted to `live` and nothing is implemented autonomously by this loop.

A finding is a proposal. The loop has no write access to code, branches or deployments.

---

## 10. Acceptance matrix

Design work is accepted on observable evidence, not on the existence of a screen. Each row is a testable criterion; the matrix is the shared contract between design, implementation and review.

### 10.1 Required evidence per claim

| Claim               | Minimum evidence                                                     | Never accepted                          |
| ------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| “Screen exists”     | Route reachable in a built client; screenshot or DOM snapshot        | A component file alone                  |
| “Interaction works” | Recorded flow including the failure path                             | A happy-path click                      |
| “Tests pass”        | Command, exit status and output (masked) at the pushed head          | Mocked results presented as integration |
| “Deployed”          | Deployment receipt plus a verified response from the deployed origin | A successful upload                     |
| “Accessible”        | Keyboard traversal of the primary task + one screen-reader pass      | Automated score alone                   |
| “Performant”        | Measured budget value, before and after                              | An assertion that it feels fast         |

### 10.2 Seed matrix

| ID     | Wave | Given                                                | When                                                 | Then                                                                                   | Evidence                         |
| ------ | ---- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| ACC-01 | 0    | An owner on any module route                         | They press ⌘K and type a module name                 | The module is first result and Enter navigates there                                   | Recorded flow; palette unit test |
| ACC-02 | 0    | A module that is `planned`                           | The owner opens its route                            | A blocked state names dependencies and what still works; no working control is shown   | Snapshot; manual check           |
| ACC-03 | 1    | A chat that implies six steps                        | The owner sends it                                   | A plan is proposed with grants and cost; nothing executes before approval              | Recorded flow                    |
| ACC-04 | 1    | A Work run at step 3 of 7                            | The owner navigates to Projects and back             | The run is still running, the pill is accurate, and scroll position is restored        | Recorded flow; resume summary    |
| ACC-05 | 1    | A run whose verification produced no receipt         | It finishes                                          | It renders `Complete · unverified`, not `Complete`                                     | Receipt absence test             |
| ACC-06 | 2    | A checkpoint from two days ago and edits since       | The owner selects restore with `Preserve newer work` | Only untouched components change; a pre-restore checkpoint exists; a receipt is issued | Restore receipt                  |
| ACC-07 | 2    | A capability record with no receipt                  | Someone sets status to `live`                        | The save is refused with the reason                                                    | API rejection test; UI state     |
| ACC-08 | 3    | Two templates of the same category                   | They are compared                                    | At least four stated axes differ                                                       | Comparison view                  |
| ACC-09 | 3    | A template preview grid of 56 items                  | The page loads                                       | At most one live preview surface exists; others are posters                            | DOM count; budget measurement    |
| ACC-10 | 4    | Memory from project A                                | A session in project B queries memory                | Nothing from A is disclosed without a grant                                            | Isolation test on the boundary   |
| ACC-11 | 5    | A council with an unresolved disagreement            | The recommendation is produced                       | The disagreement and both evidence sets remain visible                                 | Council view                     |
| ACC-12 | 6    | A production with storyboards but no generated shots | The owner exports a film                             | Export is refused and lists the missing shots                                          | Export dialog state              |
| ACC-13 | 7    | A workload whose cost status is unknown              | Admission is requested                               | The workload is blocked and queued, never admitted                                     | Governor log; UI state           |
| ACC-14 | all  | Any table below 768px                                | The viewport narrows                                 | The table becomes a card list; no horizontal scroll on the page                        | Responsive capture               |
| ACC-15 | all  | Any new visible string                               | The build runs                                       | The string resolves through `useLocalize()`; English key added                         | Lint + diff                      |

### 10.3 Definition of done for a design change

A frontend change is done when: the route is reachable; loading, empty, error, blocked and success states exist; copy is localized; keyboard and reduced-motion paths work; the module's budget is reported; one focused test or a recorded manual observation exists; and the PR's testing artifact names the pushed head.

---

## 11. Delivery plan

Waves are ordered by dependency, not by ambition. Later modules reuse earlier contracts, so building out of order produces rework.

| Wave                           | Scope                                                                                                                                                                    | Exit criteria                                                                                                                    | Depends on |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **0 · Shell foundation**       | `ModuleShell`, `CapabilityBadge`, `CommandPalette`, run state machine, `EvidenceCard`, seven-state taxonomy, module registry, `/registry` read-only, new semantic tokens | Palette navigates every existing route; every module route renders a truthful state; tokens pass theme and lint checks           | —          |
| **1 · Coherence**              | Upgrade A1-A8, B1, B2, D1, F1, F2, G1-G5 to the module contract; add `ScopeChip`/`ApprovalSheet` to Work; settings routes                                                | Chat↔Work escalation works end to end in one URL; no surface invents its own header or state language                           | 0          |
| **2 · Engineering + evidence** | A10, C1-C5, C8, F6, F7                                                                                                                                                   | A change can be made, reviewed, tested, verified and restored with receipts at every step                                        | 0, 1       |
| **3 · Creation**               | C6, C7, D2, D3, D4 + the 56 templates                                                                                                                                    | A website or dashboard can be created from a template, edited at component level and exported with an honest distribution matrix | 2          |
| **4 · Knowledge**              | A9, E1-E7                                                                                                                                                                | Research and memory are source-attributed and project-scoped                                                                     | 2          |
| **5 · Agents**                 | B3-B7                                                                                                                                                                    | Teams, councils and model routing produce measured results and visible disagreement                                              | 2          |
| **6 · Media**                  | D5-D8                                                                                                                                                                    | Each studio states its validation level per asset and cannot export a placeholder as a finished work                             | 3, 4       |
| **7 · Cloud + ops**            | F3, F4, F5                                                                                                                                                               | Workloads are admitted, refused and explained under a fail-closed governor                                                       | 2, 5       |

### 11.1 Sequencing rationale

- **The palette before the modules.** Without it, every new module invents navigation and the platform becomes a directory of unlisted pages.
- **Evidence before engineering.** Review, tests and reliability all report outcomes; if the receipt component and the `unverified` state do not exist first, they will each invent a weaker version.
- **Time Machine before studios.** Media and design modules produce expensive, hard-to-reproduce artifacts; versioning must already work.
- **Governor before cloud workloads.** The brief's zero-spend rule is enforced at admission; building a workload before the governor means retrofitting refusals into a working path.

### 11.2 PR slicing

| Rule                                                   | Reason                                   |
| ------------------------------------------------------ | ---------------------------------------- |
| One module or one primitive per PR                     | Reviewable, revertable                   |
| Tokens and primitives land before their first consumer | Avoids feature-local CSS                 |
| No PR introduces a route without its state set         | Prevents placeholder pages               |
| No PR adds more than ~40 new locale keys               | Keeps review and translation honest      |
| Copy changes ride with the UI change                   | A string without a key is a broken build |
| Every PR states its budget impact                      | Chunk size, idle requests, preview count |

### 11.3 Non-goals

Redesigning the visual identity; replacing the token system; moving state management wholesale; owning backend behaviour; adding public multi-tenant features; introducing paid services; local execution; second navigation system; a fourth dialog pattern.

---

## 12. Contribution protocol (FreeBuff ↔ Coderax engineering)

This architecture is a design contribution under the brief's §3 and §47. It is scoped accordingly.

### 12.1 Boundary

| FreeBuff does                                                                                                | FreeBuff does not                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Design systems, journey maps, interaction specs, component proposals, responsive and accessibility contracts | Rewrite the native backend or orchestration             |
| Focused frontend changes through the established PR process, when explicitly authorised                      | Own security policy, authorization enforcement or infra |
| New shared primitives and semantic tokens with tests                                                         | Deploy production, merge, or push to a protected branch |
| Honest status language and blocked states                                                                    | Claim completion without evidence                       |

### 12.2 Repository mechanics

Per `AGENTS.md`, which governs:

- Branch from `dev`, target `dev`, pass `--base dev` explicitly (`gh pr create` defaults to `main`). Never backport to `main`.
- Never push to a protected branch; never open a draft PR; never merge.
- Run `npm run verify` and paste its Markdown artifact into the PR's Testing section — it is the acceptance artifact.
- Run `npx tsc --noEmit` in every touched workspace; `tsdown` builds do not typecheck.
- Scoped `npm run sort-imports <paths>`; fix lint and formatting in changed files.
- Read all inline review threads, fix what is valid, reply with the resolving commit, and re-request review at the exact pushed head.
- New state is Jotai; app-global preferences are passed in, not reached for.
- Use `DropdownPopup` + `Ariakit.MenuButton`; do not reintroduce Radix `DropdownMenu`.
- Localize through `useLocalize()`; English keys only.
- Compose `@coderax/client` primitives before writing feature CSS; semantic tokens only.

### 12.3 Coordination with the full engineering agent

Parallel work on one shell is the main risk. These rules are cheap and prevent most collisions:

1. **Claim by module id.** A PR names the module (`C3`) and the files it touches; no two open PRs claim the same module.
2. **Shared surfaces are serialised.** `ModuleShell`, `CommandPalette`, tokens, and the module registry are single-writer: design lands the contract, engineering consumes it, further changes are separate PRs.
3. **No drive-by refactors.** A module PR does not reformat a neighbour.
4. **Contract first.** Where design and backend meet — run states, grant tiers, evidence shape — the contract lands in `packages/data-provider` with types and a spec before either side builds UI against it.
5. **Status is data.** Both sides read `ProductStatus` / `CapabilityStatus`; neither hard-codes a label.
6. **Escalation.** A disagreement about a shared contract is resolved in an issue with both positions and evidence, not by two competing implementations.

---

## 13. Open decisions and blockers

These need the owner's decision or an external prerequisite. None block Wave 0.

| #   | Question                                                        | Recommended                                     | Why it matters                                                   |
| --- | --------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| D1  | Settings: routes or dialog?                                     | Routes with the dialog retained as a shortcut   | Deep links, refresh survival, hub-and-spoke navigation           |
| D2  | Rename `/studio` into a Studio umbrella with child routes?      | Yes, preserving `/studio`                       | Avoids two competing studios                                     |
| D3  | Where does `CapabilityStatus` live?                             | New export in `packages/product-registry`       | Do not widen `ProductStatus`; CLI and Electron consume it        |
| D4  | Add density as a theme-owned property?                          | Yes (`--theme-density-row`)                     | Tables and consoles need density without per-module CSS          |
| D5  | Keep the product switcher alongside the workspace chip?         | Keep, but remove overlapping destinations       | Two switchers listing the same modules is the confusion to avoid |
| D6  | Search federation scope                                         | Messages + files + evidence first; memory later | Each source adds cost and privacy surface                        |
| D7  | Cloud execution provider and admission limits                   | Owner decision                                  | Governs every `Blocked` state in Waves 2-7                       |
| D8  | External agent integrations (FreeBuff / OpenCode / Claude Code) | Opt-in, separately labelled, separately granted | The brief forbids silent substitution                            |

**Known blockers already reflected in the design:** video generation capacity (D5), avatar synthesis (D6), game input environment (D8), OS signing and store accounts (C7), and cloud executors (C1, C6, F3). Each appears as a `Blocked` state with its prerequisite rather than as a missing feature.

---

## Appendix A — Where things live

| Concern                      | Home                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| Shell, drawer, mobile        | `client/src/routes/Root.tsx`, `client/src/components/UnifiedSidebar/` |
| Routes                       | `client/src/routes/index.tsx`                                         |
| Rail links                   | `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`                      |
| Side-panel links             | `client/src/hooks/Nav/useSideNavLinks.ts`                             |
| Active panel persistence     | `client/src/Providers/ActivePanelContext.tsx`                         |
| Semantic tokens              | `packages/client/src/theme/tokens.css`, `defaults.css`                |
| Themes                       | `packages/client/src/theme/themes/`                                   |
| Theme-owned control geometry | `packages/client/tailwind.preset.cjs`                                 |
| Primitives                   | `packages/client/src/components/`                                     |
| Product registry             | `packages/product-registry/index.js`                                  |
| Copy                         | `client/src/locales/en/translation.json`                              |
| Query keys                   | `packages/data-provider/src/keys.ts`                                  |
| Studio limits                | `docs/visual-app-studio.md`                                           |
| Security lab                 | `packages/security-lab-core`, `docs/security-lab.md`                  |

## Appendix B — Vocabulary

| Term                   | Meaning in this document                                             |
| ---------------------- | -------------------------------------------------------------------- |
| **Canvas**             | The routed content area; exactly one per screen                      |
| **Inspector**          | Contextual detail panel for the selected object                      |
| **Run**                | One durable execution with checkpoints and evidence                  |
| **Receipt / Evidence** | Immutable proof an action occurred and was verified                  |
| **Grant**              | Scoped, expiring authorization with quota                            |
| **Blocked**            | Cannot proceed, with a named prerequisite                            |
| **Unverified**         | Finished without proof; an honest terminal state                     |
| **DNA**                | Reusable functional architecture transferred between projects        |
| **Passport**           | Measured performance record for an agent                             |
| **Genome**             | Complete durable record of a project's architecture and capabilities |

---

## Closing note

This document deliberately spends as much space on what the interface must refuse to claim as on what it should display. For a private platform whose owner must trust it with real work, the honest state is the feature.

It is a design specification. It does not assert that any module marked `Planned` or `Blocked` exists, and it should be revised whenever implementation evidence contradicts it — not the other way around.

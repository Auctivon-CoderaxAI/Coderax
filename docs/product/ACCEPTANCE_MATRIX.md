# Coderax Design Acceptance Matrix

**Version:** 1.0  
**Companions:** [Product Design Architecture](PRODUCT_DESIGN_ARCHITECTURE.md) and [Capability Registry](CAPABILITY_REGISTRY.md).  
**Scope:** Criteria for FreeBuff's design handoff and later implementation review. These criteria do not certify current behavior.

## A. Design handoff gates

| ID | Area | Acceptance criteria | Evidence |
| --- | --- | --- | --- |
| AC-01 | Existing interface | Desktop/tablet/phone shell reviewed; nav, themes, Chat/Work, settings and existing workflows mapped | Annotated frames and route/component map |
| AC-02 | Information architecture | CX-01 to CX-40 assigned to a parent destination and project context; primary nav stays concise | Navigation map and module catalog |
| AC-03 | Reuse | New screens use current @coderax/client primitives and tokens; missing primitives identified as shared proposals | Existing/new component inventory |
| AC-04 | Status honesty | Available/Experimental/Planned/Unavailable/Blocked are distinct and text-labeled | Example state for every module template |
| AC-05 | Project creation | Goal, type, inputs, criteria, permissions, cloud target and verified cost captured before execution | Clickable flow and form/error states |
| AC-06 | Owner control | No public sharing, membership or external-agent behavior implied; scopes are visible | Permission screens and blocked states |
| AC-07 | Accessibility | Keyboard, focus, screen-reader status, contrast, motion, captions and text scaling covered | Keyboard map and accessibility review |
| AC-08 | Responsive layout | No horizontal scrolling for primary actions; mobile retains stop/revoke controls | Desktop/tablet/mobile frames |
| AC-09 | Performance | Lists/previews/live views are lazy, paginated or virtualized; inactive views release resources | Loading and unmount behavior |
| AC-10 | Free/cloud gate | Cost, quota, expiry, environment and capacity have explicit states; unknown entitlement blocks work | Gate design and verification source |
| AC-11 | No fake controls | Every control maps to real behavior or is marked unavailable; demos are labeled | Control-to-capability map |
| AC-12 | Implementation plan | Small slices have non-overlapping owners, dependencies and measurable criteria | Prioritized plan and handoff |

## B. Runtime acceptance gates

A module cannot be Available until its applicable runtime gates pass.

| ID | Gate | Pass condition |
| --- | --- | --- |
| RT-01 | Identity and scope | Backend authenticates owner and revalidates project, agent, repo and integration scope on each protected operation |
| RT-02 | Zero-cost admission | Work starts only when entitlement, quota, capacity and cost boundary are verified for that request |
| RT-03 | Cloud execution | Builds, inference, tests, rendering, simulation and agent work use authorized verified cloud runtime |
| RT-04 | Agent identity | Coderax Native remains default; external runtimes are opt-in, labeled and isolated |
| RT-05 | Lifecycle | Plan, queued, running, paused, cancelled, failed, retrying and completed are real persisted transitions |
| RT-06 | Cancellation/recovery | Stop/revoke reaches server; resume/retry identifies the supported checkpoint/input state |
| RT-07 | Evidence | Receipt names actual tests, artifacts, sources, reviewed commit and deployed SHA only when each occurred |
| RT-08 | Data isolation | Project memory/files/tool outputs/audit data do not leak across projects or external agents |
| RT-09 | Accessibility | Keyboard, screen reader, announcements, contrast and responsive behavior meet design |
| RT-10 | Safe errors | Stable safe codes/localized actions; no raw exceptions, secrets or stack traces |
| RT-11 | Reversible state | Restore previews impact and protects later work; irreversible action reviews exact target |
| RT-12 | Review/release | Changes follow branch, review, CI and release policy; deployed revision verified independently |

## C. Module acceptance coverage

| Module IDs | Design-specific checks |
| --- | --- |
| CX-01 to CX-03 | Chat/Work preserve one conversation, drafts, attachments and history; Work shows agent/model, plan, scopes, cancel and evidence |
| CX-04 to CX-06 | Model access reflects account entitlement; council participants are distinct; workforce agents have least privilege |
| CX-07 to CX-09 | Memories show sources and project boundaries; restore previews diffs; project search cannot expose unauthorized data |
| CX-10 to CX-15 | Repo identity/branch policy visible; IDE/tests use approved cloud runtimes; reviews bind to exact revision |
| CX-16 to CX-21 | API/template/flow controls never fake services; retry identifies workflow version/inputs; integration permissions reviewed |
| CX-22 to CX-28 | Remote computer is visibly remote; research citations, notebook sources, office versions and media consent inspectable |
| CX-29 to CX-35 | Asset rights and synthetic consent visible; game scope, simulation validity and external submission approval explicit |
| CX-36 to CX-40 | Telemetry masks secrets; security controls remain; resource governor fails closed; registry links evidence |

## D. Required screen states

For each screen/action, include applicable states: initial and delayed loading; empty project/no results/no model/no source; planned/experimental/unavailable/blocked; success with artifact and next action; recoverable failure and retry details; denied/expired/revoked permission; quota exhausted/unverified entitlement/capacity unavailable; running/pause/takeover/cancel/reconnect/resume; partial completion; destructive action review; restore preview/conflict; degraded/offline without labeling local fallback compliant cloud execution.

## E. Definition of done

A design handoff is accepted when AC-01 through AC-12 have inspectable evidence and every CX module has its own owner journey, screens, inputs/actions, permission boundary, states, accessibility/responsive behavior and dependencies. Runtime availability requires RT-01 through RT-12 as applicable. A skipped gate remains Blocked or Experimental with its dependency; it cannot silently become Available.

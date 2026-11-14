/**
 * Every claim below is traceable to the repository: README.md (v0.8.8 notes),
 * the client route table, or the published OpenAPI surface. Nothing here is
 * invented — no customers, no prices, no usage numbers.
 */

export const brand = {
  name: 'Coderax',
  release: 'v0.8.8',
  tagline: 'The self-hosted agent workspace with a paper trail.',
};

export const nav = {
  links: [
    { label: 'Product', href: '#product' },
    { label: 'How it works', href: '#how' },
    { label: 'Security', href: '#security' },
    { label: 'FAQ', href: '#faq' },
  ],
  signIn: { label: 'Sign in', href: '/connect' },
  cta: { label: 'Get started', href: '/register' },
};

export const hero = {
  eyebrow: 'Self-hosted · Agent Management API in beta',
  title: ['Agents that touch your code.', 'With a paper trail.'],
  highlight: 'paper trail',
  description:
    'Coderax runs agents against real workspaces: they read trees, search files, author changes and run Bash. Every write and command passes a policy you set, and every model round lands in a trace you can read.',
  primary: { label: 'Get started', href: '/register' },
  secondary: { label: 'See how it works', href: '#how' },
  meta: ['Docker Compose', 'OIDC identities', 'OpenTelemetry export', 'Windows desktop'],
};

export const preview = {
  caption:
    'Composed from three Coderax surfaces: the agent thread, the code-approval prompt, and the trace viewer.',
  tabs: [
    {
      key: 'thread',
      label: 'Agent thread',
      title: 'Work in the open',
      description:
        'Tool activity, reasoning and search collapse into one thread, so a long run reads as a sequence of decisions rather than a wall of output.',
    },
    {
      key: 'approvals',
      label: 'Approvals',
      title: 'Ask, Allow or Deny',
      description:
        'File writes and command execution are gated per deployment. Full access exists, but it is a deliberate choice an administrator grants.',
    },
    {
      key: 'trace',
      label: 'Trace viewer',
      title: 'Every round, with cost',
      description:
        'Inspect ordered model conversations, tool rounds and spend, then export correlated logs over OpenTelemetry.',
    },
  ],
};

export const thread = {
  agent: 'Release agent',
  workspace: 'coderax/platform',
  steps: [
    {
      kind: 'search' as const,
      label: 'Searched 214 files',
      detail: 'grep "buildLoginRedirectUrl" — 3 matches in client/src/routes',
    },
    {
      kind: 'read' as const,
      label: 'Read useAuthRedirect.ts',
      detail: '905 bytes · client/src/routes/useAuthRedirect.ts',
    },
    {
      kind: 'write' as const,
      label: 'Proposed 1 file change',
      detail: 'client/src/routes/useAuthRedirect.ts · +12 −4',
    },
    {
      kind: 'bash' as const,
      label: 'Ran bun run typecheck',
      detail: 'exit 0 · 41s · timeout 120s',
    },
  ],
  usage: [
    { label: 'Dialogue', value: 38 },
    { label: 'Tool traffic', value: 27 },
    { label: 'Agent instructions', value: 14 },
    { label: 'Cache', value: 12 },
    { label: 'Free runway', value: 9 },
  ],
};

export const features = {
  eyebrow: 'Built for real workspaces',
  title: 'The parts that make agents safe to leave running',
  description:
    'Not a chat window with a code block. A managed environment where agents, files, skills and permissions are all first-class objects.',
  items: [
    {
      title: 'Agent Management API',
      description:
        'Create, discover, update and delete Agents, manage their files and Skills, and authenticate machine clients through deployment-bound OIDC identities.',
      tag: 'Beta',
    },
    {
      title: 'Attached workspaces',
      description:
        'Give an agent a default workspace, then let it inspect trees, read and search files, author changes and run Bash under bounded timeouts.',
      tag: 'Experimental',
    },
    {
      title: 'Code approval controls',
      description:
        'Choose Ask, Allow or Deny for file writes and command execution wherever administrators permit it, including a Full access mode for trusted environments.',
      tag: 'Policy',
    },
    {
      title: 'Context you can inspect',
      description:
        'Break down dialogue, retained tool traffic, instructions, cache, cost and runway pressure — without double-counting the subsets.',
      tag: 'Context',
    },
    {
      title: 'Projects, Skills, Prompts',
      description:
        'Reusable instructions and tools live beside the workspace they act on, scoped by role and granted per Agent.',
      tag: 'Workspace',
    },
    {
      title: 'Trace viewer and export',
      description:
        'Read ordered model conversations and tool rounds with costs attached, then ship correlated application logs through OpenTelemetry.',
      tag: 'Observability',
    },
  ],
};

export const how = {
  eyebrow: 'How it works',
  title: 'Four decisions, then it runs',
  steps: [
    {
      title: 'Deploy it yourself',
      body: 'Bring up the stack with Docker Compose. Your repositories, keys and transcripts never leave infrastructure you control.',
    },
    {
      title: 'Connect a model',
      body: 'Pick from the supported model list, including GPT-6 Astra and GPT-6.1 Sol with Responses API routing and tool-call support.',
    },
    {
      title: 'Attach a workspace',
      body: 'Point an Agent at a repository and set its Git identity. Personal workers enrol themselves and report readiness back.',
    },
    {
      title: 'Set the policy',
      body: 'Decide what agents may write and execute. Approvals are per deployment, so full access is granted deliberately, not by default.',
    },
  ],
};

export const security = {
  eyebrow: 'Security posture',
  title: 'Self-hosted by default, not as an afterthought',
  points: [
    {
      title: 'Your infrastructure',
      body: 'Docker Compose deployment with your own database, Redis and object storage. No hosted control plane in the request path.',
    },
    {
      title: 'Identity-bound clients',
      body: 'Machine clients authenticate through deployment-bound OIDC identities that preserve existing role and Agent access controls.',
    },
    {
      title: 'Scoped by role',
      body: 'Role grants decide which tools exist at all — File Search and Run Code are provisioned only when the role allows them.',
    },
    {
      title: 'Tenant isolation',
      body: 'Shared-link throttling, tenant isolation and bounded uploads are enforced server-side, not in the client.',
    },
  ],
};

export const faq = {
  eyebrow: 'FAQ',
  title: 'Questions worth asking before you attach a repo',
  items: [
    {
      q: 'Can an agent change files without approval?',
      a: 'Only if an administrator sets it that way. File writes and command execution default to Ask, with Allow and Deny available per deployment. Full access is a separate, explicit mode for trusted attached environments.',
    },
    {
      q: 'Where does my code and transcript data live?',
      a: 'In your deployment. Coderax is self-hosted with Docker Compose; the model provider receives the request, and nothing else leaves your infrastructure.',
    },
    {
      q: 'How do I know what an agent actually did?',
      a: 'The trace viewer shows ordered model conversations, tool rounds and costs for a run. Correlated application logs can be exported over OpenTelemetry, and Langfuse trace identity and metadata can be allowlisted.',
    },
    {
      q: 'Can I share a conversation without giving away the workspace?',
      a: 'Yes. Share links resolve at /share/:shareId and are throttled server-side. They expose the conversation, not the attached workspace.',
    },
    {
      q: 'Does it work without a browser?',
      a: 'There is a Windows desktop client. On first launch you enter the URL of your deployment; remote servers require HTTPS, with HTTP accepted only for local loopback development.',
    },
    {
      q: 'What does it cost?',
      a: 'This page does not list plans, because the repository does not define any. Deployment is self-hosted, so your cost is infrastructure plus model usage.',
    },
  ],
};

export const footer = {
  blurb: 'A self-hosted workspace for agents that touch real code.',
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Chat', href: '/connect' },
        { label: 'Projects', href: '/projects' },
        { label: 'Skills', href: '/skills' },
        { label: 'Agents', href: '/agents' },
      ],
    },
    {
      title: 'Account',
      links: [
        { label: 'Sign in', href: '/connect' },
        { label: 'Create account', href: '/register' },
        { label: 'Reset password', href: '/forgot-password' },
      ],
    },
  ],
  legal: 'Coderax is self-hosted software. This page describes the build in this repository.',
};

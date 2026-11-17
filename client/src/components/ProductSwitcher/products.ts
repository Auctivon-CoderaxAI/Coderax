/**
 * Product data for the switcher.
 *
 * Mirrors `packages/product-registry/index.js`, the canonical registry used by
 * the CLI. Duplicated here rather than imported across the workspace root so
 * the client build stays self-contained; keep the two in step when a product's
 * status changes, and add a parity test once one exists.
 */

export type ProductStatus = 'live' | 'preview' | 'in-development';

export type IconName =
  | 'Monitor'
  | 'TerminalSquare'
  | 'Globe'
  | 'CloudCog'
  | 'MessagesSquare';

export interface Product {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: ProductStatus;
  availabilityNote: string;
  icon: IconName;
  shortcut: string;
  launchKind: 'internal' | 'external' | 'none';
  target: string | null;
  cta: string;
  roadmap: string[];
}

export const STATUS_LABELS: Record<ProductStatus, string> = {
  live: 'Live',
  preview: 'Preview',
  'in-development': 'In development',
};

export const PRODUCTS: Product[] = [
  {
    id: 'desktop',
    name: 'Desktop',
    tagline: 'Installable app for Windows, macOS and Linux',
    description:
      'The full Coderax workspace in a native window with local file access, auto-updates and the same account as the browser.',
    status: 'preview',
    availabilityNote:
      'Electron sources and the Windows packager exist in desktop/; no signed installer artifact has been verified yet.',
    icon: 'Monitor',
    shortcut: '1',
    launchKind: 'none',
    target: null,
    cta: 'View install options',
    roadmap: [
      'Verify the Windows installer artifact from desktop/package.ps1',
      'Sign and notarise macOS builds',
      'Publish the auto-update feed',
    ],
  },
  {
    id: 'web',
    name: 'Web',
    tagline: 'The complete Coderax app in your browser',
    description:
      'Chat, Work mode, agents, tools, projects and settings, served from the existing React client with your saved conversations intact.',
    status: 'live',
    availabilityNote: 'The production web client is deployed and serving traffic.',
    icon: 'Globe',
    shortcut: '3',
    launchKind: 'internal',
    target: '/c/new',
    cta: 'Open Coderax Web',
    roadmap: [],
  },
  {
    id: 'chat',
    name: 'Chat',
    tagline: 'Unified AI conversation across every client',
    description:
      'Multi-model chat with streaming responses, thinking effort, files, agents and MCP tools \u2014 shared by Web, Desktop and the CLI.',
    status: 'live',
    availabilityNote:
      'The existing chat and Work surfaces are the live implementation of this product.',
    icon: 'MessagesSquare',
    shortcut: '5',
    launchKind: 'internal',
    target: '/c/new',
    cta: 'Start a conversation',
    roadmap: [],
  },
  {
    id: 'cli',
    name: 'CLI',
    tagline: 'Coderax from your terminal',
    description:
      'Sign in, chat, run agents and drive Cloud projects from PowerShell or bash, with JSON output and meaningful exit codes for automation.',
    status: 'preview',
    availabilityNote:
      'The CLI is maintained in the external Coderax-CLI repository (https://github.com/Auctivon-CoderaxAI/Coderax-CLI); it is not published to npm and the in-repo cli/ package is deprecated.',
    icon: 'TerminalSquare',
    shortcut: '2',
    launchKind: 'none',
    target: null,
    cta: 'See CLI setup',
    roadmap: [
      'Publish the external Coderax-CLI package to npm',
      'Device-code login flow against the Coderax API',
      'Cloud subcommands once Cloud execution exists',
    ],
  },
  {
    id: 'cloud',
    name: 'Cloud',
    tagline: 'Remote agents and sandboxed execution',
    description:
      'Connect a repository, provision an isolated workspace and let agents build and test away from your machine, with logs you can watch.',
    status: 'in-development',
    availabilityNote:
      'No managed executor exists in this repository yet; nothing is billed and no workspace can be provisioned.',
    icon: 'CloudCog',
    shortcut: '4',
    launchKind: 'none',
    target: null,
    cta: 'See the Cloud roadmap',
    roadmap: [
      'Sandbox provider selection and cost ceilings',
      'Repository authorisation and workspace provisioning',
      'Job queue, live logs, cancellation and cleanup',
      'Quota metering tied to subscription entitlements',
    ],
  },
];

export const PRODUCT_ORDER = ['desktop', 'cli', 'web', 'cloud', 'chat'];

export function getOrderedProducts(): Product[] {
  return PRODUCT_ORDER.map((id) => PRODUCTS.find((product) => product.id === id)).filter(
    (product): product is Product => Boolean(product),
  );
}

/** The product a pathname belongs to, for highlighting the rail. */
export function productForPath(pathname: string): string | null {
  if (!pathname) {
    return null;
  }
  if (/^\/(cloud|projects)(\/|$)/.test(pathname)) {
    return 'cloud';
  }
  if (/^\/(c|chat)(\/|$)/.test(pathname) || pathname === '/') {
    return 'chat';
  }
  return 'web';
}

export const STATUS_DOT: Record<ProductStatus, string> = {
  live: 'var(--accent-primary, #126e6b)',
  preview: '#b7791f',
  'in-development': 'var(--text-secondary, #6b7280)',
};

# Visual App Studio (MVP)

Coderax Visual App Studio is a local-first, deterministic page builder at /studio in the existing Coderax application. It is not yet equivalent to Vercel v0.

## Included

- Prompt-driven starter layouts: landing page, example analytics dashboard, example storefront, or example booking site.
- Editable standalone HTML, passive live preview, split/code/preview layouts, one-step generation undo.
- Browser-local draft persistence, copy source, and standalone HTML download.
- Explicit demo labels for simulated data and nonfunctional bookings/checkouts.
- No paid API or model requirement.

## Not yet built

AI model-backed code generation, arbitrary multi-file React apps, GitHub export, remote persistence, isolated build services, collaboration and actual deployment are not implemented. Browser storage is not suitable for secret or highly sensitive project content. Downloading HTML does not publish a site.

## Security

- The iframe uses an empty sandbox attribute: no scripts, same-origin access, forms or top navigation.
- A CSP with default-src none is prepended to the preview head to restrict resource loads. Even if invalid HTML bypasses the CSP injection position, the iframe sandbox remains the primary isolation.
- Generated markup escapes user text before inserting it into HTML.
- No credentials are shipped client-side; no API endpoints or existing auth rules are changed.
- Exported edited HTML may be dangerous when subsequently deployed outside the preview. Review independently.

## Validation instructions, not claims

From the client directory, with dependencies installed:

    npx jest src/lib/studio/templates.test.ts --runInBand
    npm run typecheck
    npm run build

Also open /studio in an authenticated or permitted guest session, edit HTML, inspect the iframe sandbox, confirm persistence, and download the source. Run CI and live smoke checks before merging. No production readiness is asserted by this document.

## Future implementation gates

1. Integrate a backend-authorized Coderax/CyVox/ModelGateway AI adapter with explicit free-capacity failures.
2. Add versioned multi-file projects and isolate untrusted bundler and preview execution outside the host process.
3. Add GitHub export through scoped authorization and read-back verified commits/PRs.
4. Integrate DeploymentPlatform behind cost approval, health probes and rollback.
5. Pass tests, security review and live deployment checks before enabling broadly.

/**
 * Owner-gated OpenCode execution inside the Work chat ingress.
 *
 * This is deliberately not a general engine picker: the deployment enables it
 * with `engines.workChat.enabled`, and only an ADMIN may reach it. Everyone
 * else, and every request with a selected agent or attachments, continues to
 * the native runner. The branch reuses the existing Work conversation, message
 * rows and cancel route; it never creates a second task lifecycle.
 */

export * from './workChat/index';

import { SystemRoles } from 'coderax-data-provider';

/**
 * Coderax has one privileged principal: the owner. The engine's own API is
 * owner-token authenticated, so the gateway must never let a non-owner reach it
 * with the server-held credential. This mirrors the existing app convention
 * (`SystemRoles.ADMIN`) rather than inventing a second definition of owner.
 */
export function isOwnerUser(user: unknown): boolean {
  if (user == null || typeof user !== 'object') {
    return false;
  }
  return (user as { role?: unknown }).role === SystemRoles.ADMIN;
}

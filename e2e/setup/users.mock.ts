import type { User } from '../types';
import { getE2ECredentials } from './credentials';

export function getPrimaryE2EUser(): User {
  return getE2ECredentials().primary;
}

export function getSecondaryE2EUser(): User {
  return getE2ECredentials().secondary;
}

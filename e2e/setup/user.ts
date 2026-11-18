import type { User } from '../types';
import { getE2ECredentials } from './credentials';

export function getE2EUser(): User {
  return getE2ECredentials().primary;
}

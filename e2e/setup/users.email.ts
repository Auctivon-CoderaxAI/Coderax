import type { User } from '../types';
import { getE2ECredentials } from './credentials';

export function getEmailChangeUser(): User {
  return getE2ECredentials().emailChange;
}

export function getEmailChangeTarget(): string {
  return getE2ECredentials().emailChangeTarget;
}

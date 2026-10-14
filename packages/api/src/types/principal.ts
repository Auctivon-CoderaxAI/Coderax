import type { PrincipalType } from 'coderax-data-provider';
import type { Types } from 'mongoose';

export interface ResolvedPrincipal {
  principalType: PrincipalType;
  principalId?: string | Types.ObjectId;
}

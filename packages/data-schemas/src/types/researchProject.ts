import type {
  TResearchClaim,
  TResearchProjectStatus,
  TResearchSource,
} from 'coderax-data-provider';
import type { Document, Types } from 'mongoose';

export type IResearchSource = TResearchSource;
export type IResearchClaim = TResearchClaim;

export interface IResearchProject {
  _id?: Types.ObjectId;
  title: string;
  question: string;
  status: TResearchProjectStatus;
  /** Every write bumps this; a stale write is refused rather than overwriting. */
  revision: number;
  sources: IResearchSource[];
  claims: IResearchClaim[];
  user: string;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IResearchProjectDocument extends Omit<IResearchProject, '_id'>, Document {}

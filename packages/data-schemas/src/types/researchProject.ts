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

/** Atomic per-owner admission counter for the project limit. */
export interface IResearchProjectQuota {
  _id?: Types.ObjectId;
  user: string;
  count: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IResearchProjectQuotaDocument
  extends Omit<IResearchProjectQuota, '_id'>,
    Document {}

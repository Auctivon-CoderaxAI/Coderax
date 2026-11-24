import type { TGameSpec, TGameStatus } from 'coderax-data-provider';
import type { Document, Types } from 'mongoose';

export type IGameSpec = TGameSpec;

export interface IGameProject {
  _id?: Types.ObjectId;
  name: string;
  summary?: string;
  status: TGameStatus;
  /** Every write bumps this; a stale write is refused rather than overwriting. */
  revision: number;
  specRevision: number;
  spec?: IGameSpec | null;
  user: string;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IGameProjectDocument extends Omit<IGameProject, '_id'>, Document {}

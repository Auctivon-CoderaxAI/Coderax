import { Model } from 'mongoose';
import type { IWorkRun } from '~/types/workRun';
import workRunSchema from '~/schema/workRun';

/** Cross-replica Work run leases; they expire and are reclaimed, not archived. */
export function createWorkRunModel(mongoose: typeof import('mongoose')): Model<IWorkRun> {
  return mongoose.models.WorkRun || mongoose.model<IWorkRun>('WorkRun', workRunSchema);
}

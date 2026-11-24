import { Model } from 'mongoose';
import type { IGameProjectDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import gameProjectSchema from '~/schema/gameProject';

export function createGameProjectModel(
  mongoose: typeof import('mongoose'),
): Model<IGameProjectDocument> {
  applyTenantIsolation(gameProjectSchema);
  return (
    mongoose.models.GameProject ||
    mongoose.model<IGameProjectDocument>('GameProject', gameProjectSchema, 'gameprojects')
  );
}

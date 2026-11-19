import { Model } from 'mongoose';
import type { IMovieProjectDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import movieProjectSchema from '~/schema/movieProject';

export function createMovieProjectModel(
  mongoose: typeof import('mongoose'),
): Model<IMovieProjectDocument> {
  applyTenantIsolation(movieProjectSchema);
  return (
    mongoose.models.MovieProject ||
    mongoose.model<IMovieProjectDocument>('MovieProject', movieProjectSchema, 'movieprojects')
  );
}

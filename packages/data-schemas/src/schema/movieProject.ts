import { Schema } from 'mongoose';
import type { IMovieProjectDocument } from '~/types';

const movieProjectSchema: Schema<IMovieProjectDocument> = new Schema<IMovieProjectDocument>(
  {
    user: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    logline: {
      type: String,
      default: '',
      maxlength: 4000,
    },
    genre: {
      type: String,
      default: '',
      maxlength: 200,
    },
    ratingTarget: {
      type: String,
      default: 'R (target; no MPA rating claimed)',
      maxlength: 200,
    },
    aspectRatio: {
      type: String,
      enum: ['16:9', '9:16'],
      default: '16:9',
    },
    status: {
      type: String,
      enum: ['development', 'production', 'review', 'complete'],
      default: 'development',
    },
    /**
     * Creative documents are embedded so a scene plan, its shots, and the render
     * receipts that reference them share one revision. Shot-level validation
     * lives in the movie module rather than in a parallel set of subdocuments.
     */
    characters: {
      type: Schema.Types.Mixed,
      default: [],
    },
    scenes: {
      type: Schema.Types.Mixed,
      default: [],
    },
    jobs: {
      type: Schema.Types.Mixed,
      default: [],
    },
    revision: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

movieProjectSchema.index({ user: 1, updatedAt: -1, _id: -1 });

export default movieProjectSchema;

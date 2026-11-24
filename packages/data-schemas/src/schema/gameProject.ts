import { Schema } from 'mongoose';
import {
  GAME_CAMERAS,
  GAME_GENRES,
  GAME_STATUSES,
  MAX_GAME_NAME_LENGTH,
  MAX_GAME_PROMPT_LENGTH,
  MAX_GAME_SPEC_FIELD_LENGTH,
  MAX_GAME_SUMMARY_LENGTH,
} from 'coderax-data-provider';
import type { IGameProjectDocument, IGameSpec } from '~/types';

const gameSpecSchema: Schema<IGameSpec> = new Schema<IGameSpec>(
  {
    prompt: { type: String, required: true, trim: true, maxlength: MAX_GAME_PROMPT_LENGTH },
    genre: { type: String, enum: GAME_GENRES, required: true },
    camera: { type: String, enum: GAME_CAMERAS, required: true },
    players: { type: Number, enum: [1, 2], required: true },
    coreLoop: { type: String, default: '', maxlength: MAX_GAME_SPEC_FIELD_LENGTH },
    winCondition: { type: String, default: '', maxlength: MAX_GAME_SPEC_FIELD_LENGTH },
    artDirection: { type: String, default: '', maxlength: MAX_GAME_SPEC_FIELD_LENGTH },
  },
  { _id: false },
);

const gameProjectSchema: Schema<IGameProjectDocument> = new Schema<IGameProjectDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_GAME_NAME_LENGTH,
      index: true,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
      maxlength: MAX_GAME_SUMMARY_LENGTH,
    },
    status: {
      type: String,
      enum: GAME_STATUSES,
      default: 'draft',
      index: true,
    },
    revision: {
      type: Number,
      default: 1,
      min: 1,
    },
    specRevision: {
      type: Number,
      default: 0,
      min: 0,
    },
    spec: {
      type: gameSpecSchema,
      default: null,
    },
    user: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

gameProjectSchema.index({ user: 1, createdAt: -1, _id: -1 });
gameProjectSchema.index({ user: 1, name: 1 });

export default gameProjectSchema;

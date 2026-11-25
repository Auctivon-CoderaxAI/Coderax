import { Schema } from 'mongoose';
import {
  MAX_RESEARCH_CLAIM_LENGTH,
  MAX_RESEARCH_CLAIMS,
  MAX_RESEARCH_EXCERPT_LENGTH,
  MAX_RESEARCH_NOTE_LENGTH,
  MAX_RESEARCH_PUBLISHER_LENGTH,
  MAX_RESEARCH_QUESTION_LENGTH,
  MAX_RESEARCH_SOURCES,
  MAX_RESEARCH_SOURCE_TITLE_LENGTH,
  MAX_RESEARCH_SOURCE_URL_LENGTH,
  MAX_RESEARCH_TITLE_LENGTH,
  RESEARCH_CLAIM_STATUSES,
  RESEARCH_PROJECT_STATUSES,
  RESEARCH_SOURCE_KINDS,
} from 'coderax-data-provider';
import type { IResearchClaim, IResearchProjectDocument, IResearchSource } from '~/types';

const researchSourceSchema: Schema<IResearchSource> = new Schema<IResearchSource>(
  {
    id: { type: String, required: true, maxlength: 64 },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_RESEARCH_SOURCE_TITLE_LENGTH,
    },
    url: { type: String, required: true, trim: true, maxlength: MAX_RESEARCH_SOURCE_URL_LENGTH },
    publisher: { type: String, default: '', trim: true, maxlength: MAX_RESEARCH_PUBLISHER_LENGTH },
    kind: { type: String, enum: RESEARCH_SOURCE_KINDS, required: true },
    excerpt: { type: String, default: '', maxlength: MAX_RESEARCH_EXCERPT_LENGTH },
    note: { type: String, default: '', maxlength: MAX_RESEARCH_NOTE_LENGTH },
    retrievedAt: { type: String, default: '', maxlength: 40 },
  },
  { _id: false },
);

const researchClaimSchema: Schema<IResearchClaim> = new Schema<IResearchClaim>(
  {
    id: { type: String, required: true, maxlength: 64 },
    text: { type: String, required: true, trim: true, maxlength: MAX_RESEARCH_CLAIM_LENGTH },
    status: { type: String, enum: RESEARCH_CLAIM_STATUSES, required: true },
    sourceIds: { type: [String], default: [] },
  },
  { _id: false },
);

const researchProjectSchema: Schema<IResearchProjectDocument> =
  new Schema<IResearchProjectDocument>(
    {
      title: {
        type: String,
        required: true,
        trim: true,
        maxlength: MAX_RESEARCH_TITLE_LENGTH,
        index: true,
      },
      question: {
        type: String,
        default: '',
        maxlength: MAX_RESEARCH_QUESTION_LENGTH,
      },
      status: {
        type: String,
        enum: RESEARCH_PROJECT_STATUSES,
        default: 'draft',
        index: true,
      },
      revision: {
        type: Number,
        default: 1,
        min: 1,
      },
      sources: {
        type: [researchSourceSchema],
        default: [],
        validate: {
          validator: (value: IResearchSource[]) => value.length <= MAX_RESEARCH_SOURCES,
          message: 'Too many sources',
        },
      },
      claims: {
        type: [researchClaimSchema],
        default: [],
        validate: {
          validator: (value: IResearchClaim[]) => value.length <= MAX_RESEARCH_CLAIMS,
          message: 'Too many claims',
        },
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

researchProjectSchema.index({ user: 1, createdAt: -1, _id: -1 });
researchProjectSchema.index({ user: 1, title: 1 });

export default researchProjectSchema;

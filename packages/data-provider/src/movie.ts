export type MovieProjectStatus = 'development' | 'production' | 'review' | 'complete';

export type MovieShotStatus =
  | 'planned'
  | 'queued'
  | 'generating'
  | 'blocked'
  | 'rendered'
  | 'approved'
  | 'rejected';

export type MovieJobState =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type MovieJobKind = 'generation' | 'assembly' | 'audio';

export interface TMovieCharacter {
  id: string;
  name: string;
  age: number;
  role: string;
  appearance: string;
  wardrobe: string;
  voice: string;
  performance: string;
}

export interface TMovieDialogue {
  speakerId: string;
  text: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface TMovieShot {
  id: string;
  order: number;
  title: string;
  camera: string;
  lensMm: number;
  lighting: string;
  action: string;
  dialogue: TMovieDialogue[];
  durationSeconds: number;
  status: MovieShotStatus;
  prompt: string;
  notes: string;
  artifactId?: string | null;
  lastJobId?: string | null;
}

export interface TMovieScene {
  id: string;
  number: number;
  title: string;
  slugline: string;
  synopsis: string;
  location: string;
  timeOfDay: string;
  characterIds: string[];
  dialogue: TMovieDialogue[];
  durationSeconds: number;
  mood: string;
  shots: TMovieShot[];
}

export interface TMovieJob {
  id: string;
  sceneId: string;
  shotId: string | null;
  kind: MovieJobKind;
  state: MovieJobState;
  providerJobId: string | null;
  provider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  checkpoint: string;
  createdAt: string;
  updatedAt: string;
}

export interface TMovieProject {
  id: string;
  title: string;
  logline: string;
  genre: string;
  ratingTarget: string;
  aspectRatio: '16:9' | '9:16';
  status: MovieProjectStatus;
  characters: TMovieCharacter[];
  scenes: TMovieScene[];
  jobs: TMovieJob[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TMovieServiceState {
  service: 'generation' | 'render' | 'audio';
  configured: boolean;
  ready: boolean;
  code: string | null;
  detail: string | null;
}

export interface TMovieProductionStatus {
  projectId: string;
  providerReady: boolean;
  services: TMovieServiceState[];
  blockedShots: number;
  plannedShots: number;
  approvedShots: number;
  runningJobs: number;
}

export interface TCreateMovieProjectRequest {
  title: string;
  logline?: string;
  genre?: string;
  ratingTarget?: string;
  aspectRatio?: '16:9' | '9:16';
  characters?: TMovieCharacter[];
  scenes?: TMovieScene[];
}

export interface TUpdateMovieProjectRequest {
  title?: string;
  logline?: string;
  status?: MovieProjectStatus;
  revision?: number;
  characters?: TMovieCharacter[];
  scenes?: TMovieScene[];
}

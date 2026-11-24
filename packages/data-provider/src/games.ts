/**
 * Game Studio contracts shared by the API and the client.
 *
 * M1 persists a project and its design spec only. Builds, playtests and agent
 * sessions have no workload executor in this deployment, so the capability
 * flags below are constant and must stay false until one is verified.
 */

export const MAX_GAME_NAME_LENGTH = 100;
export const MAX_GAME_SUMMARY_LENGTH = 600;
export const MAX_GAME_PROMPT_LENGTH = 2000;
export const MAX_GAME_SPEC_FIELD_LENGTH = 2000;
export const MAX_GAME_PROJECTS_PER_OWNER_CEILING = 200;
export const DEFAULT_GAME_PROJECTS_PER_OWNER = 50;

export const GAME_GENRES = [
  'platformer',
  'puzzle',
  'shooter',
  'strategy',
  'role_playing',
  'other',
] as const;
export type TGameGenre = (typeof GAME_GENRES)[number];

export const GAME_CAMERAS = [
  'side_view',
  'top_down',
  'isometric',
  'first_person',
  'ui_only',
] as const;
export type TGameCamera = (typeof GAME_CAMERAS)[number];

export const GAME_STATUSES = ['draft', 'spec_ready'] as const;
export type TGameStatus = (typeof GAME_STATUSES)[number];

/** The persisted design brief. Everything here is authored or reviewed by the owner. */
export type TGameSpec = {
  prompt: string;
  genre: TGameGenre;
  camera: TGameCamera;
  players: 1 | 2;
  coreLoop: string;
  winCondition: string;
  artDirection: string;
};

export type TGameProject = {
  _id: string;
  name: string;
  summary: string;
  status: TGameStatus;
  /** Bumped by every write; a spec save sends the revision it was based on. */
  revision: number;
  specRevision: number;
  spec: TGameSpec | null;
  createdAt: string;
  updatedAt: string;
};

export type TGameProjectListResponse = {
  projects: TGameProject[];
  nextCursor: string | null;
};

export type TCreateGameProjectRequest = {
  name: string;
  summary?: string;
  /** Seeds the project spec from a gallery entry; the owner still reviews it. */
  templateId?: string;
};

export type TUpdateGameProjectRequest = {
  gameId: string;
  name?: string;
  summary?: string;
};

export type TSaveGameSpecRequest = {
  gameId: string;
  spec: TGameSpec;
  expectedRevision: number;
};

/**
 * Server-reported capability gate. The client renders these surfaces from this
 * value rather than guessing, so a future executor flips one source of truth.
 */
export type TGameCapabilities = {
  executor: 'unavailable';
  builds: false;
  playtests: false;
  agentSessions: false;
  reason: string;
};

export const GAME_CAPABILITIES: TGameCapabilities = {
  executor: 'unavailable',
  builds: false,
  playtests: false,
  agentSessions: false,
  reason:
    'No verified cloud workload executor is available in this deployment, so nothing can be built, played or tested yet.',
};

export type TGameTemplate = {
  id: string;
  name: string;
  genre: TGameGenre;
  summary: string;
  spec: TGameSpec;
};

/** Original premises written for this project; no third-party assets or branding. */
export const GAME_TEMPLATES: readonly TGameTemplate[] = [
  {
    id: 'lantern-run',
    name: 'Lantern Run',
    genre: 'platformer',
    summary:
      'A lamplighter crosses a sleeping town at dusk, relighting beacons before the night closes in.',
    spec: {
      prompt:
        'A side-view platformer about a lamplighter relighting beacons across a quiet town before nightfall.',
      genre: 'platformer',
      camera: 'side_view',
      players: 1,
      coreLoop:
        'Run and jump between rooftops, collect oil, and decide which beacons to light before the timer runs out.',
      winCondition: 'Light every beacon in the district before the night meter empties.',
      artDirection: 'Muted dusk palette, warm lantern pools, simple geometric silhouettes.',
    },
  },
  {
    id: 'circuit-garden',
    name: 'Circuit Garden',
    genre: 'puzzle',
    summary: 'Route power through a garden of living circuitry without overloading the roots.',
    spec: {
      prompt:
        'A calm top-down puzzle about routing power through plant-like circuits without overloading them.',
      genre: 'puzzle',
      camera: 'top_down',
      players: 1,
      coreLoop:
        'Rotate and connect tiles, watch the load spread, and re-route before a branch overloads.',
      winCondition: 'Power every seed node in the garden using a single source.',
      artDirection: 'Soft greens and copper traces, gentle glow on powered paths.',
    },
  },
  {
    id: 'tide-harbor',
    name: 'Tide Harbor',
    genre: 'strategy',
    summary:
      'Balance a small harbor through shifting tides: dock space, cargo and weather all compete.',
    spec: {
      prompt:
        'A compact top-down strategy game about running a harbor where the tide changes what can dock.',
      genre: 'strategy',
      camera: 'top_down',
      players: 1,
      coreLoop:
        'Assign incoming ships to berths, trade cargo, and adapt when the tide removes options.',
      winCondition: 'Reach the season target without letting a ship miss its deadline.',
      artDirection: 'Flat maritime palette, readable berth markers, restrained motion.',
    },
  },
  {
    id: 'signal-drift',
    name: 'Signal Drift',
    genre: 'shooter',
    summary:
      'Steer a survey drone through an asteroid field, clearing interference nodes under time pressure.',
    spec: {
      prompt:
        'A top-down arcade shooter about a survey drone clearing interference nodes in an asteroid field.',
      genre: 'shooter',
      camera: 'top_down',
      players: 2,
      coreLoop:
        'Move, aim and dash between asteroids; each cleared node opens the route a little further.',
      winCondition: 'Clear all interference nodes before the drone hull reaches zero.',
      artDirection: 'Deep space blues, high-contrast projectiles, minimal HUD.',
    },
  },
];

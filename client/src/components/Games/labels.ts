import type { TGameCamera, TGameGenre } from 'coderax-data-provider';

export const GENRE_LABEL_KEYS = {
  platformer: 'com_games_genre_platformer',
  puzzle: 'com_games_genre_puzzle',
  shooter: 'com_games_genre_shooter',
  strategy: 'com_games_genre_strategy',
  role_playing: 'com_games_genre_role_playing',
  other: 'com_games_genre_other',
} as const satisfies Record<TGameGenre, string>;

export const CAMERA_LABEL_KEYS = {
  side_view: 'com_games_camera_side_view',
  top_down: 'com_games_camera_top_down',
  isometric: 'com_games_camera_isometric',
  first_person: 'com_games_camera_first_person',
  ui_only: 'com_games_camera_ui_only',
} as const satisfies Record<TGameCamera, string>;

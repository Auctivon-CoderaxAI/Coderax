import type {
  TMovieCharacter,
  TMovieDialogue,
  TMovieProject,
  TMovieScene,
  TMovieShot,
} from 'coderax-data-provider';

const MAX_SCENES = 200;
const MAX_SHOTS_PER_SCENE = 40;
const MIN_SHOT_SECONDS = 0.5;
const MAX_SHOT_SECONDS = 60;

type ShotBeat = {
  title: string;
  camera: string;
  lensMm: number;
  fraction: number;
  lighting: string;
  action: (scene: TMovieScene) => string;
};

/**
 * A deterministic shot grammar. It plans coverage from the scene's written beats; it
 * does not invent story or dialogue, and it never claims a planned shot has motion.
 */
const SHOT_BEATS: ShotBeat[] = [
  {
    title: 'Establishing wide',
    camera: 'Slow dolly-in, eye level, 24 fps',
    lensMm: 28,
    fraction: 0.24,
    lighting: 'Motivated practicals, soft key, deep background falloff',
    action: (scene) =>
      `Wide view of ${scene.location}. ${scene.synopsis} The frame holds long enough to read the space and the character's position in it.`,
  },
  {
    title: 'Approach',
    camera: 'Handheld follow, chest height, natural weight',
    lensMm: 35,
    fraction: 0.18,
    lighting: 'Warm practical key from frame left, cool city fill from windows',
    action: () =>
      'The character crosses the space with natural weight, heel-to-toe contact, and a continuous eye-line. Shoulders and hips counter-rotate; no sliding or floating.',
  },
  {
    title: 'Reaction close-up',
    camera: 'Static close-up, shallow focus on the eyes',
    lensMm: 85,
    fraction: 0.14,
    lighting: 'Soft key, negative fill, catchlights from the window',
    action: () =>
      'Close on the character listening. Micro-expressions move through recognition, calculation, and decision; breath is visible. Blinks land on the cut, not mid-line.',
  },
  {
    title: 'Dialogue coverage',
    camera: 'Over-the-shoulder, slow push-in',
    lensMm: 50,
    fraction: 0.22,
    lighting: 'Key-side practical, rim light separating the silhouette from the city',
    action: () =>
      'The speaker delivers the scene dialogue to camera with visible lip, jaw, and tongue articulation synchronized to the recorded line.',
  },
  {
    title: 'Threshold reveal',
    camera: 'Tracking approach, slight parallax against the doorway',
    lensMm: 35,
    fraction: 0.12,
    lighting: 'Doorway spill, harder backlight, rain reflections on the floor',
    action: () =>
      'The character moves toward the doorway as the threshold enters frame. The camera tracks with the body, then settles as the character stops.',
  },
  {
    title: 'Final hold',
    camera: 'Slow push-in, locked horizon',
    lensMm: 85,
    fraction: 0.1,
    lighting: 'Single soft source, controlled falloff, no flat fill',
    action: () =>
      'Final close-up holds on the decision. The performance stays alive in the eyes and breath while the camera settles.',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parseCharacters(value: unknown): TMovieCharacter[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError('characters must be an array of at most 100 entries');
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`characters[${index}] must be an object`);
    }
    const id = readString(entry.id);
    const name = readString(entry.name);
    if (!id || !name) {
      throw new TypeError(`characters[${index}] requires id and name`);
    }
    if (ids.has(id)) {
      throw new TypeError(`duplicate character id ${id}`);
    }
    ids.add(id);
    return {
      id,
      name,
      age: Math.round(clamp(readNumber(entry.age, 25), 25, 120)),
      role: readString(entry.role, 'supporting'),
      appearance: readString(entry.appearance),
      wardrobe: readString(entry.wardrobe),
      voice: readString(entry.voice),
      performance: readString(entry.performance),
    };
  });
}

export function parseDialogue(value: unknown, shotLabel: string): TMovieDialogue[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 40) {
    throw new TypeError(`${shotLabel}.dialogue must be an array of at most 40 entries`);
  }
  return value.map((line, index) => {
    if (!isRecord(line)) {
      throw new TypeError(`${shotLabel}.dialogue[${index}] must be an object`);
    }
    const speakerId = readString(line.speakerId);
    const text = readString(line.text);
    if (!speakerId || !text) {
      throw new TypeError(`${shotLabel}.dialogue[${index}] requires speakerId and text`);
    }
    return { speakerId, text };
  });
}

export function parseShots(value: unknown, sceneLabel: string): TMovieShot[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_SHOTS_PER_SCENE) {
    throw new TypeError(`${sceneLabel}.shots must be an array of at most ${MAX_SHOTS_PER_SCENE}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`${sceneLabel}.shots[${index}] must be an object`);
    }
    const id = readString(entry.id) || `${sceneLabel}-S${index + 1}`;
    return {
      id,
      order: index + 1,
      title: readString(entry.title, `Shot ${index + 1}`),
      camera: readString(entry.camera),
      lensMm: Math.round(clamp(readNumber(entry.lensMm, 35), 8, 300)),
      lighting: readString(entry.lighting),
      action: readString(entry.action),
      dialogue: parseDialogue(entry.dialogue, `${sceneLabel}.shots[${index}]`),
      durationSeconds: round(clamp(readNumber(entry.durationSeconds, 3), MIN_SHOT_SECONDS, MAX_SHOT_SECONDS)),
      status: 'planned',
      prompt: readString(entry.prompt),
      notes: readString(entry.notes),
      artifactId: null,
      lastJobId: null,
    };
  });
}

export function parseScenes(value: unknown): TMovieScene[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_SCENES) {
    throw new TypeError(`scenes must be an array of at most ${MAX_SCENES}`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`scenes[${index}] must be an object`);
    }
    const id = readString(entry.id) || `SC${index + 1}`;
    if (ids.has(id)) {
      throw new TypeError(`duplicate scene id ${id}`);
    }
    ids.add(id);
    const number = Math.max(1, Math.round(readNumber(entry.number, index + 1)));
    const label = `scenes[${index}]`;
    const scene: TMovieScene = {
      id,
      number,
      title: readString(entry.title, `Scene ${number}`),
      slugline: readString(entry.slugline, 'INT. LOCATION - NIGHT'),
      synopsis: readString(entry.synopsis),
      location: readString(entry.location, 'Interior'),
      timeOfDay: readString(entry.timeOfDay, 'NIGHT'),
      characterIds: Array.isArray(entry.characterIds)
        ? entry.characterIds.filter((item): item is string => typeof item === 'string')
        : [],
      dialogue: parseDialogue(entry.dialogue, label),
      durationSeconds: round(clamp(readNumber(entry.durationSeconds, 5), 1, 600)),
      mood: readString(entry.mood),
      shots: parseShots(entry.shots, label),
    };
    return scene;
  });
}

function beatDurations(totalSeconds: number, beatCount: number): number[] {
  const weights = SHOT_BEATS.slice(0, beatCount).map((beat) => beat.fraction);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (totalSeconds * weight) / weightTotal);
  const rounded = raw.map((seconds) =>
    round(clamp(seconds, MIN_SHOT_SECONDS, MAX_SHOT_SECONDS)),
  );
  const drift = round(totalSeconds - rounded.reduce((sum, seconds) => sum + seconds, 0));
  rounded[rounded.length - 1] = round(
    clamp(rounded[rounded.length - 1] + drift, MIN_SHOT_SECONDS, MAX_SHOT_SECONDS),
  );
  return rounded;
}

function estimatedDialogueSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return clamp(words / 2.6, 0.8, 6);
}

/**
 * Expands one scene into coverage. Existing planned shots are preserved so replanning
 * after a review never discards an approved or rendered shot.
 */
export function planSceneShots(scene: TMovieScene): TMovieShot[] {
  const kept = scene.shots.filter((shot) => shot.status !== 'planned');
  const plannedIds = new Set(kept.map((shot) => shot.id));
  const beats = SHOT_BEATS.slice(0, 6);
  const durations = beatDurations(scene.durationSeconds, beats.length);
  const scenePrefix = scene.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'SC';
  const shots: TMovieShot[] = [];

  beats.forEach((beat, index) => {
    const id = `${scenePrefix}-S${index + 1}`;
    if (plannedIds.has(id)) {
      return;
    }
    const shot: TMovieShot = {
      id,
      order: index + 1,
      title: beat.title,
      camera: beat.camera,
      lensMm: beat.lensMm,
      lighting: beat.lighting,
      action: beat.action(scene),
      dialogue: [],
      durationSeconds: durations[index],
      status: 'planned',
      prompt: '',
      notes: '',
      artifactId: null,
      lastJobId: null,
    };
    shots.push(shot);
  });

  const dialogueShots = shots.filter((_, index) => index >= 2);
  const sceneDialogue = [...scene.dialogue, ...scene.shots.flatMap((shot) => shot.dialogue)];
  let lineCursor = 0;
  for (const line of sceneDialogue) {
    const target = dialogueShots[lineCursor % Math.max(dialogueShots.length, 1)];
    if (target) {
      target.dialogue.push(line);
    }
    lineCursor += 1;
  }

  let shotStart = 0;
  for (const shot of shots) {
    if (shot.dialogue.length === 0) {
      shotStart += shot.durationSeconds;
      continue;
    }
    let lineStart = shotStart + 0.2;
    for (const line of shot.dialogue) {
      const duration = estimatedDialogueSeconds(line.text);
      line.startSeconds = round(lineStart);
      line.endSeconds = round(
        Math.min(lineStart + duration, shotStart + shot.durationSeconds - 0.1),
      );
      lineStart = (line.endSeconds ?? lineStart) + 0.1;
    }
    shotStart += shot.durationSeconds;
  }

  return [...kept, ...shots].sort((a, b) => a.order - b.order).map((shot, index) => ({
    ...shot,
    order: index + 1,
  }));
}

function characterLook(character: TMovieCharacter | undefined): string {
  if (!character) {
    return '';
  }
  return `${character.name} (${character.age}), ${character.appearance}. Wardrobe: ${character.wardrobe}. Voice: ${character.voice}.`;
}

export function buildShotPrompt(
  project: Pick<TMovieProject, 'title'>,
  scene: TMovieScene,
  shot: TMovieShot,
  characters: TMovieCharacter[],
): string {
  const cast = scene.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .map(characterLook)
    .filter(Boolean)
    .join(' ');
  const dialogue = shot.dialogue
    .map((line) => {
      const speaker = characters.find((character) => character.id === line.speakerId);
      return `${speaker?.name ?? line.speakerId}: "${line.text}"`;
    })
    .join(' ');
  return [
    `Photorealistic cinematic film footage for "${project.title}".`,
    `Scene ${scene.number}: ${scene.slugline}. ${scene.mood}`,
    cast,
    `Action: ${shot.action}`,
    `Camera: ${shot.camera}, ${shot.lensMm}mm lens.`,
    `Lighting: ${shot.lighting}.`,
    dialogue ? `Synchronized dialogue: ${dialogue}` : '',
    'Continuity: the same adult actor face, hair, body type, and wardrobe in every shot of this scene. Natural body mechanics, weight, and eye-lines. Landscape 16:9. No text, no captions, no watermark, no logo, no extra faces, no celebrity likeness.',
  ]
    .filter(Boolean)
    .join(' ');
}

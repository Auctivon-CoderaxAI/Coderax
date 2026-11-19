import { buildShotPrompt, parseScenes, planSceneShots } from './planner';

const scene = {
  id: 'S01',
  number: 1,
  title: 'The Rain Room',
  slugline: "INT. MARA'S APARTMENT - NIGHT",
  synopsis: 'Mara turns from the window and walks toward the doorway.',
  location: 'Apartment',
  timeOfDay: 'NIGHT',
  characterIds: ['mara'],
  dialogue: [{ speakerId: 'mara', text: "You weren't supposed to find me." }],
  durationSeconds: 5,
  mood: 'Rain and threat',
  shots: [],
};

const characters = [
  {
    id: 'mara',
    name: 'Mara Voss',
    age: 32,
    role: 'lead',
    appearance: 'olive skin, hazel eyes, scar through the left eyebrow',
    wardrobe: 'charcoal knit sweater',
    voice: 'low and measured',
    performance: 'guarded',
  },
];

describe('movie planner', () => {
  it('expands a scene into coverage that adds up to the scene duration', () => {
    const shots = planSceneShots(scene);
    expect(shots).toHaveLength(6);
    const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
    expect(total).toBeCloseTo(5, 1);
    expect(shots.every((shot) => shot.status === 'planned')).toBe(true);
  });

  it('places authored dialogue on a dialogue-bearing shot with timing', () => {
    const shots = planSceneShots(scene);
    const withDialogue = shots.filter((shot) => shot.dialogue.length > 0);
    expect(withDialogue.length).toBeGreaterThan(0);
    for (const shot of withDialogue) {
      for (const line of shot.dialogue) {
        expect(line.text).toBe("You weren't supposed to find me.");
        expect(line.startSeconds).toBeGreaterThanOrEqual(0);
        expect(line.endSeconds).toBeGreaterThan(line.startSeconds ?? 0);
      }
    }
  });

  it('builds a continuity prompt from the character bible and shot direction', () => {
    const shot = planSceneShots(scene)[1];
    const prompt = buildShotPrompt({ title: 'ECHO PROTOCOL' }, scene, shot, characters);
    expect(prompt).toContain('Mara Voss');
    expect(prompt).toContain('charcoal knit sweater');
    expect(prompt).toContain('same adult actor face');
    expect(prompt).toContain('no celebrity likeness');
  });

  it('rejects duplicate scene ids instead of silently overwriting one', () => {
    expect(() => parseScenes([scene, scene])).toThrow('duplicate scene id S01');
  });

  it('clamps planned shot duration into a renderable range', () => {
    const shots = planSceneShots({ ...scene, durationSeconds: 1 });
    expect(shots.every((shot) => shot.durationSeconds >= 0.5)).toBe(true);
  });
});

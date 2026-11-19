import type { TMovieProject } from 'coderax-data-provider';
import type { NeonFrameClient } from './neonframe';
import { NeonFrameError } from './neonframe';
import { queueShotGeneration } from './runner';

const project: TMovieProject = {
  id: 'project-1',
  title: 'ECHO PROTOCOL',
  logline: '',
  genre: '',
  ratingTarget: 'R',
  aspectRatio: '16:9',
  status: 'production',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  characters: [
    {
      id: 'mara',
      name: 'Mara Voss',
      age: 32,
      role: 'lead',
      appearance: 'olive skin',
      wardrobe: 'charcoal sweater',
      voice: 'low',
      performance: 'guarded',
    },
  ],
  scenes: [
    {
      id: 'S01',
      number: 1,
      title: 'The Rain Room',
      slugline: 'INT. APARTMENT - NIGHT',
      synopsis: 'She turns.',
      location: 'Apartment',
      timeOfDay: 'NIGHT',
      characterIds: ['mara'],
      dialogue: [],
      durationSeconds: 5,
      mood: 'rain',
      shots: [
        {
          id: 'S01-S1',
          order: 1,
          title: 'Establishing wide',
          camera: 'dolly',
          lensMm: 28,
          lighting: 'practical',
          action: 'She stands at the window.',
          dialogue: [],
          durationSeconds: 2,
          status: 'planned',
          prompt: '',
          notes: '',
        },
      ],
    },
  ],
  jobs: [],
};

const readyServices = [
  { service: 'generation' as const, configured: true, ready: true, code: null, detail: null },
];

function client(overrides: Partial<NeonFrameClient>): NeonFrameClient {
  return {
    config: {
      generationUrl: 'http://127.0.0.1:4312',
      renderUrl: null,
      audioUrl: null,
      token: null,
      workflowId: 'wan-i2v-5s',
      timeoutMs: 1000,
    },
    status: async () => readyServices,
    submitGeneration: async () => ({ jobId: 'prompt-1', provider: 'comfyui', state: 'submitted' }),
    planAudio: async () => ({}),
    planAssembly: async () => ({}),
    ...overrides,
  };
}

const base = {
  project,
  sceneId: 'S01',
  shotId: 'S01-S1',
  now: () => new Date('2026-11-17T12:00:00.000Z'),
  newId: () => 'job-1',
};

describe('movie shot runner', () => {
  it('records a blocked job when the provider is not ready', async () => {
    const result = await queueShotGeneration({
      ...base,
      client: client({
        status: async () => [
          {
            service: 'generation',
            configured: true,
            ready: false,
            code: 'PROVIDER_UNREACHABLE',
            detail: 'provider state: unavailable',
          },
        ],
      }),
    });
    expect(result.job.state).toBe('blocked');
    expect(result.job.errorCode).toBe('PROVIDER_UNREACHABLE');
    expect(result.shotStatus).toBe('blocked');
  });

  it('submits only when the generation service reports readiness', async () => {
    const submitGeneration = jest.fn(async () => ({
      jobId: 'prompt-1',
      provider: 'comfyui',
      state: 'submitted',
    }));
    const result = await queueShotGeneration({
      ...base,
      client: client({ submitGeneration }),
    });
    expect(submitGeneration).toHaveBeenCalledTimes(1);
    expect(result.job.state).toBe('running');
    expect(result.job.providerJobId).toBe('prompt-1');
    expect(result.job.checkpoint).toBe('provider_accepted');
    expect(result.shotStatus).toBe('generating');
  });

  it('turns a provider rejection into a blocked, sanitized job', async () => {
    const result = await queueShotGeneration({
      ...base,
      client: client({
        submitGeneration: async () => {
          throw new NeonFrameError('PROVIDER_REJECTED', 'ComfyUI rejected the workflow', 502);
        },
      }),
    });
    expect(result.job.state).toBe('blocked');
    expect(result.job.errorCode).toBe('PROVIDER_REJECTED');
    expect(result.job.errorMessage).toBe('ComfyUI rejected the workflow');
  });

  it('refuses to re-render an approved shot', async () => {
    const approved = {
      ...project,
      scenes: [
        {
          ...project.scenes[0],
          shots: [{ ...project.scenes[0].shots[0], status: 'approved' as const }],
        },
      ],
    };
    await expect(
      queueShotGeneration({ ...base, project: approved, client: client({}) }),
    ).rejects.toMatchObject({ code: 'SHOT_APPROVED' });
  });
});

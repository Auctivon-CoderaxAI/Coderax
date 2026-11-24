import mongoose from 'mongoose';
import { createModels, logger } from '..';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TGameSpec } from 'coderax-data-provider';
import { createGameProjectMethods } from './gameProject';

logger.silent = true;

const owner = 'owner-user';
const other = 'other-user';

const spec: TGameSpec = {
  prompt: 'A side-view platformer about relighting beacons.',
  genre: 'platformer',
  camera: 'side_view',
  players: 1,
  coreLoop: 'Jump between rooftops and light beacons.',
  winCondition: 'Light every beacon before nightfall.',
  artDirection: 'Muted dusk palette with warm lantern pools.',
};

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createGameProjectMethods>;
let GameProject: mongoose.Model<unknown>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  GameProject = mongoose.models.GameProject;
  methods = createGameProjectMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await GameProject.deleteMany({});
});

const idOf = (project: { _id?: mongoose.Types.ObjectId }): string => project._id?.toString() ?? '';

async function create(overrides: { name?: string; user?: string; spec?: TGameSpec } = {}) {
  const result = await methods.createGameProject(overrides.user ?? owner, {
    name: overrides.name ?? 'Lantern Run',
    summary: 'A quiet platformer.',
    spec: overrides.spec,
  });
  if (!result.ok) {
    throw new Error(`create failed: ${result.code}`);
  }
  return result.project;
}

describe('game project methods', () => {
  it('creates a draft project with revision 1 and no spec', async () => {
    const project = await create();
    expect(project.name).toBe('Lantern Run');
    expect(project.status).toBe('draft');
    expect(project.revision).toBe(1);
    expect(project.specRevision).toBe(0);
    expect(project.spec).toBeNull();
  });

  it('creates a spec-ready project when a spec is supplied', async () => {
    const project = await create({ spec });
    expect(project.status).toBe('spec_ready');
    expect(project.specRevision).toBe(1);
    expect(project.spec?.genre).toBe('platformer');
  });

  it('persists the spec and survives a reload', async () => {
    const created = await create();
    const saved = await methods.saveGameSpec(owner, idOf(created), spec, 1);
    expect(saved.ok).toBe(true);

    const reloaded = await methods.getGameProject(owner, idOf(created));
    expect(reloaded?.spec?.winCondition).toBe(spec.winCondition);
    expect(reloaded?.status).toBe('spec_ready');
    expect(reloaded?.specRevision).toBe(1);
    expect(reloaded?.revision).toBe(2);
  });

  it('refuses a stale spec write with a conflict and returns the current state', async () => {
    const created = await create();
    const first = await methods.saveGameSpec(owner, idOf(created), spec, 1);
    expect(first.ok).toBe(true);

    const stale = await methods.saveGameSpec(owner, idOf(created), spec, 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe('CONFLICT');
      if (stale.code === 'CONFLICT') {
        expect(stale.project.revision).toBe(2);
        expect(stale.project.specRevision).toBe(1);
      }
    }
  });

  it('returns NOT_FOUND for a foreign owner and writes nothing', async () => {
    const created = await create();
    const id = idOf(created);

    expect(await methods.getGameProject(other, id)).toBeNull();
    expect(await methods.saveGameSpec(other, id, spec, 1)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await methods.updateGameProject(other, id, { name: 'Stolen' })).toBeNull();
    expect(await methods.deleteGameProject(other, id)).toBe(false);

    const stillOwned = await methods.getGameProject(owner, id);
    expect(stillOwned?.name).toBe('Lantern Run');
    expect(stillOwned?.spec).toBeNull();
  });

  it('lists only the requested owner and filters by search', async () => {
    await create({ name: 'Lantern Run' });
    await create({ name: 'Circuit Garden' });
    await create({ name: 'Foreign Game', user: other });

    const ownerList = await methods.listGameProjects(owner);
    expect(ownerList.projects.map((project) => project.name).sort()).toEqual([
      'Circuit Garden',
      'Lantern Run',
    ]);

    const search = await methods.listGameProjects(owner, { search: 'garden' });
    expect(search.projects).toHaveLength(1);
    expect(search.projects[0].name).toBe('Circuit Garden');
  });

  it('paginates with a cursor without repeating or dropping projects', async () => {
    await create({ name: 'One' });
    await create({ name: 'Two' });
    await create({ name: 'Three' });

    const first = await methods.listGameProjects(owner, { limit: 2 });
    expect(first.projects).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await methods.listGameProjects(owner, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.projects).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const names = [...first.projects, ...second.projects].map((project) => project.name);
    expect(new Set(names).size).toBe(3);
  });

  it('enforces the configured project limit', async () => {
    const first = await methods.createGameProject(
      owner,
      { name: 'One' },
      { maxProjectsPerOwner: 1 },
    );
    expect(first.ok).toBe(true);
    const second = await methods.createGameProject(
      owner,
      { name: 'Two' },
      { maxProjectsPerOwner: 1 },
    );
    expect(second).toEqual({ ok: false, code: 'LIMIT_REACHED' });
  });

  it('bumps the revision on rename and deletes only the owner’s project', async () => {
    const created = await create();
    const renamed = await methods.updateGameProject(owner, idOf(created), {
      name: 'Lantern Run Redux',
    });
    expect(renamed?.name).toBe('Lantern Run Redux');
    expect(renamed?.revision).toBe(2);

    expect(await methods.deleteGameProject(owner, idOf(created))).toBe(true);
    expect(await methods.getGameProject(owner, idOf(created))).toBeNull();
  });
});

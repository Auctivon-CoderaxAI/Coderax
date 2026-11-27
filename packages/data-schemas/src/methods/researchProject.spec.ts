import mongoose from 'mongoose';
import { createModels, logger } from '..';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TResearchClaim, TResearchSource } from 'coderax-data-provider';
import { createResearchProjectMethods } from './researchProject';

logger.silent = true;

const owner = 'owner-user';
const other = 'other-user';

const source: TResearchSource = {
  id: 'source-1',
  title: 'Primary filing',
  url: 'https://example.com/filing',
  publisher: 'Example',
  kind: 'primary',
  excerpt: 'The filing states the figure.',
  note: '',
  retrievedAt: '2026-11-20',
};

const claim: TResearchClaim = {
  id: 'claim-1',
  text: 'The figure is 42.',
  status: 'supported',
  sourceIds: ['source-1'],
};

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createResearchProjectMethods>;
let ResearchProject: mongoose.Model<unknown>;
let ResearchProjectQuota: mongoose.Model<unknown>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  // Quota admission must enforce uniqueness even when deployment auto-indexing is off.
  await mongoose.connect(mongoServer.getUri(), { autoIndex: false });
  createModels(mongoose);
  ResearchProject = mongoose.models.ResearchProject;
  ResearchProjectQuota = mongoose.models.ResearchProjectQuota;
  methods = createResearchProjectMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all([ResearchProject.deleteMany({}), ResearchProjectQuota.deleteMany({})]);
});

const idOf = (project: { _id?: mongoose.Types.ObjectId }): string => project._id?.toString() ?? '';

async function create(user: string = owner) {
  const result = await methods.createResearchProject(user, {
    title: 'Free tool calling',
    question: 'Which providers still support it?',
  });
  if (!result.ok) {
    throw new Error(`create failed: ${result.code}`);
  }
  return result.project;
}

describe('research project methods', () => {
  it('creates a draft dossier owned by the caller', async () => {
    const project = await create();

    expect(project.title).toBe('Free tool calling');
    expect(project.question).toBe('Which providers still support it?');
    expect(project.status).toBe('draft');
    expect(project.revision).toBe(1);
    expect(project.sources).toEqual([]);
    expect(project.claims).toEqual([]);
    expect(project.user).toBe(owner);
  });

  it('hides a dossier from another owner', async () => {
    const project = await create();

    expect(await methods.getResearchProject(other, idOf(project))).toBeNull();
    expect(await methods.getResearchProject(owner, idOf(project))).not.toBeNull();
  });

  it('saves with a revision CAS and refuses a stale write', async () => {
    const project = await create();
    const researchId = idOf(project);

    const saved = await methods.saveResearchProject(
      owner,
      researchId,
      {
        title: 'Free tool calling',
        question: 'Which providers still support it?',
        status: 'collecting',
        sources: [source],
        claims: [claim],
      },
      1,
    );
    expect(saved).toEqual(expect.objectContaining({ ok: true }));
    if (!saved.ok) {
      throw new Error('save failed');
    }
    expect(saved.project.revision).toBe(2);
    expect(saved.project.sources).toHaveLength(1);

    const stale = await methods.saveResearchProject(
      owner,
      researchId,
      {
        title: 'Changed elsewhere',
        question: '',
        status: 'collecting',
        sources: [],
        claims: [],
      },
      1,
    );
    expect(stale).toEqual(expect.objectContaining({ ok: false, code: 'CONFLICT' }));
  });

  it('enforces the completion invariant at the persistence boundary', async () => {
    const project = await create();
    const researchId = idOf(project);

    const notReady = await methods.saveResearchProject(
      owner,
      researchId,
      {
        title: 'Free tool calling',
        question: '',
        status: 'complete',
        sources: [source],
        claims: [{ ...claim, sourceIds: [] }],
      },
      1,
    );
    expect(notReady).toEqual(expect.objectContaining({ ok: false, code: 'NOT_READY' }));

    const ready = await methods.saveResearchProject(
      owner,
      researchId,
      {
        title: 'Free tool calling',
        question: '',
        status: 'complete',
        sources: [source],
        claims: [claim],
      },
      1,
    );
    expect(ready).toEqual(expect.objectContaining({ ok: true }));
  });

  it('keeps a completed dossier read-only until it is reopened', async () => {
    const project = await create();
    const researchId = idOf(project);
    const ready = {
      title: 'Free tool calling',
      question: '',
      status: 'complete' as const,
      sources: [source],
      claims: [claim],
    };

    const completed = await methods.saveResearchProject(owner, researchId, ready, 1);
    if (!completed.ok) {
      throw new Error('completion failed');
    }

    const edit = await methods.saveResearchProject(
      owner,
      researchId,
      { ...ready, claims: [{ ...claim, text: 'Changed after completion.' }] },
      completed.project.revision,
    );
    expect(edit).toEqual(
      expect.objectContaining({ ok: false, code: 'READ_ONLY', project: expect.anything() }),
    );

    const reopened = await methods.saveResearchProject(
      owner,
      researchId,
      { ...ready, status: 'review' },
      completed.project.revision,
    );
    expect(reopened).toEqual(expect.objectContaining({ ok: true }));
  });

  it('enforces the owner limit atomically and releases a slot on delete', async () => {
    const first = await methods.createResearchProject(
      owner,
      { title: 'One' },
      { maxProjectsPerOwner: 2 },
    );
    const second = await methods.createResearchProject(
      owner,
      { title: 'Two' },
      { maxProjectsPerOwner: 2 },
    );
    if (!first.ok || !second.ok) {
      throw new Error('setup creates failed');
    }

    expect(
      await methods.createResearchProject(owner, { title: 'Three' }, { maxProjectsPerOwner: 2 }),
    ).toEqual({ ok: false, code: 'LIMIT_REACHED' });
    expect(
      await methods.createResearchProject(other, { title: 'Other' }, { maxProjectsPerOwner: 2 }),
    ).toEqual(expect.objectContaining({ ok: true }));

    await methods.deleteResearchProject(owner, idOf(first.project));
    expect(
      await methods.createResearchProject(owner, { title: 'Three' }, { maxProjectsPerOwner: 2 }),
    ).toEqual(expect.objectContaining({ ok: true }));
  });

  it('never lets concurrent creates exceed the owner limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        methods.createResearchProject(
          owner,
          { title: `Concurrent ${index}` },
          { maxProjectsPerOwner: 3 },
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(await ResearchProject.countDocuments({ user: owner })).toBe(3);
    expect(await ResearchProjectQuota.countDocuments({ user: owner })).toBe(1);
  });

  it('scopes saves and lists to the dossier owner', async () => {
    const project = await create();
    const otherSave = await methods.saveResearchProject(
      other,
      idOf(project),
      {
        title: 'Hijacked',
        question: '',
        status: 'collecting',
        sources: [],
        claims: [],
      },
      1,
    );
    expect(otherSave).toEqual({ ok: false, code: 'NOT_FOUND' });

    await create(other);
    const ownerList = await methods.listResearchProjects(owner, { limit: 10 });
    expect(ownerList.projects).toHaveLength(1);
    expect(ownerList.projects.every((entry) => entry.user === owner)).toBe(true);
  });

  it('deletes only the owner dossier', async () => {
    const project = await create();

    expect(await methods.deleteResearchProject(other, idOf(project))).toBe(false);
    expect(await methods.deleteResearchProject(owner, idOf(project))).toBe(true);
    expect(await methods.getResearchProject(owner, idOf(project))).toBeNull();
  });

  it('searches titles and questions and pages by cursor', async () => {
    await create();
    await methods.createResearchProject(owner, {
      title: 'Deployment cost',
      question: 'What is free?',
    });
    const page = await methods.listResearchProjects(owner, { search: 'deployment', limit: 1 });

    expect(page.projects).toHaveLength(1);
    expect(page.projects[0].title).toBe('Deployment cost');

    const all = await methods.listResearchProjects(owner, { limit: 1 });
    expect(all.projects).toHaveLength(1);
    expect(all.nextCursor).not.toBeNull();
    const next = await methods.listResearchProjects(owner, { limit: 1, cursor: all.nextCursor });
    expect(next.projects).toHaveLength(1);
  });
});

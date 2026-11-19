import type { Model } from 'mongoose';
import type { MovieProjectStatus, TMovieJob } from 'coderax-data-provider';
import type { IMovieProject, IMovieProjectDocument } from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';

export type CreateMovieProjectInput = {
  title: string;
  logline?: string;
  genre?: string;
  ratingTarget?: string;
  aspectRatio?: '16:9' | '9:16';
  characters?: IMovieProject['characters'];
  scenes?: IMovieProject['scenes'];
};

export type UpdateMovieProjectInput = {
  title?: string;
  logline?: string;
  status?: MovieProjectStatus;
  characters?: IMovieProject['characters'];
  scenes?: IMovieProject['scenes'];
};

export type MovieJobPatch = Partial<
  Pick<
    TMovieJob,
    'state' | 'providerJobId' | 'provider' | 'errorCode' | 'errorMessage' | 'checkpoint' | 'attempts'
  >
>;

export interface MovieProjectMethods {
  listMovieProjects(user: string): Promise<IMovieProject[]>;
  getMovieProject(user: string, projectId: string): Promise<IMovieProject | null>;
  createMovieProject(user: string, input: CreateMovieProjectInput): Promise<IMovieProject>;
  updateMovieProject(
    user: string,
    projectId: string,
    input: UpdateMovieProjectInput,
  ): Promise<IMovieProject | null>;
  appendMovieJob(
    user: string,
    projectId: string,
    job: TMovieJob,
  ): Promise<IMovieProject | null>;
  updateMovieJob(
    user: string,
    projectId: string,
    jobId: string,
    patch: MovieJobPatch,
  ): Promise<IMovieProject | null>;
  deleteMovieProject(user: string, projectId: string): Promise<boolean>;
}

const MUTATION_ATTEMPTS = 3;

function cleanTitle(value: string): string {
  return value.trim().slice(0, 200);
}

export const MOVIE_PROJECT_CONFLICT = 'Movie project revision conflict';

export function createMovieProjectMethods(
  mongoose: typeof import('mongoose'),
): MovieProjectMethods {
  const model = () =>
    mongoose.models.MovieProject as Model<IMovieProjectDocument>;

  async function getMovieProject(
    user: string,
    projectId: string,
  ): Promise<IMovieProject | null> {
    if (!isValidObjectIdString(projectId)) {
      return null;
    }
    return await model()
      .findOne({ _id: new mongoose.Types.ObjectId(projectId), user })
      .lean<IMovieProject>();
  }

  /**
   * Scenes, shots and job receipts are embedded, so every write is a compare-and-set
   * on the project revision. A conflicting writer re-reads instead of overwriting a
   * scene plan or a render receipt it never saw.
   */
  async function mutate(
    user: string,
    projectId: string,
    change: (current: IMovieProject) => Partial<IMovieProject>,
  ): Promise<IMovieProject | null> {
    if (!isValidObjectIdString(projectId)) {
      return null;
    }
    const objectId = new mongoose.Types.ObjectId(projectId);
    for (let attempt = 0; attempt < MUTATION_ATTEMPTS; attempt++) {
      const current = await model()
        .findOne({ _id: objectId, user })
        .lean<IMovieProject>();
      if (!current) {
        return null;
      }
      const updated = await model()
        .findOneAndUpdate(
          { _id: objectId, user, revision: current.revision },
          {
            $set: {
              ...change(current),
              revision: current.revision + 1,
            },
          },
          { new: true, runValidators: true },
        )
        .lean<IMovieProject>();
      if (updated) {
        return updated;
      }
    }
    throw new Error(MOVIE_PROJECT_CONFLICT);
  }

  async function listMovieProjects(user: string): Promise<IMovieProject[]> {
    return await model()
      .find({ user })
      .select('title logline genre ratingTarget aspectRatio status revision createdAt updatedAt')
      .sort({ updatedAt: -1, _id: -1 })
      .limit(100)
      .lean<IMovieProject[]>();
  }

  async function createMovieProject(
    user: string,
    input: CreateMovieProjectInput,
  ): Promise<IMovieProject> {
    const title = cleanTitle(input.title);
    if (!title) {
      throw new TypeError('title is required');
    }
    const project = await model().create({
      user,
      title,
      logline: input.logline ?? '',
      genre: input.genre ?? '',
      ratingTarget: input.ratingTarget ?? 'R (target; no MPA rating claimed)',
      aspectRatio: input.aspectRatio ?? '16:9',
      status: 'development',
      characters: input.characters ?? [],
      scenes: input.scenes ?? [],
      jobs: [],
      revision: 0,
    });
    return project.toObject() as IMovieProject;
  }

  async function updateMovieProject(
    user: string,
    projectId: string,
    input: UpdateMovieProjectInput,
  ): Promise<IMovieProject | null> {
    return await mutate(user, projectId, () => {
      const update: Partial<IMovieProject> = {};
      if (input.title !== undefined) {
        const title = cleanTitle(input.title);
        if (!title) {
          throw new TypeError('title is required');
        }
        update.title = title;
      }
      if (input.logline !== undefined) {
        update.logline = input.logline.slice(0, 4000);
      }
      if (input.status !== undefined) {
        update.status = input.status;
      }
      if (input.characters !== undefined) {
        update.characters = input.characters;
      }
      if (input.scenes !== undefined) {
        update.scenes = input.scenes;
      }
      return update;
    });
  }

  async function appendMovieJob(
    user: string,
    projectId: string,
    job: TMovieJob,
  ): Promise<IMovieProject | null> {
    return await mutate(user, projectId, (current) => ({
      jobs: [...(current.jobs ?? []), job].slice(-500),
    }));
  }

  async function updateMovieJob(
    user: string,
    projectId: string,
    jobId: string,
    patch: MovieJobPatch,
  ): Promise<IMovieProject | null> {
    return await mutate(user, projectId, (current) => ({
      jobs: (current.jobs ?? []).map((job) =>
        job.id === jobId ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job,
      ),
    }));
  }

  async function deleteMovieProject(user: string, projectId: string): Promise<boolean> {
    if (!isValidObjectIdString(projectId)) {
      return false;
    }
    const result = await model().deleteOne({
      _id: new mongoose.Types.ObjectId(projectId),
      user,
    });
    return (result.deletedCount ?? 0) > 0;
  }

  return {
    listMovieProjects,
    getMovieProject,
    createMovieProject,
    updateMovieProject,
    appendMovieJob,
    updateMovieJob,
    deleteMovieProject,
  };
}

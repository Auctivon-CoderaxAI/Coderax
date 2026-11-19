import type { Document, Types } from 'mongoose';
import type {
  MovieProjectStatus,
  TMovieCharacter,
  TMovieJob,
  TMovieScene,
} from 'coderax-data-provider';

export interface IMovieProject {
  _id?: Types.ObjectId;
  user: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMovieProjectDocument extends Omit<IMovieProject, '_id'>, Document {}

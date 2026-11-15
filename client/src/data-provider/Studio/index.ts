import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

export type TStudioFile = { path: string; content: string };

export type TStudioGeneratedProject = {
  title: string;
  entry: string;
  files: TStudioFile[];
};

export type TStudioErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED';

export async function postStudioGenerate(prompt: string): Promise<TStudioGeneratedProject> {
  const { data } = await axios.post<{ project: TStudioGeneratedProject }>(
    'api/studio/generate',
    { prompt },
    { headers: { 'Content-Type': 'application/json' } },
  );
  return data.project;
}

/** Stable server code from a failed generation, if the server answered with one. */
export function getStudioErrorCode(error: unknown): TStudioErrorCode | undefined {
  return (error as { response?: { data?: { code?: TStudioErrorCode } } })?.response?.data?.code;
}

export const useStudioGenerate = (): UseMutationResult<
  TStudioGeneratedProject,
  unknown,
  string,
  unknown
> => useMutation((prompt: string) => postStudioGenerate(prompt), { retry: false });
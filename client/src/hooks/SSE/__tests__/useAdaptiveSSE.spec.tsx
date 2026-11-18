import { renderHook } from '@testing-library/react';
import type { TSubmission } from 'coderax-data-provider';
import useAdaptiveSSE from '../useAdaptiveSSE';

jest.mock('../useSSE', () => jest.fn());
jest.mock('../useResumableSSE', () => jest.fn(() => ({ streamId: undefined })));

const chatHelpers = {} as Parameters<typeof useAdaptiveSSE>[1];

describe('useAdaptiveSSE', () => {
  it('renders before the submission has a user message', () => {
    const submission = { conversation: { endpoint: 'openAI' } } as unknown as TSubmission;

    const { result } = renderHook(() => useAdaptiveSSE(submission, chatHelpers));

    expect(result.current.resumableEnabled).toBe(true);
  });
});

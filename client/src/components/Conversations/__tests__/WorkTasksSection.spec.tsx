import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkTasksSection from '../WorkTasksSection';

const mockNavigate = jest.fn();
const mockMutatePinnedOrder = jest.fn();
const mockCancelWorkTask = jest.fn();
const mockInvalidateQueries = jest.fn();
let mockPinnedOrder: string[] | undefined;
let mockTasksQuery: {
  data?: {
    tasks: Array<{
      id: string;
      title: string;
      state: 'running' | 'awaiting_approval' | 'completed' | 'unknown';
    }>;
  };
  isLoading: boolean;
  isError: boolean;
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => mockTasksQuery,
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useMutation: (mutationFn: (id: string) => unknown, options: { onSuccess: () => void }) => ({
    mutate: (id: string) => {
      mutationFn(id);
      options.onSuccess();
    },
    isLoading: false,
  }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/data-provider', () => ({
  useGetPinnedOrderQuery: () => ({
    data: mockPinnedOrder,
    isSuccess: mockPinnedOrder !== undefined,
    isFetching: false,
  }),
  useUpdatePinnedOrderMutation: () => ({ mutate: mockMutatePinnedOrder, isLoading: false }),
}));

jest.mock('coderax-data-provider', () => ({
  dataService: { getWorkTasks: jest.fn(), cancelWorkTask: mockCancelWorkTask },
  MutationKeys: { cancelWorkTask: 'cancelWorkTask' },
  QueryKeys: { workTasks: 'workTasks' },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useLocalStorage: () => [true, jest.fn()],
}));

jest.mock('~/common', () => ({ NotificationSeverity: { ERROR: 'error' } }));

jest.mock('~/components/ui', () => ({
  Collapse: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@coderax/client', () => ({
  buttonVariants: () => '',
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

describe('WorkTasksSection', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockMutatePinnedOrder.mockReset();
    mockCancelWorkTask.mockReset();
    mockInvalidateQueries.mockReset();
    mockPinnedOrder = [];
    mockTasksQuery = {
      data: {
        tasks: [
          { id: 'work-1', title: 'Prepare release notes', state: 'completed' },
          { id: 'work-2', title: 'Update documentation', state: 'unknown' },
        ],
      },
      isLoading: false,
      isError: false,
    };
  });

  it('shows only unpinned Work tasks and pins them in the shared order', () => {
    mockPinnedOrder = ['work:work-2', 'convo:chat-1'];
    render(<WorkTasksSection isAuthenticated toggleNav={(afterSlide) => afterSlide?.()} />);

    expect(screen.getByText('Prepare release notes')).toBeInTheDocument();
    expect(screen.queryByText('Update documentation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_pin Prepare release notes' }));

    expect(mockMutatePinnedOrder).toHaveBeenCalledWith([
      'work:work-2',
      'convo:chat-1',
      'work:work-1',
    ], expect.anything());
  });

  it('opens a Work task through the native Work route', () => {
    const toggleNav = jest.fn((afterSlide?: () => void) => afterSlide?.());
    render(<WorkTasksSection isAuthenticated toggleNav={toggleNav} />);

    fireEvent.click(
      screen.getByText('Prepare release notes').closest('button') as HTMLButtonElement,
    );

    expect(toggleNav).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/work/work-1');
  });

  it('cancels active tasks and refreshes the task list', () => {
    mockTasksQuery.data?.tasks.push({
      id: 'work-running',
      title: 'Run checks',
      state: 'running',
    });
    render(<WorkTasksSection isAuthenticated toggleNav={(afterSlide) => afterSlide?.()} />);

    fireEvent.click(screen.getByRole('button', { name: 'com_work_cancel_task Run checks' }));

    expect(mockCancelWorkTask).toHaveBeenCalledWith('work-running');
    expect(mockInvalidateQueries).toHaveBeenCalledWith(['workTasks']);
  });
});

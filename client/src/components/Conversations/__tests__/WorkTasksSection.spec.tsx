import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkTasksSection from '../WorkTasksSection';

const mockNavigate = jest.fn();
const mockMutatePinnedOrder = jest.fn();
let mockPinnedOrder: string[] | undefined;
let mockTasksQuery: {
  data?: { tasks: Array<{ id: string; title: string; state: 'completed' | 'unknown' }> };
  isLoading: boolean;
  isError: boolean;
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => mockTasksQuery,
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
  dataService: { getWorkTasks: jest.fn() },
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
});

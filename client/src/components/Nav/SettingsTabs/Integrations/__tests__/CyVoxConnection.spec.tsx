import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyVoxConnection from '../CyVoxConnection';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockTest = jest.fn();
const mockRefetch = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetCyVoxConnectionQuery: () => mockGet(),
  useUpdateCyVoxConnectionMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useTestCyVoxConnectionMutation: () => ({ mutate: mockTest, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@coderax/client', () => ({
  ...jest.requireActual('@coderax/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

function configuredStatus(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    enabled: true,
    source: 'settings',
    baseUrl: 'https://cyvox.example.com',
    tokenConfigured: true,
    tokenPreview: 'abc...xyz',
    ...overrides,
  };
}

function queryResult(data: ReturnType<typeof configuredStatus>) {
  return {
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetch,
    data,
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockTest.mockReset();
  mockRefetch.mockReset();
  mockGet.mockReturnValue(queryResult(configuredStatus()));
});

describe('CyVoxConnection', () => {
  it('renders the stored URL and a masked token', async () => {
    render(<CyVoxConnection />);

    await waitFor(() =>
      expect(screen.getByLabelText('com_ui_cyvox_service_url')).toHaveValue(
        'https://cyvox.example.com',
      ),
    );
    expect(screen.getByText('abc...xyz')).toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_cyvox_enable')).toBeChecked();
  });

  it('saves a first-time connection with the token', async () => {
    mockGet.mockReturnValue(
      queryResult(
        configuredStatus({
          configured: false,
          enabled: false,
          baseUrl: undefined,
          tokenConfigured: false,
          tokenPreview: undefined,
          source: 'none',
        }),
      ),
    );
    render(<CyVoxConnection />);

    const url = await screen.findByLabelText('com_ui_cyvox_service_url');
    fireEvent.change(url, { target: { value: 'https://new.example.com' } });
    fireEvent.change(screen.getByLabelText('com_ui_cyvox_auth_token'), {
      target: { value: 'secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cyvox_save' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      { enabled: false, baseUrl: 'https://new.example.com', authToken: 'secret-token' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('shows the mapped failure when the connection test is rejected', async () => {
    mockTest.mockImplementation((_payload, options) => {
      options?.onSuccess?.({ success: false, errorCode: 'invalid_credentials' });
    });
    render(<CyVoxConnection />);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cyvox_test' }));

    expect(
      await screen.findByText('com_ui_cyvox_test_error_invalid_credentials'),
    ).toBeInTheDocument();
  });

  it('shows discovered capabilities, API version and round trip after a successful test', async () => {
    mockTest.mockImplementation((_payload, options) => {
      options?.onSuccess?.({
        success: true,
        apiVersion: '1.4.0',
        capabilities: ['browser', 'shell'],
        latencyMs: 42,
      });
    });
    render(<CyVoxConnection />);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cyvox_test' }));

    expect(await screen.findByText('1.4.0')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/browser, shell/)).toBeInTheDocument();
  });

  it('shows the recorded outcome of the last saved-connection check', async () => {
    mockGet.mockReturnValue(
      queryResult(
        configuredStatus({
          lastProbe: { checkedAt: '2026-10-30T00:00:00.000Z', success: true },
        }),
      ),
    );
    render(<CyVoxConnection />);

    expect(await screen.findByText(/com_ui_cyvox_last_check/)).toBeInTheDocument();
    expect(screen.getByText(/com_ui_cyvox_last_check_ok/)).toBeInTheDocument();
  });
});

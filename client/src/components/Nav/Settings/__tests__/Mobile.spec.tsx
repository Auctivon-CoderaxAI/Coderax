import userEvent from '@testing-library/user-event';
import { render, screen } from 'test/layout-test-utils';
import { SettingsDialog } from '../index';

jest.mock('../Content', () => ({
  __esModule: true,
  default: ({ query }: { query: string }) =>
    query.trim() !== '' ? (
      <div aria-label="Search results" />
    ) : (
      <div data-testid="desktop-content" />
    ),
}));

jest.mock('../ios/Page', () => ({
  __esModule: true,
  default: ({ page }: { page: { id: string } }) => <div data-testid="ios-page">{page.id}</div>,
}));

/** The dialog picks its layout from matchMedia, so the breakpoint is the query's result. */
function setViewport(isSmallScreen: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: isSmallScreen && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe('SettingsDialog at the mobile breakpoint', () => {
  beforeEach(() => {
    setViewport(true);
  });

  it('renders the iOS index instead of the desktop tab rail', () => {
    render(<SettingsDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByTestId('ios-settings-general')).toBeInTheDocument();
    expect(screen.getByTestId('ios-settings-storage')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('opens a page and returns to the index through the back control', async () => {
    render(<SettingsDialog open onOpenChange={jest.fn()} />);

    await userEvent.click(screen.getByTestId('ios-settings-general'));
    expect(screen.getByTestId('ios-page')).toHaveTextContent('general');
    expect(screen.queryByTestId('ios-settings-storage')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('ios-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('ios-settings-general')).toBeInTheDocument();
  });

  it('replaces an open page with search results while typing', async () => {
    render(<SettingsDialog open onOpenChange={jest.fn()} />);

    await userEvent.click(screen.getByTestId('ios-settings-storage'));
    expect(screen.getByTestId('ios-page')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'files');
    expect(screen.getByLabelText('Search results')).toBeInTheDocument();
    expect(screen.queryByTestId('ios-page')).not.toBeInTheDocument();
  });

  it('closes the dialog from the header control', async () => {
    const onOpenChange = jest.fn();
    render(<SettingsDialog open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('button', { name: /close settings/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('SettingsDialog above the mobile breakpoint', () => {
  beforeEach(() => {
    setViewport(false);
  });

  it('keeps the desktop tab rail', () => {
    render(<SettingsDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole('tab', { selected: true })).toBeInTheDocument();
    expect(screen.queryByTestId('ios-settings-general')).not.toBeInTheDocument();
  });
});

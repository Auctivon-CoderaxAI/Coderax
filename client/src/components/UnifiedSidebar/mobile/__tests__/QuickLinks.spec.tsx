import { useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { createStore, useAtom, Provider } from 'jotai';
import { SettingsTabValues } from 'coderax-data-provider';
import { settingsOpenAtom, settingsTabAtom } from '~/components/Nav/Settings/state';
import SettingsDialog from '../../../Nav/Settings/Dialog';
import { render, screen } from 'test/layout-test-utils';
import QuickLinks from '../QuickLinks';

jest.mock('../../../Nav/Settings/Content', () => ({
  __esModule: true,
  default: () => <div data-testid="settings-content" />,
}));

jest.mock('../../../Nav/Settings/ios/Page', () => ({
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

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

const renderQuickLinks = () => {
  const onNavigate = jest.fn();
  const store = createStore();
  render(
    <Provider store={store}>
      <QuickLinks onNavigate={onNavigate} />
      <LocationProbe />
    </Provider>,
  );
  return { onNavigate, store };
};

/**
 * Mounts the drawer shortcuts beside the real settings dialog, both reading the
 * settings atoms, so the shortcut's request is exercised through the component
 * that consumes it rather than asserted in isolation.
 */
function SettingsHost({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  return (
    <>
      <QuickLinks onNavigate={onNavigate} />
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('mobile drawer quick links', () => {
  it('lists the app-wide destinations in drawer order', () => {
    renderQuickLinks();

    const labels = screen.getAllByRole('button').map((row) => row.textContent);
    expect(labels).toEqual(['Projects', 'Skills', 'Explore', 'Customize Coderax']);
  });

  it.each([
    ['projects', '/projects'],
    ['skills', '/skills'],
    ['explore', '/agents'],
  ])('routes %s to %s and closes the drawer', async (id, path) => {
    const { onNavigate } = renderQuickLinks();

    await userEvent.click(screen.getByTestId(`drawer-quick-${id}`));

    expect(screen.getByTestId('pathname')).toHaveTextContent(path);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer and asks for Settings without leaving the route', async () => {
    const { onNavigate, store } = renderQuickLinks();

    await userEvent.click(screen.getByTestId('drawer-quick-customize'));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(store.get(settingsOpenAtom)).toBe(true);
    expect(store.get(settingsTabAtom)).toBe(SettingsTabValues.DATA);
  });

  /**
   * The drawer only names a tab, so what the shortcut actually opens depends on
   * the dialog mapping that tab to an iOS page. Customize must win over the
   * other pages that also read the Data tab.
   */
  it('opens Settings on its iOS Customize page', async () => {
    setViewport(true);
    const store = createStore();
    render(
      <Provider store={store}>
        <SettingsHost onNavigate={jest.fn()} />
      </Provider>,
    );

    await userEvent.click(screen.getByTestId('drawer-quick-customize'));

    const page = await screen.findByTestId('ios-page');
    expect(page).toHaveTextContent('customize');
    expect(screen.getByRole('heading', { name: 'Customize Coderax' })).toBeInTheDocument();
    expect(screen.queryByTestId('ios-settings-general')).not.toBeInTheDocument();
  });
});

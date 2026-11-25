import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  useOutletContext,
} from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import {
  VerifyEmail,
  Registration,
  ResetPassword,
  ApiErrorWatcher,
  TwoFactorScreen,
  TwoFactorSetupScreen,
  RequestPasswordReset,
} from '~/components/Auth';
import { OAuthSuccess, OAuthError } from '~/components/OAuth';
import { AuthContextProvider } from '~/hooks/AuthContext';
import { importWithRecovery } from '~/lib/assets/lazy';
import RouteErrorBoundary from './RouteErrorBoundary';
import LandingPage from '~/components/Landing';
import StartupLayout from './Layouts/Startup';
import MarketplaceRoute from './Marketplace';
import Login from '~/components/Auth/Login';
import LoginLayout from './Layouts/Login';
import dashboardRoutes from './Dashboard';
import WithRum from '~/lib/rum/WithRum';
import GuestEntry from './GuestEntry';
import ShareRoute from './ShareRoute';
import CyVoxAddon from './CyVoxAddon';
import ChatRoute from './ChatRoute';
import WorkRoute from './WorkRoute';
import Search from './Search';
import Studio from './Studio';
import Root from './Root';

/**
 * Keep the former login URL as a passwordless guest entry. `manual=1` is the
 * explicit escape hatch for an existing account: it renders the ordinary login
 * form instead of the guest hand-off, so a deployment without guest access can
 * still be signed into and the e2e setup keeps a deterministic form to fill.
 */
const LegacyLoginEntry = () => {
  const location = useLocation();
  const { startupConfig, startupConfigError } = useOutletContext<TLoginLayoutContext>();
  const search = new URLSearchParams(location.search);
  const manual = search.get('manual') === '1';
  search.delete('manual');
  if (manual && startupConfig == null && startupConfigError == null) {
    return null;
  }
  if (manual && startupConfig?.emailLoginEnabled === true) {
    return <Login manual />;
  }
  const redirectSearch = search.toString();
  return (
    <Navigate
      to={{ pathname: '/connect', search: redirectSearch ? `?${redirectSearch}` : '' }}
      replace
    />
  );
};

const AuthLayout = () => (
  <AuthContextProvider>
    <WithRum>
      <Outlet />
    </WithRum>
    <ApiErrorWatcher />
  </AuthContextProvider>
);

const loadInlinePromptsView = () =>
  importWithRecovery(() => import('~/components/Prompts/layouts/InlinePromptsView')).then((m) => ({
    Component: m.default,
  }));

const loadSkillsView = () =>
  importWithRecovery(() => import('~/components/Skills/layouts/SkillsView')).then((m) => ({
    Component: m.default,
  }));

const loadInsightsView = () =>
  importWithRecovery(() => import('~/components/Insights')).then((m) => ({
    Component: m.default,
  }));

const loadGamesView = () =>
  importWithRecovery(() => import('~/components/Games')).then((m) => ({
    Component: m.GamesView,
  }));

const loadGameNew = () =>
  importWithRecovery(() => import('~/components/Games')).then((m) => ({
    Component: m.GameNew,
  }));

const loadGameTemplates = () =>
  importWithRecovery(() => import('~/components/Games')).then((m) => ({
    Component: m.GameTemplates,
  }));

const loadGameWorkspace = () =>
  importWithRecovery(() => import('~/components/Games')).then((m) => ({
    Component: m.GameWorkspace,
  }));

const loadResearchView = () =>
  importWithRecovery(() => import('~/components/Research')).then((m) => ({
    Component: m.ResearchView,
  }));

const loadResearchNew = () =>
  importWithRecovery(() => import('~/components/Research')).then((m) => ({
    Component: m.ResearchNew,
  }));

const loadResearchWorkspace = () =>
  importWithRecovery(() => import('~/components/Research')).then((m) => ({
    Component: m.ResearchWorkspace,
  }));

const loadProjectsView = () =>
  importWithRecovery(() => import('~/components/Projects')).then((m) => ({
    Component: m.ProjectsView,
  }));

const loadProjectWorkspace = () =>
  importWithRecovery(() => import('~/components/Projects')).then((m) => ({
    Component: m.ProjectWorkspace,
  }));

const loadWorkflowsView = () =>
  importWithRecovery(() => import('~/components/Workflows')).then((m) => ({
    Component: m.WorkflowsView,
  }));

const baseEl = document.querySelector('base');
const baseHref = baseEl?.getAttribute('href') || '/';

export const router = createBrowserRouter(
  [
    {
      /** Public marketing page. Lives outside the authenticated shell so the
       *  chat application's providers and routing stay untouched. */
      path: 'welcome',
      element: <LandingPage />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'share/:shareId',
      element: <ShareRoute />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'oauth',
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'success',
          element: <OAuthSuccess />,
        },
        {
          path: 'error',
          element: <OAuthError />,
        },
      ],
    },
    {
      path: '/',
      element: <StartupLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'register',
          element: <Registration />,
        },
        {
          path: 'forgot-password',
          element: <RequestPasswordReset />,
        },
        {
          path: 'reset-password',
          element: <ResetPassword />,
        },
      ],
    },
    {
      path: 'verify',
      element: <VerifyEmail />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      element: <AuthLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          errorElement: <RouteErrorBoundary />,
          children: [
            {
              path: '/',
              element: <LoginLayout />,
              children: [
                {
                  path: 'login',
                  element: <LegacyLoginEntry />,
                },
                {
                  path: 'connect',
                  element: <GuestEntry />,
                },
                {
                  path: 'login/2fa',
                  element: <TwoFactorScreen />,
                },
                {
                  path: 'login/2fa/setup',
                  element: <TwoFactorSetupScreen />,
                },
              ],
            },
            dashboardRoutes,
            {
              path: '/',
              element: <Root />,
              children: [
                {
                  index: true,
                  element: <Navigate to="/c/new" replace={true} />,
                },
                {
                  path: 'c/:conversationId?',
                  element: <ChatRoute />,
                },
                {
                  path: 'search',
                  element: <Search />,
                },
                {
                  path: 'work/:conversationId?',
                  element: <WorkRoute />,
                },
                {
                  path: 'cyvox/:tool',
                  element: <CyVoxAddon />,
                },
                {
                  path: 'studio',
                  element: <Studio />,
                },
                {
                  path: 'workflows',
                  lazy: loadWorkflowsView,
                },
                {
                  path: 'prompts',
                  element: <Navigate to="/c/new" replace={true} />,
                },
                {
                  /** Prompts are created from a dialog, so there is no "new" page to land on */
                  path: 'prompts/new',
                  element: <Navigate to="/c/new" replace={true} />,
                },
                {
                  path: 'prompts/:promptId',
                  lazy: loadInlinePromptsView,
                },
                {
                  path: 'skills',
                  lazy: loadSkillsView,
                },
                {
                  path: 'insights',
                  lazy: loadInsightsView,
                },
                {
                  path: 'skills/new',
                  lazy: loadSkillsView,
                },
                {
                  path: 'skills/:skillId',
                  lazy: loadSkillsView,
                },
                {
                  path: 'skills/:skillId/edit',
                  lazy: loadSkillsView,
                },
                {
                  path: 'projects',
                  lazy: loadProjectsView,
                },
                {
                  path: 'projects/:projectId',
                  lazy: loadProjectWorkspace,
                },
                {
                  path: 'games',
                  lazy: loadGamesView,
                },
                {
                  path: 'games/new',
                  lazy: loadGameNew,
                },
                {
                  path: 'games/templates',
                  lazy: loadGameTemplates,
                },
                {
                  path: 'games/:gameId',
                  lazy: loadGameWorkspace,
                },
                {
                  path: 'research',
                  lazy: loadResearchView,
                },
                {
                  path: 'research/new',
                  lazy: loadResearchNew,
                },
                {
                  path: 'research/:researchId',
                  lazy: loadResearchWorkspace,
                },
                {
                  path: 'agents',
                  element: <MarketplaceRoute />,
                },
                {
                  path: 'agents/:category',
                  element: <MarketplaceRoute />,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref },
);

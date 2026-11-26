import { useEffect } from 'react';
import { RecoilRoot } from 'recoil';
import { DndProvider } from 'react-dnd';
import { RouterProvider } from 'react-router-dom';
import * as RadixToast from '@radix-ui/react-toast';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toast, ToastViewport, ToastProvider, useInputModality } from '@coderax/client';
import { useApiErrorBoundary } from './hooks/ApiErrorBoundaryContext';
import WakeLockManager from '~/components/System/WakeLockManager';
import { ScreenshotProvider } from './hooks/ScreenshotContext';
import QueryDevtoolsGate from '~/components/QueryDevtoolsGate';
import LanguageSync from '~/components/System/LanguageSync';
import useAppQueryClient from './hooks/useAppQueryClient';
import DeploymentTheme from '~/Providers/DeploymentTheme';
import UiScaleSync from '~/components/System/UiScaleSync';
import { initializeFontSize } from '~/store/fontSize';
import { LiveAnnouncer } from '~/a11y';
import { router } from './routes';

const App = () => {
  const { setError } = useApiErrorBoundary();
  useInputModality();

  const queryClient = useAppQueryClient(setError);

  useEffect(() => {
    initializeFontSize();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <LanguageSync />
        <UiScaleSync />
        <LiveAnnouncer>
          <DeploymentTheme>
            <RadixToast.Provider>
              <ToastProvider>
                <DndProvider backend={HTML5Backend}>
                  {/* Location updates commit in the caller's own task instead
                      of React's transition lane. A transition keeps the
                      OUTGOING route painted until the incoming one finishes
                      rendering, so switching conversations left the previous
                      transcript on screen under the new URL for as long as the
                      next thread took to render.

                      Set here rather than per navigation because the property
                      is route-shaped, not caller-shaped: fourteen call sites
                      across components, chat hooks and SSE handlers navigate
                      into `/c/*`, and an opt-out passed at each one is a list
                      that silently rots as call sites are added. Nothing in the
                      app reads route data through router loaders or renders
                      pending UI from `useNavigation`, so the transition buys no
                      interstitial on any route — it only defers the commit. And
                      conversation state still lives in Recoil, whose
                      transition-safe reads are gated behind
                      `_TRANSITION_SUPPORT_UNSTABLE` hooks this app does not use.
                      Worth revisiting once that state has moved to Jotai. */}
                  <RouterProvider router={router} useTransitions={false} />
                  <WakeLockManager />
                  <QueryDevtoolsGate />
                  <Toast />
                  <ToastViewport />
                </DndProvider>
              </ToastProvider>
            </RadixToast.Provider>
          </DeploymentTheme>
        </LiveAnnouncer>
      </RecoilRoot>
    </QueryClientProvider>
  );
};

export default () => (
  <ScreenshotProvider>
    <App />
    <iframe
      src="assets/silence.mp3"
      allow="autoplay"
      id="audio"
      title="audio-silence"
      className="hidden"
    />
  </ScreenshotProvider>
);

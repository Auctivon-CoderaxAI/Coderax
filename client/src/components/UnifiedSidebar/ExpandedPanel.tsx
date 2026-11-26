import { memo, useCallback, useEffect, useRef, Suspense, useState } from 'react';
import { useAtomValue } from 'jotai';
import { SquarePen } from 'lucide-react';
import { Skeleton, Sidebar, Button, TooltipAnchor } from '@coderax/client';
import type { NavLink } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { useActivePanel, resolveActivePanel, DEFAULT_PANEL } from '~/Providers';
import ScheduleNavButton from '~/components/UnifiedSidebar/ScheduleNavButton';
import ScheduleHoverPanel from '~/components/Taskbar/ScheduleHoverPanel';
import PluginsHoverPanel from '~/components/Taskbar/PluginsHoverPanel';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import useRouteActiveId from '~/hooks/Nav/useRouteActiveId';
import { lazyWithRecovery } from '~/lib/assets/lazy';
import Taskbar from '~/components/Taskbar/Taskbar';
import { unreadCountAtom } from '~/store/recents';
import useNewChat from '~/hooks/Chat/useNewChat';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AccountSettings = lazyWithRecovery(() => import('~/components/Nav/AccountSettings'));

const NewChatButton = memo(function NewChatButton({
  setActive,
  switchToHistory,
}: {
  setActive: (id: string) => void;
  switchToHistory: boolean;
}) {
  const localize = useLocalize();
  const tooltipDescription = useShortcutHint('newChat', localize('com_ui_new_chat'));
  const ariaKey = useShortcutAriaKey('newChat');

  const handlePanelSwitch = useCallback(() => {
    if (switchToHistory) {
      setActive(DEFAULT_PANEL);
    }
  }, [switchToHistory, setActive]);

  const { handleNewChatClick } = useNewChat({ onNewChat: handlePanelSwitch });

  return (
    <TooltipAnchor
      side="right"
      description={tooltipDescription}
      render={
        <a
          href="/c/new"
          data-testid="new-chat-button"
          aria-label={localize('com_ui_new_chat')}
          aria-keyshortcuts={ariaKey}
          className="hover:bg-surface-hover flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          onClick={handleNewChatClick}
        >
          <SquarePen className="text-text-primary h-5 w-5" />
        </a>
      }
    />
  );
});

const NavIconButton = memo(function NavIconButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onNavigate,
  onLeaveInsights,
  onHover,
  onHoverEnd,
  onDismissHover,
  hasPopup,
  popupExpanded,
}: {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
  onDismissHover?: () => void;
  hasPopup?: boolean;
  popupExpanded?: boolean;
}) {
  const localize = useLocalize();
  const unreadCount = useAtomValue(unreadCountAtom);
  const isRecents = link.id === 'conversations';
  const showsUnread = isRecents && unreadCount > 0;
  const unreadDescriptionId = `${link.id}-unread-description`;
  const unreadLabel = localize(
    unreadCount === 1 ? 'com_a11y_recents_unread' : 'com_a11y_recents_unread_plural',
    { count: unreadCount },
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onDismissHover?.();
      if (link.onClick) {
        link.onClick(e);
        onNavigate?.();
        return;
      }
      // Only the explicit sidebar toggle closes the expanded chat history.
      if (isActive && expanded) {
        return;
      }
      if (!isActive) {
        setActive(link.id);
      }
      if (!expanded) {
        onExpand?.();
      } else {
        onLeaveInsights?.();
      }
    },
    [link, isActive, setActive, expanded, onExpand, onNavigate, onLeaveInsights, onDismissHover],
  );

  return (
    <TooltipAnchor
      description={localize(link.title)}
      side="right"
      render={
        <Button
          size="icon"
          variant="ghost"
          aria-label={localize(link.title)}
          aria-describedby={showsUnread ? unreadDescriptionId : undefined}
          aria-pressed={isActive}
          aria-haspopup={hasPopup ? 'dialog' : undefined}
          aria-expanded={hasPopup ? popupExpanded : undefined}
          disabled={link.disabled}
          data-testid={`nav-panel-${link.id}`}
          className={cn(
            'relative h-9 w-9 rounded-lg',
            isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
          )}
          onClick={handleClick}
          onMouseEnter={onHover}
          onMouseLeave={onHoverEnd}
        >
          <link.icon className="h-5 w-5" aria-hidden="true" />
          {showsUnread && (
            <>
              <span
                aria-hidden="true"
                className="bg-status-info ring-surface-primary-alt pointer-events-none absolute top-1 right-1 size-2 rounded-full ring-2"
              />
              <span id={unreadDescriptionId} className="sr-only">
                {unreadLabel}
              </span>
            </>
          )}
        </Button>
      }
    />
  );
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
  onNavigate,
  onLeaveInsights,
  switchToHistory,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
  switchToHistory: boolean;
}) {
  const localize = useLocalize();
  const { active, setActive } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  const routeActiveId = useRouteActiveId();
  const [hoverPreview, setHoverPreview] = useState<'schedules' | 'plugins' | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPreviewOpen = useCallback(() => {
    if (previewTimer.current != null) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, []);
  const openPreview = useCallback(
    (id: 'schedules' | 'plugins') => {
      cancelPreviewOpen();
      previewTimer.current = setTimeout(() => setHoverPreview(id), 250);
    },
    [cancelPreviewOpen],
  );
  const closePreview = useCallback(() => {
    cancelPreviewOpen();
    setHoverPreview(null);
  }, [cancelPreviewOpen]);
  useEffect(() => () => cancelPreviewOpen(), [cancelPreviewOpen]);

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize(toggleLabel));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  return (
    <div className="border-border-inset bg-surface-primary-alt flex h-full w-16 shrink-0 flex-col items-center gap-2 border-r px-2 pt-4 pb-2">
      <a
        href="/c/new"
        aria-label="Coderax"
        data-testid="sidebar-brand-mark"
        className="focus-visible:ring-text-primary flex size-10 items-center justify-center overflow-hidden rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-inset"
      >
        <img
          src="/assets/coderax-mark.svg"
          alt=""
          aria-hidden="true"
          className="size-8 rounded-lg"
        />
      </a>
      <TooltipAnchor
        side="right"
        description={toggleSidebarHint}
        render={
          <Button
            id={expanded ? CLOSE_SIDEBAR_ID : undefined}
            data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
            size="icon"
            variant="ghost"
            aria-label={localize(toggleLabel)}
            aria-expanded={expanded}
            aria-keyshortcuts={toggleSidebarAriaKey}
            className="h-9 w-9 rounded-lg"
            onClick={toggleClick}
          >
            <Sidebar aria-hidden="true" className="text-text-primary h-5 w-5" />
          </Button>
        }
      />
      <NewChatButton setActive={setActive} switchToHistory={switchToHistory} />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {links.map((link) => {
          const isLinkActive = routeActiveId
            ? link.id === routeActiveId
            : link.id === effectiveActive;
          if (link.id === 'schedules') {
            return (
              <ScheduleNavButton
                key={link.id}
                link={link}
                isActive={isLinkActive}
                expanded={expanded ?? true}
                setActive={setActive}
                onExpand={onExpand}
                onLeaveInsights={routeActiveId ? onLeaveInsights : undefined}
                onHover={() => openPreview('schedules')}
                onHoverEnd={cancelPreviewOpen}
                onDismissHover={closePreview}
              />
            );
          }
          return (
            <NavIconButton
              key={link.id}
              link={link}
              isActive={isLinkActive}
              expanded={expanded ?? true}
              setActive={setActive}
              onExpand={onExpand}
              onNavigate={onNavigate}
              onLeaveInsights={routeActiveId ? onLeaveInsights : undefined}
              onHover={link.id === 'plugins' ? () => openPreview('plugins') : undefined}
              onHoverEnd={link.id === 'plugins' ? cancelPreviewOpen : undefined}
              onDismissHover={link.id === 'plugins' ? closePreview : undefined}
              hasPopup={link.id === 'plugins'}
              popupExpanded={link.id === 'plugins' ? hoverPreview === 'plugins' : undefined}
            />
          );
        })}
        <Taskbar />
      </div>

      {hoverPreview === 'schedules' && <ScheduleHoverPanel onClose={closePreview} />}
      {hoverPreview === 'plugins' && <PluginsHoverPanel onClose={closePreview} />}

      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);

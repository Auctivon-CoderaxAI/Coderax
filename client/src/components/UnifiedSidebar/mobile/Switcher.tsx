import { memo, useId, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import { DropdownPopup, buttonVariants } from '@coderax/client';
import type { NavLink } from '~/common';
import type * as t from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';
import { unreadCountAtom } from '~/store/recents';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Doubles as the drawer's title: it names the panel you are in and is also how
 * you leave it. Replaces the icon rail's ten unlabelled glyphs with labelled
 * rows, and costs no standing width.
 */
function Switcher({
  links,
  onLeaveInsights,
  onNavigate,
  routeActiveId,
}: {
  links: NavLink[];
  onLeaveInsights?: () => void;
  onNavigate?: () => void;
  routeActiveId?: string;
}) {
  const localize = useLocalize();
  const menuId = useId();
  const unreadCount = useAtomValue(unreadCountAtom);
  const [isOpen, setIsOpen] = useState(false);
  const { active, setActive } = useActivePanel();

  const activeId = routeActiveId ?? resolveActivePanel(active, links);
  const activeLink = links.find((link) => link.id === activeId);

  const items = useMemo<t.MenuItemProps[]>(
    () =>
      links.map((link) => ({
        id: `nav-panel-${link.id}`,
        label: localize(link.title),
        ariaChecked: link.id === activeId,
        className: link.id === activeId ? 'bg-surface-nav-selected' : undefined,
        icon: <link.icon className="text-text-primary size-5" aria-hidden="true" />,
        onClick: () => {
          if (link.onClick) {
            link.onClick();
            onNavigate?.();
            return;
          }
          setActive(link.id);
          if (routeActiveId) {
            onLeaveInsights?.();
          }
        },
      })),
    [links, activeId, localize, onLeaveInsights, onNavigate, routeActiveId, setActive],
  );

  if (!activeLink) {
    return null;
  }

  const activeTitle = localize(activeLink.title);
  const showsUnread = activeLink.id === 'conversations' && unreadCount > 0;
  const unreadDescriptionId = 'panel-switcher-unread-description';
  const unreadLabel = localize(
    unreadCount === 1 ? 'com_a11y_recents_unread' : 'com_a11y_recents_unread_plural',
    { count: unreadCount },
  );

  return (
    <DropdownPopup
      /**
       * The drawer sets a transform, which makes it the containing block for
       * fixed descendants, so an in-place popup would be positioned and clipped
       * relative to it. Portaling escapes that, and the drawer cannot occlude
       * the menu: its z-index only ranks it inside `Root`'s `relative z-0`
       * stacking context, while this lands on `document.body` outside it.
       */
      portal={true}
      menuId={menuId}
      focusLoop={true}
      unmountOnHide={true}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      items={items}
      minWidth="15rem"
      iconClassName="mr-2 size-5"
      trigger={
        <Ariakit.MenuButton
          data-testid="panel-switcher-button"
          aria-label={`${activeTitle}, ${localize('com_nav_control_panel')}`}
          aria-describedby={showsUnread ? unreadDescriptionId : undefined}
          aria-expanded={isOpen}
          /**
           * The drawer's primary navigation control, so it takes the shared
           * button's focus ring and transition rather than restating a hover
           * treatment with no visible focus state of its own. Only the layout
           * — filling the row and left-aligning the label — stays local.
           */
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'text-text-primary h-10 min-w-0 flex-1 justify-start px-2',
          )}
        >
          <activeLink.icon className="size-5 shrink-0" aria-hidden="true" />
          {/* Grows so the chevron settles on the trailing edge rather than trailing the label. */}
          <span className="flex-1 truncate text-left text-sm font-medium">{activeTitle}</span>
          {showsUnread && (
            <span
              aria-hidden="true"
              className="bg-status-info pointer-events-none size-2 shrink-0 rounded-full"
            />
          )}
          <ChevronDown className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
          {showsUnread && (
            <span id={unreadDescriptionId} className="sr-only">
              {unreadLabel}
            </span>
          )}
        </Ariakit.MenuButton>
      }
    />
  );
}

export default memo(Switcher);

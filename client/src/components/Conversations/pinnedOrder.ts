/** Which kind of target the pointer was over most recently.
 *
 * `monitor.didDrop()` alone cannot tell a reorder from a filing action that was
 * refused, so the pinned list also tracks whether the drag returned to one of
 * its rows after crossing an external target. */
let lastHoverWasExternal = false;

/** Called by the pinned rows, whose hover is what reorders the list. */
export const markPinnedHover = (): void => {
  lastHoverWasExternal = false;
};

/** Called by the project rows and the Chats section, accepted or refused. */
export const markExternalHover = (): void => {
  lastHoverWasExternal = true;
};

export const beginPinnedDrag = (): void => {
  lastHoverWasExternal = false;
};

export const endedOverExternalTarget = (): boolean => lastHoverWasExternal;

/** Whether a hover should reorder yet. Rows only swap once the pointer crosses
 * the hovered row's midpoint to prevent shorter and taller rows from
 * oscillating under a cursor that has not moved. */
export const shouldSwapOnHover = ({
  dragIndex,
  hoverIndex,
  pointerY,
  hoverTop,
  hoverBottom,
}: {
  dragIndex: number;
  hoverIndex: number;
  pointerY: number;
  hoverTop: number;
  hoverBottom: number;
}): boolean => {
  if (dragIndex < 0 || hoverIndex < 0 || dragIndex === hoverIndex) {
    return false;
  }
  const middleY = (hoverBottom - hoverTop) / 2;
  const offsetY = pointerY - hoverTop;
  if (dragIndex < hoverIndex) {
    return offsetY >= middleY;
  }
  return offsetY <= middleY;
};

/** Which group of the Pinned section a stored key belongs to. Pinned chats and
 * Work tasks share the conversation group, while favorites form their own. */
const keyKind = (key: string): 'convo' | 'favorite' =>
  key.startsWith('convo:') || key.startsWith('work:') ? 'convo' : 'favorite';

/**
 * Rewrites only the slots the visible keys occupy in the stored order, so a
 * reorder performed while a filter hides part of the list keeps hidden keys in
 * place. Visible keys the stored order does not know about append after their
 * own group.
 */
export const mergeVisibleOrder = (stored: string[], visible: string[]): string[] => {
  const visibleSet = new Set(visible);
  const kinds: Array<'favorite' | 'convo'> = ['favorite', 'convo'];
  return kinds.flatMap((kind) => {
    const slots = stored.filter((key) => keyKind(key) === kind);
    const incoming = visible.filter((key) => keyKind(key) === kind);
    const merged: string[] = [];
    let next = 0;
    for (const key of slots) {
      if (!visibleSet.has(key)) {
        merged.push(key);
        continue;
      }
      if (next < incoming.length) {
        merged.push(incoming[next]);
        next += 1;
      }
    }
    for (; next < incoming.length; next += 1) {
      merged.push(incoming[next]);
    }
    return merged;
  });
};

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CommandPaletteItem, CommandPaletteLabels } from './CommandPalette';
import CommandPalette from './CommandPalette';

/** jsdom has no layout, so the palette's scroll-into-view needs a stand-in. */
Element.prototype.scrollIntoView = jest.fn();

const labels: CommandPaletteLabels = {
  title: 'Command palette',
  placeholder: 'Search commands',
  empty: 'No results',
  unavailable: 'Unavailable',
  navigate: 'to navigate',
  open: 'to open',
  close: 'to close',
};

const renderPalette = (
  items: CommandPaletteItem[],
  onOpenChange: (open: boolean) => void = jest.fn(),
) =>
  render(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      items={items}
      labels={labels}
      shortcut={false}
    />,
  );

describe('CommandPalette', () => {
  it('filters by name and opens the matching destination with Enter', () => {
    const onReview = jest.fn();
    renderPalette([
      { id: 'timemachine', title: 'Time Machine', group: 'Modules', onSelect: jest.fn() },
      { id: 'review', title: 'Code Review', group: 'Modules', onSelect: onReview },
    ]);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'code' } });

    expect(screen.queryByText('Time Machine')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Code Review/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('shows an unavailable destination with its blocker and refuses to open it', () => {
    const onFilm = jest.fn();
    renderPalette([
      {
        id: 'film',
        title: 'Movie Studio',
        group: 'Modules',
        unavailableReason: 'Requires verified video generation',
        onSelect: onFilm,
      },
    ]);

    const option = screen.getByRole('option', { name: /Movie Studio/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Requires verified video generation')).toBeInTheDocument();

    fireEvent.click(option);
    expect(onFilm).not.toHaveBeenCalled();
  });

  it('never leaves the cursor on a row it cannot open', () => {
    const onPlanned = jest.fn();
    renderPalette([
      {
        id: 'film',
        title: 'Movie Studio',
        group: 'Modules',
        unavailableReason: 'Requires verified video generation',
        onSelect: jest.fn(),
      },
      { id: 'planned', title: 'Planning', group: 'Modules', onSelect: onPlanned },
    ]);

    expect(screen.getByRole('option', { name: /Planning/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onPlanned).toHaveBeenCalledTimes(1);
  });

  it('opens in the inspector with a modified Enter when the caller supports it', () => {
    const onSelect = jest.fn();
    const onInspect = jest.fn();
    renderPalette([
      {
        id: 'evidence',
        title: 'Evidence Explorer',
        group: 'Modules',
        onSelect,
        onInspect,
      },
    ]);

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', metaKey: true });
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says so when nothing matches instead of showing an empty list', () => {
    renderPalette([{ id: 'review', title: 'Code Review', group: 'Modules', onSelect: jest.fn() }]);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });

    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('toggles with ⌘K while it is unmounted from view', () => {
    const onOpenChange = jest.fn();
    render(<CommandPalette open={false} onOpenChange={onOpenChange} items={[]} labels={labels} />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('walks rows in the order they are drawn, not the order they matched', () => {
    const onAlphaTwo = jest.fn();
    renderPalette([
      { id: 'alpha-one', title: 'Alpha one', group: 'Alpha', onSelect: jest.fn() },
      { id: 'beta-one', title: 'Beta one', group: 'Beta', onSelect: jest.fn() },
      { id: 'alpha-two', title: 'Alpha two', group: 'Alpha', onSelect: onAlphaTwo },
    ]);

    expect(screen.getByRole('option', { name: /Alpha one/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Alpha two/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onAlphaTwo).toHaveBeenCalledTimes(1);
  });

  it('keeps the active row when rows are inserted above it', () => {
    const onBravo = jest.fn();
    const items: CommandPaletteItem[] = [
      { id: 'alpha', title: 'Alpha', group: 'Modules', onSelect: jest.fn() },
      { id: 'bravo', title: 'Bravo', group: 'Modules', onSelect: onBravo },
    ];
    const { rerender } = renderPalette(items);

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Bravo/ })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <CommandPalette
        open
        onOpenChange={jest.fn()}
        items={[{ id: 'xray', title: 'Xray', group: 'Modules', onSelect: jest.fn() }, ...items]}
        labels={labels}
        shortcut={false}
      />,
    );

    expect(screen.getByRole('option', { name: /Bravo/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onBravo).toHaveBeenCalledTimes(1);
  });
});

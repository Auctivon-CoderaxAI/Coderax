import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ModuleShell from './ModuleShell';

describe('ModuleShell', () => {
  it('renders the frame a module inherits: breadcrumb, title, status, actions and body', () => {
    render(
      <ModuleShell
        title="Evidence"
        breadcrumb={<span>Project · Aurora</span>}
        description="Every receipt the platform has issued."
        status={<span>Verified</span>}
        actions={<button type="button">Export</button>}
        footer={<span>42 receipts</span>}
      >
        <p>Receipt list</p>
      </ModuleShell>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Evidence' })).toBeInTheDocument();
    expect(screen.getByText('Project · Aurora')).toBeInTheDocument();
    expect(screen.getByText('Every receipt the platform has issued.')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByText('Receipt list')).toBeInTheDocument();
    expect(screen.getByText('42 receipts')).toBeInTheDocument();
  });

  it('names the tab strip after the module so it is not an unlabelled navigation region', () => {
    render(
      <ModuleShell
        title="Testing Lab"
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'runs', label: 'Runs' },
        ]}
        activeTab="overview"
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Testing Lab' })).toBeInTheDocument();
  });

  it('marks the active destination and reports the one the owner picks', () => {
    const onTabChange = jest.fn();
    render(
      <ModuleShell
        title="Testing Lab"
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'runs', label: 'Runs' },
        ]}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onTabChange).toHaveBeenCalledWith('runs');

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled destination out of reach', () => {
    const onTabChange = jest.fn();
    render(
      <ModuleShell
        title="Studio"
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'editor', label: 'Editor', disabled: true },
        ]}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );

    const editor = screen.getByRole('button', { name: 'Editor' });
    expect(editor).toBeDisabled();

    fireEvent.click(editor);
    expect(onTabChange).not.toHaveBeenCalled();
  });
});

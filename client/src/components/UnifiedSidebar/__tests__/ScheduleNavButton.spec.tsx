import { CalendarClock } from 'lucide-react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NavLink } from '~/common';
import ScheduleNavButton from '../ScheduleNavButton';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
}));

const link: NavLink = {
  title: 'com_ui_taskbar_scheduled',
  label: '',
  icon: CalendarClock,
  id: 'schedules',
};

const renderButton = () => {
  const props = {
    link,
    isActive: false,
    expanded: true,
    setActive: jest.fn(),
    onExpand: jest.fn(),
    onLeaveInsights: jest.fn(),
    onHover: jest.fn(),
    onHoverEnd: jest.fn(),
    onDismissHover: jest.fn(),
  };
  render(<ScheduleNavButton {...props} />);
  return props;
};

describe('ScheduleNavButton', () => {
  it('opens the schedule type options on click without opening the hover preview', () => {
    const props = renderButton();

    fireEvent.click(screen.getByTestId('nav-panel-schedules'));

    expect(props.onDismissHover).toHaveBeenCalled();
    expect(props.setActive).toHaveBeenCalledWith('schedules');
    expect(props.onHover).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('com_ui_schedule_hourly')).toBeInTheDocument();
    expect(screen.getByText('com_ui_schedule_daily')).toBeInTheDocument();
    expect(screen.getByText('com_ui_schedule_weekdays')).toBeInTheDocument();
    expect(screen.getByText('com_ui_schedule_weekly')).toBeInTheDocument();
    expect(screen.getByText('com_ui_schedule_cron')).toBeInTheDocument();
  });
});

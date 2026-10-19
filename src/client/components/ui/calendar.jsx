import { DayPicker } from 'react-day-picker';
import { cn } from '../../lib/utils';

// Manual shadcn Calendar adapter for DayPicker 9 and Tailwind 3.
// No global shadcn theme, Button component, or Tailwind 4 utilities are needed.
export function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return <DayPicker showOutsideDays={showOutsideDays} navLayout="around"
    className={cn('tripcast-calendar', className)}
    classNames={{
      months: 'calendar-months', month: 'calendar-month', month_caption: 'calendar-caption',
      caption_label: 'calendar-caption-label', month_grid: 'calendar-grid',
      weekdays: 'calendar-weekdays', weekday: 'calendar-weekday', week: 'calendar-week',
      day: 'calendar-day', day_button: 'calendar-day-button',
      button_previous: 'calendar-month-button', button_next: 'calendar-month-button',
      chevron: 'calendar-chevron', selected: 'calendar-selected', today: 'calendar-today',
      outside: 'calendar-outside', disabled: 'calendar-disabled', hidden: 'calendar-hidden',
      ...classNames,
    }} {...props} />;
}

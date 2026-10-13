import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Destination from '../src/client/components/destination/Destination';
import WeatherContext from '../src/client/context/WeatherContextProvider';

function renderDestination(overrides = {}) {
  const actions = {
    city: '',
    submitted: false,
    setCity: vi.fn(),
    setDate: vi.fn(),
    setSubmitted: vi.fn(),
    resetAll: vi.fn(),
    handleUseCurrentLocation: vi.fn(),
    ...overrides,
  };
  render(
    <WeatherContext.Provider value={actions}>
      <Destination />
    </WeatherContext.Provider>,
  );
  return actions;
}

describe('destination form baseline', () => {
  it('keeps the date field required and associated with its label', () => {
    renderDestination();
    expect(screen.getByLabelText('Date of travel:')).toBeRequired();
    expect(screen.getByPlaceholderText('Destination e.g., Berlin')).toBeRequired();
  });

  it('passes city edits to form state without calling the weather API', async () => {
    const user = userEvent.setup();
    const actions = renderDestination();
    await user.type(screen.getByPlaceholderText('Destination e.g., Berlin'), 'B');
    expect(actions.setCity).toHaveBeenCalledWith('B');
    expect(actions.setSubmitted).not.toHaveBeenCalled();
  });

  it('delegates reset and clears the date input', async () => {
    const user = userEvent.setup();
    const actions = renderDestination({ city: 'Berlin' });
    const dateInput = screen.getByLabelText('Date of travel:');
    await user.type(dateInput, '2026-10-13');
    expect(dateInput).toHaveValue('2026-10-13');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(actions.resetAll).toHaveBeenCalledOnce();
    expect(dateInput).toHaveValue('');
  });
});

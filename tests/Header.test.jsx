import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import Header from '../src/client/components/Header';

it('preserves the application title and travel introduction', () => {
  render(<Header />);
  expect(screen.getByRole('heading', { level: 1, name: 'My Travel App' })).toBeVisible();
  expect(screen.getByText("The 3 W's of travelling: Where, When and Weather")).toBeVisible();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AppError from './error';

const logRenderErrorMock = vi.fn();

vi.mock('@/lib/clientErrorLogging', () => ({
  logRenderError: (...args: unknown[]) => logRenderErrorMock(...args),
}));

describe('AppError boundary UI', () => {
  it('renders a fallback message and retry action', () => {
    const reset = vi.fn();

    render(<AppError error={new Error('boom')} reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('We hit an unexpected error while loading this page.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('logs render errors on mount', async () => {
    logRenderErrorMock.mockReset();

    const error = Object.assign(new Error('Render failed'), { digest: 'digest-1' });
    render(<AppError error={error} reset={() => undefined} />);

    await waitFor(() => {
      expect(logRenderErrorMock).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ source: 'frontend/src/app/error.tsx' }),
      );
    });
  });
});

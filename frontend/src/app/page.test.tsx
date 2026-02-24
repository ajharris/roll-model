import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

const pushMock = vi.fn();
const useAuthMock = vi.fn();
const beginHostedUiSignInMock = vi.fn();
const getHostedUiRuntimeConfigMock = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/cognitoHostedUi', () => ({
  beginHostedUiSignIn: (...args: unknown[]) => beginHostedUiSignInMock(...args),
  getHostedUiRuntimeConfig: (...args: unknown[]) => getHostedUiRuntimeConfigMock(...args),
}));

describe('HomePage Hosted UI', () => {
  beforeEach(() => {
    pushMock.mockReset();
    useAuthMock.mockReset();
    beginHostedUiSignInMock.mockReset();
    getHostedUiRuntimeConfigMock.mockReset();

    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      role: 'unknown',
      signIn: vi.fn(),
    });
  });

  it('renders hosted UI sign-in button and starts hosted UI flow', async () => {
    const user = userEvent.setup();
    getHostedUiRuntimeConfigMock.mockReturnValue({
      hasHostedUiConfig: true,
      enabled: true,
      clientId: 'client',
      domainUrl: 'https://example.auth.us-east-1.amazoncognito.com',
      signInRedirectUri: 'http://localhost:3000/auth/callback',
      signOutRedirectUri: 'http://localhost:3000/',
      validationErrors: [],
    });

    render(<HomePage />);

    const hostedUiButton = await screen.findByRole('button', {
      name: 'Sign in with Cognito Hosted UI',
    });
    await user.click(hostedUiButton);

    expect(beginHostedUiSignInMock).toHaveBeenCalledWith(window.location.origin);
  });

  it('shows hosted UI config validation error when configured but invalid', async () => {
    getHostedUiRuntimeConfigMock.mockReturnValue({
      hasHostedUiConfig: true,
      enabled: false,
      clientId: 'client',
      domainUrl: 'https://example.auth.us-east-1.amazoncognito.com',
      signInRedirectUri: null,
      signOutRedirectUri: null,
      validationErrors: ['No sign-in redirect URI matches the current origin (http://localhost:3000).'],
    });

    render(<HomePage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No sign-in redirect URI matches the current origin (http://localhost:3000).',
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Sign in with Cognito Hosted UI' }),
    ).not.toBeInTheDocument();
  });

  it('routes coach users to /coach using the fresh sign-in role', async () => {
    const user = userEvent.setup();
    const signInMock = vi.fn().mockResolvedValue('coach');
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      role: 'athlete',
      signIn: signInMock,
    });

    render(<HomePage />);

    await user.type(screen.getByLabelText('Email or username'), 'coach@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith('coach@example.com', 'password123');
      expect(pushMock).toHaveBeenCalledWith('/coach');
    });
  });

  it('routes athlete users to /entries using the fresh sign-in role', async () => {
    const user = userEvent.setup();
    const signInMock = vi.fn().mockResolvedValue('athlete');
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      role: 'coach',
      signIn: signInMock,
    });

    render(<HomePage />);

    await user.type(screen.getByLabelText('Email or username'), 'athlete@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith('athlete@example.com', 'password123');
      expect(pushMock).toHaveBeenCalledWith('/entries');
    });
  });
});

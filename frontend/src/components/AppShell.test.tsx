import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';

const pushMock = vi.fn();
const usePathnameMock = vi.fn();
const useAuthMock = vi.fn();
const buildHostedUiLogoutUrlMock = vi.fn();
const getHostedUiRuntimeConfigMock = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/cognitoHostedUi', () => ({
  buildHostedUiLogoutUrl: (...args: unknown[]) => buildHostedUiLogoutUrlMock(...args),
  getHostedUiRuntimeConfig: (...args: unknown[]) => getHostedUiRuntimeConfigMock(...args),
}));

describe('AppShell', () => {
  beforeEach(() => {
    pushMock.mockReset();
    usePathnameMock.mockReset();
    useAuthMock.mockReset();
    buildHostedUiLogoutUrlMock.mockReset();
    getHostedUiRuntimeConfigMock.mockReset();
    buildHostedUiLogoutUrlMock.mockReturnValue(null);
    getHostedUiRuntimeConfigMock.mockReturnValue({});
  });

  it('renders athlete nav links and marks active path', () => {
    usePathnameMock.mockReturnValue('/chat');
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      role: 'athlete',
      signOut: vi.fn(),
      user: { email: 'athlete@example.com' },
    });

    render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: 'chat' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'entries' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'coach' })).not.toBeInTheDocument();
  });

  it('signs out and routes home when sign out is clicked', async () => {
    const user = userEvent.setup();
    const signOutMock = vi.fn();

    usePathnameMock.mockReturnValue('/entries');
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      role: 'athlete',
      signOut: signOutMock,
      user: { email: 'athlete@example.com' },
    });

    render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('redirects to Cognito hosted logout when configured', async () => {
    const user = userEvent.setup();
    const signOutMock = vi.fn();
    const assignMock = vi.spyOn(Location.prototype, 'assign').mockImplementation(() => undefined);

    usePathnameMock.mockReturnValue('/entries');
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      role: 'athlete',
      signOut: signOutMock,
      user: { email: 'athlete@example.com' },
    });
    buildHostedUiLogoutUrlMock.mockReturnValue('https://example.auth/logout');

    render(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(getHostedUiRuntimeConfigMock).toHaveBeenCalledWith(window.location.origin);
    expect(assignMock).toHaveBeenCalledWith('https://example.auth/logout');
    expect(pushMock).not.toHaveBeenCalled();

    assignMock.mockRestore();
  });
});

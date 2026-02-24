import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConfigHealthPage from './page';

const useAuthMock = vi.fn();
const getHostedUiRuntimeConfigMock = vi.fn();

vi.mock('@/components/Protected', () => ({
  Protected: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/cognitoHostedUi', () => ({
  getHostedUiRuntimeConfig: (...args: unknown[]) => getHostedUiRuntimeConfigMock(...args),
}));

describe('ConfigHealthPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthMock.mockReset();
    getHostedUiRuntimeConfigMock.mockReset();

    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test/prod';
    process.env.NEXT_PUBLIC_AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_pool123';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-123';
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'example.auth.us-east-1.amazoncognito.com';
    process.env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS = 'http://localhost:3000/auth/callback';
    process.env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS = 'http://localhost:3000/';

    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      role: 'admin',
      tokens: {
        idToken: 'secret-id-token',
        accessToken: 'secret-access-token',
        refreshToken: 'secret-refresh-token',
      },
    });

    getHostedUiRuntimeConfigMock.mockReturnValue({
      hasHostedUiConfig: true,
      enabled: true,
      clientId: 'client-123',
      domainUrl: 'https://example.auth.us-east-1.amazoncognito.com',
      signInRedirectUri: 'http://localhost:3000/auth/callback',
      signOutRedirectUri: 'http://localhost:3000/',
      validationErrors: [],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 403, statusText: 'Forbidden' })),
    );
  });

  it('shows non-secret config values and API/auth diagnostics', async () => {
    render(<ConfigHealthPage />);

    expect(screen.getByRole('heading', { name: 'Config Health' })).toBeInTheDocument();
    expect(screen.getByText('Role: admin')).toBeInTheDocument();
    expect(screen.getByText('ID token present: yes')).toBeInTheDocument();
    expect(screen.getByText('Access token present: yes')).toBeInTheDocument();
    expect(screen.getByText('Refresh token present: yes')).toBeInTheDocument();

    expect(screen.getByText(/API base URL: https:\/\/api\.example\.test\/prod/)).toBeInTheDocument();
    expect(screen.getByText(/AWS region: us-east-1/)).toBeInTheDocument();
    expect(screen.getByText(/Cognito user pool ID: us-east-1_pool123/)).toBeInTheDocument();
    expect(screen.getByText(/Cognito client ID: client-123/)).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/Status: API reachable but request not authorized \(WARN\)/),
      ).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/entries',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    );

    expect(screen.queryByText('secret-id-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-access-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-refresh-token')).not.toBeInTheDocument();
  });
});

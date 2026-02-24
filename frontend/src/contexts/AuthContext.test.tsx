import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';

const sessionKey = 'roll-model-auth';

type TokenGetter = () => string | null;

const configureApiClientMock = vi.fn<(getter: TokenGetter) => void>();
let latestApiTokenGetter: TokenGetter | null = null;

const cognitoRefreshSessionMock = vi.fn();
const cognitoAuthenticateUserMock = vi.fn();

vi.mock('@/lib/apiClient', () => ({
  configureApiClient: (getter: TokenGetter) => {
    latestApiTokenGetter = getter;
    configureApiClientMock(getter);
  },
}));

vi.mock('amazon-cognito-identity-js', () => {
  class CognitoUserPool {
    constructor() {}
  }

  class AuthenticationDetails {
    constructor() {}
  }

  class CognitoRefreshToken {
    private token: string;

    constructor(config: { RefreshToken: string }) {
      this.token = config.RefreshToken;
    }

    getToken() {
      return this.token;
    }
  }

  class CognitoUser {
    constructor() {}

    authenticateUser(details: unknown, callbacks: unknown) {
      return cognitoAuthenticateUserMock(details, callbacks);
    }

    refreshSession(refreshToken: unknown, callback: unknown) {
      return cognitoRefreshSessionMock(refreshToken, callback);
    }
  }

  return {
    AuthenticationDetails,
    CognitoRefreshToken,
    CognitoUser,
    CognitoUserPool,
  };
});

const makeJwt = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
};

const makeSessionResult = (tokens: { idToken: string; accessToken: string; refreshToken?: string }) => ({
  getIdToken: () => ({ getJwtToken: () => tokens.idToken }),
  getAccessToken: () => ({ getJwtToken: () => tokens.accessToken }),
  getRefreshToken: () => ({ getToken: () => tokens.refreshToken ?? 'refresh-fallback' }),
});

const Probe = () => {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="is-authenticated">{auth.isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="role">{auth.role}</div>
      <div data-testid="id-token">{auth.tokens?.idToken ?? ''}</div>
      <div data-testid="user-email">{auth.user?.email ?? ''}</div>
    </div>
  );
};

const renderWithProvider = (children?: ReactNode) =>
  render(<AuthProvider>{children ?? <Probe />}</AuthProvider>);

describe('AuthContext refresh flow', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    sessionStorage.clear();
    latestApiTokenGetter = null;
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_pool';
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'client-id';
    window.history.replaceState(null, '', '/');
  });

  it('refreshes stored session on startup hydration when ID token is expired', async () => {
    const now = new Date('2026-02-24T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());

    const expiredIdToken = makeJwt({
      sub: 'user-1',
      email: 'athlete@example.com',
      exp: Math.floor(now.getTime() / 1000) - 10,
      'custom:role': 'athlete',
      'cognito:username': 'athlete-user',
    });
    const refreshedIdToken = makeJwt({
      sub: 'user-1',
      email: 'athlete@example.com',
      exp: Math.floor(now.getTime() / 1000) + 3600,
      'custom:role': 'athlete',
      'cognito:username': 'athlete-user',
    });

    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        idToken: expiredIdToken,
        accessToken: 'expired-access',
        refreshToken: 'refresh-1',
      }),
    );

    cognitoRefreshSessionMock.mockImplementation((_refreshToken, callback) => {
      callback(null, makeSessionResult({
        idToken: refreshedIdToken,
        accessToken: 'fresh-access',
        refreshToken: 'refresh-2',
      }));
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('yes');
      expect(screen.getByTestId('id-token')).toHaveTextContent(refreshedIdToken);
    });

    expect(screen.getByTestId('role')).toHaveTextContent('athlete');
    expect(latestApiTokenGetter?.()).toBe(refreshedIdToken);
    expect(JSON.parse(sessionStorage.getItem(sessionKey) ?? '{}')).toMatchObject({
      idToken: refreshedIdToken,
      accessToken: 'fresh-access',
      refreshToken: 'refresh-2',
    });
  });

  it('clears session and routes to sign-in when refresh fails during hydration', async () => {
    const now = new Date('2026-02-24T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    window.history.replaceState(null, '', '/entries');
    const replaceSpy = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      pathname: '/entries',
      replace: replaceSpy,
    } as Location);

    const expiredIdToken = makeJwt({
      sub: 'user-2',
      email: 'coach@example.com',
      exp: Math.floor(now.getTime() / 1000) - 5,
      'custom:role': 'coach',
      'cognito:username': 'coach-user',
    });
    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        idToken: expiredIdToken,
        accessToken: 'expired-access',
        refreshToken: 'bad-refresh',
      }),
    );

    cognitoRefreshSessionMock.mockImplementation((_refreshToken, callback) => {
      callback(new Error('invalid refresh token'));
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('no');
    });

    expect(sessionStorage.getItem(sessionKey)).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith('/');
  });

  it('handles malformed stored session during hydration', async () => {
    sessionStorage.setItem(sessionKey, '{not-json');

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('no');
    });

    expect(cognitoRefreshSessionMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it('refreshes proactively before expiration and updates the API token getter', async () => {
    const now = new Date('2026-02-24T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const initialIdToken = makeJwt({
      sub: 'user-3',
      email: 'athlete2@example.com',
      exp: Math.floor((now.getTime() + 180_000) / 1000),
      'custom:role': 'athlete',
      'cognito:username': 'athlete-user-2',
    });
    const refreshedIdToken = makeJwt({
      sub: 'user-3',
      email: 'athlete2@example.com',
      exp: Math.floor((now.getTime() + 7200_000) / 1000),
      'custom:role': 'athlete',
      'cognito:username': 'athlete-user-2',
    });

    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        idToken: initialIdToken,
        accessToken: 'access-initial',
        refreshToken: 'refresh-proactive',
      }),
    );

    cognitoRefreshSessionMock.mockImplementation((_refreshToken, callback) => {
      callback(null, makeSessionResult({
        idToken: refreshedIdToken,
        accessToken: 'access-refreshed',
        refreshToken: 'refresh-proactive-2',
      }));
    });

    renderWithProvider();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('id-token')).toHaveTextContent(initialIdToken);

    act(() => {
      vi.advanceTimersByTime(119_000);
    });
    expect(cognitoRefreshSessionMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(cognitoRefreshSessionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('id-token')).toHaveTextContent(refreshedIdToken);

    expect(latestApiTokenGetter?.()).toBe(refreshedIdToken);
  });
});

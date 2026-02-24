'use client';

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoRefreshToken,
  CognitoUserPool,
} from 'amazon-cognito-identity-js';
import { jwtDecode } from 'jwt-decode';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { configureApiClient } from '@/lib/apiClient';
import type { UserRole } from '@/types/api';

export interface AuthTokens {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
}

interface UserInfo {
  sub: string;
  email?: string;
}

interface DecodedIdToken {
  sub: string;
  email?: string;
  exp?: number;
  'custom:role'?: UserRole;
  'cognito:username'?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  user: UserInfo | null;
  role: UserRole;
  tokens: AuthTokens | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  hydrateHostedUiTokens: (tokens: AuthTokens) => UserRole | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const sessionKey = 'roll-model-auth';
const refreshLeadTimeMs = 60_000;

const decodeIdToken = (idToken: string): DecodedIdToken => jwtDecode<DecodedIdToken>(idToken);

const getIdTokenExpiryMs = (idToken: string): number | null => {
  try {
    const decoded = decodeIdToken(idToken);
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
};

const getMsUntilTokenExpiry = (idToken: string): number | null => {
  const expiryMs = getIdTokenExpiryMs(idToken);
  if (expiryMs === null) return null;
  return expiryMs - Date.now();
};

const createUserPool = (): CognitoUserPool | null => {
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  try {
    return new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [role, setRole] = useState<UserRole>('unknown');
  const userPool = useMemo(() => createUserPool(), []);
  const tokensRef = useRef<AuthTokens | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef<Promise<AuthTokens | null> | null>(null);

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const redirectToSignIn = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== '/') {
      window.location.replace('/');
    }
  }, []);

  const clearSession = useCallback(
    (options?: { redirectToSignIn?: boolean }) => {
      clearRefreshTimeout();
      tokensRef.current = null;
      setTokens(null);
      setUser(null);
      setRole('unknown');
      sessionStorage.removeItem(sessionKey);
      if (options?.redirectToSignIn) {
        redirectToSignIn();
      }
    },
    [clearRefreshTimeout, redirectToSignIn],
  );

  const hydrateFromToken = useCallback((nextTokens: AuthTokens): UserRole | null => {
    try {
      const decoded = decodeIdToken(nextTokens.idToken);
      const nextRole = decoded['custom:role'] ?? 'unknown';
      tokensRef.current = nextTokens;
      setTokens(nextTokens);
      setUser({ sub: decoded.sub, email: decoded.email });
      setRole(nextRole);
      sessionStorage.setItem(sessionKey, JSON.stringify(nextTokens));
      return nextRole;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  const refreshSession = useCallback(
    async (
      currentTokens: AuthTokens,
      options?: { redirectOnFailure?: boolean },
    ): Promise<AuthTokens | null> => {
      if (!userPool || !currentTokens.refreshToken) {
        if (options?.redirectOnFailure) clearSession({ redirectToSignIn: true });
        return null;
      }

      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }

      let username: string | undefined;
      try {
        username = decodeIdToken(currentTokens.idToken)['cognito:username'];
      } catch {
        username = undefined;
      }

      if (!username) {
        if (options?.redirectOnFailure) clearSession({ redirectToSignIn: true });
        return null;
      }

      const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
      const refreshToken = new CognitoRefreshToken({ RefreshToken: currentTokens.refreshToken });

      const request = new Promise<AuthTokens | null>((resolve) => {
        cognitoUser.refreshSession(
          refreshToken,
          (error: Error | null, result?: { getIdToken: () => { getJwtToken: () => string }; getAccessToken: () => { getJwtToken: () => string }; getRefreshToken?: () => { getToken: () => string } }) => {
            if (error || !result) {
              if (options?.redirectOnFailure) clearSession({ redirectToSignIn: true });
              resolve(null);
              return;
            }

            const nextTokens: AuthTokens = {
              idToken: result.getIdToken().getJwtToken(),
              accessToken: result.getAccessToken().getJwtToken(),
              refreshToken: result.getRefreshToken?.().getToken() ?? currentTokens.refreshToken,
            };

            const nextRole = hydrateFromToken(nextTokens);
            if (!nextRole) {
              if (options?.redirectOnFailure) clearSession({ redirectToSignIn: true });
              resolve(null);
              return;
            }

            resolve(nextTokens);
          },
        );
      }).finally(() => {
        refreshInFlightRef.current = null;
      });

      refreshInFlightRef.current = request;
      return request;
    },
    [clearSession, hydrateFromToken, userPool],
  );

  const refreshCurrentSession = useCallback(
    (options?: { redirectOnFailure?: boolean }) => {
      const currentTokens = tokensRef.current;
      if (!currentTokens?.refreshToken) return Promise.resolve<AuthTokens | null>(null);
      return refreshSession(currentTokens, options);
    },
    [refreshSession],
  );

  const getLatestIdToken = useCallback(() => {
    const currentTokens = tokensRef.current;
    if (!currentTokens?.idToken) return null;

    const msUntilExpiry = getMsUntilTokenExpiry(currentTokens.idToken);
    if (msUntilExpiry !== null) {
      if (msUntilExpiry <= 0) {
        void refreshCurrentSession({ redirectOnFailure: true });
        return null;
      }
      if (msUntilExpiry <= refreshLeadTimeMs) {
        void refreshCurrentSession({ redirectOnFailure: true });
      }
    }

    return tokensRef.current?.idToken ?? null;
  }, [refreshCurrentSession]);

  useEffect(() => {
    configureApiClient(getLatestIdToken);
  }, [getLatestIdToken]);

  useEffect(() => {
    const raw = sessionStorage.getItem(sessionKey);
    if (!raw) return;

    let parsed: AuthTokens | null = null;
    try {
      parsed = JSON.parse(raw) as AuthTokens;
    } catch {
      clearSession();
      return;
    }

    if (!parsed?.idToken) {
      clearSession();
      return;
    }

    const msUntilExpiry = getMsUntilTokenExpiry(parsed.idToken);
    if (msUntilExpiry === null) {
      clearSession();
      return;
    }

    if (msUntilExpiry <= refreshLeadTimeMs && parsed.refreshToken) {
      void refreshSession(parsed, { redirectOnFailure: true });
      return;
    }

    if (msUntilExpiry <= 0) {
      clearSession();
      return;
    }

    hydrateFromToken(parsed);
  }, [clearSession, hydrateFromToken, refreshSession]);

  useEffect(() => {
    clearRefreshTimeout();

    if (!tokens?.idToken) return;

    const msUntilExpiry = getMsUntilTokenExpiry(tokens.idToken);
    if (msUntilExpiry === null) return;

    const delayMs = Math.max(msUntilExpiry - refreshLeadTimeMs, 0);
    refreshTimeoutRef.current = window.setTimeout(() => {
      void refreshCurrentSession({ redirectOnFailure: true });
    }, delayMs);

    return clearRefreshTimeout;
  }, [clearRefreshTimeout, refreshCurrentSession, tokens]);

  const signIn = useCallback((username: string, password: string) =>
    new Promise<void>((resolve, reject) => {
      if (!userPool) {
        reject(new Error('Cognito user pool is not configured.'));
        return;
      }
      const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
      const authDetails = new AuthenticationDetails({ Username: username, Password: password });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (result) => {
          hydrateFromToken({
            idToken: result.getIdToken().getJwtToken(),
            accessToken: result.getAccessToken().getJwtToken(),
            refreshToken: result.getRefreshToken().getToken(),
          });
          resolve();
        },
        onFailure: (err) => reject(err),
      });
    }), [hydrateFromToken, userPool]);

  const signOut = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const hydrateHostedUiTokens = useCallback(
    (nextTokens: AuthTokens) => hydrateFromToken(nextTokens),
    [hydrateFromToken],
  );

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(tokens?.idToken),
      user,
      role,
      tokens,
      signIn,
      signOut,
      hydrateHostedUiTokens,
    }),
    [hydrateHostedUiTokens, role, signIn, signOut, tokens, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

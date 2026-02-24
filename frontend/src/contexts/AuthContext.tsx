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
import { getFrontendRuntimeConfig } from '@/lib/runtimeConfig';
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
  'cognito:groups'?: string[] | string;
  'cognito:username'?: string;
}

const resolveRolesFromToken = (decoded: DecodedIdToken): UserRole[] => {
  const roles: UserRole[] = [];
  const explicitRole = decoded['custom:role'];
  if (explicitRole === 'athlete' || explicitRole === 'coach' || explicitRole === 'admin') {
    roles.push(explicitRole);
  }

  const rawGroups = decoded['cognito:groups'];
  const groups = Array.isArray(rawGroups)
    ? rawGroups
    : typeof rawGroups === 'string'
      ? rawGroups.split(',').map((group) => group.trim())
      : [];

  if (groups.includes('athlete')) roles.push('athlete');
  if (groups.includes('coach')) roles.push('coach');
  if (groups.includes('admin')) roles.push('admin');

  const uniqueRoles = [...new Set(roles)];
  return uniqueRoles.length ? uniqueRoles : ['unknown'];
};

const pickDefaultActiveRole = (roles: UserRole[], preferredRole?: UserRole | null): UserRole => {
  if (preferredRole && preferredRole !== 'unknown' && roles.includes(preferredRole)) {
    return preferredRole;
  }
  if (roles.includes('athlete')) return 'athlete';
  if (roles.includes('coach')) return 'coach';
  if (roles.includes('admin')) return 'admin';
  return 'unknown';
};

interface AuthContextValue {
  isAuthenticated: boolean;
  user: UserInfo | null;
  roles: UserRole[];
  activeRole: UserRole;
  role: UserRole;
  tokens: AuthTokens | null;
  signIn: (username: string, password: string) => Promise<UserRole>;
  signOut: () => void;
  hydrateHostedUiTokens: (tokens: AuthTokens) => UserRole | null;
  setActiveRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const sessionKey = 'roll-model-auth';
const activeRoleKey = 'roll-model-active-role';
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
  const config = getFrontendRuntimeConfig();
  const userPoolId = config.cognitoUserPoolId;
  const clientId = config.cognitoClientId;
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
  const [roles, setRoles] = useState<UserRole[]>(['unknown']);
  const [role, setRole] = useState<UserRole>('unknown');
  const userPool = useMemo(() => createUserPool(), []);
  const tokensRef = useRef<AuthTokens | null>(null);
  const rolesRef = useRef<UserRole[]>(['unknown']);
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
      rolesRef.current = ['unknown'];
      setRoles(['unknown']);
      setRole('unknown');
      sessionStorage.removeItem(sessionKey);
      sessionStorage.removeItem(activeRoleKey);
      if (options?.redirectToSignIn) {
        redirectToSignIn();
      }
    },
    [clearRefreshTimeout, redirectToSignIn],
  );

  const hydrateFromToken = useCallback((nextTokens: AuthTokens): UserRole | null => {
    try {
      const decoded = decodeIdToken(nextTokens.idToken);
      const nextRoles = resolveRolesFromToken(decoded);
      const storedActiveRole = sessionStorage.getItem(activeRoleKey);
      const preferredRole =
        storedActiveRole === 'athlete' || storedActiveRole === 'coach' || storedActiveRole === 'admin'
          ? storedActiveRole
          : role;
      const nextRole = pickDefaultActiveRole(nextRoles, preferredRole);
      tokensRef.current = nextTokens;
      setTokens(nextTokens);
      setUser({ sub: decoded.sub, email: decoded.email });
      rolesRef.current = nextRoles;
      setRoles(nextRoles);
      setRole(nextRole);
      if (nextRole !== 'unknown') {
        sessionStorage.setItem(activeRoleKey, nextRole);
      }
      sessionStorage.setItem(sessionKey, JSON.stringify(nextTokens));
      return nextRole;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession, role]);

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
    new Promise<UserRole>((resolve, reject) => {
      if (!userPool) {
        reject(new Error('Cognito user pool is not configured.'));
        return;
      }
      const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
      const authDetails = new AuthenticationDetails({ Username: username, Password: password });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (result) => {
          const nextRole = hydrateFromToken({
            idToken: result.getIdToken().getJwtToken(),
            accessToken: result.getAccessToken().getJwtToken(),
            refreshToken: result.getRefreshToken().getToken(),
          });
          if (!nextRole) {
            reject(new Error('Failed to hydrate authenticated session.'));
            return;
          }
          resolve(nextRole);
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

  const setActiveRole = useCallback((nextRole: UserRole) => {
    if (nextRole === 'unknown') return;
    if (!rolesRef.current.includes(nextRole)) return;
    setRole(nextRole);
    sessionStorage.setItem(activeRoleKey, nextRole);
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(tokens?.idToken),
      user,
      roles,
      activeRole: role,
      role,
      tokens,
      signIn,
      signOut,
      hydrateHostedUiTokens,
      setActiveRole,
    }),
    [hydrateHostedUiTokens, role, roles, setActiveRole, signIn, signOut, tokens, user],
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

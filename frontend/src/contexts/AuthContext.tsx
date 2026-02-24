'use client';

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js';
import { jwtDecode } from 'jwt-decode';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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

  const hydrateFromToken = useCallback((nextTokens: AuthTokens): UserRole | null => {
    try {
      const decoded = jwtDecode<Record<string, string>>(nextTokens.idToken);
      const nextRole = (decoded['custom:role'] as UserRole) ?? 'unknown';
      setTokens(nextTokens);
      setUser({ sub: decoded.sub, email: decoded.email });
      setRole(nextRole);
      sessionStorage.setItem(sessionKey, JSON.stringify(nextTokens));
      return nextRole;
    } catch {
      setTokens(null);
      setUser(null);
      setRole('unknown');
      sessionStorage.removeItem(sessionKey);
      return null;
    }
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem(sessionKey);
    if (raw) {
      const parsed = JSON.parse(raw) as AuthTokens;
      hydrateFromToken(parsed);
    }
  }, [hydrateFromToken]);

  useEffect(() => {
    configureApiClient(() => tokens?.idToken ?? null);
  }, [tokens]);

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
    setTokens(null);
    setUser(null);
    setRole('unknown');
    sessionStorage.removeItem(sessionKey);
  }, []);

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

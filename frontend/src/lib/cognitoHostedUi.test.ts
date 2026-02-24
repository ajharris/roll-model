import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOSTED_UI_CALLBACK_PATH,
  buildHostedUiLogoutUrl,
  exchangeHostedUiCodeForTokens,
  getHostedUiRuntimeConfig,
  parseHostedUiCallback,
} from './cognitoHostedUi';

describe('getHostedUiRuntimeConfig', () => {
  const baseEnv = {
    NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
    NEXT_PUBLIC_COGNITO_DOMAIN: 'example.auth.us-east-1.amazoncognito.com',
    NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: [
      `http://localhost:3000${HOSTED_UI_CALLBACK_PATH}`,
      `https://preview.example.amplifyapp.com${HOSTED_UI_CALLBACK_PATH}`,
      `https://app.example.com${HOSTED_UI_CALLBACK_PATH}`,
    ].join(','),
    NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS: [
      'http://localhost:3000/',
      'https://preview.example.amplifyapp.com/',
      'https://app.example.com/',
    ].join(','),
  };

  it('selects redirect URIs by current origin', () => {
    const config = getHostedUiRuntimeConfig('https://preview.example.amplifyapp.com', baseEnv);

    expect(config.enabled).toBe(true);
    expect(config.signInRedirectUri).toBe(
      `https://preview.example.amplifyapp.com${HOSTED_UI_CALLBACK_PATH}`,
    );
    expect(config.signOutRedirectUri).toBe('https://preview.example.amplifyapp.com/');
    expect(config.validationErrors).toEqual([]);
  });

  it('reports a validation error when current origin has no matching redirect URI', () => {
    const config = getHostedUiRuntimeConfig('https://unknown.example.com', baseEnv);

    expect(config.enabled).toBe(false);
    expect(config.validationErrors).toContain(
      'No sign-in redirect URI matches the current origin (https://unknown.example.com).',
    );
    expect(config.validationErrors).toContain(
      'No sign-out redirect URI matches the current origin (https://unknown.example.com).',
    );
  });

  it('validates callback path for sign-in redirect URIs', () => {
    const config = getHostedUiRuntimeConfig('http://localhost:3000', {
      ...baseEnv,
      NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: 'http://localhost:3000/',
    });

    expect(config.enabled).toBe(false);
    expect(config.validationErrors).toContain(
      `Hosted UI sign-in redirect must use ${HOSTED_UI_CALLBACK_PATH}: http://localhost:3000/`,
    );
  });
});

describe('Hosted UI callback + logout helpers', () => {
  it('parses an authorization code callback', () => {
    const payload = parseHostedUiCallback(
      'http://localhost:3000/auth/callback?code=abc123&state=state-1',
    );

    expect(payload.code).toBe('abc123');
    expect(payload.state).toBe('state-1');
    expect(payload.tokens).toBeNull();
    expect(payload.error).toBeNull();
  });

  it('builds a Cognito logout URL when config is enabled', () => {
    const config = getHostedUiRuntimeConfig('https://app.example.com', {
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
      NEXT_PUBLIC_COGNITO_DOMAIN: 'https://example.auth.us-east-1.amazoncognito.com',
      NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: 'https://app.example.com/auth/callback',
      NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS: 'https://app.example.com/',
    });

    expect(buildHostedUiLogoutUrl(config)).toBe(
      'https://example.auth.us-east-1.amazoncognito.com/logout?client_id=client-123&logout_uri=https%3A%2F%2Fapp.example.com%2F',
    );
  });
});

describe('exchangeHostedUiCodeForTokens', () => {
  const config = getHostedUiRuntimeConfig('https://app.example.com', {
    NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
    NEXT_PUBLIC_COGNITO_DOMAIN: 'https://example.auth.us-east-1.amazoncognito.com',
    NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: 'https://app.example.com/auth/callback',
    NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS: 'https://app.example.com/',
  });

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts authorization code exchange to Cognito token endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id_token: 'id-token',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeHostedUiCodeForTokens(config, 'code-1', 'pkce-1');

    expect(tokens).toEqual({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.auth.us-east-1.amazoncognito.com/oauth2/token',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.body).toBeInstanceOf(URLSearchParams);
    const params = requestInit.body as URLSearchParams;
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_id')).toBe('client-123');
    expect(params.get('code')).toBe('code-1');
    expect(params.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
    expect(params.get('code_verifier')).toBe('pkce-1');
  });

  it('throws Cognito error details when token exchange fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Invalid code',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeHostedUiCodeForTokens(config, 'bad-code', 'pkce-1')).rejects.toThrow(
      'Invalid code',
    );
  });
});

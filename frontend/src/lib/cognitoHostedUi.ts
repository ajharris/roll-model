'use client';

export interface HostedUiTokens {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
}

interface HostedUiEnv {
  NEXT_PUBLIC_COGNITO_CLIENT_ID?: string;
  NEXT_PUBLIC_COGNITO_DOMAIN?: string;
  NEXT_PUBLIC_COGNITO_REDIRECT_URI?: string;
  NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS?: string;
  NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS?: string;
}

export interface HostedUiRuntimeConfig {
  hasHostedUiConfig: boolean;
  enabled: boolean;
  clientId: string | null;
  domainUrl: string | null;
  signInRedirectUri: string | null;
  signOutRedirectUri: string | null;
  validationErrors: string[];
}

export interface HostedUiCallbackPayload {
  code: string | null;
  state: string | null;
  tokens: HostedUiTokens | null;
  error: string | null;
  errorDescription: string | null;
}

interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export const HOSTED_UI_CALLBACK_PATH = '/auth/callback';
export const hostedUiPkceVerifierKey = 'roll-model-hosted-ui-pkce-verifier';
export const hostedUiStateKey = 'roll-model-hosted-ui-state';

const splitEnvList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const normalizeDomainUrl = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const withProtocol = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return null;
  }
};

const parseRedirectUris = (env: HostedUiEnv) => {
  const signInRedirectUris = splitEnvList(env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS);
  const signOutRedirectUris = splitEnvList(env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS);
  const legacyRedirectUri = env.NEXT_PUBLIC_COGNITO_REDIRECT_URI?.trim();

  if (!signInRedirectUris.length && legacyRedirectUri) {
    signInRedirectUris.push(legacyRedirectUri);
  }

  return { signInRedirectUris, signOutRedirectUris };
};

const isValidHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const selectRedirectUri = (candidates: string[], origin?: string): string | null => {
  if (!candidates.length) return null;
  if (!origin) return candidates[0] ?? null;

  const exactOriginMatch = candidates.find((candidate) => {
    try {
      return new URL(candidate).origin === origin;
    } catch {
      return false;
    }
  });

  return exactOriginMatch ?? null;
};

export const getHostedUiRuntimeConfig = (
  origin?: string,
  env: HostedUiEnv = process.env,
): HostedUiRuntimeConfig => {
  const validationErrors: string[] = [];
  const hasHostedUiConfig = Boolean(
    env.NEXT_PUBLIC_COGNITO_DOMAIN ||
      env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ||
      env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS ||
      env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS,
  );
  const clientId = env.NEXT_PUBLIC_COGNITO_CLIENT_ID?.trim() ?? null;
  const domainUrl = normalizeDomainUrl(env.NEXT_PUBLIC_COGNITO_DOMAIN);
  const { signInRedirectUris, signOutRedirectUris } = parseRedirectUris(env);

  if (env.NEXT_PUBLIC_COGNITO_DOMAIN && !domainUrl) {
    validationErrors.push('NEXT_PUBLIC_COGNITO_DOMAIN must be a valid Cognito Hosted UI domain.');
  }
  if (!clientId) {
    validationErrors.push('NEXT_PUBLIC_COGNITO_CLIENT_ID is required for Cognito Hosted UI.');
  }
  if (!signInRedirectUris.length) {
    validationErrors.push(
      'NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS is required (comma-separated list of callback URLs).',
    );
  }
  if (!signOutRedirectUris.length) {
    validationErrors.push(
      'NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS is required (comma-separated list of post-logout URLs).',
    );
  }

  signInRedirectUris.forEach((uri) => {
    if (!isValidHttpUrl(uri)) {
      validationErrors.push(`Invalid sign-in redirect URI: ${uri}`);
      return;
    }
    try {
      const url = new URL(uri);
      if (url.pathname !== HOSTED_UI_CALLBACK_PATH) {
        validationErrors.push(
          `Hosted UI sign-in redirect must use ${HOSTED_UI_CALLBACK_PATH}: ${uri}`,
        );
      }
    } catch {
      // covered above
    }
  });

  signOutRedirectUris.forEach((uri) => {
    if (!isValidHttpUrl(uri)) {
      validationErrors.push(`Invalid sign-out redirect URI: ${uri}`);
    }
  });

  const signInRedirectUri = selectRedirectUri(signInRedirectUris, origin);
  const signOutRedirectUri = selectRedirectUri(signOutRedirectUris, origin);

  if (origin && signInRedirectUris.length && !signInRedirectUri) {
    validationErrors.push(
      `No sign-in redirect URI matches the current origin (${origin}).`,
    );
  }
  if (origin && signOutRedirectUris.length && !signOutRedirectUri) {
    validationErrors.push(
      `No sign-out redirect URI matches the current origin (${origin}).`,
    );
  }

  const enabled = Boolean(
    domainUrl &&
      clientId &&
      signInRedirectUri &&
      signOutRedirectUri &&
      validationErrors.length === 0,
  );

  return {
    hasHostedUiConfig,
    enabled,
    clientId,
    domainUrl,
    signInRedirectUri,
    signOutRedirectUri,
    validationErrors,
  };
};

const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
};

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const randomBase64Url = (size: number) => toBase64Url(randomBytes(size));

export const createPkcePair = async (): Promise<PkcePair> => {
  const codeVerifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = toBase64Url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
};

const encodeParam = (value: string) => encodeURIComponent(value);

export const buildHostedUiAuthorizeUrl = (
  config: HostedUiRuntimeConfig,
  codeChallenge: string,
  state: string,
) => {
  if (!config.enabled || !config.domainUrl || !config.clientId || !config.signInRedirectUri) {
    throw new Error(
      config.validationErrors[0] ?? 'Cognito Hosted UI is not configured for this environment.',
    );
  }

  return `${config.domainUrl}/oauth2/authorize?response_type=code&client_id=${encodeParam(
    config.clientId,
  )}&redirect_uri=${encodeParam(config.signInRedirectUri)}&scope=${encodeParam(
    'openid email profile',
  )}&code_challenge_method=S256&code_challenge=${encodeParam(codeChallenge)}&state=${encodeParam(
    state,
  )}`;
};

export const buildHostedUiLogoutUrl = (config: HostedUiRuntimeConfig) => {
  if (!config.enabled || !config.domainUrl || !config.clientId || !config.signOutRedirectUri) {
    return null;
  }

  return `${config.domainUrl}/logout?client_id=${encodeParam(
    config.clientId,
  )}&logout_uri=${encodeParam(config.signOutRedirectUri)}`;
};

export const beginHostedUiSignIn = async (origin: string) => {
  const config = getHostedUiRuntimeConfig(origin);
  if (!config.enabled) {
    throw new Error(
      config.validationErrors[0] ?? 'Cognito Hosted UI is not configured for this environment.',
    );
  }

  const [{ codeVerifier, codeChallenge }, state] = await Promise.all([
    createPkcePair(),
    Promise.resolve(randomBase64Url(16)),
  ]);

  sessionStorage.setItem(hostedUiPkceVerifierKey, codeVerifier);
  sessionStorage.setItem(hostedUiStateKey, state);

  const authorizeUrl = buildHostedUiAuthorizeUrl(config, codeChallenge, state);
  window.location.assign(authorizeUrl);
};

export const parseHostedUiCallback = (urlValue: string): HostedUiCallbackPayload => {
  const url = new URL(urlValue);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? hashParams.get('state');
  const error = url.searchParams.get('error') ?? hashParams.get('error');
  const errorDescription =
    url.searchParams.get('error_description') ?? hashParams.get('error_description');

  const idToken = hashParams.get('id_token');
  const accessToken = hashParams.get('access_token') ?? undefined;
  const refreshToken = hashParams.get('refresh_token') ?? undefined;

  return {
    code,
    state,
    tokens: idToken ? { idToken, accessToken, refreshToken } : null,
    error,
    errorDescription,
  };
};

export const exchangeHostedUiCodeForTokens = async (
  config: HostedUiRuntimeConfig,
  code: string,
  codeVerifier: string,
): Promise<HostedUiTokens> => {
  if (!config.enabled || !config.domainUrl || !config.clientId || !config.signInRedirectUri) {
    throw new Error(
      config.validationErrors[0] ?? 'Cognito Hosted UI is not configured for this environment.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.signInRedirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${config.domainUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json()) as
    | {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      }
    | undefined;

  if (!response.ok || !payload?.id_token) {
    const detail =
      payload?.error_description ?? payload?.error ?? `Token exchange failed (${response.status})`;
    throw new Error(detail);
  }

  return {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
};

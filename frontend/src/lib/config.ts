const HOSTED_UI_CALLBACK_PATH = '/auth/callback';

export interface FrontendEnv {
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_AWS_REGION?: string;
  NEXT_PUBLIC_COGNITO_USER_POOL_ID?: string;
  NEXT_PUBLIC_COGNITO_CLIENT_ID?: string;
  NEXT_PUBLIC_COGNITO_DOMAIN?: string;
  NEXT_PUBLIC_COGNITO_REDIRECT_URI?: string;
  NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS?: string;
  NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS?: string;
}

export interface FrontendConfig {
  apiBaseUrl: string;
  awsRegion: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoDomain: string | null;
  cognitoLegacyRedirectUri: string | null;
  cognitoSignInRedirectUris: string[];
  cognitoSignOutRedirectUris: string[];
}

export class FrontendConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid frontend environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'FrontendConfigError';
    this.issues = issues;
  }
}

const getFrontendEnvFromProcessEnv = (): FrontendEnv => ({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  NEXT_PUBLIC_COGNITO_DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
  NEXT_PUBLIC_COGNITO_REDIRECT_URI: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI,
  NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: process.env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS,
  NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS: process.env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS,
});

const trimOptional = (value?: string): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const splitCsv = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const deriveRegionFromUserPoolId = (userPoolId: string): string | null => {
  const [region] = userPoolId.split('_');
  const trimmed = region?.trim();
  return trimmed ? trimmed : null;
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeCognitoDomainUrl = (raw: string): string | null => {
  const withProtocol =
    raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return null;
  }
};

const requireString = (
  errors: string[],
  envName: keyof FrontendEnv,
  value: string | null,
): string => {
  if (value) return value;
  errors.push(`${envName} is required.`);
  return '';
};

export const parseFrontendConfig = (env: FrontendEnv): FrontendConfig => {
  const errors: string[] = [];

  const apiBaseUrl = requireString(errors, 'NEXT_PUBLIC_API_BASE_URL', trimOptional(env.NEXT_PUBLIC_API_BASE_URL));
  const cognitoUserPoolId = requireString(
    errors,
    'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
    trimOptional(env.NEXT_PUBLIC_COGNITO_USER_POOL_ID),
  );
  const cognitoClientId = requireString(
    errors,
    'NEXT_PUBLIC_COGNITO_CLIENT_ID',
    trimOptional(env.NEXT_PUBLIC_COGNITO_CLIENT_ID),
  );
  const configuredRegion = trimOptional(env.NEXT_PUBLIC_AWS_REGION);
  const derivedRegion = cognitoUserPoolId ? deriveRegionFromUserPoolId(cognitoUserPoolId) : null;
  const awsRegion = configuredRegion ?? derivedRegion ?? '';

  const cognitoDomain = trimOptional(env.NEXT_PUBLIC_COGNITO_DOMAIN);
  const cognitoLegacyRedirectUri = trimOptional(env.NEXT_PUBLIC_COGNITO_REDIRECT_URI);
  const cognitoSignInRedirectUris = splitCsv(env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS);
  const cognitoSignOutRedirectUris = splitCsv(env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS);

  if (!isValidHttpUrl(apiBaseUrl)) {
    errors.push('NEXT_PUBLIC_API_BASE_URL must be a valid http(s) URL.');
  }

  if (!awsRegion) {
    errors.push('NEXT_PUBLIC_AWS_REGION is required or must be derivable from NEXT_PUBLIC_COGNITO_USER_POOL_ID.');
  }

  const hasAnyHostedUiConfig = Boolean(
    cognitoDomain ||
      cognitoLegacyRedirectUri ||
      cognitoSignInRedirectUris.length ||
      cognitoSignOutRedirectUris.length,
  );

  if (hasAnyHostedUiConfig) {
    if (!cognitoDomain) {
      errors.push('NEXT_PUBLIC_COGNITO_DOMAIN is required when Cognito Hosted UI is configured.');
    } else if (!normalizeCognitoDomainUrl(cognitoDomain)) {
      errors.push('NEXT_PUBLIC_COGNITO_DOMAIN must be a valid Cognito Hosted UI domain.');
    }

    if (!cognitoSignInRedirectUris.length) {
      errors.push(
        'NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS is required when Cognito Hosted UI is configured.',
      );
    }

    if (!cognitoSignOutRedirectUris.length) {
      errors.push(
        'NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS is required when Cognito Hosted UI is configured.',
      );
    }
  }

  if (cognitoLegacyRedirectUri && !isValidHttpUrl(cognitoLegacyRedirectUri)) {
    errors.push('NEXT_PUBLIC_COGNITO_REDIRECT_URI must be a valid http(s) URL.');
  }

  for (const uri of cognitoSignInRedirectUris) {
    if (!isValidHttpUrl(uri)) {
      errors.push(`Invalid sign-in redirect URI: ${uri}`);
      continue;
    }
    try {
      const url = new URL(uri);
      if (url.pathname !== HOSTED_UI_CALLBACK_PATH) {
        errors.push(`Hosted UI sign-in redirect must use ${HOSTED_UI_CALLBACK_PATH}: ${uri}`);
      }
    } catch {
      // handled above
    }
  }

  for (const uri of cognitoSignOutRedirectUris) {
    if (!isValidHttpUrl(uri)) {
      errors.push(`Invalid sign-out redirect URI: ${uri}`);
    }
  }

  if (errors.length) {
    throw new FrontendConfigError(errors);
  }

  return {
    apiBaseUrl,
    awsRegion,
    cognitoUserPoolId,
    cognitoClientId,
    cognitoDomain,
    cognitoLegacyRedirectUri,
    cognitoSignInRedirectUris,
    cognitoSignOutRedirectUris,
  };
};

export const getFrontendConfig = (env?: FrontendEnv): FrontendConfig =>
  parseFrontendConfig(env ?? getFrontendEnvFromProcessEnv());

export const frontendConfig = getFrontendConfig();

export const assertFrontendConfig = (): FrontendConfig => frontendConfig;

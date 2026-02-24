export interface FrontendRuntimeEnv {
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_AWS_REGION?: string;
  NEXT_PUBLIC_COGNITO_USER_POOL_ID?: string;
  NEXT_PUBLIC_COGNITO_CLIENT_ID?: string;
  NEXT_PUBLIC_COGNITO_DOMAIN?: string;
  NEXT_PUBLIC_COGNITO_REDIRECT_URI?: string;
  NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS?: string;
  NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS?: string;
}

export interface FrontendRuntimeConfig {
  apiBaseUrl: string | null;
  awsRegion: string | null;
  cognitoUserPoolId: string | null;
  cognitoClientId: string | null;
  cognitoDomain: string | null;
  cognitoLegacyRedirectUri: string | null;
  cognitoSignInRedirectUris: string[];
  cognitoSignOutRedirectUris: string[];
}

const trimOptional = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const splitCsv = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const deriveRegionFromUserPoolId = (userPoolId: string | null) => {
  if (!userPoolId) return null;
  const [region] = userPoolId.split('_');
  return region?.trim() ? region : null;
};

export const getFrontendRuntimeConfig = (
  env: FrontendRuntimeEnv = process.env as FrontendRuntimeEnv,
): FrontendRuntimeConfig => {
  const cognitoUserPoolId = trimOptional(env.NEXT_PUBLIC_COGNITO_USER_POOL_ID);
  const configuredRegion = trimOptional(env.NEXT_PUBLIC_AWS_REGION);

  return {
    apiBaseUrl: trimOptional(env.NEXT_PUBLIC_API_BASE_URL),
    awsRegion: configuredRegion ?? deriveRegionFromUserPoolId(cognitoUserPoolId),
    cognitoUserPoolId,
    cognitoClientId: trimOptional(env.NEXT_PUBLIC_COGNITO_CLIENT_ID),
    cognitoDomain: trimOptional(env.NEXT_PUBLIC_COGNITO_DOMAIN),
    cognitoLegacyRedirectUri: trimOptional(env.NEXT_PUBLIC_COGNITO_REDIRECT_URI),
    cognitoSignInRedirectUris: splitCsv(env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS),
    cognitoSignOutRedirectUris: splitCsv(env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS),
  };
};


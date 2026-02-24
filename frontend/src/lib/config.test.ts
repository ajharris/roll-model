import { describe, expect, it } from 'vitest';

import { FrontendConfigError, parseFrontendConfig } from './config';

describe('parseFrontendConfig', () => {
  it('returns a typed config and derives AWS region from the user pool ID', () => {
    const config = parseFrontendConfig({
      NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test/prod',
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-1_abc123',
      NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
    });

    expect(config.apiBaseUrl).toBe('https://api.example.test/prod');
    expect(config.awsRegion).toBe('us-east-1');
    expect(config.cognitoUserPoolId).toBe('us-east-1_abc123');
    expect(config.cognitoClientId).toBe('client-123');
  });

  it('throws when required values are missing or invalid', () => {
    expect(() =>
      parseFrontendConfig({
        NEXT_PUBLIC_API_BASE_URL: 'not-a-url',
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: '',
        NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
      }),
    ).toThrow(FrontendConfigError);
  });

  it('throws when Hosted UI config is partial or invalid', () => {
    expect(() =>
      parseFrontendConfig({
        NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test',
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-1_abc123',
        NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-123',
        NEXT_PUBLIC_COGNITO_DOMAIN: 'bad domain',
        NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS: 'https://app.example.com/not-callback',
      }),
    ).toThrow(FrontendConfigError);
  });
});

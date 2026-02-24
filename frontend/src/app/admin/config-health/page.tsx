'use client';

import { useEffect, useMemo, useState } from 'react';

import { Protected } from '@/components/Protected';
import { useAuth } from '@/contexts/AuthContext';
import { getHostedUiRuntimeConfig } from '@/lib/cognitoHostedUi';
import { getFrontendRuntimeConfig } from '@/lib/runtimeConfig';

type ProbeLevel = 'ok' | 'warn' | 'error' | 'pending';

interface ProbeResult {
  level: ProbeLevel;
  summary: string;
  detail: string;
}

const isValidHttpUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const statusText = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

export default function ConfigHealthPage() {
  const { isAuthenticated, role, tokens } = useAuth();
  const [origin, setOrigin] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult>({
    level: 'pending',
    summary: 'Not started',
    detail: 'Waiting for runtime config.',
  });

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const runtimeConfig = useMemo(() => getFrontendRuntimeConfig(), []);
  const hostedUiConfig = useMemo(
    () => (origin ? getHostedUiRuntimeConfig(origin) : null),
    [origin],
  );

  const checks = useMemo(() => {
    const apiBaseUrlValid = isValidHttpUrl(runtimeConfig.apiBaseUrl);
    const userPoolRegion = runtimeConfig.cognitoUserPoolId?.split('_')[0] ?? null;
    const regionMatches =
      !runtimeConfig.awsRegion || !userPoolRegion || runtimeConfig.awsRegion === userPoolRegion;

    return [
      {
        label: 'API base URL configured',
        ok: Boolean(runtimeConfig.apiBaseUrl),
        detail: runtimeConfig.apiBaseUrl ?? 'Missing NEXT_PUBLIC_API_BASE_URL',
      },
      {
        label: 'API base URL is valid URL',
        ok: apiBaseUrlValid,
        detail: runtimeConfig.apiBaseUrl ?? 'Not set',
      },
      {
        label: 'Cognito user pool ID configured',
        ok: Boolean(runtimeConfig.cognitoUserPoolId),
        detail: runtimeConfig.cognitoUserPoolId ?? 'Missing NEXT_PUBLIC_COGNITO_USER_POOL_ID',
      },
      {
        label: 'Cognito client ID configured',
        ok: Boolean(runtimeConfig.cognitoClientId),
        detail: runtimeConfig.cognitoClientId ?? 'Missing NEXT_PUBLIC_COGNITO_CLIENT_ID',
      },
      {
        label: 'AWS region resolved',
        ok: Boolean(runtimeConfig.awsRegion),
        detail: runtimeConfig.awsRegion ?? 'Missing NEXT_PUBLIC_AWS_REGION and could not infer',
      },
      {
        label: 'User pool region matches AWS region',
        ok: regionMatches,
        detail:
          runtimeConfig.awsRegion && userPoolRegion
            ? `${runtimeConfig.awsRegion} vs ${userPoolRegion}`
            : 'Skipped (missing region or user pool ID)',
      },
      {
        label: 'Hosted UI runtime config valid',
        ok: hostedUiConfig ? hostedUiConfig.enabled || !hostedUiConfig.hasHostedUiConfig : false,
        detail: !hostedUiConfig
          ? 'Waiting for browser origin'
          : hostedUiConfig.enabled
            ? 'Enabled for current origin'
            : hostedUiConfig.hasHostedUiConfig
              ? hostedUiConfig.validationErrors[0] ?? 'Invalid Hosted UI configuration'
              : 'Hosted UI not configured (optional)',
      },
    ];
  }, [hostedUiConfig, runtimeConfig]);

  useEffect(() => {
    const apiBaseUrl = runtimeConfig.apiBaseUrl;
    if (!apiBaseUrl) {
      setProbe({
        level: 'error',
        summary: 'API probe skipped',
        detail: 'NEXT_PUBLIC_API_BASE_URL is not configured.',
      });
      return;
    }

    let probeUrl: string;
    try {
      probeUrl = new URL('/entries', apiBaseUrl).toString();
    } catch {
      setProbe({
        level: 'error',
        summary: 'API probe skipped',
        detail: 'NEXT_PUBLIC_API_BASE_URL is not a valid URL.',
      });
      return;
    }

    const controller = new AbortController();
    setProbe({
      level: 'pending',
      summary: 'Checking API reachability...',
      detail: probeUrl,
    });

    const headers = new Headers();
    if (tokens?.idToken) {
      headers.set('Authorization', `Bearer ${tokens.idToken}`);
    }

    void fetch(probeUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        const reachable = response.ok || response.status === 401 || response.status === 403;
        setProbe({
          level: response.ok ? 'ok' : reachable ? 'warn' : 'error',
          summary: response.ok
            ? 'API reachable and request authorized'
            : reachable
              ? 'API reachable but request not authorized'
              : 'API responded with an error',
          detail: `${response.status} ${response.statusText || '(no status text)'} from ${probeUrl}`,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProbe({
          level: 'error',
          summary: 'API unreachable',
          detail: error instanceof Error ? error.message : 'Network request failed.',
        });
      });

    return () => controller.abort();
  }, [runtimeConfig.apiBaseUrl, tokens?.idToken]);

  return (
    <Protected allow={['admin']}>
      <section>
        <h2>Config Health</h2>
        <p className="small">
          Environment diagnostics for the current frontend runtime. Public config only; no secrets are displayed.
        </p>

        <div className="panel">
          <h3>Auth status</h3>
          <p>Authenticated: {isAuthenticated ? 'yes' : 'no'}</p>
          <p>Role: {role}</p>
          <p>ID token present: {tokens?.idToken ? 'yes' : 'no'}</p>
          <p>Access token present: {tokens?.accessToken ? 'yes' : 'no'}</p>
          <p>Refresh token present: {tokens?.refreshToken ? 'yes' : 'no'}</p>
        </div>

        <div className="panel">
          <h3>API reachability</h3>
          <p>
            Status: {probe.summary} ({probe.level.toUpperCase()})
          </p>
          <p className="small">{probe.detail}</p>
        </div>

        <div className="panel">
          <h3>Runtime config values</h3>
          <p>Current origin: {origin ?? 'Loading...'}</p>
          <p>API base URL: {runtimeConfig.apiBaseUrl ?? 'Not set'}</p>
          <p>AWS region: {runtimeConfig.awsRegion ?? 'Not set'}</p>
          <p>Cognito user pool ID: {runtimeConfig.cognitoUserPoolId ?? 'Not set'}</p>
          <p>Cognito client ID: {runtimeConfig.cognitoClientId ?? 'Not set'}</p>
          <p>Cognito domain: {runtimeConfig.cognitoDomain ?? 'Not set'}</p>
          <p>Cognito legacy redirect URI: {runtimeConfig.cognitoLegacyRedirectUri ?? 'Not set'}</p>
          <p>
            Cognito sign-in redirect URIs:{' '}
            {runtimeConfig.cognitoSignInRedirectUris.length
              ? runtimeConfig.cognitoSignInRedirectUris.join(', ')
              : 'Not set'}
          </p>
          <p>
            Cognito sign-out redirect URIs:{' '}
            {runtimeConfig.cognitoSignOutRedirectUris.length
              ? runtimeConfig.cognitoSignOutRedirectUris.join(', ')
              : 'Not set'}
          </p>
        </div>

        <div className="panel">
          <h3>Validity checks</h3>
          {checks.map((check) => (
            <div key={check.label} className="list-item">
              <p>
                {statusText(check.ok)}: {check.label}
              </p>
              <p className="small">{check.detail}</p>
            </div>
          ))}
          {hostedUiConfig?.validationErrors.length ? (
            <div className="list-item">
              <p>Hosted UI validation errors</p>
              {hostedUiConfig.validationErrors.map((error) => (
                <p key={error} className="small">
                  {error}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </Protected>
  );
}

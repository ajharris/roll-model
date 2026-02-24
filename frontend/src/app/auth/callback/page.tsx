'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { logAuthFailure } from '@/lib/clientErrorLogging';
import {
  HOSTED_UI_CALLBACK_PATH,
  exchangeHostedUiCodeForTokens,
  getHostedUiRuntimeConfig,
  hostedUiPkceVerifierKey,
  hostedUiStateKey,
  parseHostedUiCallback,
} from '@/lib/cognitoHostedUi';
import { getDefaultRouteForRole } from '@/lib/roleRouting';

export default function HostedUiCallbackPage() {
  const router = useRouter();
  const { hydrateHostedUiTokens } = useAuth();
  const [message, setMessage] = useState('Completing sign-in...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const completeSignIn = async () => {
      try {
        const origin = window.location.origin;
        const config = getHostedUiRuntimeConfig(origin);
        if (!config.enabled) {
          throw new Error(config.validationErrors[0] ?? 'Hosted UI is not configured.');
        }

        const payload = parseHostedUiCallback(window.location.href);
        if (payload.error) {
          throw new Error(payload.errorDescription ?? payload.error);
        }

        const expectedState = sessionStorage.getItem(hostedUiStateKey);
        if (!payload.state || !expectedState || payload.state !== expectedState) {
          throw new Error('Hosted UI callback state validation failed. Start sign-in again.');
        }

        let nextTokens = payload.tokens;
        if (payload.code) {
          const codeVerifier = sessionStorage.getItem(hostedUiPkceVerifierKey);
          if (!codeVerifier) {
            throw new Error('Hosted UI callback is missing PKCE verifier. Start sign-in again.');
          }
          setMessage('Exchanging authorization code...');
          nextTokens = await exchangeHostedUiCodeForTokens(config, payload.code, codeVerifier);
        }

        if (!nextTokens?.idToken) {
          throw new Error('Hosted UI callback did not include tokens.');
        }

        const nextRole = hydrateHostedUiTokens(nextTokens);
        if (!nextRole) {
          throw new Error('Unable to hydrate session from Hosted UI tokens.');
        }

        sessionStorage.removeItem(hostedUiPkceVerifierKey);
        sessionStorage.removeItem(hostedUiStateKey);
        window.history.replaceState(null, '', HOSTED_UI_CALLBACK_PATH);

        if (!cancelled) {
          router.replace(getDefaultRouteForRole(nextRole));
        }
      } catch (cause) {
        sessionStorage.removeItem(hostedUiPkceVerifierKey);
        sessionStorage.removeItem(hostedUiStateKey);
        logAuthFailure({
          source: 'HostedUiCallbackPage',
          operation: 'hosted-ui-callback',
          error: cause,
          details: {
            pathname: window.location.pathname,
          },
        });
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Hosted UI sign-in failed.');
        }
      }
    };

    void completeSignIn();

    return () => {
      cancelled = true;
    };
  }, [hydrateHostedUiTokens, router]);

  return (
    <section>
      <h2>Cognito sign-in</h2>
      {error ? <p>{error}</p> : <p>{message}</p>}
    </section>
  );
}

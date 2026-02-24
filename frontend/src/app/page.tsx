'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import type { HostedUiRuntimeConfig } from '@/lib/cognitoHostedUi';
import { beginHostedUiSignIn, getHostedUiRuntimeConfig } from '@/lib/cognitoHostedUi';
import { getDefaultRouteForRole } from '@/lib/roleRouting';

export default function HomePage() {
  const { isAuthenticated, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [hostedUiError, setHostedUiError] = useState('');
  const [hostedUiConfig, setHostedUiConfig] = useState<HostedUiRuntimeConfig | null>(null);
  const router = useRouter();

  useEffect(() => {
    setHostedUiConfig(getHostedUiRuntimeConfig(window.location.origin));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const signedInRole = await signIn(username, password);
      router.push(getDefaultRouteForRole(signedInRole));
    } catch {
      setError('Sign in failed. Verify credentials and user pool settings.');
    }
  };

  const signInWithHostedUi = async () => {
    setHostedUiError('');
    try {
      await beginHostedUiSignIn(window.location.origin);
    } catch {
      setHostedUiError(
        hostedUiConfig?.validationErrors[0] ?? 'Hosted UI sign-in is not configured correctly.',
      );
    }
  };

  if (isAuthenticated) {
    return <p>Authenticated. Continue through the navigation panel.</p>;
  }

  return (
    <section>
      <h2>Sign in</h2>
      <p className="small">Observations first, interventions second.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">Email or username</label>
        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="row">
          <button type="submit">Sign in</button>
          {error && <span>{error}</span>}
        </div>
      </form>
      {hostedUiConfig?.enabled && (
        <div className="row">
          <button type="button" onClick={() => void signInWithHostedUi()}>
            Sign in with Cognito Hosted UI
          </button>
          {hostedUiError && <span>{hostedUiError}</span>}
        </div>
      )}
      {!hostedUiConfig?.enabled &&
      hostedUiConfig?.hasHostedUiConfig &&
      hostedUiConfig.validationErrors.length ? (
        <p className="small">{hostedUiConfig.validationErrors[0]}</p>
      ) : null}
      <div className="row">
        <span className="small">New here?</span>
        <Link className="button-link" href="/signup-request">Request access</Link>
      </div>
    </section>
  );
}

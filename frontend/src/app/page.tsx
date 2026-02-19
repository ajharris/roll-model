'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent} from 'react';
import { useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';

export default function HomePage() {
  const { isAuthenticated, role, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await signIn(username, password);
      router.push(role === 'coach' ? '/coach' : '/entries');
    } catch {
      setError('Sign in failed. Verify credentials and user pool settings.');
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
    </section>
  );
}

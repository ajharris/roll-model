'use client';

import { FormEvent, useState } from 'react';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';

export default function CoachLinkPage() {
  const [coachId, setCoachId] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiClient.linkCoach({ coachId });
      setStatus('Coach linked. Athlete controls access and sharing scope.');
    } catch {
      setStatus('Could not link coach.');
    }
  };

  const revoke = async () => {
    try {
      await apiClient.revokeCoach({ coachId });
      setStatus('Coach link revoked.');
    } catch {
      setStatus('Could not revoke coach link.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Coach link</h2>
        <p>Athlete controls access. Coaches can comment on shared notes but cannot edit or delete athlete notes.</p>
        <form onSubmit={submit}>
          <label htmlFor="coachId">Coach ID (Cognito sub)</label>
          <input id="coachId" value={coachId} onChange={(e) => setCoachId(e.target.value)} required />
          <button type="submit">Link coach</button>
          <button type="button" onClick={revoke}>
            Revoke coach
          </button>
        </form>
        <p>{status}</p>
      </section>
    </Protected>
  );
}

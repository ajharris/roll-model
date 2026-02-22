'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { apiClient } from '@/lib/apiClient';

export default function SignupRequestPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [intendedRole, setIntendedRole] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    try {
      await apiClient.requestSignup({
        email,
        name: name || undefined,
        intendedRole: intendedRole || undefined,
        notes: notes || undefined,
      });
      setSubmitted(true);
    } catch {
      setError('Could not submit request. Please try again.');
    }
  };

  if (submitted) {
    return (
      <section>
        <h2>Request received</h2>
        <p>Thanks. I will review your request and follow up by email.</p>
        <Link href="/">Return to sign in</Link>
      </section>
    );
  }

  return (
    <section>
      <h2>Request access</h2>
      <p className="small">Access is approved manually. Share a quick note about who you are.</p>
      <form onSubmit={submit}>
        <label htmlFor="name">Name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="role">Intended role</label>
        <select id="role" value={intendedRole} onChange={(e) => setIntendedRole(e.target.value)}>
          <option value="">Select one</option>
          <option value="athlete">Athlete</option>
          <option value="coach">Coach</option>
          <option value="unsure">Not sure yet</option>
        </select>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="row">
          <button type="submit">Request access</button>
          {error && <span>{error}</span>}
        </div>
      </form>
    </section>
  );
}

'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { FeedbackType } from '@/types/api';

export default function FeedbackPage() {
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<{ issueNumber: number } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    try {
      const response = await apiClient.submitFeedback({
        type,
        title,
        details,
        steps: steps || undefined,
        expected: expected || undefined,
        actual: actual || undefined,
      });
      setSubmitted({ issueNumber: response.issueNumber });
    } catch {
      setError('Could not submit feedback. Please try again.');
    }
  };

  return (
    <Protected allow={['athlete', 'coach']}>
      <section>
        <h2>Suggest a feature or report a bug</h2>
        <p className="small">Your submission creates a GitHub issue automatically.</p>
        {submitted ? (
          <p>Thanks. Issue #{submitted.issueNumber} has been filed.</p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
              <option value="bug">Bug</option>
              <option value="feature">Feature request</option>
              <option value="ui">UI/UX issue</option>
              <option value="other">Other</option>
            </select>
            <label htmlFor="title">Title</label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <label htmlFor="details">Details</label>
            <textarea id="details" value={details} onChange={(e) => setDetails(e.target.value)} required />
            <label htmlFor="steps">Steps to reproduce (optional)</label>
            <textarea id="steps" value={steps} onChange={(e) => setSteps(e.target.value)} />
            <label htmlFor="expected">Expected behavior (optional)</label>
            <textarea id="expected" value={expected} onChange={(e) => setExpected(e.target.value)} />
            <label htmlFor="actual">Actual behavior (optional)</label>
            <textarea id="actual" value={actual} onChange={(e) => setActual(e.target.value)} />
            <div className="row">
              <button type="submit">Submit feedback</button>
              {error && <span>{error}</span>}
            </div>
          </form>
        )}
      </section>
    </Protected>
  );
}

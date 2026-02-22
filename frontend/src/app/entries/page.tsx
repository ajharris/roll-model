'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { Entry } from '@/types/api';

export default function EntriesPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.getEntries().then(setEntries).catch(() => setError('Could not load entries.'));
  }, []);

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Observations</h2>
        <p className="small">BJJ Lab Notebook: evidence over vibes.</p>
        <Link href="/entries/new" className="button-link">Create a new entry</Link>
        {error && <p>{error}</p>}
        {entries.map((entry) => (
          <div key={entry.entryId} className="list-item">
            <p>
              <Link href={`/entries/${entry.entryId}`}>{new Date(entry.createdAt).toLocaleString()}</Link>
            </p>
            <p>Intensity: {entry.sessionMetrics.intensity}/10</p>
            <p>Tags: {entry.sessionMetrics.tags.join(', ') || 'none'}</p>
            <p>{entry.sections.shared.slice(0, 120)}</p>
            <p className="small">
              <Link href={`/entries/${entry.entryId}`} className="button-link">
                View / Edit
              </Link>
            </p>
          </div>
        ))}
      </section>
    </Protected>
  );
}

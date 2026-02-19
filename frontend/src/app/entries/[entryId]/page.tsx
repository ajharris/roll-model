'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { Entry } from '@/types/api';

export default function EntryDetailPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    void apiClient.getEntries().then((entries) => setEntry(entries.find((e) => e.entryId === entryId) ?? null));
  }, [entryId]);

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Entry detail</h2>
        {!entry && <p>Entry not found.</p>}
        {entry && (
          <>
            <p><strong>Shared</strong>: {entry.sections.shared}</p>
            <p><strong>Private</strong>: {entry.sections.private}</p>
            <p>Duration: {entry.sessionMetrics.durationMinutes} minutes</p>
            <p>Intensity: {entry.sessionMetrics.intensity}</p>
            <p>Rounds: {entry.sessionMetrics.rounds}</p>
            <p>Mode: {entry.sessionMetrics.giOrNoGi}</p>
            <p>Tags: {entry.sessionMetrics.tags.join(', ')}</p>
          </>
        )}
        <div className="panel">
          <h3>Comments</h3>
          <p>Comments are not yet retrievable in v1. Coaches can still post comments through the coach workflow.</p>
        </div>
      </section>
    </Protected>
  );
}

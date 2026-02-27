'use client';

import type { FormEvent} from 'react';
import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { Entry } from '@/types/api';

export default function CoachPage() {
  const [athleteId, setAthleteId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [comment, setComment] = useState('');
  const [localComments, setLocalComments] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState('');

  const load = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('Loading...');
    try {
      const data = await apiClient.getAthleteEntries(athleteId);
      setEntries(data);
      setStatus('Loaded shared entries.');
    } catch {
      setStatus('Could not load athlete entries.');
    }
  };

  const post = async () => {
    if (!selected || !comment.trim()) return;
    const body = comment.trim();
    setLocalComments((prev) => ({ ...prev, [selected.entryId]: [...(prev[selected.entryId] || []), body] }));
    setComment('');
    try {
      await apiClient.postComment({ entryId: selected.entryId, body });
    } catch {
      setStatus('Comment sync failed. Stored locally for this session.');
    }
  };

  return (
    <Protected allow={['coach']}>
      <section>
        <h2>Coach view</h2>
        <form onSubmit={load} className="row">
          <label htmlFor="athleteId">Athlete ID</label>
          <input id="athleteId" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} required />
          <button type="submit">Load athlete journal (shared only)</button>
        </form>
        <p>{status}</p>
        <div className="grid">
          <div>
            {entries.map((entry) => (
              <button key={entry.entryId} className="list-item" onClick={() => setSelected(entry)}>
                {new Date(entry.createdAt).toLocaleDateString()} - {entry.sections.shared.slice(0, 60)}
              </button>
            ))}
          </div>
          <div>
            {selected ? (
              <div className="panel">
                <h3>Shared notes</h3>
                <p>{selected.sections.shared}</p>
                {selected.actionPackFinal?.actionPack && (
                  <>
                    <h4>Finalized feedback history</h4>
                    <p>
                      <strong>One focus:</strong> {selected.actionPackFinal.actionPack.oneFocus || 'none'}
                    </p>
                    <p className="small">
                      Wins: {selected.actionPackFinal.actionPack.wins.join(' | ') || 'none'}
                    </p>
                    <p className="small">
                      Leaks: {selected.actionPackFinal.actionPack.leaks.join(' | ') || 'none'}
                    </p>
                    <p className="small">
                      Finalized: {new Date(selected.actionPackFinal.finalizedAt).toLocaleString()}
                    </p>
                  </>
                )}
                <h4>Comment</h4>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
                <button onClick={post}>Post comment</button>
                {(localComments[selected.entryId] || []).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : (
              <p>Select an entry.</p>
            )}
          </div>
        </div>
      </section>
    </Protected>
  );
}

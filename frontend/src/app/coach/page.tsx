'use client';

import type { FormEvent} from 'react';
import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type { Entry, EntryStructuredFieldKey, EntryStructuredMetadataConfirmation } from '@/types/api';

const STRUCTURED_FIELDS: Array<{ key: EntryStructuredFieldKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'technique', label: 'Technique' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'problem', label: 'Problem' },
  { key: 'cue', label: 'Cue' },
];

export default function CoachPage() {
  const [athleteId, setAthleteId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [comment, setComment] = useState('');
  const [localComments, setLocalComments] = useState<Record<string, string[]>>({});
  const [structuredDraft, setStructuredDraft] = useState<Partial<Record<EntryStructuredFieldKey, string>>>({});
  const [confirmations, setConfirmations] = useState<EntryStructuredMetadataConfirmation[]>([]);
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

  const selectEntry = (entry: Entry) => {
    setSelected(entry);
    setStructuredDraft({
      position: entry.structured?.position ?? '',
      technique: entry.structured?.technique ?? '',
      outcome: entry.structured?.outcome ?? '',
      problem: entry.structured?.problem ?? '',
      cue: entry.structured?.cue ?? '',
    });
    setConfirmations([]);
  };

  const upsertConfirmation = (next: EntryStructuredMetadataConfirmation) => {
    setConfirmations((current) => [...current.filter((item) => item.field !== next.field), next]);
  };

  const setStructuredField = (field: EntryStructuredFieldKey, value: string) => {
    setStructuredDraft((current) => ({ ...current, [field]: value }));
    const trimmed = value.trim();
    if (trimmed) {
      upsertConfirmation({
        field,
        status: 'corrected',
        correctionValue: trimmed,
      });
    }
  };

  const saveStructuredReview = async () => {
    if (!selected) return;

    try {
      const structured = Object.fromEntries(
        Object.entries(structuredDraft).filter(([, value]) => typeof value === 'string' && value.trim())
      );
      const updated = await apiClient.reviewEntryStructuredMetadata(selected.entryId, {
        structured,
        confirmations,
      });
      setSelected(updated);
      setEntries((current) => current.map((entry) => (entry.entryId === updated.entryId ? updated : entry)));
      setStructuredDraft({
        position: updated.structured?.position ?? '',
        technique: updated.structured?.technique ?? '',
        outcome: updated.structured?.outcome ?? '',
        problem: updated.structured?.problem ?? '',
        cue: updated.structured?.cue ?? '',
      });
      setConfirmations([]);
      setStatus('Structured metadata review saved.');
    } catch {
      setStatus('Could not save structured metadata review.');
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
              <button key={entry.entryId} className="list-item" onClick={() => selectEntry(entry)}>
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
                <h4>Structured metadata review</h4>
                {STRUCTURED_FIELDS.map(({ key, label }) => {
                  const suggestion = selected.structuredExtraction?.suggestions.find((item) => item.field === key);
                  return (
                    <div key={key}>
                      <label htmlFor={`coach-structured-${key}`}>{label}</label>
                      <input
                        id={`coach-structured-${key}`}
                        value={structuredDraft[key] ?? ''}
                        onChange={(e) => setStructuredField(key, e.target.value)}
                      />
                      {suggestion?.confirmationPrompt && <p className="small">{suggestion.confirmationPrompt}</p>}
                      {suggestion && (
                        <div className="row">
                          <span className="small">Confidence: {suggestion.confidence}</span>
                          <button type="button" onClick={() => upsertConfirmation({ field: key, status: 'confirmed' })}>
                            Confirm
                          </button>
                          <button type="button" onClick={() => upsertConfirmation({ field: key, status: 'rejected' })}>
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {selected.structuredExtraction?.concepts?.length ? (
                  <p className="small">Concepts: {selected.structuredExtraction.concepts.join(' | ')}</p>
                ) : null}
                {selected.structuredExtraction?.failures?.length ? (
                  <p className="small">Failures: {selected.structuredExtraction.failures.join(' | ')}</p>
                ) : null}
                {selected.structuredExtraction?.conditioningIssues?.length ? (
                  <p className="small">Conditioning: {selected.structuredExtraction.conditioningIssues.join(' | ')}</p>
                ) : null}
                <button type="button" onClick={saveStructuredReview}>
                  Save structured review
                </button>
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

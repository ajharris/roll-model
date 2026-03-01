'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { ChipInput } from '@/components/ChipInput';
import { MediaAttachmentsInput } from '@/components/MediaAttachmentsInput';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import { clearEntryDraft, readEntryDraft, writeEntryDraft } from '@/lib/journalLocal';
import type {
  CheckoffEvidence,
  Entry,
  EntryStructuredFieldKey,
  EntryStructuredMetadataConfirmation,
  MediaAttachment
} from '@/types/api';

type EntryEditDraft = {
  shared: string;
  privateText: string;
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: 'gi' | 'no-gi';
  tags: string[];
  techniques: string[];
  mediaAttachments: MediaAttachment[];
};

const STRUCTURED_FIELDS: Array<{ key: EntryStructuredFieldKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'technique', label: 'Technique' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'problem', label: 'Problem' },
  { key: 'cue', label: 'Cue' },
];

const sanitizeAttachments = (attachments: MediaAttachment[]): MediaAttachment[] =>
  attachments
    .map((attachment) => ({
      ...attachment,
      title: attachment.title.trim(),
      url: attachment.url.trim(),
      notes: attachment.notes?.trim() ?? '',
      clipNotes: attachment.clipNotes
        .map((clip) => ({
          ...clip,
          timestamp:
            typeof clip.timestamp === 'string'
              ? clip.timestamp.trim()
              : typeof (clip as Partial<{ label: string }>).label === 'string'
                ? ((clip as Partial<{ label: string }>).label as string).trim()
                : '',
          text:
            typeof clip.text === 'string'
              ? clip.text.trim()
              : typeof (clip as Partial<{ note: string }>).note === 'string'
                ? ((clip as Partial<{ note: string }>).note as string).trim()
                : '',
        }))
        .filter((clip) => clip.timestamp && clip.text),
    }))
    .filter((attachment) => attachment.title && attachment.url);

export default function EntryDetailPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const router = useRouter();
  const draftKey = useMemo(() => `edit.${entryId}`, [entryId]);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [shared, setShared] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [intensity, setIntensity] = useState(6);
  const [rounds, setRounds] = useState(5);
  const [giOrNoGi, setGiOrNoGi] = useState<'gi' | 'no-gi'>('gi');
  const [tags, setTags] = useState<string[]>([]);
  const [techniques, setTechniques] = useState<string[]>([]);
  const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([]);
  const [status, setStatus] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'saved'>('idle');
  const [checkoffEvidence, setCheckoffEvidence] = useState<CheckoffEvidence[]>([]);
  const [structuredDraft, setStructuredDraft] = useState<Partial<Record<EntryStructuredFieldKey, string>>>({});
  const [structuredConfirmations, setStructuredConfirmations] = useState<EntryStructuredMetadataConfirmation[]>([]);
  const canEdit = Boolean(entry) && !isLoading;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setStatus('');

    void (async () => {
      try {
        const loadedEntry = await apiClient.getEntry(entryId);
        if (cancelled) return;
        setEntry(loadedEntry);

        const draft = readEntryDraft<EntryEditDraft>(draftKey);
        if (draft) {
          setShared(draft.shared ?? loadedEntry.sections.shared);
          setPrivateText(draft.privateText ?? (loadedEntry.sections.private ?? ''));
          setDurationMinutes(draft.durationMinutes ?? loadedEntry.sessionMetrics.durationMinutes);
          setIntensity(draft.intensity ?? loadedEntry.sessionMetrics.intensity);
          setRounds(draft.rounds ?? loadedEntry.sessionMetrics.rounds);
          setGiOrNoGi(draft.giOrNoGi ?? loadedEntry.sessionMetrics.giOrNoGi);
          setTags(draft.tags ?? loadedEntry.sessionMetrics.tags);
          setTechniques(draft.techniques ?? loadedEntry.rawTechniqueMentions);
          setMediaAttachments(draft.mediaAttachments ?? (loadedEntry.mediaAttachments ?? []));
          setStatus('Draft restored.');
        } else {
          setShared(loadedEntry.sections.shared);
          setPrivateText(loadedEntry.sections.private ?? '');
          setDurationMinutes(loadedEntry.sessionMetrics.durationMinutes);
          setIntensity(loadedEntry.sessionMetrics.intensity);
          setRounds(loadedEntry.sessionMetrics.rounds);
          setGiOrNoGi(loadedEntry.sessionMetrics.giOrNoGi);
          setTags(loadedEntry.sessionMetrics.tags);
          setTechniques(loadedEntry.rawTechniqueMentions);
          setMediaAttachments(loadedEntry.mediaAttachments ?? []);
        }
        setStructuredDraft({
          position: loadedEntry.structured?.position ?? '',
          technique: loadedEntry.structured?.technique ?? '',
          outcome: loadedEntry.structured?.outcome ?? '',
          problem: loadedEntry.structured?.problem ?? '',
          cue: loadedEntry.structured?.cue ?? '',
        });
        setStructuredConfirmations([]);

        const evidence = await apiClient.getEntryCheckoffEvidence(entryId);
        if (!cancelled) {
          setCheckoffEvidence(evidence);
        }
      } catch {
        if (!cancelled) {
          setEntry(null);
          setStatus('Could not load entry.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, entryId]);

  useEffect(() => {
    if (!entry) return;

    const timeout = window.setTimeout(() => {
      writeEntryDraft(draftKey, {
        shared,
        privateText,
        durationMinutes,
        intensity,
        rounds,
        giOrNoGi,
        tags,
        techniques,
        mediaAttachments,
      } satisfies EntryEditDraft);
      setDraftState('saved');
    }, 350);

    setDraftState('idle');
    return () => window.clearTimeout(timeout);
  }, [draftKey, durationMinutes, entry, giOrNoGi, intensity, mediaAttachments, privateText, rounds, shared, tags, techniques]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!entry) {
      setStatus('Entry not available.');
      return;
    }
    setStatus('Saving...');

    try {
      const structured = Object.fromEntries(
        Object.entries(structuredDraft).filter(([, value]) => typeof value === 'string' && value.trim())
      );
      const updated = await apiClient.updateEntry(entryId, {
        sections: { shared, private: privateText },
        sessionMetrics: { durationMinutes, intensity, rounds, giOrNoGi, tags },
        rawTechniqueMentions: techniques,
        mediaAttachments: sanitizeAttachments(mediaAttachments),
        structured,
        ...(structuredConfirmations.length > 0 ? { structuredMetadataConfirmations: structuredConfirmations } : {}),
      });
      setEntry(updated);
      setStructuredDraft({
        position: updated.structured?.position ?? '',
        technique: updated.structured?.technique ?? '',
        outcome: updated.structured?.outcome ?? '',
        problem: updated.structured?.problem ?? '',
        cue: updated.structured?.cue ?? '',
      });
      clearEntryDraft(draftKey);
      setStatus('Saved.');
    } catch {
      setStatus('Save failed.');
    }
  };

  const remove = async () => {
    if (!entry) {
      setStatus('Entry not available.');
      return;
    }

    const confirmed = window.confirm('Delete this entry? This cannot be undone.');
    if (!confirmed) {
      setStatus('Delete cancelled.');
      return;
    }

    setStatus('Deleting...');
    try {
      await apiClient.deleteEntry(entryId);
      clearEntryDraft(draftKey);
      router.push('/entries');
    } catch {
      setStatus('Delete failed.');
    }
  };

  const upsertStructuredConfirmation = (next: EntryStructuredMetadataConfirmation) => {
    setStructuredConfirmations((current) => [...current.filter((item) => item.field !== next.field), next]);
  };

  const onStructuredFieldChange = (field: EntryStructuredFieldKey, value: string) => {
    setStructuredDraft((current) => ({ ...current, [field]: value }));
    const trimmed = value.trim();
    if (trimmed) {
      upsertStructuredConfirmation({
        field,
        status: 'corrected',
        correctionValue: trimmed,
      });
    }
  };

  const saveStructuredReview = async () => {
    if (!entry) return;
    setStatus('Saving structured review...');

    try {
      const structured = Object.fromEntries(
        Object.entries(structuredDraft).filter(([, value]) => typeof value === 'string' && value.trim())
      );
      const updated = await apiClient.reviewEntryStructuredMetadata(entry.entryId, {
        structured,
        confirmations: structuredConfirmations,
      });
      setEntry(updated);
      setStructuredDraft({
        position: updated.structured?.position ?? '',
        technique: updated.structured?.technique ?? '',
        outcome: updated.structured?.outcome ?? '',
        problem: updated.structured?.problem ?? '',
        cue: updated.structured?.cue ?? '',
      });
      setStructuredConfirmations([]);
      setStatus('Structured review saved.');
    } catch {
      setStatus('Structured review save failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Entry detail</h2>
        <p className="small">
          <Link href="/entries">Back to entries</Link>
        </p>
        {isLoading && <p>Loading entry...</p>}
        {!isLoading && !entry && <p>{status || 'Entry not found.'}</p>}
        {entry && (
          <p className="small">
            Created: {new Date(entry.createdAt).toLocaleString()} • Draft: {draftState === 'saved' ? 'autosaved' : 'editing'}
          </p>
        )}
        {entry?.actionPackFinal?.actionPack && (
          <div className="panel">
            <h3>Finalized action pack</h3>
            <p>
              <strong>One focus:</strong> {entry.actionPackFinal.actionPack.oneFocus || 'none'}
            </p>
            <p>
              <strong>Wins:</strong> {entry.actionPackFinal.actionPack.wins.join(' | ') || 'none'}
            </p>
            <p>
              <strong>Leaks:</strong> {entry.actionPackFinal.actionPack.leaks.join(' | ') || 'none'}
            </p>
            <p>
              <strong>Drills:</strong> {entry.actionPackFinal.actionPack.drills.join(' | ') || 'none'}
            </p>
            <p>
              <strong>Positional requests:</strong> {entry.actionPackFinal.actionPack.positionalRequests.join(' | ') || 'none'}
            </p>
            <p>
              <strong>Fallback guidance:</strong> {entry.actionPackFinal.actionPack.fallbackDecisionGuidance || 'none'}
            </p>
            <p className="small">Finalized at {new Date(entry.actionPackFinal.finalizedAt).toLocaleString()}</p>
          </div>
        )}
        {checkoffEvidence.length > 0 && (
          <div className="panel">
            <h3>Checkoff evidence from this entry</h3>
            {checkoffEvidence.map((item) => (
              <div key={item.evidenceId} className="small" style={{ marginBottom: '0.5rem' }}>
                <strong>{item.skillId}</strong> • {item.evidenceType} • {item.mappingStatus}
                <br />
                Evidence: {item.statement}
                <br />
                Confidence: {item.confidence}
                {item.sourceOutcomeField ? (
                  <>
                    <br />
                    Source outcome: {item.sourceOutcomeField}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {entry?.structuredExtraction && (
          <div className="panel">
            <h3>Structured extraction</h3>
            {entry.structuredExtraction.confidenceFlags.length > 0 && (
              <p className="small">
                Uncertain fields:{' '}
                {entry.structuredExtraction.confidenceFlags
                  .map((flag) => `${flag.field} (${flag.confidence})`)
                  .join(', ')}
              </p>
            )}
            {STRUCTURED_FIELDS.map(({ key, label }) => {
              const suggestion = entry.structuredExtraction?.suggestions.find((item) => item.field === key);
              return (
                <div key={key}>
                  <label htmlFor={`entry-structured-${key}`}>{label}</label>
                  <input
                    id={`entry-structured-${key}`}
                    value={structuredDraft[key] ?? ''}
                    onChange={(e) => onStructuredFieldChange(key, e.target.value)}
                    disabled={!canEdit}
                  />
                  {suggestion?.confirmationPrompt && <p className="small">{suggestion.confirmationPrompt}</p>}
                  {suggestion && (
                    <div className="row">
                      <span className="small">Confidence: {suggestion.confidence}</span>
                      <button
                        type="button"
                        onClick={() => upsertStructuredConfirmation({ field: key, status: 'confirmed' })}
                        disabled={!canEdit}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => upsertStructuredConfirmation({ field: key, status: 'rejected' })}
                        disabled={!canEdit}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {entry.structuredExtraction.concepts.length > 0 && (
              <p className="small">Concepts: {entry.structuredExtraction.concepts.join(' | ')}</p>
            )}
            {entry.structuredExtraction.failures.length > 0 && (
              <p className="small">Failures: {entry.structuredExtraction.failures.join(' | ')}</p>
            )}
            {entry.structuredExtraction.conditioningIssues.length > 0 && (
              <p className="small">Conditioning: {entry.structuredExtraction.conditioningIssues.join(' | ')}</p>
            )}
            <button type="button" onClick={saveStructuredReview} disabled={!canEdit}>
              Save structured review
            </button>
          </div>
        )}
        <form onSubmit={save}>
          <label htmlFor="shared-notes">Shared notes</label>
          <textarea
            id="shared-notes"
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            required
            disabled={!canEdit}
          />
          <label htmlFor="private-notes">Private notes</label>
          <textarea
            id="private-notes"
            value={privateText}
            onChange={(e) => setPrivateText(e.target.value)}
            required
            disabled={!canEdit}
          />
          <div className="grid">
            <div>
              <label htmlFor="duration-minutes">Duration (minutes)</label>
              <input
                id="duration-minutes"
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label htmlFor="intensity">Intensity (1-10)</label>
              <input
                id="intensity"
                type="number"
                min={1}
                max={10}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label htmlFor="rounds">Rounds</label>
              <input
                id="rounds"
                type="number"
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label htmlFor="gi-or-no-gi">Gi or no-gi</label>
              <select
                id="gi-or-no-gi"
                value={giOrNoGi}
                onChange={(e) => setGiOrNoGi(e.target.value as 'gi' | 'no-gi')}
                disabled={!canEdit}
              >
                <option value="gi">gi</option>
                <option value="no-gi">no-gi</option>
              </select>
            </div>
          </div>
          <ChipInput label="Tags" values={tags} onChange={setTags} />
          <ChipInput label="Technique mentions" values={techniques} onChange={setTechniques} />
          <MediaAttachmentsInput value={mediaAttachments} onChange={setMediaAttachments} disabled={!canEdit} />
          <div className="grid">
            <button type="submit" disabled={!canEdit}>
              Update entry
            </button>
            <button type="button" onClick={remove} className="button-danger" disabled={!canEdit}>
              Delete entry
            </button>
          </div>
          <p>{status}</p>
        </form>
        <div className="panel">
          <h3>Comments</h3>
          <p>Comments are not yet retrievable in v1. Coaches can still post comments through the coach workflow.</p>
        </div>
      </section>
    </Protected>
  );
}

'use client';

import { useMemo, useState } from 'react';

import { ChipInput } from '@/components/ChipInput';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type {
  EntryStructuredFieldKey,
  EntryStructuredFields,
  LegacyImportPreview,
  LegacyImportSourceType,
} from '@/types/api';

const STRUCTURED_FIELDS: Array<{ key: EntryStructuredFieldKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'technique', label: 'Technique' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'problem', label: 'Problem' },
  { key: 'cue', label: 'Cue' },
];

export default function ImportEntriesPage() {
  const [sourceType, setSourceType] = useState<LegacyImportSourceType>('markdown');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [useGpt, setUseGpt] = useState(true);
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [structured, setStructured] = useState<EntryStructuredFields>({});
  const [tags, setTags] = useState<string[]>([]);
  const [techniques, setTechniques] = useState<string[]>([]);
  const [requiresCoachReview, setRequiresCoachReview] = useState(false);
  const [coachNotes, setCoachNotes] = useState('');
  const [duplicateResolution, setDuplicateResolution] = useState<'skip' | 'allow'>('skip');
  const [conflictResolution, setConflictResolution] = useState<'save-as-draft' | 'commit'>('save-as-draft');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canCommit = useMemo(() => Boolean(preview), [preview]);

  const runPreview = async () => {
    if (!rawContent.trim()) {
      setStatus('Paste markdown or Google Docs content first.');
      return;
    }

    setSubmitting(true);
    setStatus('Building preview...');

    try {
      const nextPreview = await apiClient.previewLegacyEntryImport({
        sourceType,
        sourceTitle: sourceTitle.trim() || undefined,
        sourceId: sourceId.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        rawContent,
        useGpt,
      });

      setPreview(nextPreview);
      setStructured(nextPreview.draftEntry.structured ?? {});
      setTags(nextPreview.draftEntry.tags);
      setTechniques(nextPreview.draftEntry.rawTechniqueMentions);
      setRequiresCoachReview(nextPreview.requiresCoachReview);
      setCoachNotes('');
      setDuplicateResolution(nextPreview.dedupStatus === 'new' ? 'allow' : 'skip');
      setConflictResolution(nextPreview.conflictStatus === 'requires-review' ? 'save-as-draft' : 'commit');
      setStatus(`Preview ready (${nextPreview.mode}).`);
    } catch {
      setStatus('Preview failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const commitImport = async () => {
    if (!preview) {
      return;
    }

    setSubmitting(true);
    setStatus('Committing import...');

    try {
      const confirmations = Object.entries(structured).map(([field, value]) => ({
        field: field as EntryStructuredFieldKey,
        status: 'corrected' as const,
        correctionValue: value,
      }));

      const result = await apiClient.commitLegacyEntryImport({
        preview,
        duplicateResolution,
        conflictResolution,
        corrections: {
          structured,
          confirmations,
          tags: tags as typeof preview.draftEntry.tags,
          rawTechniqueMentions: techniques,
          requiresCoachReview,
          coachReview: {
            requiresReview: requiresCoachReview,
            ...(coachNotes.trim() ? { coachNotes: coachNotes.trim() } : {}),
            reviewedAt: new Date().toISOString(),
          },
        },
      });

      if (result.skipped) {
        setStatus('Import skipped due to duplicate resolution choice.');
        return;
      }

      setStatus('Import committed as a first-class entry.');
      setPreview(null);
      setStructured({});
    } catch {
      setStatus('Commit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Import legacy notes</h2>
        <p className="small">Paste markdown or Google Docs content, preview mappings, and commit safely.</p>

        <label htmlFor="source-type">Source type</label>
        <select id="source-type" value={sourceType} onChange={(event) => setSourceType(event.target.value as LegacyImportSourceType)}>
          <option value="markdown">Markdown</option>
          <option value="google-doc">Google Docs</option>
        </select>

        <label htmlFor="source-title">Source title</label>
        <input id="source-title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Optional" />

        <label htmlFor="source-id">Source ID</label>
        <input id="source-id" value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="Optional" />

        <label htmlFor="source-url">Source URL</label>
        <input id="source-url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Optional" />

        <label htmlFor="raw-content">Raw content</label>
        <textarea id="raw-content" rows={14} value={rawContent} onChange={(event) => setRawContent(event.target.value)} />

        <label htmlFor="use-gpt">Use GPT-assisted mapping</label>
        <select id="use-gpt" value={useGpt ? 'yes' : 'no'} onChange={(event) => setUseGpt(event.target.value === 'yes')}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>

        <button type="button" onClick={runPreview} disabled={submitting}>
          Preview import
        </button>

        {preview && (
          <div className="panel">
            <h3>Preview</h3>
            <p>Mode: {preview.mode}</p>
            <p>Dedup: {preview.dedupStatus}</p>
            <p>Conflict: {preview.conflictStatus}</p>
            {preview.duplicateEntryIds.length > 0 && (
              <p>Potential duplicates: {preview.duplicateEntryIds.join(', ')}</p>
            )}
            {preview.warnings.length > 0 && <p>{preview.warnings.join(' ')}</p>}

            <label htmlFor="dedupe-resolution">Duplicate resolution</label>
            <select
              id="dedupe-resolution"
              value={duplicateResolution}
              onChange={(event) => setDuplicateResolution(event.target.value as 'skip' | 'allow')}
            >
              <option value="skip">Skip if duplicate</option>
              <option value="allow">Allow import anyway</option>
            </select>

            <label htmlFor="conflict-resolution">Conflict resolution</label>
            <select
              id="conflict-resolution"
              value={conflictResolution}
              onChange={(event) => setConflictResolution(event.target.value as 'save-as-draft' | 'commit')}
            >
              <option value="save-as-draft">Save as draft</option>
              <option value="commit">Commit now</option>
            </select>

            <h4>Confidence flags</h4>
            {preview.confidenceFlags.length === 0 && <p className="small">No low-confidence flags.</p>}
            {preview.confidenceFlags.map((flag) => (
              <p key={flag.field}>
                {flag.field}: {flag.confidence}
                {flag.note ? ` (${flag.note})` : ''}
              </p>
            ))}

            <h4>Field corrections</h4>
            {STRUCTURED_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`structured-${key}`}>{label}</label>
                <input
                  id={`structured-${key}`}
                  value={structured[key] ?? ''}
                  onChange={(event) =>
                    setStructured((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}

            <ChipInput label="Tags" values={tags} onChange={setTags} />
            <ChipInput label="Technique mentions" values={techniques} onChange={setTechniques} />

            <label htmlFor="coach-review">Require coach review</label>
            <select
              id="coach-review"
              value={requiresCoachReview ? 'yes' : 'no'}
              onChange={(event) => setRequiresCoachReview(event.target.value === 'yes')}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>

            <label htmlFor="coach-notes">Coach notes</label>
            <textarea id="coach-notes" rows={4} value={coachNotes} onChange={(event) => setCoachNotes(event.target.value)} />

            <button type="button" onClick={commitImport} disabled={!canCommit || submitting}>
              Commit import
            </button>
          </div>
        )}

        <p>{status}</p>
      </section>
    </Protected>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { ChipInput } from '@/components/ChipInput';
import { MediaAttachmentsInput } from '@/components/MediaAttachmentsInput';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import {
  applyEntryTemplate,
  clearEntryDraft,
  enqueueOfflineCreate,
  getOfflineMutationQueueCounts,
  readEntryDraft,
  writeEntryDraft,
} from '@/lib/journalLocal';
import { flushOfflineMutationQueue, retryFailedOfflineMutations } from '@/lib/journalQueue';
import type {
  ActionPack,
  ActionPackConfidenceFlag,
  ActionPackFieldKey,
  Entry,
  EntryCreatePayload,
  EntryStructuredFieldKey,
  EntryStructuredFields,
  EntryStructuredMetadataConfirmation,
  EntryTemplateId,
  CheckoffEvidenceType,
  MediaAttachment,
} from '@/types/api';

type DraftShape = {
  shared: string;
  privateText: string;
  durationMinutes: number;
  intensity: number;
  rounds: number;
  giOrNoGi: 'gi' | 'no-gi';
  tags: string[];
  techniques: string[];
  mediaAttachments: MediaAttachment[];
  templateId?: EntryTemplateId;
};

const STRUCTURED_FIELDS: Array<{ key: EntryStructuredFieldKey; label: string }> = [
  { key: 'position', label: 'Position' },
  { key: 'technique', label: 'Technique' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'problem', label: 'Problem' },
  { key: 'cue', label: 'Cue' },
];

const NEW_ENTRY_DRAFT_KEY = 'new';
const DEFAULT_TEMPLATE: EntryTemplateId = 'class-notes';
const ACTION_PACK_FIELDS: ActionPackFieldKey[] = [
  'wins',
  'leaks',
  'oneFocus',
  'drills',
  'positionalRequests',
  'fallbackDecisionGuidance',
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

const buildDefaultActionPack = (): ActionPack => ({
  wins: [],
  leaks: [],
  oneFocus: '',
  drills: [],
  positionalRequests: [],
  fallbackDecisionGuidance: '',
  confidenceFlags: [],
});

const normalizeConfidenceFlags = (flags: ActionPackConfidenceFlag[]): ActionPackConfidenceFlag[] => {
  const byField = new Map<ActionPackFieldKey, ActionPackConfidenceFlag>();
  ACTION_PACK_FIELDS.forEach((field) => {
    byField.set(field, { field, confidence: 'medium' });
  });

  flags.forEach((flag) => {
    if (!ACTION_PACK_FIELDS.includes(flag.field)) return;
    byField.set(flag.field, {
      field: flag.field,
      confidence: flag.confidence,
      ...(flag.note?.trim() ? { note: flag.note.trim() } : {}),
    });
  });

  return ACTION_PACK_FIELDS.map((field) => byField.get(field) as ActionPackConfidenceFlag);
};

const normalizeActionPack = (value: ActionPack | undefined): ActionPack => {
  if (!value) return buildDefaultActionPack();
  return {
    wins: value.wins ?? [],
    leaks: value.leaks ?? [],
    oneFocus: value.oneFocus ?? '',
    drills: value.drills ?? [],
    positionalRequests: value.positionalRequests ?? [],
    fallbackDecisionGuidance: value.fallbackDecisionGuidance ?? '',
    confidenceFlags: normalizeConfidenceFlags(value.confidenceFlags ?? []),
  };
};

const listToText = (items: string[]): string => items.join('\n');
const textToList = (value: string): string[] =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const resolveFieldConfidence = (actionPack: ActionPack, field: ActionPackFieldKey): 'high' | 'medium' | 'low' =>
  actionPack.confidenceFlags.find((flag) => flag.field === field)?.confidence ?? 'medium';

const buildCheckoffEvidenceFromActionPack = (
  actionPack: ActionPack,
  skillIds: string[],
): Array<{
  skillId: string;
  evidenceType: CheckoffEvidenceType;
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  sourceOutcomeField: ActionPackFieldKey;
  mappingStatus: 'confirmed' | 'pending_confirmation';
}> => {
  const normalizedSkills = [...new Set(skillIds.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (normalizedSkills.length === 0) return [];

  const mapMappingStatus = (confidence: 'high' | 'medium' | 'low'): 'confirmed' | 'pending_confirmation' =>
    confidence === 'low' ? 'pending_confirmation' : 'confirmed';

  const wins = actionPack.wins.find((item) => item.trim());
  const drills = actionPack.drills.find((item) => item.trim());
  const positional = actionPack.positionalRequests.find((item) => item.trim());
  const fallback = actionPack.fallbackDecisionGuidance.trim();

  const output: Array<{
    skillId: string;
    evidenceType: CheckoffEvidenceType;
    statement: string;
    confidence: 'high' | 'medium' | 'low';
    sourceOutcomeField: ActionPackFieldKey;
    mappingStatus: 'confirmed' | 'pending_confirmation';
  }> = [];

  for (const skillId of normalizedSkills) {
    if (wins) {
      const confidence = resolveFieldConfidence(actionPack, 'wins');
      output.push({
        skillId,
        evidenceType: 'hit-in-live-roll',
        statement: wins,
        confidence,
        sourceOutcomeField: 'wins',
        mappingStatus: mapMappingStatus(confidence),
      });
    }
    if (drills) {
      const confidence = resolveFieldConfidence(actionPack, 'drills');
      output.push({
        skillId,
        evidenceType: 'demonstrate-clean-reps',
        statement: drills,
        confidence,
        sourceOutcomeField: 'drills',
        mappingStatus: mapMappingStatus(confidence),
      });
    }
    if (positional) {
      const confidence = resolveFieldConfidence(actionPack, 'positionalRequests');
      output.push({
        skillId,
        evidenceType: 'hit-on-equal-or-better-partner',
        statement: positional,
        confidence,
        sourceOutcomeField: 'positionalRequests',
        mappingStatus: mapMappingStatus(confidence),
      });
    }
    if (fallback) {
      const confidence = resolveFieldConfidence(actionPack, 'fallbackDecisionGuidance');
      output.push({
        skillId,
        evidenceType: 'explain-counters-and-recounters',
        statement: fallback,
        confidence,
        sourceOutcomeField: 'fallbackDecisionGuidance',
        mappingStatus: mapMappingStatus(confidence),
      });
    }
  }

  return output;
};

export default function NewEntryPage() {
  const [shared, setShared] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [intensity, setIntensity] = useState(6);
  const [rounds, setRounds] = useState(5);
  const [giOrNoGi, setGiOrNoGi] = useState<'gi' | 'no-gi'>('gi');
  const [tags, setTags] = useState<string[]>([]);
  const [techniques, setTechniques] = useState<string[]>([]);
  const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([]);
  const [templateId, setTemplateId] = useState<EntryTemplateId>(DEFAULT_TEMPLATE);
  const [status, setStatus] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'saved'>('idle');
  const [syncCounts, setSyncCounts] = useState({ pending: 0, failed: 0, total: 0 });
  const [gptStatus, setGptStatus] = useState('');
  const [createdEntry, setCreatedEntry] = useState<Entry | null>(null);
  const [actionPack, setActionPack] = useState<ActionPack | null>(null);
  const [coachReviewRequired, setCoachReviewRequired] = useState(false);
  const [coachReviewNotes, setCoachReviewNotes] = useState('');
  const [structured, setStructured] = useState<EntryStructuredFields>({});
  const [metadataConfirmations, setMetadataConfirmations] = useState<EntryStructuredMetadataConfirmation[]>([]);
  const router = useRouter();
  const syncStateLabel = syncCounts.failed > 0 ? 'failed' : syncCounts.pending > 0 ? 'pending' : 'synced';

  const refreshQueueCounts = () => {
    setSyncCounts(getOfflineMutationQueueCounts());
  };

  useEffect(() => {
    const draft = readEntryDraft<DraftShape>(NEW_ENTRY_DRAFT_KEY);
    if (draft) {
      setShared(draft.shared ?? '');
      setPrivateText(draft.privateText ?? '');
      setDurationMinutes(draft.durationMinutes ?? 60);
      setIntensity(draft.intensity ?? 6);
      setRounds(draft.rounds ?? 5);
      setGiOrNoGi(draft.giOrNoGi ?? 'gi');
      setTags(draft.tags ?? []);
      setTechniques(draft.techniques ?? []);
      setMediaAttachments(draft.mediaAttachments ?? []);
      setTemplateId(draft.templateId ?? DEFAULT_TEMPLATE);
      setStatus('Draft restored.');
    } else {
      const next = applyEntryTemplate(DEFAULT_TEMPLATE);
      if (next.sections) {
        setShared(next.sections.shared);
      }
      if (next.sessionMetrics) {
        setDurationMinutes(next.sessionMetrics.durationMinutes);
        setIntensity(next.sessionMetrics.intensity);
        setRounds(next.sessionMetrics.rounds);
        setGiOrNoGi(next.sessionMetrics.giOrNoGi);
        setTags(next.sessionMetrics.tags);
      }
      setTechniques(next.rawTechniqueMentions ?? []);
    }

    refreshQueueCounts();

    const flush = async () => {
      const result = await flushOfflineMutationQueue();
      refreshQueueCounts();
      if (result.succeeded > 0) {
        setStatus(`Synced ${result.succeeded} queued entr${result.succeeded === 1 ? 'y' : 'ies'}.`);
      }
    };

    void flush();
    const onOnline = () => {
      void flush();
    };
    const onStorage = () => refreshQueueCounts();
    window.addEventListener('online', onOnline);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      writeEntryDraft(NEW_ENTRY_DRAFT_KEY, {
        shared,
        privateText,
        durationMinutes,
        intensity,
        rounds,
        giOrNoGi,
        tags,
        techniques,
        mediaAttachments,
        templateId,
      } satisfies DraftShape);
      setDraftState('saved');
    }, 350);

    setDraftState('idle');
    return () => window.clearTimeout(timeout);
  }, [durationMinutes, giOrNoGi, intensity, mediaAttachments, privateText, rounds, shared, tags, techniques, templateId]);

  const applyTemplate = (nextTemplateId: EntryTemplateId) => {
    const next = applyEntryTemplate(nextTemplateId);
    if (next.sections) {
      setShared(next.sections.shared);
      setPrivateText(next.sections.private ?? '');
    }
    if (next.sessionMetrics) {
      setDurationMinutes(next.sessionMetrics.durationMinutes);
      setIntensity(next.sessionMetrics.intensity);
      setRounds(next.sessionMetrics.rounds);
      setGiOrNoGi(next.sessionMetrics.giOrNoGi);
      setTags(next.sessionMetrics.tags);
    }
    setTemplateId(nextTemplateId);
    setTechniques(next.rawTechniqueMentions ?? []);
    setStatus('Template applied.');
  };

  const buildPayload = useMemo(
    () =>
      (): EntryCreatePayload => ({
        sections: { shared, private: privateText },
        sessionMetrics: { durationMinutes, intensity, rounds, giOrNoGi, tags },
        rawTechniqueMentions: techniques,
        mediaAttachments: sanitizeAttachments(mediaAttachments),
        templateId,
        ...(Object.keys(structured).length > 0 ? { structured } : {}),
        ...(metadataConfirmations.length > 0 ? { structuredMetadataConfirmations: metadataConfirmations } : {}),
        ...(actionPack ? { actionPackDraft: actionPack } : {}),
      }),
    [
      actionPack,
      durationMinutes,
      giOrNoGi,
      intensity,
      mediaAttachments,
      metadataConfirmations,
      privateText,
      rounds,
      shared,
      structured,
      tags,
      techniques,
      templateId,
    ],
  );

  const upsertConfirmation = (next: EntryStructuredMetadataConfirmation) => {
    setMetadataConfirmations((current) => {
      const filtered = current.filter((item) => item.field !== next.field);
      return [...filtered, next];
    });
  };

  const setStructuredField = (field: EntryStructuredFieldKey, value: string) => {
    const trimmed = value.trim();
    setStructured((current) => {
      const next = { ...current };
      if (trimmed) {
        next[field] = trimmed;
      } else {
        delete next[field];
      }
      return next;
    });
    if (trimmed) {
      upsertConfirmation({
        field,
        status: 'corrected',
        correctionValue: trimmed,
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = buildPayload();
    setStatus('Saving...');
    try {
      const saved = await apiClient.createEntry(payload);
      setCreatedEntry(saved);
      setStructured(saved.structured ?? {});
      clearEntryDraft(NEW_ENTRY_DRAFT_KEY);
      setStatus('Saved.');
      router.push('/entries');
    } catch {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        enqueueOfflineCreate(payload);
        refreshQueueCounts();
        setStatus('Offline: entry queued and will sync when you reconnect.');
        return;
      }
      setStatus('Save failed.');
    }
  };

  const retryFailedSync = async () => {
    const result = await retryFailedOfflineMutations();
    refreshQueueCounts();
    if (result.succeeded > 0) {
      setStatus(`Retried sync: ${result.succeeded} entr${result.succeeded === 1 ? 'y' : 'ies'} synced.`);
      return;
    }
    if (result.remainingFailed > 0) {
      setStatus('Some queued items still failed. Open the entry and save again to resolve conflicts.');
      return;
    }
    setStatus('Nothing to retry.');
  };

  const saveAndRunGpt = async () => {
    const payload = buildPayload();
    setStatus('Saving...');
    setGptStatus('');

    let entryForGpt: Entry;
    try {
      entryForGpt = await apiClient.createEntry(payload);
      setCreatedEntry(entryForGpt);
      setStructured(entryForGpt.structured ?? {});
      clearEntryDraft(NEW_ENTRY_DRAFT_KEY);
      setStatus('Saved. Running GPT extraction...');
    } catch {
      setStatus('Save failed.');
      return;
    }

    try {
      const response = await apiClient.chat({
        message: `Generate an action pack for this entry. Shared notes: ${shared}\nPrivate notes: ${privateText}`,
        context: {
          entryIds: [entryForGpt.entryId],
          includePrivate: true,
          keywords: [...techniques, ...tags],
        },
      });

      const nextActionPack = normalizeActionPack(response.extracted_updates?.actionPack);
      setActionPack(nextActionPack);
      setCoachReviewRequired(Boolean(response.extracted_updates?.coachReview?.requiresReview));
      setCoachReviewNotes(response.extracted_updates?.coachReview?.coachNotes ?? '');
      setGptStatus('GPT action pack ready. Review confidence flags and finalize shared feedback.');

      await apiClient.updateEntry(entryForGpt.entryId, {
        ...payload,
        actionPackDraft: nextActionPack,
      });
    } catch {
      setGptStatus('GPT processing failed. Entry is saved, and you can retry later.');
    }
  };

  const updateConfidenceFlag = (field: ActionPackFieldKey, next: Partial<ActionPackConfidenceFlag>) => {
    setActionPack((current) => {
      if (!current) return current;
      const nextFlags = normalizeConfidenceFlags(current.confidenceFlags).map((flag) =>
        flag.field === field
          ? {
              ...flag,
              ...next,
            }
          : flag,
      );
      return {
        ...current,
        confidenceFlags: nextFlags,
      };
    });
  };

  const finalizeActionPack = async () => {
    if (!createdEntry || !actionPack) {
      setGptStatus('Run GPT first to finalize action pack output.');
      return;
    }

    setGptStatus('Finalizing...');
    try {
      await apiClient.updateEntry(createdEntry.entryId, {
        ...buildPayload(),
        actionPackDraft: actionPack,
        actionPackFinal: {
          actionPack,
          coachReview: {
            requiresReview: coachReviewRequired,
            ...(coachReviewNotes.trim() ? { coachNotes: coachReviewNotes.trim() } : {}),
            reviewedAt: new Date().toISOString(),
          },
          finalizedAt: new Date().toISOString(),
        },
      });
      const derivedEvidence = buildCheckoffEvidenceFromActionPack(
        actionPack,
        techniques.length > 0 ? techniques : tags,
      );
      if (derivedEvidence.length > 0) {
        const checkoffResult = await apiClient.upsertEntryCheckoffEvidence(createdEntry.entryId, { evidence: derivedEvidence });
        if (checkoffResult.pendingConfirmationCount > 0) {
          setGptStatus(
            `Finalized. ${checkoffResult.pendingConfirmationCount} low-confidence checkoff mappings are saved as pending confirmation.`,
          );
          return;
        }
      }

      setGptStatus('Finalized and persisted. Checkoff evidence has been mapped from this journal entry.');
    } catch {
      setGptStatus('Finalize failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section className="mobile-compose">
        <h2>New entry</h2>
        <p className="small">Mobile-first capture: choose template, save, run GPT, finalize in one flow.</p>

        <div className="panel">
          <div className="row">
            <strong>Templates</strong>
            <button type="button" onClick={() => applyTemplate('class-notes')}>
              Class notes
            </button>
            <button type="button" onClick={() => applyTemplate('open-mat-rounds')}>
              Open mat rounds
            </button>
            <button type="button" onClick={() => applyTemplate('drill-session')}>
              Drill session
            </button>
          </div>
          <p className="small">
            Draft: {draftState === 'saved' ? 'autosaved' : 'editing'} • Sync: {syncStateLabel}
            {syncCounts.pending > 0 ? ` (${syncCounts.pending} pending)` : ''}
            {syncCounts.failed > 0 ? ` (${syncCounts.failed} failed)` : ''}
          </p>
          {syncCounts.failed > 0 && (
            <button type="button" onClick={retryFailedSync}>
              Retry failed sync
            </button>
          )}
        </div>

        <form onSubmit={submit}>
          <label htmlFor="shared-notes">Shared notes</label>
          <textarea
            id="shared-notes"
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            required
            placeholder="After class: wins, leaks, one focus"
          />
          <label htmlFor="private-notes">Private notes</label>
          <textarea
            id="private-notes"
            value={privateText}
            onChange={(e) => setPrivateText(e.target.value)}
            required
            placeholder="Private detail for better GPT extraction"
          />
          <div className="grid">
            <div>
              <label htmlFor="duration-minutes">Duration (minutes)</label>
              <input
                id="duration-minutes"
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
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
              />
            </div>
            <div>
              <label htmlFor="rounds">Rounds</label>
              <input id="rounds" type="number" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
            </div>
            <div>
              <label htmlFor="gi-or-no-gi">Gi or no-gi</label>
              <select id="gi-or-no-gi" value={giOrNoGi} onChange={(e) => setGiOrNoGi(e.target.value as 'gi' | 'no-gi')}>
                <option value="gi">gi</option>
                <option value="no-gi">no-gi</option>
              </select>
            </div>
          </div>
          <ChipInput label="Tags" values={tags} onChange={setTags} />
          <ChipInput label="Technique mentions" values={techniques} onChange={setTechniques} />
          <MediaAttachmentsInput value={mediaAttachments} onChange={setMediaAttachments} />

          <div className="thumb-actions">
            <button type="submit">Save entry</button>
            <button type="button" onClick={saveAndRunGpt}>
              Save + run GPT
            </button>
          </div>
          <p>{status}</p>
        </form>

        {actionPack && (
          <div className="panel">
            <h3>GPT action pack</h3>
            <label htmlFor="action-pack-wins">Wins</label>
            <textarea
              id="action-pack-wins"
              value={listToText(actionPack.wins)}
              onChange={(e) => setActionPack({ ...actionPack, wins: textToList(e.target.value) })}
            />

            <label htmlFor="action-pack-leaks">Leaks</label>
            <textarea
              id="action-pack-leaks"
              value={listToText(actionPack.leaks)}
              onChange={(e) => setActionPack({ ...actionPack, leaks: textToList(e.target.value) })}
            />

            <label htmlFor="action-pack-focus">One focus</label>
            <input
              id="action-pack-focus"
              type="text"
              value={actionPack.oneFocus}
              onChange={(e) => setActionPack({ ...actionPack, oneFocus: e.target.value })}
            />

            <label htmlFor="action-pack-drills">Drills</label>
            <textarea
              id="action-pack-drills"
              value={listToText(actionPack.drills)}
              onChange={(e) => setActionPack({ ...actionPack, drills: textToList(e.target.value) })}
            />

            <label htmlFor="action-pack-positional-requests">Positional requests</label>
            <textarea
              id="action-pack-positional-requests"
              value={listToText(actionPack.positionalRequests)}
              onChange={(e) => setActionPack({ ...actionPack, positionalRequests: textToList(e.target.value) })}
            />

            <label htmlFor="action-pack-fallback">Fallback decision guidance</label>
            <textarea
              id="action-pack-fallback"
              value={actionPack.fallbackDecisionGuidance}
              onChange={(e) =>
                setActionPack({
                  ...actionPack,
                  fallbackDecisionGuidance: e.target.value,
                })
              }
            />

            <h4>Confidence flags</h4>
            {normalizeConfidenceFlags(actionPack.confidenceFlags).map((flag) => (
              <div key={flag.field} className="panel">
                <p>
                  <strong>{flag.field}</strong>
                </p>
                <label htmlFor={`confidence-${flag.field}`}>Confidence</label>
                <select
                  id={`confidence-${flag.field}`}
                  value={flag.confidence}
                  onChange={(e) =>
                    updateConfidenceFlag(flag.field, {
                      confidence: e.target.value as ActionPackConfidenceFlag['confidence'],
                    })
                  }
                >
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
                <label htmlFor={`confidence-note-${flag.field}`}>Correction note</label>
                <input
                  id={`confidence-note-${flag.field}`}
                  type="text"
                  value={flag.note ?? ''}
                  onChange={(e) => updateConfidenceFlag(flag.field, { note: e.target.value })}
                />
              </div>
            ))}

            <h4>Coach review (optional)</h4>
            <label htmlFor="coach-review-required">Require coach review before shared feedback</label>
            <select
              id="coach-review-required"
              value={coachReviewRequired ? 'yes' : 'no'}
              onChange={(e) => setCoachReviewRequired(e.target.value === 'yes')}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
            <label htmlFor="coach-review-notes">Coach notes</label>
            <textarea
              id="coach-review-notes"
              value={coachReviewNotes}
              onChange={(e) => setCoachReviewNotes(e.target.value)}
              placeholder="Optional coach notes before finalization"
            />

            <button type="button" onClick={finalizeActionPack}>
              Finalize shared feedback
            </button>
          </div>
        )}

        {createdEntry?.structuredExtraction && (
          <div className="panel">
            <h3>Structured extraction</h3>
            <p className="small">
              Confirm or correct suggested metadata. Corrections are one-step and persisted to your record.
            </p>
            {createdEntry.structuredExtraction.confidenceFlags.length > 0 && (
              <p className="small">
                Uncertain fields:{' '}
                {createdEntry.structuredExtraction.confidenceFlags
                  .map((flag) => `${flag.field} (${flag.confidence})`)
                  .join(', ')}
              </p>
            )}
            {STRUCTURED_FIELDS.map(({ key, label }) => {
              const suggestion = createdEntry.structuredExtraction?.suggestions.find((item) => item.field === key);
              return (
                <div key={key}>
                  <label htmlFor={`structured-${key}`}>{label}</label>
                  <input
                    id={`structured-${key}`}
                    type="text"
                    value={structured[key] ?? ''}
                    onChange={(e) => setStructuredField(key, e.target.value)}
                    placeholder={suggestion?.value ?? ''}
                  />
                  {suggestion?.confirmationPrompt && <p className="small">{suggestion.confirmationPrompt}</p>}
                  {suggestion && (
                    <div className="row">
                      <span className="small">Confidence: {suggestion.confidence}</span>
                      <button
                        type="button"
                        onClick={() => upsertConfirmation({ field: key, status: 'confirmed' })}
                      >
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
            {createdEntry.structuredExtraction.concepts.length > 0 && (
              <p className="small">Concepts: {createdEntry.structuredExtraction.concepts.join(' | ')}</p>
            )}
            {createdEntry.structuredExtraction.failures.length > 0 && (
              <p className="small">Failures: {createdEntry.structuredExtraction.failures.join(' | ')}</p>
            )}
            {createdEntry.structuredExtraction.conditioningIssues.length > 0 && (
              <p className="small">Conditioning: {createdEntry.structuredExtraction.conditioningIssues.join(' | ')}</p>
            )}
          </div>
        )}

        {!!gptStatus && <p>{gptStatus}</p>}
      </section>
    </Protected>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { ChipInput } from '@/components/ChipInput';
import { MediaAttachmentsInput } from '@/components/MediaAttachmentsInput';
import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import {
  applyEntryTemplate,
  clearEntryDraft,
  enqueueOfflineCreate,
  readEntryDraft,
  type EntryTemplateId,
  writeEntryDraft,
} from '@/lib/journalLocal';
import { flushOfflineCreateQueue } from '@/lib/journalQueue';
import type { EntryCreatePayload, MediaAttachment } from '@/types/api';

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
};

const NEW_ENTRY_DRAFT_KEY = 'new';

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
          label: clip.label.trim(),
          note: clip.note.trim(),
        }))
        .filter((clip) => clip.label && clip.note),
    }))
    .filter((attachment) => attachment.title && attachment.url);

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
  const [status, setStatus] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'saved'>('idle');
  const [queuedCount, setQueuedCount] = useState(0);
  const router = useRouter();

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
      setStatus('Draft restored.');
    }

    const flush = async () => {
      const flushed = await flushOfflineCreateQueue();
      if (flushed > 0) {
        setQueuedCount(0);
        setStatus(`Synced ${flushed} queued entr${flushed === 1 ? 'y' : 'ies'}.`);
      }
    };

    void flush();
    const onOnline = () => {
      void flush();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
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
      } satisfies DraftShape);
      setDraftState('saved');
    }, 350);

    setDraftState('idle');
    return () => window.clearTimeout(timeout);
  }, [durationMinutes, giOrNoGi, intensity, mediaAttachments, privateText, rounds, shared, tags, techniques]);

  const applyTemplate = (templateId: EntryTemplateId) => {
    const next = applyEntryTemplate(templateId);
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
    if (next.rawTechniqueMentions) {
      setTechniques(next.rawTechniqueMentions);
    }
    setStatus('Template applied.');
  };

  const buildPayload = (): EntryCreatePayload => ({
    sections: { shared, private: privateText },
    sessionMetrics: { durationMinutes, intensity, rounds, giOrNoGi, tags },
    rawTechniqueMentions: techniques,
    mediaAttachments: sanitizeAttachments(mediaAttachments),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = buildPayload();
    setStatus('Saving...');
    try {
      await apiClient.createEntry(payload);
      clearEntryDraft(NEW_ENTRY_DRAFT_KEY);
      setStatus('Saved.');
      router.push('/entries');
    } catch {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        enqueueOfflineCreate(payload);
        setQueuedCount((count) => count + 1);
        setStatus('Offline: entry queued and will sync when you reconnect.');
        return;
      }
      setStatus('Save failed.');
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>New journal entry</h2>
        <p className="small">Fast capture first. Templates + autosave keep mobile entry under 30 seconds.</p>

        <div className="panel">
          <div className="row">
            <strong>Templates</strong>
            <button type="button" onClick={() => applyTemplate('quick-roll')}>
              Quick roll
            </button>
            <button type="button" onClick={() => applyTemplate('comp-class')}>
              Comp class
            </button>
            <button type="button" onClick={() => applyTemplate('drill-day')}>
              Drill day
            </button>
            <button type="button" onClick={() => applyTemplate('open-mat')}>
              Open mat
            </button>
          </div>
          <p className="small">Draft: {draftState === 'saved' ? 'autosaved' : 'editing'} {queuedCount > 0 ? `• queued ${queuedCount}` : ''}</p>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="shared-notes">Shared notes</label>
          <textarea
            id="shared-notes"
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            required
            placeholder="Key rounds, wins/losses, what worked"
          />
          <label htmlFor="private-notes">Private notes</label>
          <textarea
            id="private-notes"
            value={privateText}
            onChange={(e) => setPrivateText(e.target.value)}
            required
            placeholder="Feel, confidence, hypotheses, next experiments"
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
          <button type="submit">Save entry</button>
          <p>{status}</p>
        </form>
      </section>
    </Protected>
  );
}

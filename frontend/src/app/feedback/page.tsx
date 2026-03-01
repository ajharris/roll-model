'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';

import { Protected } from '@/components/Protected';
import { apiClient } from '@/lib/apiClient';
import type {
  FeedbackNormalizationState,
  FeedbackPayload,
  FeedbackReviewerWorkflow,
  FeedbackSeverity,
  FeedbackType,
} from '@/types/api';

type ScreenshotFormRow = {
  id: string;
  url: string;
  caption: string;
};

const MIN_REQUIRED_TEXT_LENGTH = 12;

const isValidHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

const extractFirstJsonObject = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const createRowId = (): string => globalThis.crypto?.randomUUID?.() ?? `screenshot-${Date.now()}-${Math.random()}`;

export default function FeedbackPage() {
  const [type, setType] = useState<FeedbackType>('bug');
  const [problem, setProblem] = useState('');
  const [proposedChange, setProposedChange] = useState('');
  const [contextSteps, setContextSteps] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity>('medium');
  const [screenshots, setScreenshots] = useState<ScreenshotFormRow[]>([{ id: createRowId(), url: '', caption: '' }]);
  const [requiresReview, setRequiresReview] = useState(false);
  const [reviewerRole, setReviewerRole] = useState<Exclude<FeedbackReviewerWorkflow['reviewerRole'], undefined>>('coach');
  const [reviewerNote, setReviewerNote] = useState('');
  const [normalization, setNormalization] = useState<FeedbackNormalizationState | undefined>();
  const [previewPayload, setPreviewPayload] = useState<FeedbackPayload | null>(null);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<{ issueNumber: number; issueUrl: string } | null>(null);

  const buildPayload = (): FeedbackPayload => {
    const nextProblem = problem.trim();
    const nextProposedChange = proposedChange.trim();
    const nextContextSteps = contextSteps.trim();

    if (nextProblem.length < MIN_REQUIRED_TEXT_LENGTH) {
      throw new Error(`Problem must be at least ${MIN_REQUIRED_TEXT_LENGTH} characters.`);
    }
    if (nextProposedChange.length < MIN_REQUIRED_TEXT_LENGTH) {
      throw new Error(`Proposed change must be at least ${MIN_REQUIRED_TEXT_LENGTH} characters.`);
    }
    if (nextContextSteps.length < MIN_REQUIRED_TEXT_LENGTH) {
      throw new Error(`Reproduction steps / context must be at least ${MIN_REQUIRED_TEXT_LENGTH} characters.`);
    }

    const parsedScreenshots = screenshots
      .map((item) => ({ url: item.url.trim(), caption: item.caption.trim() }))
      .filter((item) => item.url || item.caption);
    if (parsedScreenshots.length > 5) {
      throw new Error('You can attach up to 5 screenshots.');
    }
    for (const [index, screenshot] of parsedScreenshots.entries()) {
      if (!screenshot.url) {
        throw new Error(`Screenshot #${index + 1} needs a URL.`);
      }
      if (!isValidHttpsUrl(screenshot.url)) {
        throw new Error(`Screenshot #${index + 1} URL must use https.`);
      }
    }

    const reviewerWorkflow: FeedbackReviewerWorkflow = requiresReview
      ? {
          requiresReview: true,
          reviewerRole,
          ...(reviewerNote.trim() ? { note: reviewerNote.trim() } : {}),
        }
      : { requiresReview: false };

    return {
      type,
      problem: nextProblem,
      proposedChange: nextProposedChange,
      contextSteps: nextContextSteps,
      severity,
      screenshots: parsedScreenshots,
      reviewerWorkflow,
      ...(normalization ? { normalization } : {}),
      previewConfirmed: true,
    };
  };

  const buildNormalizationPrompt = () =>
    [
      'Normalize this user feedback into concise, actionable fields.',
      'Return JSON only with keys: problem, proposedChange, contextSteps.',
      `problem: ${problem.trim()}`,
      `proposedChange: ${proposedChange.trim()}`,
      `contextSteps: ${contextSteps.trim()}`,
    ].join('\n');

  const handleNormalize = async () => {
    setError('');
    const originalProblem = problem.trim();
    const originalProposedChange = proposedChange.trim();
    if (!originalProblem && !originalProposedChange && !contextSteps.trim()) {
      setError('Add some feedback text before GPT normalization.');
      return;
    }

    setIsNormalizing(true);
    try {
      const response = await apiClient.chat({
        message: buildNormalizationPrompt(),
        context: {
          task: 'feedback_normalization',
        },
      });
      const parsed = extractFirstJsonObject(response.assistant_text);
      if (!parsed) {
        throw new Error('GPT response was not valid JSON.');
      }

      const nextProblem = typeof parsed.problem === 'string' ? parsed.problem.trim() : '';
      const nextProposedChange = typeof parsed.proposedChange === 'string' ? parsed.proposedChange.trim() : '';
      const nextContextSteps = typeof parsed.contextSteps === 'string' ? parsed.contextSteps.trim() : '';

      if (nextProblem) setProblem(nextProblem);
      if (nextProposedChange) setProposedChange(nextProposedChange);
      if (nextContextSteps) setContextSteps(nextContextSteps);

      setNormalization({
        usedGpt: true,
        ...(originalProblem && originalProblem !== nextProblem ? { originalProblem } : {}),
        ...(originalProposedChange && originalProposedChange !== nextProposedChange ? { originalProposedChange } : {}),
      });
    } catch {
      setError('GPT normalization failed. You can continue editing manually.');
    } finally {
      setIsNormalizing(false);
    }
  };

  const preview = () => {
    setError('');
    try {
      setPreviewPayload(buildPayload());
    } catch (buildError) {
      setPreviewPayload(null);
      setError(buildError instanceof Error ? buildError.message : 'Review the form before preview.');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!previewPayload) {
      preview();
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiClient.submitFeedback(previewPayload);
      setSubmitted({ issueNumber: response.issueNumber, issueUrl: response.issueUrl });
    } catch {
      setError('Could not submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Protected allow={['athlete', 'coach', 'admin']}>
      <section>
        <h2>Suggest a feature or report a bug</h2>
        <p className="small">Logged-in submissions are structured, previewed, stored, then linked to a GitHub issue.</p>
        <p className="small">
          Screenshot strategy: add hosted HTTPS URLs now. Direct file upload can be added later with presigned URLs.
        </p>
        {submitted ? (
          <p>
            Thanks. Issue #{submitted.issueNumber} has been filed.{' '}
            <a href={submitted.issueUrl} target="_blank" rel="noreferrer">
              Open issue
            </a>
          </p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
              <option value="bug">Bug</option>
              <option value="feature">Feature request</option>
            </select>

            <label htmlFor="severity">Severity</label>
            <select id="severity" value={severity} onChange={(event) => setSeverity(event.target.value as FeedbackSeverity)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <label htmlFor="problem">Problem</label>
            <textarea id="problem" value={problem} onChange={(e) => setProblem(e.target.value)} required minLength={12} />

            <label htmlFor="proposed-change">Proposed change</label>
            <textarea
              id="proposed-change"
              value={proposedChange}
              onChange={(e) => setProposedChange(e.target.value)}
              required
              minLength={12}
            />

            <label htmlFor="context-steps">Reproduction steps / context</label>
            <textarea
              id="context-steps"
              value={contextSteps}
              onChange={(e) => setContextSteps(e.target.value)}
              required
              minLength={12}
            />

            <h3 style={{ marginBottom: 6 }}>Screenshot attachments</h3>
            {screenshots.map((item, index) => (
              <div className="panel" key={item.id}>
                <label htmlFor={`screenshot-url-${item.id}`}>Screenshot URL #{index + 1}</label>
                <input
                  id={`screenshot-url-${item.id}`}
                  value={item.url}
                  onChange={(event) =>
                    setScreenshots((current) =>
                      current.map((candidate) =>
                        candidate.id === item.id ? { ...candidate, url: event.target.value } : candidate,
                      ),
                    )
                  }
                  placeholder="https://..."
                />
                <label htmlFor={`screenshot-caption-${item.id}`}>Caption (optional)</label>
                <input
                  id={`screenshot-caption-${item.id}`}
                  value={item.caption}
                  onChange={(event) =>
                    setScreenshots((current) =>
                      current.map((candidate) =>
                        candidate.id === item.id ? { ...candidate, caption: event.target.value } : candidate,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <div className="row">
              <button
                type="button"
                onClick={() => setScreenshots((current) => [...current, { id: createRowId(), url: '', caption: '' }])}
              >
                Add screenshot URL
              </button>
              {screenshots.length > 1 && (
                <button
                  type="button"
                  onClick={() => setScreenshots((current) => current.slice(0, Math.max(1, current.length - 1)))}
                >
                  Remove last
                </button>
              )}
            </div>

            <h3 style={{ marginBottom: 6 }}>Reviewer workflow (optional)</h3>
            <label htmlFor="requires-review">
              <input
                id="requires-review"
                type="checkbox"
                checked={requiresReview}
                onChange={(event) => setRequiresReview(event.target.checked)}
              />
              Route to reviewer before triage
            </label>
            {requiresReview && (
              <>
                <label htmlFor="reviewer-role">Reviewer role</label>
                <select
                  id="reviewer-role"
                  value={reviewerRole}
                  onChange={(event) =>
                    setReviewerRole(event.target.value as Exclude<FeedbackReviewerWorkflow['reviewerRole'], undefined>)
                  }
                >
                  <option value="coach">Coach</option>
                  <option value="admin">Admin</option>
                </select>
                <label htmlFor="reviewer-note">Reviewer note (optional)</label>
                <textarea id="reviewer-note" value={reviewerNote} onChange={(event) => setReviewerNote(event.target.value)} />
              </>
            )}

            <div className="row">
              <button type="button" onClick={handleNormalize} disabled={isNormalizing}>
                {isNormalizing ? 'Normalizing...' : 'Normalize with GPT'}
              </button>
              <button type="button" onClick={preview}>
                Preview payload
              </button>
            </div>

            {previewPayload && (
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>Final preview</h3>
                <p className="small">Review and edit before sending. Submissions only send from this preview step.</p>
                <pre>{JSON.stringify(previewPayload, null, 2)}</pre>
                <div className="row">
                  <button type="button" onClick={() => setPreviewPayload(null)}>
                    Edit form
                  </button>
                  <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Submitting...' : 'Submit feedback'}
                  </button>
                </div>
              </div>
            )}

            <div className="row">
              {!previewPayload && (
                <button type="submit">
                  Preview before submit
                </button>
              )}
              {error && <span>{error}</span>}
            </div>
          </form>
        )}
      </section>
    </Protected>
  );
}

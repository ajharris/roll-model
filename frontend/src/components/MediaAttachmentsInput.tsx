'use client';

import type { MediaAttachment } from '@/types/api';

type Props = {
  value: MediaAttachment[];
  onChange: (next: MediaAttachment[]) => void;
  disabled?: boolean;
};

const emptyClip = () => ({
  clipId: crypto.randomUUID(),
  label: '',
  note: '',
  startSeconds: undefined as number | undefined,
  endSeconds: undefined as number | undefined,
});

const emptyAttachment = (): MediaAttachment => ({
  mediaId: crypto.randomUUID(),
  title: '',
  url: '',
  notes: '',
  clipNotes: [],
});

export const MediaAttachmentsInput = ({ value, onChange, disabled = false }: Props) => {
  const updateAttachment = (mediaId: string, updater: (attachment: MediaAttachment) => MediaAttachment) => {
    onChange(value.map((attachment) => (attachment.mediaId === mediaId ? updater(attachment) : attachment)));
  };

  return (
    <div className="panel">
      <div className="row">
        <h3 style={{ margin: 0 }}>Media attachments (optional)</h3>
        <button type="button" onClick={() => onChange([...value, emptyAttachment()])} disabled={disabled}>
          Add media link
        </button>
      </div>
      {value.length === 0 && <p className="small">Add a video URL or clip link and annotate timestamps.</p>}
      {value.map((attachment, attachmentIndex) => (
        <div key={attachment.mediaId} className="panel">
          <div className="row">
            <strong>Media {attachmentIndex + 1}</strong>
            <button
              type="button"
              className="button-danger"
              onClick={() => onChange(value.filter((candidate) => candidate.mediaId !== attachment.mediaId))}
              disabled={disabled}
            >
              Remove media
            </button>
          </div>

          <label htmlFor={`media-title-${attachment.mediaId}`}>Title</label>
          <input
            id={`media-title-${attachment.mediaId}`}
            value={attachment.title}
            onChange={(event) =>
              updateAttachment(attachment.mediaId, (current) => ({ ...current, title: event.target.value }))
            }
            disabled={disabled}
            placeholder="Round 3 training clip"
          />

          <label htmlFor={`media-url-${attachment.mediaId}`}>URL</label>
          <input
            id={`media-url-${attachment.mediaId}`}
            value={attachment.url}
            onChange={(event) =>
              updateAttachment(attachment.mediaId, (current) => ({ ...current, url: event.target.value }))
            }
            disabled={disabled}
            placeholder="https://..."
          />

          <label htmlFor={`media-notes-${attachment.mediaId}`}>Media notes</label>
          <textarea
            id={`media-notes-${attachment.mediaId}`}
            value={attachment.notes ?? ''}
            onChange={(event) =>
              updateAttachment(attachment.mediaId, (current) => ({ ...current, notes: event.target.value }))
            }
            disabled={disabled}
          />

          <div className="row">
            <strong>Clip notes</strong>
            <button
              type="button"
              onClick={() =>
                updateAttachment(attachment.mediaId, (current) => ({
                  ...current,
                  clipNotes: [...current.clipNotes, emptyClip()],
                }))
              }
              disabled={disabled}
            >
              Add clip note
            </button>
          </div>

          {attachment.clipNotes.map((clip, clipIndex) => (
            <div key={clip.clipId} className="panel">
              <div className="row">
                <strong>Clip {clipIndex + 1}</strong>
                <button
                  type="button"
                  className="button-danger"
                  onClick={() =>
                    updateAttachment(attachment.mediaId, (current) => ({
                      ...current,
                      clipNotes: current.clipNotes.filter((candidate) => candidate.clipId !== clip.clipId),
                    }))
                  }
                  disabled={disabled}
                >
                  Remove clip
                </button>
              </div>
              <div className="grid">
                <div>
                  <label htmlFor={`clip-label-${clip.clipId}`}>Label</label>
                  <input
                    id={`clip-label-${clip.clipId}`}
                    value={clip.label}
                    onChange={(event) =>
                      updateAttachment(attachment.mediaId, (current) => ({
                        ...current,
                        clipNotes: current.clipNotes.map((candidate) =>
                          candidate.clipId === clip.clipId ? { ...candidate, label: event.target.value } : candidate,
                        ),
                      }))
                    }
                    disabled={disabled}
                    placeholder="00:42 guard retention"
                  />
                </div>
                <div>
                  <label htmlFor={`clip-start-${clip.clipId}`}>Start (sec)</label>
                  <input
                    id={`clip-start-${clip.clipId}`}
                    type="number"
                    value={clip.startSeconds ?? ''}
                    onChange={(event) =>
                      updateAttachment(attachment.mediaId, (current) => ({
                        ...current,
                        clipNotes: current.clipNotes.map((candidate) =>
                          candidate.clipId === clip.clipId
                            ? {
                                ...candidate,
                                startSeconds:
                                  event.target.value === '' ? undefined : Number(event.target.value),
                              }
                            : candidate,
                        ),
                      }))
                    }
                    disabled={disabled}
                  />
                </div>
                <div>
                  <label htmlFor={`clip-end-${clip.clipId}`}>End (sec)</label>
                  <input
                    id={`clip-end-${clip.clipId}`}
                    type="number"
                    value={clip.endSeconds ?? ''}
                    onChange={(event) =>
                      updateAttachment(attachment.mediaId, (current) => ({
                        ...current,
                        clipNotes: current.clipNotes.map((candidate) =>
                          candidate.clipId === clip.clipId
                            ? {
                                ...candidate,
                                endSeconds: event.target.value === '' ? undefined : Number(event.target.value),
                              }
                            : candidate,
                        ),
                      }))
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <label htmlFor={`clip-note-${clip.clipId}`}>Clip note</label>
              <textarea
                id={`clip-note-${clip.clipId}`}
                value={clip.note}
                onChange={(event) =>
                  updateAttachment(attachment.mediaId, (current) => ({
                    ...current,
                    clipNotes: current.clipNotes.map((candidate) =>
                      candidate.clipId === clip.clipId ? { ...candidate, note: event.target.value } : candidate,
                    ),
                  }))
                }
                disabled={disabled}
                placeholder="What happened? What do you want to test next?"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

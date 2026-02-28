import { listRecentOneThingCues, normalizeOneThingCue, normalizeSessionReviewArtifact } from './sessionReview';

describe('sessionReview', () => {
  it('normalizes one-thing cue to a single concise statement', () => {
    const cue = normalizeOneThingCue('  - Pummel first on underhook battles. Then check knee line.  ');
    expect(cue).toBe('Pummel first on underhook battles');
  });

  it('derives one-thing cue deterministically when omitted', () => {
    const artifact = normalizeSessionReviewArtifact({
      promptSet: {
        whatWorked: ['Frames held'],
        whatFailed: ['Late underhook reaction'],
        whatToAskCoach: ['How to keep elbow in?'],
        whatToDrillSolo: ['Early pummel reps from half guard'],
      },
      confidenceFlags: [{ field: 'whatToDrillSolo', confidence: 'high' }],
    });

    expect(artifact?.oneThing).toBe('Early pummel reps from half guard');
  });

  it('returns recent cues from finalized then draft reviews', () => {
    const cues = listRecentOneThingCues(
      [
        {
          entryId: 'entry-1',
          createdAt: '2026-02-25T00:00:00.000Z',
          sessionReviewDraft: {
            promptSet: {
              whatWorked: [],
              whatFailed: [],
              whatToAskCoach: [],
              whatToDrillSolo: [],
            },
            oneThing: 'Draft cue',
            confidenceFlags: [],
          },
        },
        {
          entryId: 'entry-2',
          createdAt: '2026-02-26T00:00:00.000Z',
          sessionReviewFinal: {
            review: {
              promptSet: {
                whatWorked: [],
                whatFailed: [],
                whatToAskCoach: [],
                whatToDrillSolo: [],
              },
              oneThing: 'Final cue.',
              confidenceFlags: [],
            },
            finalizedAt: '2026-02-26T00:05:00.000Z',
          },
        },
      ],
      2
    );

    expect(cues).toEqual([
      { entryId: 'entry-2', createdAt: '2026-02-26T00:00:00.000Z', cue: 'Final cue' },
      { entryId: 'entry-1', createdAt: '2026-02-25T00:00:00.000Z', cue: 'Draft cue' },
    ]);
  });
});


import { extractCoachSignals, generateCoachQuestionSet, hasDuplicateQuestions, scoreCoachQuestion } from './coachQuestions';
import { getOpenAIApiKey } from './openai';
import type { Entry } from './types';

jest.mock('./openai', () => ({
  getOpenAIApiKey: jest.fn()
}));

const mockGetOpenAIApiKey = jest.mocked(getOpenAIApiKey);

const buildEntry = (overrides: Partial<Entry>): Entry => ({
  entryId: 'entry-default',
  athleteId: 'athlete-1',
  schemaVersion: 4,
  createdAt: '2026-02-20T10:00:00.000Z',
  updatedAt: '2026-02-20T10:00:00.000Z',
  quickAdd: {
    time: '10:00',
    class: 'Noon class',
    gym: 'Main',
    partners: [],
    rounds: 5,
    notes: ''
  },
  structured: {
    problem: 'I lose elbow-knee connection in knee shield and get flattened.'
  },
  tags: [],
  sections: {
    private: '',
    shared: 'I kept failing the same knee shield retention sequence when pressured.'
  },
  sessionMetrics: {
    durationMinutes: 60,
    intensity: 7,
    rounds: 5,
    giOrNoGi: 'gi',
    tags: []
  },
  rawTechniqueMentions: [],
  ...overrides
});

describe('coachQuestions signal extraction', () => {
  it('prioritizes repeated failure and decision point signals', () => {
    const entries: Entry[] = [
      buildEntry({
        entryId: 'entry-1',
        createdAt: '2026-02-20T10:00:00.000Z',
        updatedAt: '2026-02-20T10:00:00.000Z',
        structured: {
          problem: 'I lose elbow-knee connection in knee shield and get flattened.',
          cue: 'When they staple my top knee, I must frame first before hip escape.'
        }
      }),
      buildEntry({
        entryId: 'entry-2',
        createdAt: '2026-02-24T10:00:00.000Z',
        updatedAt: '2026-02-24T10:00:00.000Z',
        structured: {
          problem: 'I lose elbow-knee connection in knee shield and get flattened.'
        },
        actionPackFinal: {
          finalizedAt: '2026-02-24T10:00:00.000Z',
          actionPack: {
            wins: [],
            leaks: ['I lose elbow-knee connection in knee shield and get flattened.'],
            oneFocus: 'Frame before hip escape',
            drills: [],
            positionalRequests: [],
            fallbackDecisionGuidance: 'If pressure spikes, frame then hip escape before re-guard.',
            confidenceFlags: []
          }
        }
      })
    ];

    const signals = extractCoachSignals(entries);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]?.signalType).toBe('repeated_failure');
    expect(signals.some((item) => item.signalType === 'decision_point')).toBe(true);
  });
});

describe('coachQuestions quality guardrails', () => {
  it('detects duplicates and scores non-duplicative questions higher', () => {
    const duplicate = hasDuplicateQuestions([
      'What cue will you test next round to keep your elbow-knee connection?',
      'What cue will you test next round to keep elbow-knee connection?'
    ]);
    expect(duplicate).toBe(true);

    const rubric = scoreCoachQuestion(
      {
        text: 'What cue will you test in your next two rounds to keep elbow-knee connection under pressure?',
        signalType: 'repeated_failure',
        issueKey: 'elbow-knee-connection',
        confidence: 'high',
        evidence: [
          {
            entryId: 'entry-1',
            createdAt: '2026-02-20T10:00:00.000Z',
            signalType: 'repeated_failure',
            excerpt: 'I lose elbow-knee connection in knee shield and get flattened.'
          }
        ]
      },
      ['What drill will you run to improve mount escapes next session?']
    );

    expect(rubric.total).toBeGreaterThanOrEqual(70);
    expect(rubric.nonDuplicative).toBe(5);
  });

  it('returns exactly three questions when model output is unavailable', async () => {
    mockGetOpenAIApiKey.mockResolvedValue('test-key');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

    const questionSet = await generateCoachQuestionSet({
      athleteId: 'athlete-1',
      entries: [
        buildEntry({ entryId: 'entry-1' }),
        buildEntry({
          entryId: 'entry-2',
          createdAt: '2026-02-22T10:00:00.000Z',
          updatedAt: '2026-02-22T10:00:00.000Z',
          sections: {
            private: '',
            shared: 'I hesitate on the first pass and need a trigger for crossface pressure.'
          }
        })
      ],
      nowIso: '2026-03-01T12:00:00.000Z',
      generatedBy: 'athlete-1',
      generatedByRole: 'athlete',
      generationReason: 'initial'
    });

    expect(questionSet.questions).toHaveLength(3);
    expect(questionSet.questions.every((question) => question.evidence.length >= 0)).toBe(true);

    fetchMock.mockRestore();
  });
});

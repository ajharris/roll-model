import type { GetCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { getItem, putItem } from '../../shared/db';

import { handler } from './index';

jest.mock('../../shared/db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

const buildEvent = (
  role: 'athlete' | 'coach',
  options: {
    athleteId?: string;
    body?: Record<string, unknown>;
  } = {}
): APIGatewayProxyEvent =>
  ({
    pathParameters: {
      questionSetId: 'set-1',
      ...(options.athleteId ? { athleteId: options.athleteId } : {})
    },
    body: JSON.stringify(options.body ?? {}),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const questionSetRow = {
  PK: 'USER#athlete-1',
  SK: 'COACH_QUESTION_SET#2026-03-01T10:00:00.000Z#set-1',
  entityType: 'COACH_QUESTION_SET',
  questionSetId: 'set-1',
  athleteId: 'athlete-1',
  generatedAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  sourceEntryIds: ['entry-1'],
  generationReason: 'initial',
  generatedBy: 'athlete-1',
  generatedByRole: 'athlete',
  model: 'gpt-4.1-mini',
  promptVersion: 1,
  qualitySummary: {
    averageScore: 84,
    minScore: 80,
    hasDuplicates: false,
    lowConfidenceCount: 0
  },
  questions: [
    {
      questionId: 'q-1',
      text: 'What cue will you test next round to stop losing inside elbow position?',
      priority: 1,
      signalType: 'repeated_failure',
      issueKey: 'inside-elbow-position',
      confidence: 'high',
      evidence: [
        {
          entryId: 'entry-1',
          createdAt: '2026-02-25T10:00:00.000Z',
          signalType: 'repeated_failure',
          excerpt: 'I kept losing inside elbow position when passing half guard.'
        }
      ],
      rubric: {
        specific: 5,
        testable: 5,
        coachActionable: 5,
        evidenceBacked: 5,
        nonDuplicative: 5,
        total: 100,
        needsRevision: false,
        notes: []
      }
    }
  ]
};

describe('updateCoachQuestions handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
  });

  it('allows a linked coach to edit question wording and note', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'COACH_QUESTION_SET#set-1',
          SK: 'META',
          entityType: 'COACH_QUESTION_META',
          athleteId: 'athlete-1',
          generatedAt: '2026-03-01T10:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#athlete-1',
          SK: 'COACH#coach-1',
          status: 'active'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({ Item: questionSetRow } as unknown as GetCommandOutput);

    const result = (await handler(
      buildEvent('coach', {
        body: {
          questionEdits: [
            {
              questionId: 'q-1',
              text: 'What exact frame cue will you test first in your next two rounds to keep inside elbow position?'
            }
          ],
          coachNote: 'Focus discussion on decision trigger and first contact.'
        }
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { questionSet: { coachNote?: string; questions: Array<{ coachEditedText?: string }> } };
    expect(body.questionSet.coachNote).toContain('Focus discussion');
    expect(body.questionSet.questions[0]?.coachEditedText).toContain('exact frame cue');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  it('allows athlete response updates but blocks question text edits', async () => {
    mockGetItem
      .mockResolvedValueOnce({
        Item: {
          PK: 'COACH_QUESTION_SET#set-1',
          SK: 'META',
          entityType: 'COACH_QUESTION_META',
          athleteId: 'athlete-1',
          generatedAt: '2026-03-01T10:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({ Item: questionSetRow } as unknown as GetCommandOutput);

    const responseResult = (await handler(
      buildEvent('athlete', {
        body: {
          responses: [{ questionId: 'q-1', response: 'I will frame before hip escape and track success over two rounds.' }]
        }
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(responseResult.statusCode).toBe(200);

    mockGetItem
      .mockReset()
      .mockResolvedValueOnce({
        Item: {
          PK: 'COACH_QUESTION_SET#set-1',
          SK: 'META',
          entityType: 'COACH_QUESTION_META',
          athleteId: 'athlete-1',
          generatedAt: '2026-03-01T10:00:00.000Z'
        }
      } as unknown as GetCommandOutput)
      .mockResolvedValueOnce({ Item: questionSetRow } as unknown as GetCommandOutput);

    const editResult = (await handler(
      buildEvent('athlete', {
        body: {
          questionEdits: [{ questionId: 'q-1', text: 'Edited by athlete should not be allowed.' }]
        }
      }),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(editResult.statusCode).toBe(403);
  });
});

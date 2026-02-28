const sendMock = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({
    send: sendMock
  })),
  GetParameterCommand: jest.fn().mockImplementation((input) => input)
}));

import { getOpenAIApiKey, isAIExtractedUpdates, resetOpenAIApiKeyCache } from './openai';

describe('openai key loading', () => {
  beforeEach(() => {
    sendMock.mockReset();
    resetOpenAIApiKeyCache();
  });

  it('fetches SSM parameter and caches it', async () => {
    sendMock.mockResolvedValue({ Parameter: { Value: 'secret-key' } });

    const first = await getOpenAIApiKey();
    const second = await getOpenAIApiKey();

    expect(first).toBe('secret-key');
    expect(second).toBe('secret-key');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe('isAIExtractedUpdates', () => {
  it('accepts optional structured session review payload', () => {
    expect(
      isAIExtractedUpdates({
        summary: 'Summary',
        actionPack: {
          wins: ['Win'],
          leaks: ['Leak'],
          oneFocus: 'One focus',
          drills: ['Drill'],
          positionalRequests: ['Request'],
          fallbackDecisionGuidance: 'Fallback',
          confidenceFlags: [{ field: 'wins', confidence: 'high' }],
        },
        sessionReview: {
          promptSet: {
            whatWorked: ['Worked'],
            whatFailed: ['Failed'],
            whatToAskCoach: ['Ask'],
            whatToDrillSolo: ['Drill solo'],
          },
          oneThing: 'One thing.',
          confidenceFlags: [{ field: 'oneThing', confidence: 'medium' }],
        },
        suggestedFollowUpQuestions: ['Question'],
      })
    ).toBe(true);
  });
});

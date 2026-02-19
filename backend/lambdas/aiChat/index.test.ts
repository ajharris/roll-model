import { putItem } from '../../shared/db';
import { resetOpenAIApiKeyCache } from '../../shared/openai';
import type { Entry } from '../../shared/types';

import { buildPromptContext, sanitizeContext, storeMessage } from './index';

jest.mock('../../shared/db', () => ({
  putItem: jest.fn(),
  getItem: jest.fn(),
  queryItems: jest.fn()
}));

describe('aiChat context/privacy', () => {
  it('athlete can include private notes when requested', () => {
    const ctx = sanitizeContext('athlete', 'athlete-1', { includePrivate: true });
    expect(ctx).toEqual({
      athleteId: 'athlete-1',
      includePrivate: true,
      entryIds: undefined,
      from: undefined,
      to: undefined,
      keywords: []
    });

    const entries: Entry[] = [
      {
        entryId: 'e1',
        athleteId: 'athlete-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sections: { private: 'private text', shared: 'shared text' },
        sessionMetrics: {
          durationMinutes: 60,
          intensity: 7,
          rounds: 5,
          giOrNoGi: 'gi',
          tags: []
        }
      }
    ];

    const prompt = JSON.parse(buildPromptContext(entries, true)) as Array<{
      sections: { private?: string; shared: string };
    }>;
    expect(prompt[0].sections.private).toBe('private text');
  });

  it('coach cannot access private notes', () => {
    const ctx = sanitizeContext('coach', 'coach-1', {
      athleteId: 'athlete-9',
      includePrivate: true
    });

    expect(ctx.includePrivate).toBe(false);
    expect(ctx.athleteId).toBe('athlete-9');
  });
});

describe('aiChat storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenAIApiKeyCache();
  });

  it('stores messages in required AI_MESSAGE format', async () => {
    await storeMessage({
      messageId: 'msg-1',
      threadId: 'thread-1',
      role: 'user',
      content: 'hello',
      visibilityScope: 'shared',
      createdAt: '2026-01-02T00:00:00.000Z'
    });

    expect(putItem).toHaveBeenCalledWith({
      Item: {
        PK: 'AI_THREAD#thread-1',
        SK: 'MSG#2026-01-02T00:00:00.000Z#msg-1',
        entityType: 'AI_MESSAGE',
        messageId: 'msg-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'hello',
        visibilityScope: 'shared',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    });
  });
});

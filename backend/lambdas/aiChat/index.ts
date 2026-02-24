import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem, queryItems } from '../../shared/db';
import { normalizeToken, tokenizeText } from '../../shared/keywords';
import { isCoachLinkActive } from '../../shared/links';
import { callOpenAI } from '../../shared/openai';
import { ApiError, errorResponse, response } from '../../shared/responses';
import { batchGetEntries, queryKeywordMatches, rankKeywordMatches } from '../../shared/retrieval';
import type {
  AIChatContext,
  AIChatRequest,
  AIMessage,
  AIThread,
  Entry,
  UserRole
} from '../../shared/types';

interface SanitizedContext {
  athleteId: string;
  includePrivate: boolean;
  entryIds?: string[];
  from?: string;
  to?: string;
  keywords: string[];
}

const DEFAULT_ENTRY_LIMIT = 10;
const KEYWORD_MATCH_LIMIT = 10;
const DEFAULT_THREAD_MESSAGE_LIMIT = 20;

const parseBody = (body: string | null): AIChatRequest => {
  if (!body) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body is required.', statusCode: 400 });
  }

  const parsed = JSON.parse(body) as Partial<AIChatRequest>;
  if (typeof parsed.message !== 'string' || parsed.message.trim().length === 0) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'message is required.', statusCode: 400 });
  }

  return parsed as AIChatRequest;
};

export const sanitizeContext = (
  role: UserRole,
  userId: string,
  context: AIChatContext | undefined
): SanitizedContext => {
  const includePrivate = role === 'athlete' ? Boolean(context?.includePrivate) : false;

  if (role === 'coach') {
    if (!context?.athleteId) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: 'Coach requests must include context.athleteId.',
        statusCode: 400
      });
    }

    return {
      athleteId: context.athleteId,
      includePrivate,
      entryIds: context.entryIds,
      from: context.dateRange?.from,
      to: context.dateRange?.to,
      keywords: context.keywords ?? []
    };
  }

  return {
    athleteId: userId,
    includePrivate,
    entryIds: context?.entryIds,
    from: context?.dateRange?.from,
    to: context?.dateRange?.to,
    keywords: context?.keywords ?? []
  };
};

const ensureCoachLink = async (coachId: string, athleteId: string): Promise<void> => {
  const link = await getItem({
    Key: {
      PK: `USER#${athleteId}`,
      SK: `COACH#${coachId}`
    }
  });

  if (!isCoachLinkActive(link.Item)) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: 'Coach is not linked to this athlete.',
      statusCode: 403
    });
  }
};

const getRecentEntries = async (athleteId: string, limit: number): Promise<Entry[]> => {
  const queryResult = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':entryPrefix': 'ENTRY#'
    },
    ScanIndexForward: false,
    Limit: limit
  });

  const items = (queryResult.Items ?? []) as Array<Entry & { entityType: string; PK: string; SK: string }>;

  return items
    .filter((item) => item.entityType === 'ENTRY')
    .map((item) => {
      const { PK: _pk, SK: _sk, entityType: _entityType, ...entry } = item;
      void _pk;
      void _sk;
      void _entityType;
      return entry;
    });
};

const applyContextFilters = (entries: Entry[], context: SanitizedContext): Entry[] => {
  return entries
    .filter((entry) => !context.entryIds || context.entryIds.includes(entry.entryId))
    .filter((entry) => !context.from || entry.createdAt >= context.from)
    .filter((entry) => !context.to || entry.createdAt <= context.to);
};

const getKeywordDrivenEntries = async (context: SanitizedContext): Promise<Entry[]> => {
  const tokens = [...new Set(context.keywords.flatMap((keyword) => tokenizeText(keyword).map(normalizeToken)))].slice(
    0,
    8
  );
  if (tokens.length === 0) {
    return [];
  }

  const scopes: Array<'shared' | 'private'> = context.includePrivate ? ['shared', 'private'] : ['shared'];
  const matches = await Promise.all(
    tokens.flatMap((token) =>
      scopes.map((scope) => queryKeywordMatches(context.athleteId, token, 5, { visibilityScope: scope }))
    )
  );

  const sortedIds = rankKeywordMatches(matches, KEYWORD_MATCH_LIMIT);
  return batchGetEntries(sortedIds);
};

export const buildPromptContext = (entries: Entry[], includePrivate: boolean): string => {
  // OPENAI_TWEAK_POINT: Change what training/context data gets sent to the model here.
  return JSON.stringify(
    entries.map((entry) => ({
      entryId: entry.entryId,
      createdAt: entry.createdAt,
      sections: includePrivate
        ? { private: entry.sections.private, shared: entry.sections.shared }
        : { shared: entry.sections.shared },
      sessionMetrics: entry.sessionMetrics
    }))
  );
};

const buildSystemPrompt = (): string =>
  // OPENAI_TWEAK_POINT: Tune system instructions and output contract here.
  [
    'You are Roll Model AI, a scientific, coach-like, practical grappling training assistant.',
    'You must respond as strict JSON only with this exact shape:',
    '{"text": string, "extracted_updates": {"summary": string, "detectedTopics": string[], "recommendedIntensity"?: number, "followUpActions": string[]}, "suggested_prompts": string[] }',
    'Do not include markdown. Do not include additional keys.'
  ].join(' ');

const createThread = async (userId: string, nowIso: string): Promise<AIThread> => {
  const thread: AIThread = {
    threadId: uuidv4(),
    title: 'Training Reflection',
    createdAt: nowIso,
    lastActiveAt: nowIso
  };

  await putItem({
    Item: {
      PK: `USER#${userId}`,
      SK: `AI_THREAD#${thread.threadId}`,
      entityType: 'AI_THREAD',
      ...thread
    }
  });

  return thread;
};

const touchThread = async (userId: string, threadId: string, nowIso: string): Promise<void> => {
  const existing = await getItem({
    Key: {
      PK: `USER#${userId}`,
      SK: `AI_THREAD#${threadId}`
    }
  });

  if (!existing.Item) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'Thread not found.', statusCode: 404 });
  }

  const title = typeof existing.Item.title === 'string' ? existing.Item.title : 'Training Reflection';
  const createdAt =
    typeof existing.Item.createdAt === 'string' ? existing.Item.createdAt : new Date().toISOString();

  await putItem({
    Item: {
      PK: `USER#${userId}`,
      SK: `AI_THREAD#${threadId}`,
      entityType: 'AI_THREAD',
      threadId,
      title,
      createdAt,
      lastActiveAt: nowIso
    }
  });
};

const getRecentThreadMessages = async (threadId: string): Promise<AIMessage[]> => {
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msgPrefix)',
    ExpressionAttributeValues: {
      ':pk': `AI_THREAD#${threadId}`,
      ':msgPrefix': 'MSG#'
    },
    ScanIndexForward: false,
    Limit: DEFAULT_THREAD_MESSAGE_LIMIT
  });

  const items = (result.Items ?? []) as Array<AIMessage & { PK: string; SK: string; entityType: string }>;
  return items
    .filter((item) => item.entityType === 'AI_MESSAGE')
    .map((item) => {
      const { PK: _pk, SK: _sk, entityType: _entityType, ...msg } = item;
      void _pk;
      void _sk;
      void _entityType;
      return msg;
    })
    .reverse();
};

export const storeMessage = async (message: AIMessage): Promise<void> => {
  await putItem({
    Item: {
      PK: `AI_THREAD#${message.threadId}`,
      SK: `MSG#${message.createdAt}#${message.messageId}`,
      entityType: 'AI_MESSAGE',
      ...message
    }
  });
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const req = parseBody(event.body);
    const sanitized = sanitizeContext(auth.role, auth.userId, req.context);

    if (auth.role === 'coach') {
      await ensureCoachLink(auth.userId, sanitized.athleteId);
    }

    const nowIso = new Date().toISOString();
    const threadId = req.threadId ?? (await createThread(auth.userId, nowIso)).threadId;
    if (req.threadId) {
      await touchThread(auth.userId, req.threadId, nowIso);
    }

    const visibilityScope = sanitized.includePrivate ? 'private' : 'shared';

    await storeMessage({
      messageId: uuidv4(),
      threadId,
      role: 'user',
      content: req.message,
      visibilityScope,
      createdAt: nowIso
    });

    const threadMessages = await getRecentThreadMessages(threadId);
    const recentEntries = await getRecentEntries(sanitized.athleteId, DEFAULT_ENTRY_LIMIT);
    const keywordEntries = sanitized.keywords.length > 0 ? await getKeywordDrivenEntries(sanitized) : [];

    const filteredRecent = applyContextFilters(recentEntries, sanitized).slice(0, DEFAULT_ENTRY_LIMIT);
    const filteredKeyword = applyContextFilters(keywordEntries, sanitized).filter(
      (entry) => !filteredRecent.some((recent) => recent.entryId === entry.entryId)
    );

    const entries = [...filteredRecent, ...filteredKeyword];
    const promptContext = buildPromptContext(entries, sanitized.includePrivate);

    const historyText = threadMessages
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n');

    // OPENAI_TWEAK_POINT: Change how messages/history are assembled before sending to OpenAI.
    const aiPayload = await callOpenAI([
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: `Conversation history:\n${historyText}\nAthlete context data: ${promptContext}. User message: ${req.message}`
      }
    ]);

    await storeMessage({
      messageId: uuidv4(),
      threadId,
      role: 'assistant',
      content: aiPayload.text,
      visibilityScope,
      createdAt: new Date().toISOString()
    });

    return response(200, {
      threadId,
      assistant_text: aiPayload.text,
      extracted_updates: aiPayload.extracted_updates,
      suggested_prompts: aiPayload.suggested_prompts
    });
  } catch (error) {
    return errorResponse(error);
  }
};

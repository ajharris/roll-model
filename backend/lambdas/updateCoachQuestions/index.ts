import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from '../../shared/auth';
import { parseCoachQuestionSetUpdatePayload } from '../../shared/coachQuestionPayload';
import {
  buildCoachQuestionMetaPk,
  buildCoachQuestionSetRecord,
  buildCoachQuestionSetSk,
  hasDuplicateQuestions,
  parseCoachQuestionSetRecord,
  scoreCoachQuestion
} from '../../shared/coachQuestions';
import { getItem, putItem } from '../../shared/db';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { CoachQuestionSet } from '../../shared/types';

const getQuestionSetId = (questionSetId?: string): string => {
  if (typeof questionSetId === 'string' && questionSetId.trim()) {
    return questionSetId.trim();
  }

  throw new ApiError({
    code: 'INVALID_REQUEST',
    message: 'questionSetId is required.',
    statusCode: 400
  });
};

const recalculateQuality = (set: CoachQuestionSet): CoachQuestionSet => {
  const questionTexts = set.questions.map((question) => question.coachEditedText ?? question.text);

  const updatedQuestions = set.questions.map((question, index) => {
    const effectiveQuestion = {
      ...question,
      text: question.coachEditedText ?? question.text
    };

    const siblings = questionTexts.filter((_, siblingIndex) => siblingIndex !== index);
    return {
      ...question,
      rubric: scoreCoachQuestion(effectiveQuestion, siblings)
    };
  });

  const totals = updatedQuestions.map((question) => question.rubric.total);
  const averageScore = totals.length > 0 ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length) : 0;
  const minScore = totals.length > 0 ? Math.min(...totals) : 0;

  return {
    ...set,
    questions: updatedQuestions,
    qualitySummary: {
      averageScore,
      minScore,
      hasDuplicates: hasDuplicateQuestions(questionTexts),
      lowConfidenceCount: updatedQuestions.filter((question) => question.confidence === 'low').length
    }
  };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach']);

    const questionSetId = getQuestionSetId(event.pathParameters?.questionSetId);
    const payload = parseCoachQuestionSetUpdatePayload(event);

    const metaResult = await getItem({
      Key: {
        PK: buildCoachQuestionMetaPk(questionSetId),
        SK: 'META'
      }
    });

    if (
      !metaResult.Item ||
      typeof metaResult.Item.athleteId !== 'string' ||
      typeof metaResult.Item.generatedAt !== 'string'
    ) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Coach question set not found.',
        statusCode: 404
      });
    }

    const athleteId = metaResult.Item.athleteId;
    const coachMode = athleteId !== auth.userId;

    if (coachMode) {
      if (!hasRole(auth, 'coach')) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'User does not have permission for this athlete.',
          statusCode: 403
        });
      }

      const link = await getItem({
        Key: {
          PK: `USER#${athleteId}`,
          SK: `COACH#${auth.userId}`
        }
      });

      if (!isCoachLinkActive(link.Item)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403
        });
      }
    }

    const setResult = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: buildCoachQuestionSetSk(metaResult.Item.generatedAt, questionSetId)
      }
    });

    const questionSet = parseCoachQuestionSetRecord((setResult.Item ?? {}) as Record<string, unknown>);
    if (!questionSet) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Coach question set not found.',
        statusCode: 404
      });
    }

    if ((payload.questionEdits || payload.coachNote !== undefined) && !hasRole(auth, 'coach')) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Only coaches can edit generated questions.',
        statusCode: 403
      });
    }

    const questionEdits = new Map((payload.questionEdits ?? []).map((item) => [item.questionId, item.text]));
    const responses = new Map((payload.responses ?? []).map((item) => [item.questionId, item.response]));

    const nowIso = new Date().toISOString();
    const updated: CoachQuestionSet = {
      ...questionSet,
      updatedAt: nowIso,
      questions: questionSet.questions.map((question) => ({
        ...question,
        ...(questionEdits.has(question.questionId) ? { coachEditedText: questionEdits.get(question.questionId)! } : {}),
        ...(responses.has(question.questionId) ? { athleteResponse: responses.get(question.questionId)! } : {})
      })),
      ...(payload.coachNote !== undefined ? { coachNote: payload.coachNote } : {}),
      ...(payload.questionEdits || payload.coachNote !== undefined
        ? {
            coachEditedAt: nowIso,
            coachEditedBy: auth.userId
          }
        : {})
    };

    const rescored = recalculateQuality(updated);

    await putItem({
      Item: buildCoachQuestionSetRecord(rescored)
    });

    return response(200, { questionSet: rescored });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('updateCoachQuestions', baseHandler);

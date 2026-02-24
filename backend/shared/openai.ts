import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { ApiError } from './responses';
import type { AIExtractedUpdates } from './types';

const ssmClient = new SSMClient({});
const PARAMETER_NAME = '/roll-model/openai_api_key';
let cachedApiKey: string | null = null;

interface OpenAIMessage {
  role: 'system' | 'user';
  content: string;
}

interface OpenAIResponsePayload {
  text: string;
  extracted_updates: AIExtractedUpdates;
  suggested_prompts: string[];
}

export const isAIExtractedUpdates = (value: unknown): value is AIExtractedUpdates => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybe = value as Partial<AIExtractedUpdates>;
  const recommendedOk =
    maybe.recommendedIntensity === undefined || typeof maybe.recommendedIntensity === 'number';

  return (
    typeof maybe.summary === 'string' &&
    Array.isArray(maybe.detectedTopics) &&
    maybe.detectedTopics.every((topic) => typeof topic === 'string') &&
    recommendedOk &&
    Array.isArray(maybe.followUpActions) &&
    maybe.followUpActions.every((action) => typeof action === 'string')
  );
};

export const getOpenAIApiKey = async (): Promise<string> => {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: PARAMETER_NAME,
      WithDecryption: true
    })
  );

  const value = result.Parameter?.Value;
  if (!value) {
    throw new ApiError({
      code: 'CONFIGURATION_ERROR',
      message: 'OpenAI API key is not configured.',
      statusCode: 500
    });
  }

  cachedApiKey = value;
  return value;
};

export const resetOpenAIApiKeyCache = (): void => {
  cachedApiKey = null;
};

export const callOpenAI = async (messages: OpenAIMessage[]): Promise<OpenAIResponsePayload> => {
  const apiKey = await getOpenAIApiKey();

  // OPENAI_TWEAK_POINT: Adjust endpoint, headers, model, and request payload here.
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: messages.map((message) => ({
        role: message.role,
        content: [{ type: 'input_text', text: message.content }]
      }))
    })
  });

  if (!response.ok) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'Failed to generate assistant response.',
      statusCode: 502
    });
  }

  // OPENAI_TWEAK_POINT: Update parsing/validation here if response format changes.
  const raw = (await response.json()) as {
    output_text?: string;
  };

  const outputText = raw.output_text;
  if (!outputText) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'AI provider returned an empty response.',
      statusCode: 502
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'AI provider response could not be parsed.',
      statusCode: 502
    });
  }

  const payload = parsed as Partial<OpenAIResponsePayload>;
  if (
    typeof payload.text !== 'string' ||
    !isAIExtractedUpdates(payload.extracted_updates) ||
    !Array.isArray(payload.suggested_prompts) ||
    !payload.suggested_prompts.every((prompt) => typeof prompt === 'string')
  ) {
    throw new ApiError({
      code: 'AI_PROVIDER_ERROR',
      message: 'AI response format was invalid.',
      statusCode: 502
    });
  }

  return {
    text: payload.text,
    extracted_updates: payload.extracted_updates,
    suggested_prompts: payload.suggested_prompts
  };
};

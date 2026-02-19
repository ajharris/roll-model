const sendMock = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({
    send: sendMock
  })),
  GetParameterCommand: jest.fn().mockImplementation((input) => input)
}));

import { getOpenAIApiKey, resetOpenAIApiKeyCache } from './openai';

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

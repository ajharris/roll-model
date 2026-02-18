import {
  DynamoDBClient,
  type DynamoDBClientConfig
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  type GetCommandInput,
  type GetCommandOutput,
  PutCommand,
  type PutCommandInput,
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput
} from '@aws-sdk/lib-dynamodb';

const createDocumentClient = (): DynamoDBDocumentClient => {
  const config: DynamoDBClientConfig = {};
  const client = new DynamoDBClient(config);
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });
};

const documentClient = createDocumentClient();

export const TABLE_NAME = process.env.TABLE_NAME ?? 'RollModel';

export const putItem = async (input: Omit<PutCommandInput, 'TableName'>): Promise<void> => {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      ...input
    })
  );
};

export const queryItems = async (
  input: Omit<QueryCommandInput, 'TableName'>
): Promise<QueryCommandOutput> => {
  return documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      ...input
    })
  );
};

export const getItem = async (input: Omit<GetCommandInput, 'TableName'>): Promise<GetCommandOutput> => {
  return documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      ...input
    })
  );
};

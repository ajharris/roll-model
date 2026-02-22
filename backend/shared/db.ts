import {
  DynamoDBClient,
  type DynamoDBClientConfig
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  type BatchWriteCommandInput,
  DeleteCommand,
  type DeleteCommandInput,
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

export const batchWriteItems = async (items: Array<Record<string, unknown>>): Promise<void> => {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const input: BatchWriteCommandInput = {
      RequestItems: {
        [TABLE_NAME]: chunk.map((Item) => ({ PutRequest: { Item } }))
      }
    };

    await documentClient.send(new BatchWriteCommand(input));
  }
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

export const deleteItem = async (input: Omit<DeleteCommandInput, 'TableName'>): Promise<void> => {
  await documentClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      ...input
    })
  );
};

import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

type Args = {
  userId?: string;
  email?: string;
  cognitoUsername?: string;
  userPoolId?: string;
  tableName: string;
  region: string;
  apply: boolean;
  skipCognito: boolean;
};

type Key = {
  PK: string;
  SK: string;
};

type IndexedItem = Key & {
  entityType?: string;
};

type CognitoAttribute = {
  Name?: string;
  Value?: string;
};

type CognitoUser = {
  Username?: string;
  Attributes?: CognitoAttribute[];
};

const parseArgs = (argv: string[]): Args => {
  const defaults: Args = {
    tableName: process.env.TABLE_NAME?.trim() || 'RollModel',
    region:
      process.env.AWS_REGION?.trim() ||
      process.env.CDK_DEFAULT_REGION?.trim() ||
      process.env.AWS_DEFAULT_REGION?.trim() ||
      'us-east-1',
    apply: false,
    skipCognito: false,
  };

  const args = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--user-id' && next) {
      args.userId = next.trim();
      index += 1;
      continue;
    }
    if (token === '--email' && next) {
      args.email = next.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (token === '--cognito-username' && next) {
      args.cognitoUsername = next.trim();
      index += 1;
      continue;
    }
    if (token === '--user-pool-id' && next) {
      args.userPoolId = next.trim();
      index += 1;
      continue;
    }
    if (token === '--table-name' && next) {
      args.tableName = next.trim();
      index += 1;
      continue;
    }
    if (token === '--region' && next) {
      args.region = next.trim();
      index += 1;
      continue;
    }
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--skip-cognito') {
      args.skipCognito = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.userId && !args.email) {
    throw new Error('Provide either --user-id or --email.');
  }

  if (!args.skipCognito && !args.userPoolId) {
    throw new Error('Provide --user-pool-id unless using --skip-cognito.');
  }

  return args;
};

const printHelp = (): void => {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx ts-node --prefer-ts-exts scripts/delete-user.ts [options]

Required:
  --user-id <sub>              App/Cognito user sub
  or
  --email <email>              Resolve Cognito user by email

Cognito:
  --user-pool-id <pool-id>     Required unless --skip-cognito
  --cognito-username <name>    Optional explicit Cognito username override
  --skip-cognito               Only purge DynamoDB data

Execution:
  --apply                      Execute deletions (default is dry-run)
  --table-name <name>          DynamoDB table (default: TABLE_NAME or RollModel)
  --region <aws-region>        AWS region (default: AWS_REGION/CDK_DEFAULT_REGION/us-east-1)
  --help                       Show this help

Examples:
  npx ts-node --prefer-ts-exts scripts/delete-user.ts --email athlete@example.com --user-pool-id us-east-1_abc123
  npx ts-node --prefer-ts-exts scripts/delete-user.ts --user-id 1234-uuid --user-pool-id us-east-1_abc123 --apply
`);
};

const getAttr = (user: CognitoUser, name: string): string | undefined =>
  user.Attributes?.find((attribute) => attribute.Name === name)?.Value;

const runAwsCliJson = (region: string, args: string[]): Record<string, unknown> => {
  const stdout = execFileSync('aws', [...args, '--region', region, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout) as Record<string, unknown>;
};

const runAwsCliNoOutput = (region: string, args: string[]): void => {
  execFileSync('aws', [...args, '--region', region], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};

const resolveCognitoUserByEmail = async (
  region: string,
  userPoolId: string,
  email: string,
): Promise<CognitoUser> => {
  const users: CognitoUser[] = [];
  let paginationToken: string | undefined;
  do {
    const page = runAwsCliJson(region, [
      'cognito-idp',
      'list-users',
      '--user-pool-id',
      userPoolId,
      '--filter',
      `email = "${email}"`,
      ...(paginationToken ? ['--pagination-token', paginationToken] : []),
    ]);
    const pageUsers = Array.isArray(page.Users) ? (page.Users as CognitoUser[]) : [];
    users.push(...pageUsers);
    paginationToken = typeof page.PaginationToken === 'string' ? page.PaginationToken : undefined;
  } while (paginationToken);

  if (users.length === 0) {
    throw new Error(`No Cognito user found for email "${email}".`);
  }
  if (users.length > 1) {
    throw new Error(`Multiple Cognito users found for email "${email}". Provide --cognito-username or --user-id.`);
  }
  return users[0];
};

const addKey = (keys: Map<string, IndexedItem>, item: IndexedItem): void => {
  if (typeof item.PK !== 'string' || typeof item.SK !== 'string') {
    return;
  }
  keys.set(`${item.PK}|||${item.SK}`, { PK: item.PK, SK: item.SK, entityType: item.entityType });
};

const queryAll = async (
  docClient: DynamoDBDocumentClient,
  tableName: string,
  input: Omit<QueryCommandInput, 'TableName'>,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
};

const scanAll = async (
  docClient: DynamoDBDocumentClient,
  tableName: string,
  input: Omit<ScanCommandInput, 'TableName'>,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ...input,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const collectKeysForUser = async (
  docClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<Map<string, IndexedItem>> => {
  const keys = new Map<string, IndexedItem>();

  const userItems = await queryAll(docClient, tableName, {
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
    },
  });
  for (const item of userItems) {
    addKey(keys, item as IndexedItem);
  }

  const privateItems = await queryAll(docClient, tableName, {
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `USER_PRIVATE#${userId}`,
    },
  });
  for (const item of privateItems) {
    addKey(keys, item as IndexedItem);
  }

  const entryIds = new Set<string>();
  const threadIds = new Set<string>();
  const shareTokenHashes = new Set<string>();
  const weeklyPlanIds = new Set<string>();

  for (const item of userItems) {
    const record = item as Record<string, unknown>;
    if (typeof record.entryId === 'string' && record.entityType === 'ENTRY') {
      entryIds.add(record.entryId);
    }
    if (typeof record.threadId === 'string' && record.entityType === 'AI_THREAD') {
      threadIds.add(record.threadId);
    }
    if (typeof record.tokenHash === 'string' && record.entityType === 'SHARE_LINK') {
      shareTokenHashes.add(record.tokenHash);
    }
    if (typeof record.planId === 'string' && record.entityType === 'WEEKLY_PLAN') {
      weeklyPlanIds.add(record.planId);
    }
  }

  for (const entryId of entryIds) {
    addKey(keys, { PK: `ENTRY#${entryId}`, SK: 'META', entityType: 'ENTRY_META' });
    const entryScoped = await queryAll(docClient, tableName, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `ENTRY#${entryId}`,
      },
    });
    for (const item of entryScoped) {
      addKey(keys, item as IndexedItem);
      const record = item as Record<string, unknown>;
      if (typeof record.commentId === 'string') {
        addKey(keys, { PK: `COMMENT#${record.commentId}`, SK: 'META', entityType: 'COMMENT_META' });
      }
    }
  }

  for (const threadId of threadIds) {
    const threadMessages = await queryAll(docClient, tableName, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `AI_THREAD#${threadId}`,
      },
    });
    for (const item of threadMessages) {
      addKey(keys, item as IndexedItem);
    }
  }

  for (const tokenHash of shareTokenHashes) {
    addKey(keys, { PK: `SHARE_TOKEN#${tokenHash}`, SK: 'META', entityType: 'SHARE_TOKEN_MAP' });
  }

  for (const planId of weeklyPlanIds) {
    addKey(keys, { PK: `WEEKLY_PLAN#${planId}`, SK: 'META', entityType: 'WEEKLY_PLAN_META' });
  }

  // Catch globally keyed rows tied to this athlete.
  const athleteScanRows = await scanAll(docClient, tableName, {
    FilterExpression: 'athleteId = :userId OR userId = :userId OR SK = :athleteSk',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':athleteSk': `ATHLETE#${userId}`,
    },
    ProjectionExpression: 'PK, SK, entityType',
  });
  for (const item of athleteScanRows) {
    addKey(keys, item as IndexedItem);
  }

  return keys;
};

const deleteKeys = async (
  docClient: DynamoDBDocumentClient,
  tableName: string,
  keys: Key[],
): Promise<void> => {
  for (const batch of chunk(keys, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((key) => ({ DeleteRequest: { Key: key } })),
        },
      }),
    );
  }
};

const run = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  let cognitoUsername = args.cognitoUsername;
  let userId = args.userId;

  if (!args.skipCognito && args.email) {
    const user = await resolveCognitoUserByEmail(args.region, args.userPoolId!, args.email);
    cognitoUsername = user.Username;
    userId = userId ?? getAttr(user, 'sub');
  }

  if (!userId) {
    throw new Error('Unable to resolve userId. Provide --user-id or a resolvable --email.');
  }

  const keys = await collectKeysForUser(docClient, args.tableName, userId);
  const keyList = [...keys.values()].map((item) => ({ PK: item.PK, SK: item.SK }));

  const entityCounts = [...keys.values()].reduce<Record<string, number>>((acc, item) => {
    const entity = item.entityType ?? 'unknown';
    acc[entity] = (acc[entity] ?? 0) + 1;
    return acc;
  }, {});

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        region: args.region,
        tableName: args.tableName,
        userId,
        cognitoUsername: cognitoUsername ?? null,
        cognitoPoolId: args.userPoolId ?? null,
        totalDynamoKeys: keyList.length,
        entityCounts,
        sampleKeys: keyList.slice(0, 25),
      },
      null,
      2,
    ),
  );

  if (!args.apply) {
    // eslint-disable-next-line no-console
    console.log('Dry-run complete. Re-run with --apply to execute deletions.');
    return;
  }

  await deleteKeys(docClient, args.tableName, keyList);
  // eslint-disable-next-line no-console
  console.log(`Deleted ${keyList.length} DynamoDB items.`);

  if (!args.skipCognito) {
    if (!cognitoUsername) {
      throw new Error('Unable to resolve Cognito username. Provide --cognito-username or --email.');
    }
    runAwsCliNoOutput(args.region, [
      'cognito-idp',
      'admin-delete-user',
      '--user-pool-id',
      args.userPoolId!,
      '--username',
      cognitoUsername,
    ]);
    // eslint-disable-next-line no-console
    console.log(`Deleted Cognito user "${cognitoUsername}" from pool "${args.userPoolId}".`);
  }
};

run().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        msg: 'delete-user.failed',
        error:
          error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

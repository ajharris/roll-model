import * as fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

export class RollModelStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const splitCsvEnv = (value?: string): string[] =>
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    const cognitoHostedUiDomainPrefix =
      process.env.COGNITO_HOSTED_UI_DOMAIN_PREFIX?.trim() || process.env.COGNITO_DOMAIN_PREFIX?.trim() || '';
    const cognitoHostedUiCallbackUrls = splitCsvEnv(
      process.env.COGNITO_HOSTED_UI_CALLBACK_URLS ?? process.env.NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS,
    );
    const cognitoHostedUiLogoutUrls = splitCsvEnv(
      process.env.COGNITO_HOSTED_UI_LOGOUT_URLS ?? process.env.NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS,
    );
    const hostedUiEnabled =
      Boolean(cognitoHostedUiDomainPrefix) ||
      cognitoHostedUiCallbackUrls.length > 0 ||
      cognitoHostedUiLogoutUrls.length > 0;

    if (
      hostedUiEnabled &&
      (!cognitoHostedUiDomainPrefix || !cognitoHostedUiCallbackUrls.length || !cognitoHostedUiLogoutUrls.length)
    ) {
      throw new Error(
        [
          'Incomplete Cognito Hosted UI configuration for CDK deploy.',
          'When enabling Hosted UI, set all of:',
          '- COGNITO_HOSTED_UI_DOMAIN_PREFIX (or COGNITO_DOMAIN_PREFIX)',
          '- COGNITO_HOSTED_UI_CALLBACK_URLS (or NEXT_PUBLIC_COGNITO_SIGN_IN_REDIRECT_URIS)',
          '- COGNITO_HOSTED_UI_LOGOUT_URLS (or NEXT_PUBLIC_COGNITO_SIGN_OUT_REDIRECT_URIS)'
        ].join('\n')
      );
    }

    const table = new dynamodb.Table(this, 'RollModelTable', {
      tableName: 'RollModel',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const userPool = new cognito.UserPool(this, 'RollModelUserPool', {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true
      },
      autoVerify: {
        email: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false
        }
      },
      customAttributes: {
        role: new cognito.StringAttribute({
          minLen: 5,
          maxLen: 7,
          mutable: true
        })
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      }
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'RollModelUserPoolClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      ...(hostedUiEnabled
        ? {
            oAuth: {
              flows: {
                authorizationCodeGrant: true
              },
              scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
              callbackUrls: cognitoHostedUiCallbackUrls,
              logoutUrls: cognitoHostedUiLogoutUrls
            }
          }
        : {})
    });

    const userPoolDomain = hostedUiEnabled
      ? userPool.addDomain('RollModelHostedUiDomain', {
          cognitoDomain: {
            domainPrefix: cognitoHostedUiDomainPrefix
          }
        })
      : null;

    const athleteGroup = new cognito.CfnUserPoolGroup(this, 'RollModelAthleteGroup', {
      groupName: 'athlete',
      userPoolId: userPool.userPoolId,
      precedence: 30,
      description: 'Default athlete users'
    });

    const coachGroup = new cognito.CfnUserPoolGroup(this, 'RollModelCoachGroup', {
      groupName: 'coach',
      userPoolId: userPool.userPoolId,
      precedence: 20,
      description: 'Coaches with shared-athlete access'
    });

    const adminGroup = new cognito.CfnUserPoolGroup(this, 'RollModelAdminGroup', {
      groupName: 'admin',
      userPoolId: userPool.userPoolId,
      precedence: 10,
      description: 'Administrative users with frontend diagnostics access'
    });

    const createEntryLambda = this.createLambda('createEntry', 'backend/lambdas/createEntry/index.ts', table);
    const getEntriesLambda = this.createLambda('getEntries', 'backend/lambdas/getEntries/index.ts', table);
    const getEntryLambda = this.createLambda('getEntry', 'backend/lambdas/getEntry/index.ts', table);
    const updateEntryLambda = this.createLambda('updateEntry', 'backend/lambdas/updateEntry/index.ts', table);
    const deleteEntryLambda = this.createLambda('deleteEntry', 'backend/lambdas/deleteEntry/index.ts', table);
    const listSavedSearchesLambda = this.createLambda(
      'listSavedSearches',
      'backend/lambdas/listSavedSearches/index.ts',
      table
    );
    const createSavedSearchLambda = this.createLambda(
      'createSavedSearch',
      'backend/lambdas/createSavedSearch/index.ts',
      table
    );
    const updateSavedSearchLambda = this.createLambda(
      'updateSavedSearch',
      'backend/lambdas/updateSavedSearch/index.ts',
      table
    );
    const deleteSavedSearchLambda = this.createLambda(
      'deleteSavedSearch',
      'backend/lambdas/deleteSavedSearch/index.ts',
      table
    );
    const postCommentLambda = this.createLambda('postComment', 'backend/lambdas/postComment/index.ts', table);
    const linkCoachAthleteLambda = this.createLambda(
      'linkCoachAthlete',
      'backend/lambdas/linkCoachAthlete/index.ts',
      table
    );
    const revokeCoachLinkLambda = this.createLambda(
      'revokeCoachLink',
      'backend/lambdas/revokeCoachLink/index.ts',
      table
    );
    const exportDataLambda = this.createLambda('exportData', 'backend/lambdas/exportData/index.ts', table);
    const restoreDataLambda = this.createLambda('restoreData', 'backend/lambdas/restoreData/index.ts', table);
    const aiChatLambda = this.createLambda('aiChat', 'backend/lambdas/aiChat/index.ts', table);
    const requestSignupLambda = this.createLambda(
      'requestSignup',
      'backend/lambdas/requestSignup/index.ts',
      table
    );
    const listCheckoffsLambda = this.createLambda('listCheckoffs', 'backend/lambdas/listCheckoffs/index.ts', table);
    const upsertCheckoffEvidenceLambda = this.createLambda(
      'upsertCheckoffEvidence',
      'backend/lambdas/upsertCheckoffEvidence/index.ts',
      table
    );
    const reviewCheckoffLambda = this.createLambda('reviewCheckoff', 'backend/lambdas/reviewCheckoff/index.ts', table);
    const getEntryCheckoffEvidenceLambda = this.createLambda(
      'getEntryCheckoffEvidence',
      'backend/lambdas/getEntryCheckoffEvidence/index.ts',
      table
    );
    const submitFeedbackLambda = this.createLambda(
      'submitFeedback',
      'backend/lambdas/submitFeedback/index.ts',
      table
    );
    const buildWeeklyPlanLambda = this.createLambda(
      'buildWeeklyPlan',
      'backend/lambdas/buildWeeklyPlan/index.ts',
      table
    );
    const listWeeklyPlansLambda = this.createLambda(
      'listWeeklyPlans',
      'backend/lambdas/listWeeklyPlans/index.ts',
      table
    );
    const updateWeeklyPlanLambda = this.createLambda(
      'updateWeeklyPlan',
      'backend/lambdas/updateWeeklyPlan/index.ts',
      table
    );
    const backendLambdas: Array<{ name: string; fn: nodejs.NodejsFunction }> = [
      { name: 'createEntry', fn: createEntryLambda },
      { name: 'getEntries', fn: getEntriesLambda },
      { name: 'getEntry', fn: getEntryLambda },
      { name: 'updateEntry', fn: updateEntryLambda },
      { name: 'deleteEntry', fn: deleteEntryLambda },
      { name: 'listSavedSearches', fn: listSavedSearchesLambda },
      { name: 'createSavedSearch', fn: createSavedSearchLambda },
      { name: 'updateSavedSearch', fn: updateSavedSearchLambda },
      { name: 'deleteSavedSearch', fn: deleteSavedSearchLambda },
      { name: 'postComment', fn: postCommentLambda },
      { name: 'linkCoachAthlete', fn: linkCoachAthleteLambda },
      { name: 'revokeCoachLink', fn: revokeCoachLinkLambda },
      { name: 'exportData', fn: exportDataLambda },
      { name: 'restoreData', fn: restoreDataLambda },
      { name: 'aiChat', fn: aiChatLambda },
      { name: 'requestSignup', fn: requestSignupLambda },
      { name: 'listCheckoffs', fn: listCheckoffsLambda },
      { name: 'upsertCheckoffEvidence', fn: upsertCheckoffEvidenceLambda },
      { name: 'reviewCheckoff', fn: reviewCheckoffLambda },
      { name: 'getEntryCheckoffEvidence', fn: getEntryCheckoffEvidenceLambda },
      { name: 'submitFeedback', fn: submitFeedbackLambda },
      { name: 'buildWeeklyPlan', fn: buildWeeklyPlanLambda },
      { name: 'listWeeklyPlans', fn: listWeeklyPlansLambda },
      { name: 'updateWeeklyPlan', fn: updateWeeklyPlanLambda }
    ];

    aiChatLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/roll-model/openai_api_key`
        ]
      })
    );

    requestSignupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*']
      })
    );
    requestSignupLambda.addEnvironment('SIGNUP_APPROVAL_EMAIL', process.env.SIGNUP_APPROVAL_EMAIL ?? '');
    requestSignupLambda.addEnvironment('SIGNUP_SOURCE_EMAIL', process.env.SIGNUP_SOURCE_EMAIL ?? '');

    const githubTokenSsmParam = process.env.GITHUB_TOKEN_SSM_PARAM ?? '/roll-model/github_token';
    const githubTokenSsmParamPath = githubTokenSsmParam.startsWith('/') ? githubTokenSsmParam : `/${githubTokenSsmParam}`;
    submitFeedbackLambda.addEnvironment('GITHUB_REPO', process.env.GITHUB_REPO ?? '');
    submitFeedbackLambda.addEnvironment('GITHUB_TOKEN_SSM_PARAM', githubTokenSsmParamPath);
    submitFeedbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${githubTokenSsmParamPath}`
        ]
      })
    );

    const apiAccessLogGroup = new logs.LogGroup(this, 'RollModelApiAccessLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const api = new apigateway.RestApi(this, 'RollModelApi', {
      restApiName: 'RollModelApi',
      cloudWatchRole: true,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        tracingEnabled: true,
        dataTraceEnabled: false,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true
        })
      }
    });

    api.addGatewayResponse('GatewayResponseDefault4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
      }
    });

    api.addGatewayResponse('GatewayResponseDefault5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
      }
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'RollModelAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'RollModelCognitoAuthorizer'
    });

    const methodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer
    };
    const publicMethodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE
    };

    const entries = api.root.addResource('entries');
    entries.addMethod('POST', new apigateway.LambdaIntegration(createEntryLambda), methodOptions);
    entries.addMethod('GET', new apigateway.LambdaIntegration(getEntriesLambda), methodOptions);
    entries.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const comments = entries.addResource('comments');
    comments.addMethod('POST', new apigateway.LambdaIntegration(postCommentLambda), methodOptions);
    comments.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const entryById = entries.addResource('{entryId}');
    entryById.addMethod('GET', new apigateway.LambdaIntegration(getEntryLambda), methodOptions);
    entryById.addMethod('PUT', new apigateway.LambdaIntegration(updateEntryLambda), methodOptions);
    entryById.addMethod('DELETE', new apigateway.LambdaIntegration(deleteEntryLambda), methodOptions);
    entryById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const entryComments = entryById.addResource('comments');
    entryComments.addMethod('POST', new apigateway.LambdaIntegration(postCommentLambda), methodOptions);
    entryComments.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const entryCheckoffEvidence = entryById.addResource('checkoff-evidence');
    entryCheckoffEvidence.addMethod('GET', new apigateway.LambdaIntegration(getEntryCheckoffEvidenceLambda), methodOptions);
    entryCheckoffEvidence.addMethod('POST', new apigateway.LambdaIntegration(upsertCheckoffEvidenceLambda), methodOptions);
    entryCheckoffEvidence.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const savedSearches = api.root.addResource('saved-searches');
    savedSearches.addMethod('GET', new apigateway.LambdaIntegration(listSavedSearchesLambda), methodOptions);
    savedSearches.addMethod('POST', new apigateway.LambdaIntegration(createSavedSearchLambda), methodOptions);
    savedSearches.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const savedSearchById = savedSearches.addResource('{savedSearchId}');
    savedSearchById.addMethod('PUT', new apigateway.LambdaIntegration(updateSavedSearchLambda), methodOptions);
    savedSearchById.addMethod('DELETE', new apigateway.LambdaIntegration(deleteSavedSearchLambda), methodOptions);
    savedSearchById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const links = api.root.addResource('links');
    const athleteCoach = links.addResource('coach');
    athleteCoach.addMethod('POST', new apigateway.LambdaIntegration(linkCoachAthleteLambda), methodOptions);
    athleteCoach.addMethod('DELETE', new apigateway.LambdaIntegration(revokeCoachLinkLambda), methodOptions);
    athleteCoach.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const exportResource = api.root.addResource('export');
    exportResource.addMethod('GET', new apigateway.LambdaIntegration(exportDataLambda), methodOptions);
    exportResource.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const restoreResource = api.root.addResource('restore');
    restoreResource.addMethod('POST', new apigateway.LambdaIntegration(restoreDataLambda), methodOptions);
    restoreResource.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const ai = api.root.addResource('ai');
    const aiChat = ai.addResource('chat');
    aiChat.addMethod('POST', new apigateway.LambdaIntegration(aiChatLambda), methodOptions);
    aiChat.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const signupRequests = api.root.addResource('signup-requests');
    signupRequests.addMethod('POST', new apigateway.LambdaIntegration(requestSignupLambda), publicMethodOptions);
    signupRequests.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const feedback = api.root.addResource('feedback');
    feedback.addMethod('POST', new apigateway.LambdaIntegration(submitFeedbackLambda), methodOptions);
    feedback.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const checkoffs = api.root.addResource('checkoffs');
    checkoffs.addMethod('GET', new apigateway.LambdaIntegration(listCheckoffsLambda), methodOptions);
    checkoffs.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const checkoffById = checkoffs.addResource('{checkoffId}');
    const checkoffReview = checkoffById.addResource('review');
    checkoffReview.addMethod('PUT', new apigateway.LambdaIntegration(reviewCheckoffLambda), methodOptions);
    checkoffReview.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const gapInsights = api.root.addResource('gap-insights');
    gapInsights.addMethod('GET', new apigateway.LambdaIntegration(getGapInsightsLambda), methodOptions);
    gapInsights.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const gapInsightsPriorities = gapInsights.addResource('priorities');
    gapInsightsPriorities.addMethod('PUT', new apigateway.LambdaIntegration(upsertGapPrioritiesLambda), methodOptions);
    gapInsightsPriorities.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athletes = api.root.addResource('athletes');
    const athleteById = athletes.addResource('{athleteId}');
    const athleteEntries = athleteById.addResource('entries');
    athleteEntries.addMethod('GET', new apigateway.LambdaIntegration(getEntriesLambda), methodOptions);
    athleteEntries.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCheckoffs = athleteById.addResource('checkoffs');
    athleteCheckoffs.addMethod('GET', new apigateway.LambdaIntegration(listCheckoffsLambda), methodOptions);
    athleteCheckoffs.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCheckoffById = athleteCheckoffs.addResource('{checkoffId}');
    const athleteCheckoffReview = athleteCheckoffById.addResource('review');
    athleteCheckoffReview.addMethod('PUT', new apigateway.LambdaIntegration(reviewCheckoffLambda), methodOptions);
    athleteCheckoffReview.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const weeklyPlans = api.root.addResource('weekly-plans');
    weeklyPlans.addMethod('GET', new apigateway.LambdaIntegration(listWeeklyPlansLambda), methodOptions);
    weeklyPlans.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const weeklyPlansBuild = weeklyPlans.addResource('build');
    weeklyPlansBuild.addMethod('POST', new apigateway.LambdaIntegration(buildWeeklyPlanLambda), methodOptions);
    weeklyPlansBuild.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const weeklyPlanById = weeklyPlans.addResource('{planId}');
    weeklyPlanById.addMethod('PUT', new apigateway.LambdaIntegration(updateWeeklyPlanLambda), methodOptions);
    weeklyPlanById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteWeeklyPlans = athleteById.addResource('weekly-plans');
    athleteWeeklyPlans.addMethod('GET', new apigateway.LambdaIntegration(listWeeklyPlansLambda), methodOptions);
    athleteWeeklyPlans.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteWeeklyPlansBuild = athleteWeeklyPlans.addResource('build');
    athleteWeeklyPlansBuild.addMethod('POST', new apigateway.LambdaIntegration(buildWeeklyPlanLambda), methodOptions);
    athleteWeeklyPlansBuild.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteWeeklyPlanById = athleteWeeklyPlans.addResource('{planId}');
    athleteWeeklyPlanById.addMethod('PUT', new apigateway.LambdaIntegration(updateWeeklyPlanLambda), methodOptions);
    athleteWeeklyPlanById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const observabilityNamespace = 'RollModel/Backend';
    const structuredRequestErrorMetricName = 'StructuredRequestErrors';
    const structuredLatencyMetricName = 'StructuredRequestLatencyMs';

    for (const { name, fn } of backendLambdas) {
      new logs.MetricFilter(this, `${name}StructuredRequestErrorMetricFilter`, {
        logGroup: fn.logGroup,
        filterPattern: logs.FilterPattern.literal('{ $.event = "request.error" }'),
        metricNamespace: observabilityNamespace,
        metricName: structuredRequestErrorMetricName,
        metricValue: '1'
      });

      new logs.MetricFilter(this, `${name}StructuredRequestLatencyMetricFilter`, {
        logGroup: fn.logGroup,
        filterPattern: logs.FilterPattern.literal('{ $.latencyMs = * }'),
        metricNamespace: observabilityNamespace,
        metricName: structuredLatencyMetricName,
        metricValue: '$.latencyMs',
        unit: cloudwatch.Unit.MILLISECONDS
      });
    }

    const apiRequestCountMetric = api.metricCount({
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });
    const api4xxMetric = api.metricClientError({
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });
    const api5xxMetric = api.metricServerError({
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });
    const apiLatencyP95Metric = api.metricLatency({
      statistic: 'p95',
      period: cdk.Duration.minutes(5)
    });

    const structuredRequestErrorsMetric = new cloudwatch.Metric({
      namespace: observabilityNamespace,
      metricName: structuredRequestErrorMetricName,
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });
    const structuredLatencyP95Metric = new cloudwatch.Metric({
      namespace: observabilityNamespace,
      metricName: structuredLatencyMetricName,
      statistic: 'p95',
      period: cdk.Duration.minutes(5),
      unit: cloudwatch.Unit.MILLISECONDS
    });

    const lambdaErrorMetrics = backendLambdas.map(({ name, fn }) =>
      fn.metricErrors({
        label: name,
        statistic: 'Sum',
        period: cdk.Duration.minutes(5)
      })
    );
    const lambdaDurationP95Metrics = backendLambdas.map(({ name, fn }) =>
      fn.metricDuration({
        label: name,
        statistic: 'p95',
        period: cdk.Duration.minutes(5)
      })
    );

    const operationsDashboard = new cloudwatch.Dashboard(this, 'RollModelOperationsDashboard', {
      dashboardName: `${cdk.Stack.of(this).stackName}-Operations`
    });

    operationsDashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown:
          '## RollModel Operational Dashboard\nStructured Lambda logs emit `request.start`, `request.success`, and `request.error` with correlation IDs and latency.',
        width: 24,
        height: 3
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Traffic and Errors (5m)',
        left: [apiRequestCountMetric],
        right: [api4xxMetric, api5xxMetric],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Latency p95 (5m)',
        left: [apiLatencyP95Metric],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'Structured Request Errors (from Lambda JSON logs)',
        left: [structuredRequestErrorsMetric],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'Structured Request Latency p95 (latencyMs from Lambda JSON logs)',
        left: [structuredLatencyP95Metric],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors by Handler (5m)',
        left: lambdaErrorMetrics,
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration p95 by Handler (5m)',
        left: lambdaDurationP95Metrics,
        width: 12
      })
    );

    const structuredRequestErrorAlarm = new cloudwatch.Alarm(this, 'StructuredRequestErrorAlarm', {
      metric: structuredRequestErrorsMetric,
      threshold: 5,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Triggers when structured Lambda request.error events reach 5+ within 5 minutes across backend handlers.'
    });

    const structuredLatencyAlarm = new cloudwatch.Alarm(this, 'StructuredRequestLatencyP95Alarm', {
      metric: structuredLatencyP95Metric,
      threshold: 3000,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Triggers when structured request latency p95 exceeds 3000ms for two consecutive 5 minute periods.'
    });

    // TODO: Attach alarm actions (for example SNS / Slack / PagerDuty) to structuredRequestErrorAlarm and structuredLatencyAlarm.

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${api.restApiId}.execute-api.${cdk.Stack.of(this).region}.${cdk.Stack.of(this).urlSuffix}/${api.deploymentStage.stageName}`
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId
    });

    if (userPoolDomain) {
      new cdk.CfnOutput(this, 'CognitoHostedUiDomain', {
        value: userPoolDomain.domainName
      });

      new cdk.CfnOutput(this, 'CognitoHostedUiBaseUrl', {
        value: userPoolDomain.baseUrl()
      });

      new cdk.CfnOutput(this, 'FrontendNextPublicCognitoDomain', {
        value: userPoolDomain.domainName
      });
    }

    if (hostedUiEnabled) {
      new cdk.CfnOutput(this, 'FrontendNextPublicCognitoSignInRedirectUris', {
        value: cognitoHostedUiCallbackUrls.join(',')
      });

      new cdk.CfnOutput(this, 'FrontendNextPublicCognitoSignOutRedirectUris', {
        value: cognitoHostedUiLogoutUrls.join(',')
      });
    }

    new cdk.CfnOutput(this, 'CognitoAthleteGroupName', {
      value: athleteGroup.groupName ?? 'athlete'
    });

    new cdk.CfnOutput(this, 'CognitoCoachGroupName', {
      value: coachGroup.groupName ?? 'coach'
    });

    new cdk.CfnOutput(this, 'CognitoAdminGroupName', {
      value: adminGroup.groupName ?? 'admin'
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName
    });

    new cdk.CfnOutput(this, 'ApiAccessLogGroupName', {
      value: apiAccessLogGroup.logGroupName
    });

    new cdk.CfnOutput(this, 'OperationsDashboardName', {
      value: operationsDashboard.dashboardName
    });

    new cdk.CfnOutput(this, 'StructuredRequestErrorAlarmName', {
      value: structuredRequestErrorAlarm.alarmName
    });

    new cdk.CfnOutput(this, 'StructuredRequestLatencyAlarmName', {
      value: structuredLatencyAlarm.alarmName
    });
  }

  private createLambda(name: string, entryPath: string, table: dynamodb.Table): nodejs.NodejsFunction {
    const entry = path.join(__dirname, '..', '..', '..', entryPath);
    const resolvedEntry = fs.existsSync(entry) ? entry : entry.replace(/\.ts$/, '.js');
    const fn = new nodejs.NodejsFunction(this, `${name}Lambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: resolvedEntry,
      environment: {
        TABLE_NAME: table.tableName
      },
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        target: 'node20',
        minify: true,
        sourceMap: false
      }
    });

    table.grantReadWriteData(fn);
    return fn;
  }
}

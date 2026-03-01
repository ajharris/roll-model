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
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
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
    const reviewStructuredMetadataLambda = this.createLambda(
      'reviewStructuredMetadata',
      'backend/lambdas/reviewStructuredMetadata/index.ts',
      table
    );
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
    const getGapInsightsLambda = this.createLambda(
      'getGapInsights',
      'backend/lambdas/getGapInsights/index.ts',
      table
    );
    const getCoachQuestionsLambda = this.createLambda(
      'getCoachQuestions',
      'backend/lambdas/getCoachQuestions/index.ts',
      table
    );
    const updateCoachQuestionsLambda = this.createLambda(
      'updateCoachQuestions',
      'backend/lambdas/updateCoachQuestions/index.ts',
      table
    );
    const getProgressViewsLambda = this.createLambda(
      'getProgressViews',
      'backend/lambdas/getProgressViews/index.ts',
      table
    );
    const upsertProgressAnnotationLambda = this.createLambda(
      'upsertProgressAnnotation',
      'backend/lambdas/upsertProgressAnnotation/index.ts',
      table
    );
    const upsertGapPrioritiesLambda = this.createLambda(
      'upsertGapPriorities',
      'backend/lambdas/upsertGapPriorities/index.ts',
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
    const listCurriculumLambda = this.createLambda('listCurriculum', 'backend/lambdas/listCurriculum/index.ts', table);
    const upsertCurriculumStagesLambda = this.createLambda(
      'upsertCurriculumStages',
      'backend/lambdas/upsertCurriculumStages/index.ts',
      table
    );
    const upsertCurriculumSkillLambda = this.createLambda(
      'upsertCurriculumSkill',
      'backend/lambdas/upsertCurriculumSkill/index.ts',
      table
    );
    const deleteCurriculumSkillLambda = this.createLambda(
      'deleteCurriculumSkill',
      'backend/lambdas/deleteCurriculumSkill/index.ts',
      table
    );
    const upsertCurriculumRelationshipLambda = this.createLambda(
      'upsertCurriculumRelationship',
      'backend/lambdas/upsertCurriculumRelationship/index.ts',
      table
    );
    const deleteCurriculumRelationshipLambda = this.createLambda(
      'deleteCurriculumRelationship',
      'backend/lambdas/deleteCurriculumRelationship/index.ts',
      table
    );
    const recomputeCurriculumProgressLambda = this.createLambda(
      'recomputeCurriculumProgress',
      'backend/lambdas/recomputeCurriculumProgress/index.ts',
      table
    );
    const reviewCurriculumProgressLambda = this.createLambda(
      'reviewCurriculumProgress',
      'backend/lambdas/reviewCurriculumProgress/index.ts',
      table
    );
    const listCurriculumRecommendationsLambda = this.createLambda(
      'listCurriculumRecommendations',
      'backend/lambdas/listCurriculumRecommendations/index.ts',
      table
    );
    const updateCurriculumRecommendationLambda = this.createLambda(
      'updateCurriculumRecommendation',
      'backend/lambdas/updateCurriculumRecommendation/index.ts',
      table
    );
    const seedCurriculumLambda = this.createLambda('seedCurriculum', 'backend/lambdas/seedCurriculum/index.ts', table);
    const backendLambdas: Array<{ name: string; fn: nodejs.NodejsFunction }> = [
      { name: 'createEntry', fn: createEntryLambda },
      { name: 'getEntries', fn: getEntriesLambda },
      { name: 'getEntry', fn: getEntryLambda },
      { name: 'updateEntry', fn: updateEntryLambda },
      { name: 'reviewStructuredMetadata', fn: reviewStructuredMetadataLambda },
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
      { name: 'getGapInsights', fn: getGapInsightsLambda },
      { name: 'getCoachQuestions', fn: getCoachQuestionsLambda },
      { name: 'updateCoachQuestions', fn: updateCoachQuestionsLambda },
      { name: 'getProgressViews', fn: getProgressViewsLambda },
      { name: 'upsertProgressAnnotation', fn: upsertProgressAnnotationLambda },
      { name: 'upsertGapPriorities', fn: upsertGapPrioritiesLambda },
      { name: 'buildWeeklyPlan', fn: buildWeeklyPlanLambda },
      { name: 'listWeeklyPlans', fn: listWeeklyPlansLambda },
      { name: 'updateWeeklyPlan', fn: updateWeeklyPlanLambda },
      { name: 'listCurriculum', fn: listCurriculumLambda },
      { name: 'upsertCurriculumStages', fn: upsertCurriculumStagesLambda },
      { name: 'upsertCurriculumSkill', fn: upsertCurriculumSkillLambda },
      { name: 'deleteCurriculumSkill', fn: deleteCurriculumSkillLambda },
      { name: 'upsertCurriculumRelationship', fn: upsertCurriculumRelationshipLambda },
      { name: 'deleteCurriculumRelationship', fn: deleteCurriculumRelationshipLambda },
      { name: 'recomputeCurriculumProgress', fn: recomputeCurriculumProgressLambda },
      { name: 'reviewCurriculumProgress', fn: reviewCurriculumProgressLambda },
      { name: 'listCurriculumRecommendations', fn: listCurriculumRecommendationsLambda },
      { name: 'updateCurriculumRecommendation', fn: updateCurriculumRecommendationLambda },
      { name: 'seedCurriculum', fn: seedCurriculumLambda }
    ];

    aiChatLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/roll-model/openai_api_key`
        ]
      })
    );
    getCoachQuestionsLambda.addToRolePolicy(
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
    submitFeedbackLambda.addEnvironment('APP_ENV', process.env.APP_ENV ?? 'prod');
    submitFeedbackLambda.addEnvironment('APP_VERSION', process.env.APP_VERSION ?? 'unknown');
    submitFeedbackLambda.addEnvironment('FEEDBACK_ACTOR_HASH_SALT', process.env.FEEDBACK_ACTOR_HASH_SALT ?? '');
    submitFeedbackLambda.addEnvironment(
      'FEEDBACK_REVIEW_REQUIRED_ENVS',
      process.env.FEEDBACK_REVIEW_REQUIRED_ENVS ?? ''
    );
    submitFeedbackLambda.addEnvironment('FEEDBACK_NORMALIZE_MODE', process.env.FEEDBACK_NORMALIZE_MODE ?? 'auto');
    submitFeedbackLambda.addEnvironment('FEEDBACK_OPENAI_MODEL', process.env.FEEDBACK_OPENAI_MODEL ?? 'gpt-4.1-mini');
    submitFeedbackLambda.addEnvironment('FEEDBACK_RATE_LIMIT_PER_HOUR', process.env.FEEDBACK_RATE_LIMIT_PER_HOUR ?? '6');
    submitFeedbackLambda.addEnvironment('FEEDBACK_RATE_LIMIT_PER_DAY', process.env.FEEDBACK_RATE_LIMIT_PER_DAY ?? '20');
    submitFeedbackLambda.addEnvironment('FEEDBACK_COOLDOWN_SECONDS', process.env.FEEDBACK_COOLDOWN_SECONDS ?? '20');
    submitFeedbackLambda.addEnvironment(
      'FEEDBACK_DUPLICATE_WINDOW_HOURS',
      process.env.FEEDBACK_DUPLICATE_WINDOW_HOURS ?? '24'
    );
    submitFeedbackLambda.addEnvironment('FEEDBACK_DUPLICATE_LIMIT', process.env.FEEDBACK_DUPLICATE_LIMIT ?? '2');
    submitFeedbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${githubTokenSsmParamPath}`
        ]
      })
    );
    submitFeedbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/roll-model/openai_api_key`
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

    const entryStructuredReview = entryById.addResource('structured-review');
    entryStructuredReview.addMethod('PUT', new apigateway.LambdaIntegration(reviewStructuredMetadataLambda), methodOptions);
    entryStructuredReview.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
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

    const coachQuestions = api.root.addResource('coach-questions');
    coachQuestions.addMethod('GET', new apigateway.LambdaIntegration(getCoachQuestionsLambda), methodOptions);
    coachQuestions.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const coachQuestionById = coachQuestions.addResource('{questionSetId}');
    coachQuestionById.addMethod('PUT', new apigateway.LambdaIntegration(updateCoachQuestionsLambda), methodOptions);
    coachQuestionById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const progressViews = api.root.addResource('progress-views');
    progressViews.addMethod('GET', new apigateway.LambdaIntegration(getProgressViewsLambda), methodOptions);
    progressViews.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const progressAnnotations = progressViews.addResource('annotations');
    progressAnnotations.addMethod('POST', new apigateway.LambdaIntegration(upsertProgressAnnotationLambda), methodOptions);
    progressAnnotations.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const progressAnnotationById = progressAnnotations.addResource('{annotationId}');
    progressAnnotationById.addMethod('PUT', new apigateway.LambdaIntegration(upsertProgressAnnotationLambda), methodOptions);
    progressAnnotationById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const curriculum = api.root.addResource('curriculum');
    curriculum.addMethod('GET', new apigateway.LambdaIntegration(listCurriculumLambda), methodOptions);
    curriculum.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const curriculumStages = curriculum.addResource('stages');
    curriculumStages.addMethod('PUT', new apigateway.LambdaIntegration(upsertCurriculumStagesLambda), methodOptions);
    curriculumStages.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const curriculumSkills = curriculum.addResource('skills');
    const curriculumSeed = curriculum.addResource('seed');
    curriculumSeed.addMethod('POST', new apigateway.LambdaIntegration(seedCurriculumLambda), methodOptions);
    curriculumSeed.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const curriculumSkillById = curriculumSkills.addResource('{skillId}');
    curriculumSkillById.addMethod('PUT', new apigateway.LambdaIntegration(upsertCurriculumSkillLambda), methodOptions);
    curriculumSkillById.addMethod('DELETE', new apigateway.LambdaIntegration(deleteCurriculumSkillLambda), methodOptions);
    curriculumSkillById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const curriculumRelationships = curriculum.addResource('relationships');
    curriculumRelationships.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(upsertCurriculumRelationshipLambda),
      methodOptions
    );
    curriculumRelationships.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const curriculumRelationshipById = curriculumRelationships
      .addResource('{fromSkillId}')
      .addResource('{toSkillId}');
    curriculumRelationshipById.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteCurriculumRelationshipLambda),
      methodOptions
    );
    curriculumRelationshipById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const curriculumProgress = curriculum.addResource('progress');
    const curriculumProgressRecompute = curriculumProgress.addResource('recompute');
    curriculumProgressRecompute.addMethod(
      'POST',
      new apigateway.LambdaIntegration(recomputeCurriculumProgressLambda),
      methodOptions
    );
    curriculumProgressRecompute.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const curriculumProgressBySkill = curriculumProgress.addResource('{skillId}');
    const curriculumProgressReview = curriculumProgressBySkill.addResource('review');
    curriculumProgressReview.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(reviewCurriculumProgressLambda),
      methodOptions
    );
    curriculumProgressReview.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const curriculumRecommendations = curriculum.addResource('recommendations');
    curriculumRecommendations.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listCurriculumRecommendationsLambda),
      methodOptions
    );
    curriculumRecommendations.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const curriculumRecommendationById = curriculumRecommendations.addResource('{recommendationId}');
    curriculumRecommendationById.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(updateCurriculumRecommendationLambda),
      methodOptions
    );
    curriculumRecommendationById.addCorsPreflight({
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

    const athleteProgressViews = athleteById.addResource('progress-views');
    athleteProgressViews.addMethod('GET', new apigateway.LambdaIntegration(getProgressViewsLambda), methodOptions);
    athleteProgressViews.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCoachQuestions = athleteById.addResource('coach-questions');
    athleteCoachQuestions.addMethod('GET', new apigateway.LambdaIntegration(getCoachQuestionsLambda), methodOptions);
    athleteCoachQuestions.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const athleteCoachQuestionById = athleteCoachQuestions.addResource('{questionSetId}');
    athleteCoachQuestionById.addMethod('PUT', new apigateway.LambdaIntegration(updateCoachQuestionsLambda), methodOptions);
    athleteCoachQuestionById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteProgressAnnotations = athleteProgressViews.addResource('annotations');
    athleteProgressAnnotations.addMethod('POST', new apigateway.LambdaIntegration(upsertProgressAnnotationLambda), methodOptions);
    athleteProgressAnnotations.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteProgressAnnotationById = athleteProgressAnnotations.addResource('{annotationId}');
    athleteProgressAnnotationById.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(upsertProgressAnnotationLambda),
      methodOptions
    );
    athleteProgressAnnotationById.addCorsPreflight({
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

    const athleteCurriculum = athleteById.addResource('curriculum');
    athleteCurriculum.addMethod('GET', new apigateway.LambdaIntegration(listCurriculumLambda), methodOptions);
    athleteCurriculum.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCurriculumStages = athleteCurriculum.addResource('stages');
    athleteCurriculumStages.addMethod('PUT', new apigateway.LambdaIntegration(upsertCurriculumStagesLambda), methodOptions);
    athleteCurriculumStages.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCurriculumSeed = athleteCurriculum.addResource('seed');
    athleteCurriculumSeed.addMethod('POST', new apigateway.LambdaIntegration(seedCurriculumLambda), methodOptions);
    athleteCurriculumSeed.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCurriculumSkillById = athleteCurriculum.addResource('skills').addResource('{skillId}');
    athleteCurriculumSkillById.addMethod('PUT', new apigateway.LambdaIntegration(upsertCurriculumSkillLambda), methodOptions);
    athleteCurriculumSkillById.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteCurriculumSkillLambda),
      methodOptions
    );
    athleteCurriculumSkillById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCurriculumRelationships = athleteCurriculum.addResource('relationships');
    athleteCurriculumRelationships.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(upsertCurriculumRelationshipLambda),
      methodOptions
    );
    athleteCurriculumRelationships.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const athleteCurriculumRelationshipById = athleteCurriculumRelationships
      .addResource('{fromSkillId}')
      .addResource('{toSkillId}');
    athleteCurriculumRelationshipById.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteCurriculumRelationshipLambda),
      methodOptions
    );
    athleteCurriculumRelationshipById.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });

    const athleteCurriculumProgress = athleteCurriculum.addResource('progress');
    const athleteCurriculumProgressRecompute = athleteCurriculumProgress.addResource('recompute');
    athleteCurriculumProgressRecompute.addMethod(
      'POST',
      new apigateway.LambdaIntegration(recomputeCurriculumProgressLambda),
      methodOptions
    );
    athleteCurriculumProgressRecompute.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const athleteCurriculumProgressReview = athleteCurriculumProgress
      .addResource('{skillId}')
      .addResource('review');
    athleteCurriculumProgressReview.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(reviewCurriculumProgressLambda),
      methodOptions
    );
    athleteCurriculumProgressReview.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const athleteCurriculumRecommendations = athleteCurriculum.addResource('recommendations');
    athleteCurriculumRecommendations.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listCurriculumRecommendationsLambda),
      methodOptions
    );
    athleteCurriculumRecommendations.addCorsPreflight({
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    });
    const athleteCurriculumRecommendationById = athleteCurriculumRecommendations.addResource('{recommendationId}');
    athleteCurriculumRecommendationById.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(updateCurriculumRecommendationLambda),
      methodOptions
    );
    athleteCurriculumRecommendationById.addCorsPreflight({
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

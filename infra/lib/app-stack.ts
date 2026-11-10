import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions";
import * as rds from "aws-cdk-lib/aws-rds";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as appscaling from "aws-cdk-lib/aws-applicationautoscaling";
import { NagSuppressions } from "cdk-nag";
import type { BaseStack } from "./base-stack";

export interface AppStackProps extends cdk.StackProps {
  base: BaseStack;
  envName: string;
  imageTag: string;
  alertEmail?: string;
  githubRepo?: string;
}

const CLOUDFRONT_PREFIX_LIST = "pl-3b927c52"; // com.amazonaws.global.cloudfront.origin-facing (us-east-1)

const FEATURE_FLAGS = {
  version: "1",
  flags: Object.fromEntries(
    ["ai_enabled", "anchor_enabled", "public_profile_enabled", "custom_templates_enabled",
     "reseal_after_purchase", "signups_enabled", "maintenance_mode"].map((k) => [k, { name: k }]),
  ),
  values: {
    ai_enabled: { enabled: true },
    anchor_enabled: { enabled: false },
    public_profile_enabled: { enabled: false },
    custom_templates_enabled: { enabled: false },
    reseal_after_purchase: { enabled: false },
    signups_enabled: { enabled: true },
    maintenance_mode: { enabled: false },
  },
};

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { base, envName } = props;
    const domain = base.domainName;
    const originDomain = `origin.${domain}`;
    const p = `theckards-${envName}`;

    // ---------- Network ----------
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${p}-vpc`,
      maxAzs: 2,
      natGateways: 1, // ADR-007: single NAT (cost); second NAT needs a cost/risk ADR
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      flowLogs: { all: { destination: ec2.FlowLogDestination.toCloudWatchLogs(new logs.LogGroup(this, "FlowLogs", { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN })) } },
    });
    vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });

    // ---------- Keys ----------
    const dataKey = new kms.Key(this, "DataKey", {
      alias: `alias/${p}-data`, enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.RETAIN,
      description: "Theckards data encryption key",
    });
    const sealKey = new kms.Key(this, "SealKey", {
      alias: `alias/${p}-seal-v1`, keySpec: kms.KeySpec.ECC_NIST_P256, keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, description: "Theckards receipt signing key (ECDSA_P256_SHA256)",
    });
    const alertKey = new kms.Key(this, "AlertKey", {
      alias: `alias/${p}-alerts`, enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    for (const svc of ["cloudwatch.amazonaws.com", "ses.amazonaws.com"]) {
      alertKey.addToResourcePolicy(new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(svc)], actions: ["kms:GenerateDataKey*", "kms:Decrypt"], resources: ["*"],
      }));
    }

    // ---------- Storage ----------
    const documents = new s3.Bucket(this, "Documents", {
      bucketName: `${p}-documents-${this.account}`,
      versioned: true, encryption: s3.BucketEncryption.KMS, encryptionKey: dataKey, bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      objectLockEnabled: false, // G/sec. 9.1: no Object Lock by default
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(90), abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) }],
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [`https://${domain}`], allowedHeaders: ["*"], maxAge: 3000 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------- Queues ----------
    const dlq = new sqs.Queue(this, "JobsDlq", {
      queueName: `${p}-jobs-dlq`, retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS, encryptionMasterKey: dataKey, enforceSSL: true,
    });
    const jobs = new sqs.Queue(this, "Jobs", {
      queueName: `${p}-jobs`, visibilityTimeout: cdk.Duration.seconds(120), retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.KMS, encryptionMasterKey: dataKey, enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    // ---------- Database (ADR-002: RDS PostgreSQL single-AZ) ----------
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc, description: "RDS", allowAllOutbound: false });
    const db = new rds.DatabaseInstance(this, "Db", {
      instanceIdentifier: `${p}-db`,
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret("theckards_admin", { secretName: `theckards/${envName}/db`, encryptionKey: dataKey }),
      databaseName: "theckards",
      allocatedStorage: 20, maxAllocatedStorage: 100, storageType: rds.StorageType.GP3,
      storageEncrypted: true, storageEncryptionKey: dataKey,
      multiAz: false, publiclyAccessible: false,
      backupRetention: cdk.Duration.days(14), preferredBackupWindow: "06:00-07:00", preferredMaintenanceWindow: "sun:07:30-sun:08:30",
      deleteAutomatedBackups: false, deletionProtection: true, removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoMinorVersionUpgrade: true, iamAuthentication: true,
      cloudwatchLogsExports: ["postgresql", "upgrade"], cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
    });

    // ---------- Cognito (Essentials) ----------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${p}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true }, autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      mfa: cognito.Mfa.OPTIONAL, mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      deletionProtection: true, removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cognito.CfnUserPoolGroup(this, "AdminsGroup", { userPoolId: userPool.userPoolId, groupName: "admins", description: "Product owners (MFA required)" });
    new cognito.CfnUserPoolGroup(this, "SupportGroup", { userPoolId: userPool.userPoolId, groupName: "support", description: "Read-only support" });
    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `${p}-web`, generateSecret: true,
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`https://${domain}/api/auth/callback`], logoutUrls: [`https://${domain}/`] },
      preventUserExistenceErrors: true, enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(30), idTokenValidity: cdk.Duration.minutes(30), refreshTokenValidity: cdk.Duration.hours(12),
      authFlows: {},
    });
    const poolDomain = userPool.addDomain("Domain", { cognitoDomain: { domainPrefix: `theckards-${this.account.slice(-6)}` } });

    // ---------- Email (SES) ----------
    const sesTopic = new sns.Topic(this, "SesEvents", { topicName: `${p}-ses-events`, masterKey: alertKey, enforceSSL: true });
    const configSet = new ses.ConfigurationSet(this, "ConfigSet", {
      configurationSetName: `${p}-default`, reputationMetrics: true, tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE, sendingEnabled: true,
    });
    configSet.addEventDestination("Events", {
      destination: ses.EventDestination.snsTopic(sesTopic),
      events: [ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.COMPLAINT, ses.EmailSendingEvent.REJECT, ses.EmailSendingEvent.DELIVERY_DELAY],
    });
    const mailFrom = `mail.${domain}`;
    new ses.EmailIdentity(this, "SesIdentity", {
      identity: ses.Identity.publicHostedZone(base.zone),
      configurationSet: configSet, mailFromDomain: mailFrom,
      mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
    });
    new route53.MxRecord(this, "MailFromMx", { zone: base.zone, recordName: mailFrom, values: [{ priority: 10, hostName: `feedback-smtp.${this.region}.amazonses.com` }] });
    new route53.TxtRecord(this, "MailFromSpf", { zone: base.zone, recordName: mailFrom, values: ["v=spf1 include:amazonses.com ~all"] });
    new route53.TxtRecord(this, "Dmarc", { zone: base.zone, recordName: `_dmarc.${domain}`, values: ["v=DMARC1; p=none; adkim=s; aspf=s"] });
    void sesActions;

    // ---------- Secrets ----------
    const originSecret = new secretsmanager.Secret(this, "OriginVerify", {
      secretName: `theckards/${envName}/origin-verify`, encryptionKey: dataKey,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });

    // ---------- Certificate + DNS ----------
    const cert = new acm.Certificate(this, "Cert", {
      domainName: domain, subjectAlternativeNames: [originDomain],
      validation: acm.CertificateValidation.fromDns(base.zone),
    });

    // ---------- ALB (only reachable from CloudFront) ----------
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc, description: "ALB: CloudFront origin-facing only", allowAllOutbound: false });
    albSg.addIngressRule(ec2.Peer.prefixList(CLOUDFRONT_PREFIX_LIST), ec2.Port.tcp(443), "CloudFront origin-facing");
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      loadBalancerName: `${p}-alb`, vpc, internetFacing: true, securityGroup: albSg, dropInvalidHeaderFields: true, deletionProtection: true,
    });
    const webSg = new ec2.SecurityGroup(this, "WebSg", { vpc, description: "web tasks" });
    const workerSg = new ec2.SecurityGroup(this, "WorkerSg", { vpc, description: "worker tasks" });
    albSg.addEgressRule(webSg, ec2.Port.tcp(3000), "to web tasks");
    webSg.addIngressRule(albSg, ec2.Port.tcp(3000), "from ALB");
    for (const sg of [webSg, workerSg]) {
      dbSg.addIngressRule(sg, ec2.Port.tcp(5432), "tasks to Postgres");
    }

    // ---------- ECS ----------
    const cluster = new ecs.Cluster(this, "Cluster", { clusterName: `${p}-cluster`, vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    const commonEnv: Record<string, string> = {
      NODE_ENV: "production",
      APP_ENV: envName,
      APP_BASE_URL: `https://${domain}`,
      DB_HOST: db.dbInstanceEndpointAddress, DB_PORT: db.dbInstanceEndpointPort, DB_NAME: "theckards",
      JOBS_QUEUE_URL: jobs.queueUrl,
      DOCUMENTS_BUCKET: documents.bucketName,
      SEAL_KEY_ARN: sealKey.keyArn,
      USER_POOL_ID: userPool.userPoolId, USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      COGNITO_DOMAIN: poolDomain.baseUrl(),
      SCHEDULER_GROUP: "theckards",
      APPCONFIG_APPLICATION: "theckards", APPCONFIG_ENVIRONMENT: envName, APPCONFIG_PROFILE: "feature-flags",
      SES_CONFIGURATION_SET: configSet.configurationSetName,
    };
    const dbSecrets = {
      DB_USER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
    };

    const mkTask = (name: string, cpu: number, mem: number) => {
      const td = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        family: `${p}-${name}`, cpu, memoryLimitMiB: mem,
        runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      });
      documents.grantReadWrite(td.taskRole);
      dataKey.grantEncryptDecrypt(td.taskRole);
      td.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ["appconfig:StartConfigurationSession", "appconfig:GetLatestConfiguration"], resources: ["*"],
      }));
      td.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"],
        conditions: { StringEquals: { "ses:FromAddress": [`no-reply@${domain}`] } },
      }));
      return td;
    };

    // web
    const webTask = mkTask("web", 1024, 2048);
    jobs.grantSendMessages(webTask.taskRole);
    webTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["kms:GetPublicKey", "kms:DescribeKey"], resources: [sealKey.keyArn] }));
    const webLogs = new logs.LogGroup(this, "WebLogs", { logGroupName: `/theckards/${envName}/web`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN });
    webTask.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(base.webRepo, props.imageTag),
      environment: commonEnv, secrets: dbSecrets,
      portMappings: [{ containerPort: 3000 }], stopTimeout: cdk.Duration.seconds(30),
      readonlyRootFilesystem: false,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "web", logGroup: webLogs }),
      healthCheck: { command: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval: cdk.Duration.seconds(30), timeout: cdk.Duration.seconds(5), retries: 3, startPeriod: cdk.Duration.seconds(30) },
    });
    const webService = new ecs.FargateService(this, "WebService", {
      serviceName: `${p}-web`, cluster, taskDefinition: webTask, desiredCount: 1, securityGroups: [webSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(60), enableExecuteCommand: false,
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "WebTg", {
      vpc, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [webService], deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: { path: "/healthz", interval: cdk.Duration.seconds(15), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
    });
    const listener = alb.addListener("Https", {
      port: 443, certificates: [cert], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS, open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: "text/plain", messageBody: "Forbidden" }),
    });
    listener.addAction("FromCloudFront", {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader("X-Origin-Verify", [originSecret.secretValue.unsafeUnwrap()])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });
    const webScaling = webService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    webScaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    // worker
    const workerTask = mkTask("worker", 512, 1024);
    jobs.grantConsumeMessages(workerTask.taskRole);
    jobs.grantSendMessages(workerTask.taskRole);
    workerTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"], resources: [sealKey.keyArn] }));
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", { logGroupName: `/theckards/${envName}/worker`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN });
    workerTask.addContainer("worker", {
      image: ecs.ContainerImage.fromEcrRepository(base.workerRepo, props.imageTag),
      environment: commonEnv, secrets: dbSecrets, stopTimeout: cdk.Duration.seconds(30),
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "worker", logGroup: workerLogs }),
      healthCheck: { command: ["CMD-SHELL", "node -e \"fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval: cdk.Duration.seconds(30), timeout: cdk.Duration.seconds(5), retries: 3, startPeriod: cdk.Duration.seconds(30) },
    });
    const workerService = new ecs.FargateService(this, "WorkerService", {
      serviceName: `${p}-worker`, cluster, taskDefinition: workerTask, desiredCount: 1, securityGroups: [workerSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200,
    });
    workerService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 3 }).scaleOnMetric("Queue", {
      metric: jobs.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      scalingSteps: [{ upper: 0, change: -1 }, { lower: 10, change: +1 }, { lower: 100, change: +2 }],
      cooldown: cdk.Duration.minutes(2),
    });

    // ---------- WAF (CloudFront scope) ----------
    const vis = (n: string) => ({ sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: n });
    const managed = (name: string, prio: number) => ({
      name, priority: prio, overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName: "AWS", name } }, visibilityConfig: vis(name),
    });
    const waf = new wafv2.CfnWebACL(this, "Waf", {
      name: `${p}-waf`, scope: "CLOUDFRONT", defaultAction: { allow: {} }, visibilityConfig: vis(`${p}-waf`),
      rules: [
        managed("AWSManagedRulesAmazonIpReputationList", 10),
        managed("AWSManagedRulesCommonRuleSet", 20),
        managed("AWSManagedRulesKnownBadInputsRuleSet", 30),
        managed("AWSManagedRulesSQLiRuleSet", 40),
        { name: "RateLimitOtp", priority: 5, action: { block: {} }, visibilityConfig: vis("RateLimitOtp"),
          statement: { rateBasedStatement: { limit: 50, aggregateKeyType: "IP", evaluationWindowSec: 300,
            scopeDownStatement: { byteMatchStatement: { searchString: "/otp", fieldToMatch: { uriPath: {} }, positionalConstraint: "CONTAINS", textTransformations: [{ priority: 0, type: "LOWERCASE" }] } } } } },
        { name: "RateLimitGlobal", priority: 6, action: { block: {} }, visibilityConfig: vis("RateLimitGlobal"),
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: "IP", evaluationWindowSec: 300 } } },
      ],
    });

    // ---------- CloudFront ----------
    const albOrigin = new origins.HttpOrigin(originDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY, originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      customHeaders: { "X-Origin-Verify": originSecret.secretValue.unsafeUnwrap() },
    });
    const dist = new cloudfront.Distribution(this, "Cdn", {
      comment: `${p} edge`, domainNames: [domain], certificate: cert, webAclId: waf.attrArn,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021, httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: albOrigin, viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER, compress: true,
      },
      additionalBehaviors: {
        "/_next/static/*": {
          origin: albOrigin, viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER, compress: true,
        },
      },
    });
    new route53.ARecord(this, "AliasA", { zone: base.zone, target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(dist)) });
    new route53.AaaaRecord(this, "AliasAAAA", { zone: base.zone, target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(dist)) });
    new route53.ARecord(this, "OriginA", { zone: base.zone, recordName: originDomain, target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)) });

    // ---------- AppConfig (feature flags; edited later by the Admin dashboard) ----------
    const acApp = new appconfig.CfnApplication(this, "AcApp", { name: "theckards" });
    const acEnv = new appconfig.CfnEnvironment(this, "AcEnv", { applicationId: acApp.ref, name: envName });
    const acProfile = new appconfig.CfnConfigurationProfile(this, "AcProfile", {
      applicationId: acApp.ref, name: "feature-flags", locationUri: "hosted", type: "AWS.AppConfig.FeatureFlags",
    });
    const acVersion = new appconfig.CfnHostedConfigurationVersion(this, "AcVersion", {
      applicationId: acApp.ref, configurationProfileId: acProfile.ref,
      content: JSON.stringify(FEATURE_FLAGS), contentType: "application/json",
    });
    new appconfig.CfnDeployment(this, "AcDeploy", {
      applicationId: acApp.ref, environmentId: acEnv.ref, configurationProfileId: acProfile.ref,
      configurationVersion: acVersion.ref, deploymentStrategyId: "AppConfig.AllAtOnce",
    });

    // ---------- Scheduler ----------
    new scheduler.CfnScheduleGroup(this, "SchedGroup", { name: "theckards" });
    const schedulerRole = new iam.Role(this, "SchedulerRole", { roleName: `${p}-scheduler`, assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com") });
    jobs.grantSendMessages(schedulerRole);
    webTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"],
      resources: [`arn:${this.partition}:scheduler:${this.region}:${this.account}:schedule/theckards/*`],
    }));
    webTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["iam:PassRole"], resources: [schedulerRole.roleArn] }));

    // ---------- Alarms ----------
    const alerts = new sns.Topic(this, "Alerts", { topicName: `${p}-alerts`, masterKey: alertKey, enforceSSL: true });
    if (props.alertEmail) alerts.addSubscription(new snsSubs.EmailSubscription(props.alertEmail));
    const act = new cwActions.SnsAction(alerts);
    const alarm = (id: string, metric: cloudwatch.IMetric, threshold: number, desc: string, op = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, periods = 2) => {
      const a = new cloudwatch.Alarm(this, id, { alarmName: `${p}-${id}`, alarmDescription: `${desc} (runbook: docs/runbooks/${id}.md)`, metric, threshold, evaluationPeriods: periods, comparisonOperator: op, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING });
      a.addAlarmAction(act); a.addOkAction(act);
    };
    alarm("alb-5xx", alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: cdk.Duration.minutes(1) }), 5, "ALB 5xx");
    alarm("target-5xx", alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: cdk.Duration.minutes(1) }), 10, "Web 5xx");
    alarm("web-unhealthy", targetGroup.metrics.unhealthyHostCount({ period: cdk.Duration.minutes(1) }), 0, "Unhealthy web tasks");
    alarm("jobs-dlq", dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }), 0, "Messages in DLQ", cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, 1);
    alarm("jobs-age", jobs.metricApproximateAgeOfOldestMessage({ period: cdk.Duration.minutes(1) }), 300, "Queue stalled (oldest message > 5 min)");
    alarm("db-cpu", db.metricCPUUtilization({ period: cdk.Duration.minutes(5) }), 80, "RDS CPU high", cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, 3);
    alarm("db-storage", db.metricFreeStorageSpace({ period: cdk.Duration.minutes(5) }), 5 * 1024 ** 3, "RDS free storage < 5 GB", cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD, 1);
    alarm("cdn-5xx", dist.metric5xxErrorRate({ period: cdk.Duration.minutes(5) }), 5, "CloudFront 5xx rate > 5%");
    alarm("ses-bounce", new cloudwatch.Metric({ namespace: "AWS/SES", metricName: "Reputation.BounceRate", statistic: "Average", period: cdk.Duration.minutes(15) }), 0.05, "SES bounce rate > 5%", cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, 1);
    alarm("ses-complaint", new cloudwatch.Metric({ namespace: "AWS/SES", metricName: "Reputation.ComplaintRate", statistic: "Average", period: cdk.Duration.minutes(15) }), 0.001, "SES complaint rate > 0.1%", cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, 1);

    // ---------- Optional GitHub Actions OIDC role ----------
    if (props.githubRepo) {
      const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GhOidc", `arn:${this.partition}:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`);
      const role = new iam.Role(this, "GithubDeployRole", {
        roleName: "theckards-github-deploy",
        assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:ref:refs/heads/main` },
        }),
        maxSessionDuration: cdk.Duration.hours(1),
      });
      base.webRepo.grantPullPush(role); base.workerRepo.grantPullPush(role);
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
      role.addToPolicy(new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`] }));
    }

    // ---------- Outputs ----------
    new cdk.CfnOutput(this, "Url", { value: `https://${domain}` });
    new cdk.CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "DbEndpoint", { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, "SealKeyArn", { value: sealKey.keyArn });
    new cdk.CfnOutput(this, "JobsQueueUrl", { value: jobs.queueUrl });
    new cdk.CfnOutput(this, "SchedulerRoleArn", { value: schedulerRole.roleArn });

    // ---------- cdk-nag suppressions (each justified; see docs/adr) ----------
    NagSuppressions.addStackSuppressions(this, [
      { id: "AwsSolutions-IAM4", reason: "AWS managed policies used by CDK-generated service roles (ECS execution, flow logs)." },
      { id: "AwsSolutions-IAM5", reason: "Wildcards limited to CDK-generated grants (S3 object paths, KMS data keys, ECR auth token, AppConfig sessions, schedule group prefix)." },
      { id: "AwsSolutions-RDS3", reason: "ADR-002: single-AZ in v1; Multi-AZ requires a cost/risk ADR." },
      { id: "AwsSolutions-RDS11", reason: "Default Postgres port acceptable; instance is isolated and reachable only from task security groups." },
      { id: "AwsSolutions-SMG4", reason: "ADR-010: rotation deferred; app reads credentials at task start. Tracked in S8." },
      { id: "AwsSolutions-COG2", reason: "MFA is optional for end users (email OTP signing is the user check); enforced for the admins group by the BFF (S2/S11)." },
      { id: "AwsSolutions-COG8", reason: "ADR-010: Essentials plan chosen for cost; Plus tier reconsidered after launch." },
      { id: "AwsSolutions-COG3", reason: "Advanced security mode requires Plus feature plan; ADR-010 keeps Essentials." },
      { id: "AwsSolutions-CFR1", reason: "No geo restriction: US launch, global recipients of invites." },
      { id: "AwsSolutions-CFR2", reason: "WAF is attached to the distribution." },
      { id: "AwsSolutions-CFR3", reason: "Access logging deferred to S8 (log bucket with ACLs); WAF logs and ALB metrics available." },
      { id: "AwsSolutions-CFR4", reason: "TLS 1.2_2021 minimum is enforced; custom domain certificate used." },
      { id: "AwsSolutions-CFR7", reason: "Origin is an ALB (custom origin), OAC not applicable." },
      { id: "AwsSolutions-ELB2", reason: "ALB access logs deferred to S8." },
      { id: "AwsSolutions-S1", reason: "S3 server access logs deferred to S8; CloudTrail data events cover audit." },
      { id: "AwsSolutions-ECS2", reason: "Environment variables hold non-secret configuration only; secrets use ECS secrets." },
      { id: "AwsSolutions-SQS3", reason: "DLQ is configured for the jobs queue; the DLQ itself is the dead-letter target." },
      { id: "AwsSolutions-SNS3", reason: "SSL enforced via enforceSSL." },
      { id: "AwsSolutions-L1", reason: "No Lambda runtime owned by this stack (CDK custom resources only)." },
      { id: "AwsSolutions-EC23", reason: "ALB 443 ingress restricted to CloudFront managed prefix list." },
      { id: "AwsSolutions-SMG4", reason: "See above." },
    ], true);
  }
}

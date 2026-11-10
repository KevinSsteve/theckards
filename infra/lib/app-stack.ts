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
import * as cr from "aws-cdk-lib/custom-resources";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as guardduty from "aws-cdk-lib/aws-guardduty";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { NagSuppressions } from "cdk-nag";
import type { BaseStack } from "./base-stack";

export interface AppStackProps extends cdk.StackProps {
  base: BaseStack;
  envName: string;
  imageTag: string;
  useAppDbCredentials: boolean;
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

    // Evidence lands here first and is never served from here. Objects are deleted once scanned, and expire
    // anyway after 7 days so an abandoned upload cannot linger (ADR-020).
    const quarantine = new s3.Bucket(this, "EvidenceQuarantine", {
      bucketName: `${p}-evidence-quarantine-${this.account}`,
      encryption: s3.BucketEncryption.KMS, encryptionKey: dataKey, bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
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

    const appDbSecret = new secretsmanager.Secret(this, "AppDbSecret", {
      secretName: `theckards/${envName}/db-app`,
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "theckards_app" }),
        generateStringKey: "password",
        passwordLength: 40,
        excludePunctuation: true,
      },
    });
    appDbSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

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
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE, cognito.OAuthScope.COGNITO_ADMIN],
        callbackUrls: [`https://${domain}/api/auth/callback`], logoutUrls: [`https://${domain}/`] },
      preventUserExistenceErrors: true, enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.minutes(30), idTokenValidity: cdk.Duration.minutes(30), refreshTokenValidity: cdk.Duration.hours(12),
      authFlows: {},
    });
    const poolDomain = userPool.addDomain("Domain", { cognitoDomain: { domainPrefix: `theckards-${this.account.slice(-6)}` } });
    const userPoolClientSecret = new secretsmanager.Secret(this, "UserPoolClientSecret", {
      secretName: `theckards/${envName}/cognito-client`,
      encryptionKey: dataKey,
      secretStringValue: userPoolClient.userPoolClientSecret,
    });
    userPoolClientSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // ---------- Email (SES) ----------
    const sesTopic = new sns.Topic(this, "SesEvents", { topicName: `${p}-ses-events`, masterKey: alertKey, enforceSSL: true });
    const configSet = new ses.ConfigurationSet(this, "ConfigSet", {
      configurationSetName: `${p}-default`, reputationMetrics: true, tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE, sendingEnabled: true,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
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
    // Inbound mail for @<domain> (owner mailbox, abuse reports, end-to-end tests). Stored privately, kept 30 days.
    const inboundMail = new s3.Bucket(this, "InboundMail", {
      bucketName: `${p}-inbound-mail-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED, blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }], removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Forwarding of selected addresses (cdk.json "mailForwardLocals"). The external target is personal data and is
    // kept out of git: it comes from the deploy environment (THECKARDS_MAIL_FORWARD_TO, sourced from the SSM
    // parameter /theckards/<env>/mail-forward-to) or -c mailForwardTo=... Synth fails if missing, so forwarding is
    // never removed by accident.
    const forwardTo = (this.node.tryGetContext("mailForwardTo") as string | undefined) ?? process.env.THECKARDS_MAIL_FORWARD_TO;
    if (!forwardTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardTo)) {
      throw new Error("Set THECKARDS_MAIL_FORWARD_TO (from SSM /theckards/" + envName + "/mail-forward-to) before synth or deploy.");
    }
    const forwardMap: Record<string, string> = {};
    for (const local of (this.node.tryGetContext("mailForwardLocals") ?? []) as string[]) {
      const target = forwardTo;
      forwardMap[`${local}@${domain}`.toLowerCase()] = target;
    }
    const forwarder = new lambda.Function(this, "MailForwarder", {
      functionName: `${p}-mail-forwarder`,
      runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      handler: "index.handler", code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/mail-forwarder")),
      // No reserved concurrency: the account limit is 10, which is also AWS's minimum unreserved pool.
      memorySize: 256, timeout: cdk.Duration.seconds(30),
      environment: {
        FORWARDS: JSON.stringify(forwardMap), BUCKET: inboundMail.bucketName, PREFIX: "inbox/",
        FROM_ADDRESS: `forwarder@${domain}`, CONFIG_SET: configSet.configurationSetName,
      },
      logGroup: new logs.LogGroup(this, "MailForwarderLogs", { logGroupName: `/theckards/${envName}/mail-forwarder`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN }),
    });
    inboundMail.grantRead(forwarder, "inbox/*");
    forwarder.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"],
      conditions: { StringEquals: { "ses:FromAddress": [`forwarder@${domain}`] } },
    }));
    // While SES is in the sandbox, external forward targets must be verified identities (AWS emails a confirmation link).
    for (const target of new Set(Object.values(forwardMap))) {
      new ses.EmailIdentity(this, `ForwardTarget${createHash("sha256").update(target).digest("hex").slice(0, 8)}`, { identity: ses.Identity.email(target) });
    }

    const inboundRuleSetName = `${p}-inbound`;
    const inboundRules = new ses.ReceiptRuleSet(this, "InboundRules", {
      receiptRuleSetName: inboundRuleSetName,
      rules: [{
        recipients: [domain], scanEnabled: true, tlsPolicy: ses.TlsPolicy.REQUIRE,
        actions: [
          new sesActions.S3({ bucket: inboundMail, objectKeyPrefix: "inbox/" }),
          new sesActions.Lambda({ function: forwarder, invocationType: sesActions.LambdaInvocationType.EVENT }),
        ],
      }],
    });
    const activateRules = new cr.AwsCustomResource(this, "ActivateInboundRules", {
      onCreate: { service: "SES", action: "setActiveReceiptRuleSet", parameters: { RuleSetName: inboundRuleSetName }, physicalResourceId: cr.PhysicalResourceId.of(inboundRuleSetName) },
      onUpdate: { service: "SES", action: "setActiveReceiptRuleSet", parameters: { RuleSetName: inboundRuleSetName }, physicalResourceId: cr.PhysicalResourceId.of(inboundRuleSetName) },
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({ actions: ["ses:SetActiveReceiptRuleSet"], resources: ["*"] })]),
      installLatestAwsSdk: false,
    });
    activateRules.node.addDependency(inboundRules);
    new route53.MxRecord(this, "InboundMx", { zone: base.zone, values: [{ priority: 10, hostName: `inbound-smtp.${this.region}.amazonaws.com` }] });

    // ---------- Secrets ----------
    const originSecret = new secretsmanager.Secret(this, "OriginVerify", {
      secretName: `theckards/${envName}/origin-verify`, encryptionKey: dataKey,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });
    const authHmacSecret = new secretsmanager.Secret(this, "AuthHmacSecret", {
      secretName: `theckards/${envName}/auth-hmac`, encryptionKey: dataKey,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });
    const emailHashSecret = new secretsmanager.Secret(this, "EmailHashSecret", {
      secretName: `theckards/${envName}/email-hash`, encryptionKey: dataKey,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });
    authHmacSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    emailHashSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

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
    const migrationSg = new ec2.SecurityGroup(this, "MigrationSg", { vpc, description: "one-off database migration tasks" });
    albSg.addEgressRule(webSg, ec2.Port.tcp(3000), "to web tasks");
    webSg.addIngressRule(albSg, ec2.Port.tcp(3000), "from ALB");
    for (const sg of [webSg, workerSg, migrationSg]) {
      dbSg.addIngressRule(sg, ec2.Port.tcp(5432), "tasks to Postgres");
    }

    // ---------- ECS ----------
    const cluster = new ecs.Cluster(this, "Cluster", { clusterName: `${p}-cluster`, vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    // ---------- AppConfig (feature flags; later versions are owned by the Admin dashboard) ----------
    const acApp = new appconfig.CfnApplication(this, "AcApp", { name: "theckards" });
    const acEnv = new appconfig.CfnEnvironment(this, "AcEnv", { applicationId: acApp.ref, name: envName });
    const acProfile = new appconfig.CfnConfigurationProfile(this, "AcProfile", {
      applicationId: acApp.ref, name: "feature-flags", locationUri: "hosted", type: "AWS.AppConfig.FeatureFlags",
    });
    const acVersion = new appconfig.CfnHostedConfigurationVersion(this, "AcVersion", {
      applicationId: acApp.ref, configurationProfileId: acProfile.ref,
      content: JSON.stringify(FEATURE_FLAGS), contentType: "application/json",
    });
    const appConfigStrategyId = envName === "prod"
      ? "AppConfig.Linear50PercentEvery30Seconds"
      : "AppConfig.AllAtOnce";
    new appconfig.CfnDeployment(this, "AcDeploy", {
      applicationId: acApp.ref, environmentId: acEnv.ref, configurationProfileId: acProfile.ref,
      configurationVersion: acVersion.ref, deploymentStrategyId: appConfigStrategyId,
    });
    for (const resource of [acApp, acEnv, acProfile, acVersion]) resource.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const commonEnv: Record<string, string> = {
      NODE_ENV: "production",
      APP_ENV: envName,
      APP_BASE_URL: `https://${domain}`,
      DB_HOST: db.dbInstanceEndpointAddress, DB_PORT: db.dbInstanceEndpointPort, DB_NAME: "theckards",
      JOBS_QUEUE_URL: jobs.queueUrl,
      DOCUMENTS_BUCKET: documents.bucketName,
      EVIDENCE_QUARANTINE_BUCKET: quarantine.bucketName,
      SEAL_KEY_ARN: sealKey.keyArn,
      DATA_KEY_ARN: dataKey.keyArn,
      USER_POOL_ID: userPool.userPoolId, USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      COGNITO_DOMAIN: poolDomain.baseUrl(),
      SCHEDULER_GROUP: "theckards",
      APPCONFIG_APPLICATION: "theckards", APPCONFIG_ENVIRONMENT: envName, APPCONFIG_PROFILE: "feature-flags",
      APPCONFIG_APPLICATION_ID: acApp.ref, APPCONFIG_ENVIRONMENT_ID: acEnv.ref, APPCONFIG_PROFILE_ID: acProfile.ref,
      APPCONFIG_DEPLOYMENT_STRATEGY_ID: appConfigStrategyId,
      SES_CONFIGURATION_SET: configSet.configurationSetName,
    };
    const dbCredentialSecret = props.useAppDbCredentials ? appDbSecret : db.secret!;
    const dbSecrets = {
      DB_USER: ecs.Secret.fromSecretsManager(dbCredentialSecret, "username"),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentialSecret, "password"),
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
    webTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["cognito-idp:AdminGetUser"], resources: [userPool.userPoolArn] }));
    webTask.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["appconfig:CreateHostedConfigurationVersion", "appconfig:StartDeployment"],
      resources: [
        `arn:${this.partition}:appconfig:${this.region}:${this.account}:application/${acApp.ref}`,
        `arn:${this.partition}:appconfig:${this.region}:${this.account}:application/${acApp.ref}/*`,
        `arn:${this.partition}:appconfig:${this.region}:${this.account}:deploymentstrategy/*`,
        `arn:${this.partition}:appconfig:${this.region}:aws:deploymentstrategy/*`,
      ],
    }));
    quarantine.grantPut(webTask.taskRole);
    const webLogs = new logs.LogGroup(this, "WebLogs", { logGroupName: `/theckards/${envName}/web`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN });
    webTask.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(base.webRepo, props.imageTag),
      // ECS overrides HOSTNAME with the task hostname; Next.js must bind all interfaces for the localhost health check.
      environment: { ...commonEnv, HOSTNAME: "0.0.0.0", PORT: "3000" }, secrets: {
        ...dbSecrets,
        USER_POOL_CLIENT_SECRET: ecs.Secret.fromSecretsManager(userPoolClientSecret),
        AUTH_HMAC_SECRET: ecs.Secret.fromSecretsManager(authHmacSecret),
        EMAIL_HASH_SECRET: ecs.Secret.fromSecretsManager(emailHashSecret),
      },
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
    quarantine.grantRead(workerTask.taskRole);
    quarantine.grantDelete(workerTask.taskRole);
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", { logGroupName: `/theckards/${envName}/worker`, retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.RETAIN });
    workerTask.addContainer("worker", {
      image: ecs.ContainerImage.fromEcrRepository(base.workerRepo, props.imageTag),
      environment: commonEnv, secrets: { ...dbSecrets, EMAIL_HASH_SECRET: ecs.Secret.fromSecretsManager(emailHashSecret) }, stopTimeout: cdk.Duration.seconds(30),
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

    // One-off migrations run with the RDS administrator secret. No service uses this task definition.
    const migrationTask = new ecs.FargateTaskDefinition(this, "MigrationTask", {
      family: `${p}-migration`, cpu: 512, memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const migrationLogs = new logs.LogGroup(this, "MigrationLogs", {
      logGroupName: `/theckards/${envName}/migration`, retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    migrationTask.addContainer("migration", {
      image: ecs.ContainerImage.fromEcrRepository(base.workerRepo, props.imageTag),
      command: ["node", "dist/migrate.js"],
      environment: {
        NODE_ENV: "production", DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort, DB_NAME: "theckards",
      },
      secrets: {
        DB_ADMIN_USER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
        DB_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
        APP_DB_PASSWORD: ecs.Secret.fromSecretsManager(appDbSecret, "password"),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migration", logGroup: migrationLogs }),
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
        { name: "RateLimitPublicVerify", priority: 4, action: { block: {} }, visibilityConfig: vis("RateLimitPublicVerify"),
          statement: { rateBasedStatement: { limit: 300, aggregateKeyType: "IP", evaluationWindowSec: 300,
            scopeDownStatement: { byteMatchStatement: { searchString: "/api/public/verify/", fieldToMatch: { uriPath: {} }, positionalConstraint: "STARTS_WITH", textTransformations: [{ priority: 0, type: "LOWERCASE" }] } } } } },
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
        "/api/public/verify/*": {
          origin: albOrigin, viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER, compress: true,
        },
        "/.well-known/theckards-keys.json": {
          origin: albOrigin, viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER, compress: true,
        },
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

    // ---------- Evidence malware scanning (ADR-020) ----------
    // GuardDuty Malware Protection for S3 as an independent feature: no detector, no fixed monthly cost.
    const scanRole = new iam.Role(this, "EvidenceScanRole", {
      roleName: `${p}-evidence-scan`,
      assumedBy: new iam.ServicePrincipal("malware-protection-plan.guardduty.amazonaws.com"),
      description: "Lets GuardDuty read and scan objects in the evidence quarantine bucket",
    });
    const managedRuleArn = `arn:${this.partition}:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowManagedRuleToSendS3EventsToGuardDuty",
      actions: ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"],
      resources: [managedRuleArn],
      conditions: { StringLike: { "events:ManagedBy": "malware-protection-plan.guardduty.amazonaws.com" } },
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowGuardDutyToMonitorEventBridgeManagedRule",
      actions: ["events:DescribeRule", "events:ListTargetsByRule"], resources: [managedRuleArn],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowEnableS3EventBridgeEvents",
      actions: ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"], resources: [quarantine.bucketArn],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowPutValidationObject", actions: ["s3:PutObject"],
      resources: [`${quarantine.bucketArn}/malware-protection-resource-validation-object`],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowMalwareScan", actions: ["s3:GetObject", "s3:GetObjectVersion"], resources: [`${quarantine.bucketArn}/*`],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      sid: "AllowDecryptForMalwareScan", actions: ["kms:GenerateDataKey", "kms:Decrypt"], resources: [dataKey.keyArn],
      conditions: { StringLike: { "kms:ViaService": `s3.${this.region}.amazonaws.com` } },
    }));
    const malwarePlan = new guardduty.CfnMalwareProtectionPlan(this, "EvidenceMalwareProtection", {
      role: scanRole.roleArn,
      protectedResource: { s3Bucket: { bucketName: quarantine.bucketName } },
      // Tagging is billed separately and the result already arrives on EventBridge.
      actions: { tagging: { status: "DISABLED" } },
    });
    malwarePlan.node.addDependency(scanRole);
    malwarePlan.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Scan results drive the evidence state machine, through the existing queue (retries + DLQ included).
    new events.Rule(this, "EvidenceScanResult", {
      ruleName: `${p}-evidence-scan-result`,
      description: "GuardDuty S3 malware scan results for the evidence quarantine bucket",
      eventPattern: {
        source: ["aws.guardduty"],
        detailType: ["GuardDuty Malware Protection Object Scan Result"],
        detail: { s3ObjectDetails: { bucketName: [quarantine.bucketName] } },
      },
      targets: [new eventTargets.SqsQueue(jobs, {
        message: events.RuleTargetInput.fromObject({
          id: events.EventField.fromPath("$.id"),
          topic: "evidence.scanned",
          payload: {
            bucket: events.EventField.fromPath("$.detail.s3ObjectDetails.bucketName"),
            key: events.EventField.fromPath("$.detail.s3ObjectDetails.objectKey"),
            scanStatus: events.EventField.fromPath("$.detail.scanStatus"),
            resultStatus: events.EventField.fromPath("$.detail.scanResultDetails.scanResultStatus"),
          },
        }),
      })],
    });

    // If scanning degrades, evidence stays invisible (the safe direction) and the owner is paged.
    new events.Rule(this, "EvidenceScanDegraded", {
      ruleName: `${p}-evidence-scan-degraded`,
      description: "Malware protection plan status warnings and errors (runbook: docs/runbooks/evidence-scanning.md)",
      eventPattern: {
        source: ["aws.guardduty"],
        detailType: ["GuardDuty Malware Protection Resource Status Warning", "GuardDuty Malware Protection Resource Status Error"],
      },
      targets: [new eventTargets.SnsTopic(alerts)],
    });

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
    new cdk.CfnOutput(this, "AppConfigIds", { value: cdk.Fn.join(",", [acApp.ref, acEnv.ref, acProfile.ref]) });
    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "MigrationTaskDefinitionArn", { value: migrationTask.taskDefinitionArn });
    new cdk.CfnOutput(this, "MigrationSecurityGroupId", { value: migrationSg.securityGroupId });
    new cdk.CfnOutput(this, "EvidenceQuarantineBucket", { value: quarantine.bucketName });
    new cdk.CfnOutput(this, "PrivateSubnetIds", { value: cdk.Fn.join(",", vpc.privateSubnets.map((subnet) => subnet.subnetId)) });

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

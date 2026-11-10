import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as route53 from "aws-cdk-lib/aws-route53";
import { NagSuppressions } from "cdk-nag";

export interface BaseStackProps extends cdk.StackProps {
  rootDomain: string;
  rootZoneId: string;
  subdomain: string;
}

/** DNS delegation, container registries and the image build pipeline (no local Docker needed). */
export class BaseStack extends cdk.Stack {
  readonly zone: route53.PublicHostedZone;
  readonly webRepo: ecr.Repository;
  readonly workerRepo: ecr.Repository;
  readonly sourceBucket: s3.Bucket;
  readonly buildProject: codebuild.Project;
  readonly domainName: string;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);
    this.domainName = `${props.subdomain}.${props.rootDomain}`;

    // Sub-zone for the product, delegated from the existing parent zone.
    this.zone = new route53.PublicHostedZone(this, "Zone", { zoneName: this.domainName });
    this.zone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    const parent = route53.PublicHostedZone.fromHostedZoneAttributes(this, "ParentZone", {
      hostedZoneId: props.rootZoneId,
      zoneName: props.rootDomain,
    });
    new route53.NsRecord(this, "Delegation", {
      zone: parent,
      recordName: this.domainName,
      values: this.zone.hostedZoneNameServers!,
      ttl: cdk.Duration.minutes(5),
    });

    const mkRepo = (name: string) =>
      new ecr.Repository(this, `${name}Repo`, {
        repositoryName: `theckards-${name}`,
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        encryption: ecr.RepositoryEncryption.AES_256,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        lifecycleRules: [{ maxImageCount: 30 }],
      });
    this.webRepo = mkRepo("web");
    this.workerRepo = mkRepo("worker");

    this.sourceBucket = new s3.Bucket(this, "SourceBucket", {
      bucketName: `theckards-build-src-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30), noncurrentVersionExpiration: cdk.Duration.days(7) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.buildProject = new codebuild.Project(this, "ImageBuild", {
      projectName: "theckards-image-build",
      source: codebuild.Source.s3({ bucket: this.sourceBucket, path: "source.zip" }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true,
      },
      environmentVariables: {
        ECR_REGISTRY: { value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com` },
        IMAGE_TAG: { value: "latest" },
      },
      timeout: cdk.Duration.minutes(30),
    });
    this.webRepo.grantPullPush(this.buildProject);
    this.workerRepo.grantPullPush(this.buildProject);
    this.buildProject.addToRolePolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));

    new cdk.CfnOutput(this, "NameServers", { value: cdk.Fn.join(",", this.zone.hostedZoneNameServers!) });
    new cdk.CfnOutput(this, "SourceBucketName", { value: this.sourceBucket.bucketName });

    NagSuppressions.addStackSuppressions(this, [
      { id: "AwsSolutions-S1", reason: "Build-source bucket holds only transient source archives (30-day lifecycle); access logs deferred." },
      { id: "AwsSolutions-CB4", reason: "Build artefacts are source code only; S3-managed encryption is sufficient." },
      { id: "AwsSolutions-IAM5", reason: "CodeBuild/ECR wildcards are CDK-generated grants scoped to this project's bucket, log group and ECR auth token." },
    ], true);
  }
}

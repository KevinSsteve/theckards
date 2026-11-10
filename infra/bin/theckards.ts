#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { BaseStack } from "../lib/base-stack";
import { AppStack } from "../lib/app-stack";

const app = new cdk.App({ defaultStackSynthesizer: new cdk.DefaultStackSynthesizer({ qualifier: "theckards" }) });
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" };
const envName = ctx("envName") ?? "prod";
const rootDomain = ctx("rootDomain")!;
const subdomain = ctx("subdomain")!;

const base = new BaseStack(app, "TheckardsBase", {
  env, rootDomain, rootZoneId: ctx("rootZoneId")!, subdomain,
  terminationProtection: true,
});

if (ctx("imageTag")) {
  new AppStack(app, `Theckards-${envName}`, {
    env, base, envName,
    imageTag: ctx("imageTag")!,
    alertEmail: ctx("alertEmail"),
    githubRepo: ctx("githubRepo"),
    terminationProtection: true,
  });
}

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

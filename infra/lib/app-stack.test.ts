import { existsSync } from "node:fs";
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { beforeAll, describe, expect, it } from "vitest";
import { AppStack } from "./app-stack";
import { BaseStack } from "./base-stack";

let template: Template;
let annotations: Annotations;

beforeAll(() => {
  const app = new cdk.App({ context: { mailForwardLocals: [], mailForwardTo: "forward@example.invalid" } });
  const env = { account: "111111111111", region: "us-east-1" };
  const base = new BaseStack(app, "TestBase", {
    env, rootDomain: "example.invalid", rootZoneId: "Z111111111111", subdomain: "theckards",
  });
  const stack = new AppStack(app, "TestApp", {
    env, base, envName: "prod", imageTag: "test", useAppDbCredentials: true,
    alertEmail: "alerts@example.invalid",
  });
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  template = Template.fromStack(stack);
  annotations = Annotations.fromStack(stack);
});

const resources = (type: string) => Object.values(template.findResources(type))
  .map((resource) => (resource as { Properties?: Record<string, unknown> }).Properties ?? {});

describe("R-OPS-2 burn-rate alarms", () => {
  it("creates exactly four non-paging windows for each implemented SLI", () => {
    const alarms = resources("AWS::CloudWatch::Alarm");
    const slo = alarms.filter((alarm) => /-slo-(availability|pdf-preview)-/.test(String(alarm.AlarmName)));
    expect(slo.map((alarm) => alarm.AlarmName).sort()).toEqual([
      "theckards-prod-slo-availability-fast-1h",
      "theckards-prod-slo-availability-fast-5m",
      "theckards-prod-slo-availability-slow-30m",
      "theckards-prod-slo-availability-slow-6h",
      "theckards-prod-slo-pdf-preview-fast-1h",
      "theckards-prod-slo-pdf-preview-fast-5m",
      "theckards-prod-slo-pdf-preview-slow-30m",
      "theckards-prod-slo-pdf-preview-slow-6h",
    ]);
    for (const alarm of slo) {
      expect(alarm.ActionsEnabled).toBe(false);
      expect(alarm.AlarmActions).toBeUndefined();
      expect(alarm.OKActions).toBeUndefined();
    }
    for (const alarm of slo.filter((item) => String(item.AlarmName).includes("pdf-preview"))) {
      expect(alarm.EvaluationPeriods).toBe(1);
      expect(alarm.DatapointsToAlarm).toBe(1);
    }
  });

  it("pins the 14.4x and 6x thresholds, windows and missing-data meaning", () => {
    const alarms = new Map(resources("AWS::CloudWatch::Alarm")
      .filter((alarm) => /-slo-(availability|pdf-preview)-/.test(String(alarm.AlarmName)))
      .map((alarm) => [alarm.AlarmName, alarm]));
    const availability: Record<string, { periods: number; bad: number }> = {
      "fast-5m": { periods: 5, bad: 1 },
      "fast-1h": { periods: 60, bad: 1 },
      "slow-30m": { periods: 30, bad: 1 },
      "slow-6h": { periods: 360, bad: 3 },
    };
    for (const [window, values] of Object.entries(availability)) {
      const alarm = alarms.get(`theckards-prod-slo-availability-${window}`)!;
      expect(alarm).toMatchObject({
        Threshold: 1, EvaluationPeriods: values.periods, DatapointsToAlarm: values.bad,
        ComparisonOperator: "LessThanThreshold", TreatMissingData: "breaching",
      });
      const rendered = JSON.stringify(alarm.Metrics);
      expect(rendered).toContain("FILL(status, 0)");
      expect(rendered).toContain('"Period":60');
    }
    const pdf: Record<string, { window: string; threshold: number }> = {
      "fast-5m": { window: "5m", threshold: 0.144 },
      "fast-1h": { window: "1h", threshold: 0.144 },
      "slow-30m": { window: "30m", threshold: 0.06 },
      "slow-6h": { window: "6h", threshold: 0.06 },
    };
    for (const [name, values] of Object.entries(pdf)) {
      expect(alarms.get(`theckards-prod-slo-pdf-preview-${name}`)).toMatchObject({
        Namespace: "Theckards/SLO", MetricName: "PdfPreviewFailureRate", Period: 60,
        Dimensions: [{ Name: "Window", Value: values.window }], Threshold: values.threshold,
        ComparisonOperator: "GreaterThanThreshold", TreatMissingData: "notBreaching",
      });
    }
  });

  it("pages only through one AND/OR composite per SLI", () => {
    const composites = resources("AWS::CloudWatch::CompositeAlarm");
    expect(composites.map((alarm) => alarm.AlarmName).sort()).toEqual([
      "theckards-prod-slo-availability-burn", "theckards-prod-slo-pdf-preview-burn",
    ]);
    for (const alarm of composites) {
      const rule = JSON.stringify(alarm.AlarmRule);
      expect(rule).toContain("AND");
      expect(rule).toContain("OR");
      expect(alarm.AlarmActions).toHaveLength(1);
      expect(alarm.OKActions).toHaveLength(1);
    }
  });

  it("grants the worker only namespaced metric publication and alarms if its heartbeat stops", () => {
    const policy = resources("AWS::IAM::Policy").find((item) => JSON.stringify(item).includes("cloudwatch:PutMetricData"))!;
    const rendered = JSON.stringify(policy);
    expect(rendered).toContain("cloudwatch:namespace");
    expect(rendered).toContain("Theckards/SLO");
    expect(rendered).not.toContain("logs:PutMetricFilter");

    const heartbeat = resources("AWS::CloudWatch::Alarm").find((item) => item.AlarmName === "theckards-prod-slo-metrics-publisher")!;
    expect(heartbeat).toMatchObject({
      MetricName: "PublisherHeartbeat", Namespace: "Theckards/SLO", Period: 60,
      Threshold: 1, EvaluationPeriods: 10, DatapointsToAlarm: 8,
      ComparisonOperator: "LessThanThreshold", TreatMissingData: "breaching",
    });
    expect(heartbeat.AlarmActions).toHaveLength(1);
  });
});

describe("the SLO dashboard and operating links", () => {
  it("makes no-data email explicit and shows SLO, volume, burn and diagnosis without log queries", () => {
    const dashboard = resources("AWS::CloudWatch::Dashboard").find((item) => item.DashboardName === "theckards-prod-slos")!;
    const body = JSON.stringify(dashboard.DashboardBody);
    expect(body).toContain("Email delivery SLO: unavailable");
    expect(body).toContain("PdfPreviewFailureRate");
    expect(body).toContain("HealthCheckStatus");
    expect(body).toContain("Paging SLO alarms");
    expect(body).toContain("Availability burn windows");
    expect(body).toContain("TIME_SERIES(100 * SUM(good) / SUM(samples))");
    expect(body).toContain("30-day sample coverage");
    expect(body).toContain("IF(failure >= 0, 100 * (1 - failure), -1)");
    expect(body).toContain("-1 means no eligible previews");
    expect(body).not.toContain("setPeriodToTimeRange");
    expect(body).not.toMatch(/query|SOURCE|filter @message/i);
  });

  it("resolves every runbook path named by a paging alarm", () => {
    const descriptions = [
      ...resources("AWS::CloudWatch::Alarm"), ...resources("AWS::CloudWatch::CompositeAlarm"),
    ].map((item) => String(item.AlarmDescription ?? ""));
    const paths = descriptions.flatMap((description) =>
      [...description.matchAll(/runbook: (docs\/runbooks\/[a-z0-9-]+\.md)/g)].map((match) => match[1]!),
    );
    expect(paths).toHaveLength(15);
    const root = path.resolve(process.cwd(), "..");
    for (const runbook of paths) expect(existsSync(path.join(root, runbook)), runbook).toBe(true);
  });

  it("has no unsuppressed AWS Solutions errors", () => {
    expect(annotations.findError("*", Match.stringLikeRegexp("AwsSolutions-"))).toEqual([]);
  });
});

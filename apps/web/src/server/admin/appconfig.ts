import { CreateHostedConfigurationVersionCommand, StartDeploymentCommand, AppConfigClient } from "@aws-sdk/client-appconfig";
import { env } from "../env";

const appconfig = new AppConfigClient({});

type Flags = Record<string, boolean | readonly string[]>;

export async function deployFeatureFlags(flags: Flags): Promise<{ version: number; deploymentNumber?: number }> {
  const names: Record<string, string> = {
    AI_ENABLED: "ai_enabled",
    ANCHOR_ENABLED: "anchor_enabled",
    PUBLIC_PROFILE_ENABLED: "public_profile_enabled",
    CUSTOM_TEMPLATES_ENABLED: "custom_templates_enabled",
    RESEAL_AFTER_PURCHASE: "reseal_after_purchase",
    SIGNUPS_ENABLED: "signups_enabled",
    MAINTENANCE_MODE: "maintenance_mode",
    EMAIL_DELIVERY_ENABLED: "email_delivery_enabled",
  };
  const mapped = Object.fromEntries(Object.entries(names).map(([source, target]) => [target, { enabled: flags[source] === true }]));
  const content = {
    version: "1",
    flags: Object.fromEntries(Object.keys(mapped).map((key) => [key, { name: key }])),
    values: mapped,
  };
  const created = await appconfig.send(new CreateHostedConfigurationVersionCommand({
    ApplicationId: env().APPCONFIG_APPLICATION_ID,
    ConfigurationProfileId: env().APPCONFIG_PROFILE_ID,
    ContentType: "application/json",
    Content: Buffer.from(JSON.stringify(content)),
    Description: "Admin dashboard feature flag update",
  }));
  if (!created.VersionNumber) throw new Error("AppConfig did not create a version");
  const deployment = await appconfig.send(new StartDeploymentCommand({
    ApplicationId: env().APPCONFIG_APPLICATION_ID,
    EnvironmentId: env().APPCONFIG_ENVIRONMENT_ID,
    ConfigurationProfileId: env().APPCONFIG_PROFILE_ID,
    ConfigurationVersion: String(created.VersionNumber),
    DeploymentStrategyId: env().APPCONFIG_DEPLOYMENT_STRATEGY_ID,
    Description: "Admin dashboard feature flag deployment",
  }));
  return { version: created.VersionNumber, deploymentNumber: deployment.DeploymentNumber };
}

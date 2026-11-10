import { createHash } from "node:crypto";
import { AdminGetUserCommand, AssociateSoftwareTokenCommand, CognitoIdentityProviderClient, SetUserMFAPreferenceCommand, VerifySoftwareTokenCommand } from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env";
import { randomToken, signPayload, verifySignedPayload } from "../crypto";

export type AuthIntent = "user" | "admin";

export interface AuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  intent: AuthIntent;
  createdAt: number;
}

interface CognitoClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  amr?: string[];
  auth_time?: number;
}

export interface CognitoTokens {
  accessToken: string;
  refreshToken?: string;
  claims: CognitoClaims;
}

const client = new CognitoIdentityProviderClient({});
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function issuer(): string {
  return `https://cognito-idp.${env().AWS_REGION}.amazonaws.com/${env().USER_POOL_ID}`;
}

export function beginAuthorization(intent: AuthIntent): { url: string; transaction: string } {
  const transaction: AuthTransaction = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    intent,
    createdAt: Date.now(),
  };
  const challenge = createHash("sha256").update(transaction.verifier).digest("base64url");
  const url = new URL("/oauth2/authorize", env().COGNITO_DOMAIN);
  url.searchParams.set("client_id", env().USER_POOL_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${env().APP_BASE_URL}/api/auth/callback`);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("nonce", transaction.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), transaction: signPayload(transaction) };
}

export function readAuthTransaction(value: string | undefined): AuthTransaction | null {
  if (!value) return null;
  const transaction = verifySignedPayload<AuthTransaction>(value);
  if (!transaction || Date.now() - transaction.createdAt > 10 * 60_000) return null;
  if (!(["user", "admin"] as const).includes(transaction.intent)) return null;
  return transaction;
}

export async function exchangeAuthorizationCode(code: string, transaction: AuthTransaction): Promise<CognitoTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env().USER_POOL_CLIENT_ID,
    code,
    redirect_uri: `${env().APP_BASE_URL}/api/auth/callback`,
    code_verifier: transaction.verifier,
  });
  const basic = Buffer.from(`${env().USER_POOL_CLIENT_ID}:${env().USER_POOL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(new URL("/oauth2/token", env().COGNITO_DOMAIN), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Cognito token exchange failed (${response.status})`);
  const tokens = await response.json() as { id_token?: string; access_token?: string; refresh_token?: string };
  if (!tokens.id_token || !tokens.access_token) throw new Error("Cognito token response incomplete");
  jwks ??= createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`));
  const verified = await jwtVerify(tokens.id_token, jwks, {
    issuer: issuer(),
    audience: env().USER_POOL_CLIENT_ID,
  });
  const claims = verified.payload as CognitoClaims;
  if (claims.nonce !== transaction.nonce || !claims.sub || !claims.email || claims.email_verified !== true) {
    throw new Error("Cognito identity claims failed validation");
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, claims };
}

export function groupsFromClaims(claims: CognitoClaims): readonly string[] {
  return Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [];
}

export async function hasConfiguredTotp(claims: CognitoClaims): Promise<boolean> {
  const username = claims["cognito:username"];
  if (!username) return false;
  const user = await client.send(new AdminGetUserCommand({ UserPoolId: env().USER_POOL_ID, Username: username }));
  const configured = user.UserMFASettingList?.includes("SOFTWARE_TOKEN_MFA") ?? false;
  if (!configured) return false;
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  return methods.length === 0 || methods.includes("mfa") || methods.includes("otp");
}

export async function beginTotpSetup(accessToken: string): Promise<string> {
  const output = await client.send(new AssociateSoftwareTokenCommand({ AccessToken: accessToken }));
  if (!output.SecretCode) throw new Error("Cognito did not return a TOTP secret");
  return output.SecretCode;
}

export async function verifyTotpSetup(accessToken: string, code: string): Promise<void> {
  const verified = await client.send(new VerifySoftwareTokenCommand({ AccessToken: accessToken, UserCode: code, FriendlyDeviceName: "Theckards admin" }));
  if (verified.Status !== "SUCCESS") throw new Error("TOTP verification failed");
  await client.send(new SetUserMFAPreferenceCommand({
    AccessToken: accessToken,
    SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
  }));
}

export function cognitoLogoutUrl(): string {
  const url = new URL("/logout", env().COGNITO_DOMAIN);
  url.searchParams.set("client_id", env().USER_POOL_CLIENT_ID);
  url.searchParams.set("logout_uri", env().APP_BASE_URL);
  return url.toString();
}

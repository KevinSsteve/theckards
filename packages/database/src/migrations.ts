import { agreementStateCheckSql } from "@theckards/domain";
import { ESIGN_V1, NOTICE_V1, PRIVACY_V1, TERMS_V1 } from "./legal-v1.js";
import { ESIGN_V2, PRIVACY_V2, PRIVACY_V2_REPLACEMENTS, TERMS_V2, TERMS_V2_REPLACEMENTS } from "./legal-v2.js";

const lit = (value: string) => `$legal$${value}$legal$`;
const replaced = (column: string, pairs: ReadonlyArray<readonly [string, string]>) =>
  pairs.reduce((expr, [from, to]) => `replace(${expr}, ${lit(from)}, ${lit(to)})`, column);
const draftV2FromApprovedV1 = (type: string, pairs: ReadonlyArray<readonly [string, string]>) => `
INSERT INTO legal_documents(document_type, locale, version, status, title, body_md)
SELECT document_type, locale, 2, 'DRAFT', title, ${replaced("body_md", pairs)}
FROM legal_documents WHERE document_type = '${type}' AND locale = 'en-US' AND version = 1 AND status = 'APPROVED'
ON CONFLICT (document_type, locale, version) DO NOTHING;`;

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: "0001",
    name: "auth_admin_foundation",
    sql: `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub text UNIQUE NOT NULL,
  email_ciphertext bytea NOT NULL,
  email_hash char(64) UNIQUE NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('USER', 'ADMIN', 'GUEST')),
  groups text[] NOT NULL DEFAULT '{}',
  csrf_hash char(64) NOT NULL,
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  inactivity_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  recent_auth_at timestamptz NOT NULL,
  revoked_at timestamptz,
  guest_agreement_id uuid,
  guest_party_id uuid,
  CHECK ((kind = 'GUEST') OR (guest_agreement_id IS NULL AND guest_party_id IS NULL))
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions(user_id, absolute_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('TERMS', 'PRIVACY', 'ESIGN', 'NOTICE')),
  locale text NOT NULL DEFAULT 'en-US',
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  title text NOT NULL,
  body_md text NOT NULL,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE(document_type, locale, version),
  CHECK ((status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status <> 'APPROVED')
);
CREATE INDEX IF NOT EXISTS legal_documents_active_idx ON legal_documents(document_type, locale, version DESC) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  legal_document_id uuid NOT NULL REFERENCES legal_documents(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_ciphertext bytea,
  user_agent_ciphertext bytea,
  UNIQUE(user_id, legal_document_id)
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  subject_hash char(64) NOT NULL,
  code_hash char(64) NOT NULL,
  ip_hash char(64),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_lookup_idx ON otp_codes(scope, subject_hash, expires_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  subject_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_events_lookup_idx ON rate_limit_events(scope, subject_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope, key)
);

CREATE TABLE IF NOT EXISTS admin_users (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'SUPPORT')),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setting_key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(setting_key, version)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  locale text NOT NULL DEFAULT 'en-US',
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  subject text NOT NULL,
  body_mjml text NOT NULL,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  UNIQUE(template_key, locale, version)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'ADMIN', 'GUEST', 'SYSTEM')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  request_id text,
  before_value jsonb,
  after_value jsonb,
  prev_hash char(64),
  row_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(created_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_consents_append_only ON user_consents;
CREATE TRIGGER user_consents_append_only BEFORE UPDATE OR DELETE ON user_consents
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
DROP TRIGGER IF EXISTS settings_history_append_only ON app_settings_history;
CREATE TRIGGER settings_history_append_only BEFORE UPDATE OR DELETE ON app_settings_history
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();

CREATE OR REPLACE FUNCTION protect_approved_legal_document() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'approved legal documents cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'APPROVED' AND (
    NEW.document_type IS DISTINCT FROM OLD.document_type OR
    NEW.locale IS DISTINCT FROM OLD.locale OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.body_md IS DISTINCT FROM OLD.body_md OR
    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'approved legal document content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS legal_documents_protect_approved ON legal_documents;
CREATE TRIGGER legal_documents_protect_approved BEFORE UPDATE OR DELETE ON legal_documents
FOR EACH ROW EXECUTE FUNCTION protect_approved_legal_document();
`,
  },
  {
    id: "0002",
    name: "seed_admin_configuration",
    sql: `
INSERT INTO app_settings(key, value) VALUES
  ('plans_limits', '{"free":{"monthlyAgreements":2,"watermark":true},"perAgreement":{"amountCents":499,"currency":"USD"},"pro":{"amountCents":1900,"currency":"USD","monthlyAgreements":30},"inviteDailyFree":20,"inviteDailyPro":200,"uploadMaxBytes":26214400}'::jsonb),
  ('auth', '{"inviteValidityDays":7,"otpValidityMinutes":10,"otpMaxAttempts":5,"userSessionHours":12,"userIdleMinutes":30,"adminSessionHours":4,"adminIdleMinutes":15}'::jsonb),
  ('ai', '{"enabled":true,"provider":"bedrock","modelId":"anthropic.claude-opus-5-5","fallbackModelId":"anthropic.claude-sonnet-5-5","timeoutMs":20000,"maxOutputTokens":1500,"dailyLimitFree":10,"dailyLimitPaid":100}'::jsonb),
  ('retention', '{"logsDays":90,"backupsDays":14,"invitesDays":7,"agreementsDays":null,"evidenceDays":null,"messagesDays":null,"signaturesDays":null}'::jsonb),
  ('email', '{"from":"no-reply@theckards.linkealls.com","replyTo":null,"locale":"en-US"}'::jsonb),
  ('feature_flags', '{"AI_ENABLED":true,"ANCHOR_ENABLED":false,"PUBLIC_PROFILE_ENABLED":false,"CUSTOM_TEMPLATES_ENABLED":false,"RESEAL_AFTER_PURCHASE":false,"SIGNUPS_ENABLED":true,"MAINTENANCE_MODE":false,"ACTIVE_LOCALES":["en-US"]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings_history(setting_key, value, version)
SELECT key, value, version FROM app_settings
ON CONFLICT (setting_key, version) DO NOTHING;

INSERT INTO legal_documents(document_type, locale, version, status, title, body_md) VALUES
  ('TERMS', 'en-US', 1, 'DRAFT', 'Terms of Service', '# Terms of Service\n\nDRAFT — approval required before public launch.'),
  ('PRIVACY', 'en-US', 1, 'DRAFT', 'Privacy Policy', '# Privacy Policy\n\nDRAFT — approval required before public launch.'),
  ('ESIGN', 'en-US', 1, 'DRAFT', 'Electronic Signature Consent', '# Electronic Signature Consent\n\nDRAFT — approval required before signing.'),
  ('NOTICE', 'en-US', 1, 'DRAFT', 'Important Notice', '# Important Notice\n\nTheckards provides a verifiable record. It does not provide legal advice or handle payments between parties.')
ON CONFLICT (document_type, locale, version) DO NOTHING;
`,
  },
  {
    id: "0003",
    name: "agreement_engine",
    sql: `
CREATE TABLE IF NOT EXISTS agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id),
  template_id text NOT NULL CHECK (template_id IN ('purchase_sale', 'services', 'general')),
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  state text NOT NULL DEFAULT 'DRAFT' ${agreementStateCheckSql("state")},
  lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version > 0),
  current_version_number integer NOT NULL DEFAULT 1 CHECK (current_version_number > 0),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agreements_creator_idx ON agreements(creator_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agreements_state_due_idx ON agreements(state, due_at) WHERE due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agreement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  number integer NOT NULL CHECK (number > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  fields jsonb NOT NULL,
  content_sha256 char(64) NOT NULL,
  render_status text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'READY', 'FAILED')),
  document_s3_key text,
  document_sha256 char(64),
  render_error_code text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agreement_id, number),
  CHECK ((render_status = 'READY' AND document_s3_key IS NOT NULL AND document_sha256 IS NOT NULL) OR render_status <> 'READY')
);
CREATE INDEX IF NOT EXISTS agreement_versions_current_idx ON agreement_versions(agreement_id, number DESC);

CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  role text NOT NULL CHECK (role IN ('CREATOR', 'COUNTERPARTY')),
  user_id uuid REFERENCES users(id),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  email_ciphertext bytea,
  email_hash char(64),
  invite_token_hash char(64) UNIQUE,
  invite_expires_at timestamptz,
  invited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agreement_id, role),
  CHECK (role <> 'CREATOR' OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS parties_user_idx ON parties(user_id, agreement_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS parties_invite_idx ON parties(invite_token_hash) WHERE invite_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS milestones_agreement_due_idx ON milestones(agreement_id, due_at);

CREATE TABLE IF NOT EXISTS processed_jobs (
  job_id uuid PRIMARY KEY,
  topic text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION protect_agreement_version_content() RETURNS trigger AS $$
BEGIN
  IF NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.fields IS DISTINCT FROM OLD.fields
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agreement version content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS agreement_versions_content_immutable ON agreement_versions;
CREATE TRIGGER agreement_versions_content_immutable BEFORE UPDATE ON agreement_versions
FOR EACH ROW EXECUTE FUNCTION protect_agreement_version_content();

ALTER TABLE sessions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_actor_scope_check CHECK (
  (kind = 'GUEST' AND user_id IS NULL AND guest_agreement_id IS NOT NULL AND guest_party_id IS NOT NULL)
  OR (kind IN ('USER', 'ADMIN') AND user_id IS NOT NULL AND guest_agreement_id IS NULL AND guest_party_id IS NULL)
) NOT VALID;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_actor_scope_check;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_guest_agreement_fk') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_guest_agreement_fk FOREIGN KEY (guest_agreement_id) REFERENCES agreements(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_guest_party_fk') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_guest_party_fk FOREIGN KEY (guest_party_id) REFERENCES parties(id);
  END IF;
END $$;
`,
  },
  {
    id: "0004",
    name: "signing_and_sealing",
    sql: `
ALTER TABLE parties ADD COLUMN IF NOT EXISTS invite_consumed_at timestamptz;

CREATE TABLE IF NOT EXISTS signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  version_id uuid NOT NULL REFERENCES agreement_versions(id),
  party_id uuid NOT NULL REFERENCES parties(id),
  typed_name text NOT NULL CHECK (char_length(typed_name) BETWEEN 3 AND 120),
  esign_document_id uuid NOT NULL REFERENCES legal_documents(id),
  otp_verified_at timestamptz NOT NULL,
  ip_ciphertext bytea,
  user_agent_ciphertext bytea,
  document_sha256 char(64) NOT NULL,
  content_sha256 char(64) NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, party_id)
);
CREATE INDEX IF NOT EXISTS signatures_agreement_idx ON signatures(agreement_id, version_id);

CREATE TABLE IF NOT EXISTS party_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  legal_document_id uuid NOT NULL REFERENCES legal_documents(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_ciphertext bytea,
  user_agent_ciphertext bytea,
  UNIQUE(party_id, legal_document_id)
);

CREATE TABLE IF NOT EXISTS sealed_documents (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  version_id uuid REFERENCES agreement_versions(id),
  kind text NOT NULL CHECK (kind IN ('FINAL', 'ADDENDUM', 'DOSSIER')),
  s3_key text NOT NULL,
  sha256 char(64) NOT NULL UNIQUE,
  content_sha256 char(64) NOT NULL,
  kms_key_id text NOT NULL,
  algorithm text NOT NULL DEFAULT 'ECDSA_P256_SHA256',
  signature bytea NOT NULL,
  receipt jsonb NOT NULL,
  watermarked boolean NOT NULL DEFAULT true,
  anchor_id uuid,
  sealed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agreement_id, version_id, kind)
);

ALTER TABLE agreements ADD COLUMN IF NOT EXISTS executed_at timestamptz;

DROP TRIGGER IF EXISTS signatures_append_only ON signatures;
CREATE TRIGGER signatures_append_only BEFORE UPDATE OR DELETE ON signatures
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
DROP TRIGGER IF EXISTS party_consents_append_only ON party_consents;
CREATE TRIGGER party_consents_append_only BEFORE UPDATE OR DELETE ON party_consents
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
DROP TRIGGER IF EXISTS sealed_documents_append_only ON sealed_documents;
CREATE TRIGGER sealed_documents_append_only BEFORE UPDATE OR DELETE ON sealed_documents
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_change();
`,
  },
  {
    id: "0005",
    name: "qr_link_invitations",
    sql: `
ALTER TABLE parties ADD COLUMN IF NOT EXISTS invite_channel text NOT NULL DEFAULT 'EMAIL';
ALTER TABLE parties ADD COLUMN IF NOT EXISTS invite_token_ciphertext bytea;
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_invite_channel_check;
ALTER TABLE parties ADD CONSTRAINT parties_invite_channel_check CHECK (invite_channel IN ('EMAIL', 'LINK'));
`,
  },
  {
    id: "0006",
    name: "legal_drafts_v1_content",
    // Replaces only the untouched seed placeholders (short DRAFT v1 bodies); never overwrites owner edits or approvals.
    sql: `
UPDATE legal_documents SET body_md = $legal$${TERMS_V1}$legal$ WHERE document_type = 'TERMS' AND version = 1 AND status = 'DRAFT' AND char_length(body_md) < 200;
UPDATE legal_documents SET body_md = $legal$${PRIVACY_V1}$legal$ WHERE document_type = 'PRIVACY' AND version = 1 AND status = 'DRAFT' AND char_length(body_md) < 200;
UPDATE legal_documents SET body_md = $legal$${ESIGN_V1}$legal$, title = 'Electronic Records and Signature Consent' WHERE document_type = 'ESIGN' AND version = 1 AND status = 'DRAFT' AND char_length(body_md) < 200;
UPDATE legal_documents SET body_md = $legal$${NOTICE_V1}$legal$ WHERE document_type = 'NOTICE' AND version = 1 AND status = 'DRAFT' AND char_length(body_md) < 200;
`,
  },
  {
    id: "0007",
    name: "in_person_qr_signing",
    sql: `
ALTER TABLE signatures ALTER COLUMN otp_verified_at DROP NOT NULL;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'EMAIL_OTP';
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS confirmed_by_party_id uuid REFERENCES parties(id);
ALTER TABLE signatures DROP CONSTRAINT IF EXISTS signatures_verification_method_check;
ALTER TABLE signatures ADD CONSTRAINT signatures_verification_method_check CHECK (verification_method IN ('EMAIL_OTP', 'ACCOUNT_SESSION', 'IN_PERSON_QR'));

ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_invite_channel_check;
ALTER TABLE parties ADD CONSTRAINT parties_invite_channel_check CHECK (invite_channel IN ('EMAIL', 'LINK', 'IN_PERSON'));

CREATE TABLE IF NOT EXISTS in_person_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  version_id uuid NOT NULL REFERENCES agreement_versions(id),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED')),
  expires_at timestamptz NOT NULL,
  device_hash char(64),
  typed_name text CHECK (typed_name IS NULL OR char_length(typed_name) BETWEEN 3 AND 120),
  code_hash char(64),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  ip_ciphertext bytea,
  user_agent_ciphertext bytea,
  requested_at timestamptz,
  completed_at timestamptz,
  party_id uuid REFERENCES parties(id),
  guest_session_issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS in_person_sessions_agreement_idx ON in_person_sessions(agreement_id, created_at DESC);

UPDATE app_settings SET value = value || '{"EMAIL_DELIVERY_ENABLED": false}'::jsonb, version = version + 1, updated_at = now()
WHERE key = 'feature_flags' AND NOT (value ? 'EMAIL_DELIVERY_ENABLED');
INSERT INTO app_settings_history(setting_key, value, version)
SELECT key, value, version FROM app_settings WHERE key = 'feature_flags'
ON CONFLICT (setting_key, version) DO NOTHING;
${draftV2FromApprovedV1("TERMS", TERMS_V2_REPLACEMENTS)}
${draftV2FromApprovedV1("PRIVACY", PRIVACY_V2_REPLACEMENTS)}
INSERT INTO legal_documents(document_type, locale, version, status, title, body_md)
VALUES ('ESIGN', 'en-US', 2, 'DRAFT', 'Electronic Records and Signature Consent', ${lit(ESIGN_V2)})
ON CONFLICT (document_type, locale, version) DO NOTHING;
`,
  },
  {
    id: "0008",
    name: "repair_in_person_legal_v2_drafts",
    // Migration 0007 used exact English replacements. The owner-approved v1 copy had been edited/translated,
    // so its v2 copy could remain identical. Replace only an unchanged DRAFT copy; never overwrite owner edits.
    sql: `
ALTER TABLE in_person_sessions ADD COLUMN IF NOT EXISTS code_expires_at timestamptz;
ALTER TABLE in_person_sessions ADD COLUMN IF NOT EXISTS download_claim_hash char(64);

UPDATE legal_documents v2 SET title = 'Terms of Service', body_md = ${lit(TERMS_V2)}
WHERE v2.document_type = 'TERMS' AND v2.locale = 'en-US' AND v2.version = 2 AND v2.status = 'DRAFT'
  AND v2.body_md = (SELECT v1.body_md FROM legal_documents v1
    WHERE v1.document_type = 'TERMS' AND v1.locale = 'en-US' AND v1.version = 1 AND v1.status = 'APPROVED');

UPDATE legal_documents v2 SET title = 'Privacy Policy', body_md = ${lit(PRIVACY_V2)}
WHERE v2.document_type = 'PRIVACY' AND v2.locale = 'en-US' AND v2.version = 2 AND v2.status = 'DRAFT'
  AND v2.body_md = (SELECT v1.body_md FROM legal_documents v1
    WHERE v1.document_type = 'PRIVACY' AND v1.locale = 'en-US' AND v1.version = 1 AND v1.status = 'APPROVED');
`,
  },
] as const;

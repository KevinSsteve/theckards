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
] as const;

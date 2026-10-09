-- Embodied Godis Retreat: initial schema.
-- Money is stored as integer cents (USD). Times are timestamptz; each retreat has an explicit IANA timezone.
-- Every booking and inventory unit belongs to a retreat, so later seasonal events stay separate.

CREATE TABLE IF NOT EXISTS retreats (
  id              text PRIMARY KEY,
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'America/New_York',
  start_date      date,
  end_date        date,
  nights          int CHECK (nights IS NULL OR nights >= 0),
  dates_confirmed boolean NOT NULL DEFAULT false,
  venue_name      text,
  venue_city      text,
  venue_confirmed boolean NOT NULL DEFAULT false,
  private_address text,                       -- shown only to confirmed guests
  day_pass_enabled boolean NOT NULL DEFAULT false,
  day_pass_price_cents int CHECK (day_pass_price_cents IS NULL OR day_pass_price_cents >= 0),
  terms           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- fees, deposit, installments, cancellation, transfer, refund
  terms_confirmed boolean NOT NULL DEFAULT false,
  legal_confirmed boolean NOT NULL DEFAULT false,
  reservations_open boolean NOT NULL DEFAULT false,
  is_current      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_types (
  id               text PRIMARY KEY,
  retreat_id       text NOT NULL REFERENCES retreats(id),
  name             text NOT NULL,
  sort             int NOT NULL DEFAULT 0,
  price_cents      int NOT NULL CHECK (price_cents >= 0),
  price_basis      text NOT NULL DEFAULT 'unconfirmed'
                   CHECK (price_basis IN ('unconfirmed','per_guest','per_room','per_sleeping_unit')),
  includes_admission text NOT NULL DEFAULT 'unconfirmed' CHECK (includes_admission IN ('unconfirmed','yes','no')),
  occupancy_label  text,                      -- as supplied ("Double occupancy"); never used to compute capacity
  guest_capacity   int CHECK (guest_capacity IS NULL OR guest_capacity > 0),  -- null = to confirm
  beds             text,
  bathroom         text,
  privacy          text,
  features         text,
  accessibility    text,
  difference_note  text,
  description      text,
  photos           jsonb NOT NULL DEFAULT '[]'::jsonb,
  visible          boolean NOT NULL DEFAULT true,
  inventory_confirmed boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_types_retreat ON room_types(retreat_id, sort);

CREATE TABLE IF NOT EXISTS inventory_units (
  id           text PRIMARY KEY,
  retreat_id   text NOT NULL REFERENCES retreats(id),
  room_type_id text NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  label        text NOT NULL,
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available','blocked','sold')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_units_type ON inventory_units(room_type_id);

CREATE TABLE IF NOT EXISTS profiles (
  id            text PRIMARY KEY,
  email_norm    text UNIQUE NOT NULL,
  name          text,
  verified_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id               text PRIMARY KEY,
  retreat_id       text NOT NULL REFERENCES retreats(id),
  email_norm       text NOT NULL,
  email_display    text NOT NULL,
  name             text NOT NULL,
  room_pref        text,
  intention        text,
  source           text,
  tags             jsonb NOT NULL DEFAULT '{}'::jsonb,
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_version  text NOT NULL,
  privacy_version  text NOT NULL,
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','invited','converted','removed')),
  notes            text,
  profile_id       text REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retreat_id, email_norm)
);

CREATE TABLE IF NOT EXISTS consent_events (
  id          bigserial PRIMARY KEY,
  email_norm  text NOT NULL,
  profile_id  text,
  kind        text NOT NULL,          -- 'marketing' | 'privacy_notice'
  granted     boolean NOT NULL,
  version     text NOT NULL,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_events_email ON consent_events(email_norm, created_at);

-- ---------- Reservations and payments (used from Phase 2; modeled now) ----------
CREATE TABLE IF NOT EXISTS bookings (
  id             text PRIMARY KEY,
  retreat_id     text NOT NULL REFERENCES retreats(id),
  profile_id     text NOT NULL REFERENCES profiles(id),
  room_type_id   text REFERENCES room_types(id),
  unit_id        text REFERENCES inventory_units(id),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','canceled','refunded','expired')),
  price_snapshot jsonb NOT NULL,      -- room, price, basis, fees as sold
  terms_snapshot jsonb NOT NULL,      -- deposit, schedule, refund/cancellation text as accepted
  total_cents    int NOT NULL CHECK (total_cents >= 0),
  roommate_pref  text,
  confirmed_at   timestamptz,
  confirmed_by   text,                -- 'stripe:<event id>' or 'admin:<id>' (audited)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One active hold or sale per unit. A second simultaneous buyer hits this unique index.
CREATE TABLE IF NOT EXISTS holds (
  id          text PRIMARY KEY,
  unit_id     text NOT NULL REFERENCES inventory_units(id),
  booking_id  text REFERENCES bookings(id),
  expires_at  timestamptz NOT NULL,
  released_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_per_unit ON holds(unit_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS payment_obligations (
  id          text PRIMARY KEY,
  booking_id  text NOT NULL REFERENCES bookings(id),
  label       text NOT NULL,
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  due_at      timestamptz,
  status      text NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','failed','canceled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id           text PRIMARY KEY,
  booking_id   text REFERENCES bookings(id),
  obligation_id text REFERENCES payment_obligations(id),
  provider     text NOT NULL,
  provider_ref text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('payment','refund','manual')),
  amount_cents int NOT NULL,
  status       text NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           text PRIMARY KEY,      -- provider event id; makes handling idempotent
  provider     text NOT NULL,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          text PRIMARY KEY,
  profile_id  text NOT NULL REFERENCES profiles(id),
  booking_id  text REFERENCES bookings(id),
  form_key    text NOT NULL,
  data        jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Content, email, staff, audit ----------
CREATE TABLE IF NOT EXISTS content (
  key           text PRIMARY KEY,
  draft         jsonb NOT NULL,
  published     jsonb NOT NULL,
  draft_updated_at timestamptz NOT NULL DEFAULT now(),
  draft_updated_by text,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  text
);

CREATE TABLE IF NOT EXISTS content_versions (
  id           bigserial PRIMARY KEY,
  key          text NOT NULL,
  data         jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text
);

CREATE TABLE IF NOT EXISTS email_templates (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('operational','campaign')),
  subject     text NOT NULL,
  body        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

CREATE TABLE IF NOT EXISTS email_jobs (
  id            text PRIMARY KEY,
  to_email      text NOT NULL,
  template_key  text,
  subject       text NOT NULL,
  html          text NOT NULL,
  text_body     text NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','canceled')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_id   text,
  ref           text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS email_jobs_due ON email_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS admins (
  id              text PRIMARY KEY,
  email           text UNIQUE NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('owner','staff')),
  pass_hash       text,
  totp_secret_enc text,
  totp_enabled    boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  invite_hash     text,
  invite_expires  timestamptz,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash     text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('guest','admin')),
  subject_id  text NOT NULL,
  mfa_ok      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          text PRIMARY KEY,
  email_norm  text NOT NULL,
  code_hash   text NOT NULL,
  name        text,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_email ON otp_codes(email_norm, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        int NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          bigserial PRIMARY KEY,
  actor_id    text,
  actor_label text NOT NULL,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_time ON audit_events(created_at DESC);

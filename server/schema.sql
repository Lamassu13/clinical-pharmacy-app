CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  fingerprint_number TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  account_status TEXT NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending', 'active', 'rejected', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wards (
  id BIGSERIAL PRIMARY KEY,
  floor_number INTEGER,
  name TEXT NOT NULL,
  is_special BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (floor_number, name)
);

CREATE TABLE IF NOT EXISTS user_floor_access (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  floor_number INTEGER NOT NULL CHECK (floor_number IN (2, 3, 4, 5, 6, 8, 9, 10)),
  assigned_by BIGINT NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, floor_number)
);

CREATE TABLE IF NOT EXISTS user_ward_access (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ward_name TEXT NOT NULL,
  assigned_by BIGINT NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ward_name)
);

CREATE TABLE IF NOT EXISTS daily_charts (
  id BIGSERIAL PRIMARY KEY,
  ward_id BIGINT NOT NULL REFERENCES wards(id),
  chart_date DATE NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ward_id, chart_date)
);

CREATE TABLE IF NOT EXISTS medicines (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chart_patients (
  id BIGSERIAL PRIMARY KEY,
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 41),
  patient_name TEXT NOT NULL DEFAULT '',
  UNIQUE (chart_id, row_number)
);

CREATE TABLE IF NOT EXISTS chart_columns (
  id BIGSERIAL PRIMARY KEY,
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 51),
  medicine_id BIGINT REFERENCES medicines(id),
  custom_name TEXT,
  UNIQUE (chart_id, column_number)
);

CREATE TABLE IF NOT EXISTS chart_quantities (
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 41),
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 51),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (chart_id, row_number, column_number)
);

ALTER TABLE medicines ADD COLUMN IF NOT EXISTS arabic_name TEXT;
ALTER TABLE chart_columns ADD COLUMN IF NOT EXISTS custom_name TEXT;

-- Optimistic-concurrency counter. PUT /api/chart replaces the whole chart (delete + reinsert
-- its patients/columns/quantities) on every autosave, so two clients on the same ward/date —
-- plausible on a shared iPad — could otherwise each PUT a full snapshot taken before the
-- other's edit landed, and the later request would silently erase it. The server only accepts
-- a PUT whose expectedVersion matches this counter, and bumps it on every accepted save; a
-- mismatch means someone else saved first, and the client reconciles instead of overwriting.
ALTER TABLE daily_charts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Keyed by the medicine's normalised name, not by a catalogue id. A chart column is free
-- text: it links to the catalogue when it matches one, and stands alone when it does not.
-- Keying on the id meant an unlinked column could hold no dose times at all, and deleting
-- a medicine from the catalogue cascaded away the dose times on every past printed form.
CREATE TABLE IF NOT EXISTS pill_entries (
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  patient_row_number INTEGER NOT NULL CHECK (patient_row_number BETWEEN 1 AND 41),
  medicine_key TEXT NOT NULL,
  dose_time TEXT NOT NULL DEFAULT '',
  usage_method TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (chart_id, patient_row_number, medicine_key)
);
ALTER TABLE pill_entries ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
-- Move a database created before the re-key above off medicine_id. Guarded on the old column
-- still existing, because this file runs unattended on every deploy and the statements inside
-- are not individually idempotent. Fresh databases skip the whole block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pill_entries' AND column_name = 'medicine_id') THEN
    ALTER TABLE pill_entries ADD COLUMN IF NOT EXISTS medicine_key TEXT;
    UPDATE pill_entries pe SET medicine_key = lower(btrim(regexp_replace(m.name, '\s+', ' ', 'g')))
      FROM medicines m WHERE m.id = pe.medicine_id AND pe.medicine_key IS NULL;
    -- Nothing left to name it by: the catalogue row is already gone.
    DELETE FROM pill_entries WHERE medicine_key IS NULL;
    -- Two catalogue rows differing only in case collapse to one key here.
    DELETE FROM pill_entries pe USING pill_entries other
      WHERE pe.chart_id = other.chart_id AND pe.patient_row_number = other.patient_row_number
        AND pe.medicine_key = other.medicine_key AND pe.medicine_id > other.medicine_id;
    ALTER TABLE pill_entries ALTER COLUMN medicine_key SET NOT NULL;
    ALTER TABLE pill_entries DROP CONSTRAINT IF EXISTS pill_entries_pkey;
    ALTER TABLE pill_entries ADD PRIMARY KEY (chart_id, patient_row_number, medicine_key);
    ALTER TABLE pill_entries DROP COLUMN medicine_id;
  END IF;
END $$;
-- An earlier `lead_note` column was never wired to the form's leading column, which is a
-- blank box the nurse fills in by hand on the printed sheet. Databases created before this
-- keep the column; it defaults to '' so inserts that omit it succeed. Dropping it belongs in
-- a one-off psql command, not here — this file runs unattended on every deploy.

CREATE TABLE IF NOT EXISTS pill_patient_meta (
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  patient_row_number INTEGER NOT NULL CHECK (patient_row_number BETWEEN 1 AND 41),
  room_number TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (chart_id, patient_row_number)
);

-- Admit the supervisor role on databases created when only admin and user existed. Same
-- drop-then-add shape as the row-number widening below, so the deploy can run it every time.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'supervisor', 'user'));

-- Widen the patient-row cap from 36 to 41 on databases created before this change.
ALTER TABLE chart_patients DROP CONSTRAINT IF EXISTS chart_patients_row_number_check;
ALTER TABLE chart_patients ADD CONSTRAINT chart_patients_row_number_check CHECK (row_number BETWEEN 1 AND 41);
ALTER TABLE chart_quantities DROP CONSTRAINT IF EXISTS chart_quantities_row_number_check;
ALTER TABLE chart_quantities ADD CONSTRAINT chart_quantities_row_number_check CHECK (row_number BETWEEN 1 AND 41);
ALTER TABLE pill_entries DROP CONSTRAINT IF EXISTS pill_entries_patient_row_number_check;
ALTER TABLE pill_entries ADD CONSTRAINT pill_entries_patient_row_number_check CHECK (patient_row_number BETWEEN 1 AND 41);
ALTER TABLE pill_patient_meta DROP CONSTRAINT IF EXISTS pill_patient_meta_patient_row_number_check;
ALTER TABLE pill_patient_meta ADD CONSTRAINT pill_patient_meta_patient_row_number_check CHECK (patient_row_number BETWEEN 1 AND 41);

-- Notices from the manager/admin shown on the dashboard everyone lands on after login.
CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_charts_date_idx ON daily_charts (chart_date);
CREATE INDEX IF NOT EXISTS chart_quantities_chart_idx ON chart_quantities (chart_id);
CREATE INDEX IF NOT EXISTS users_account_status_idx ON users (account_status);
CREATE INDEX IF NOT EXISTS pill_entries_chart_idx ON pill_entries (chart_id);
CREATE INDEX IF NOT EXISTS announcements_created_at_idx ON announcements (created_at DESC);

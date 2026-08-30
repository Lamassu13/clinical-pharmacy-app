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
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 36),
  patient_name TEXT NOT NULL DEFAULT '',
  UNIQUE (chart_id, row_number)
);

CREATE TABLE IF NOT EXISTS chart_columns (
  id BIGSERIAL PRIMARY KEY,
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 51),
  medicine_id BIGINT REFERENCES medicines(id),
  UNIQUE (chart_id, column_number)
);

CREATE TABLE IF NOT EXISTS chart_quantities (
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number BETWEEN 1 AND 36),
  column_number INTEGER NOT NULL CHECK (column_number BETWEEN 1 AND 51),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (chart_id, row_number, column_number)
);

ALTER TABLE medicines ADD COLUMN IF NOT EXISTS arabic_name TEXT;

CREATE TABLE IF NOT EXISTS pill_entries (
  chart_id BIGINT NOT NULL REFERENCES daily_charts(id) ON DELETE CASCADE,
  patient_row_number INTEGER NOT NULL CHECK (patient_row_number BETWEEN 1 AND 36),
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  dose_time TEXT NOT NULL DEFAULT '',
  usage_method TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (chart_id, patient_row_number, medicine_id)
);
ALTER TABLE pill_entries ADD COLUMN IF NOT EXISTS lead_note TEXT NOT NULL DEFAULT '';
ALTER TABLE pill_entries ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS daily_charts_date_idx ON daily_charts (chart_date);
CREATE INDEX IF NOT EXISTS chart_quantities_chart_idx ON chart_quantities (chart_id);
CREATE INDEX IF NOT EXISTS users_account_status_idx ON users (account_status);
CREATE INDEX IF NOT EXISTS pill_entries_chart_idx ON pill_entries (chart_id);

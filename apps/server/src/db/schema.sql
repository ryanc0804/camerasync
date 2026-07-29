CREATE TABLE IF NOT EXISTS users (
    user_id     SERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(63) DEFAULT NULL,
    profile_picture TEXT,
    roles       JSON NOT NULL DEFAULT '[]',
    password    TEXT NOT NULL,
    organizations JSON DEFAULT NULL,
    settings JSON NOT NULL DEFAULT '{}',
    agreements JSON NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
    user_id     BIGINT NOT NULL,
    session_token TEXT,
    csrf_token TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    device VARCHAR(32),
    expires TIMESTAMP DEFAULT NOW()
);

-- Every authenticated request looks a session up by its cookie value, so this
-- index keeps that lookup from becoming a sequential scan.
CREATE INDEX IF NOT EXISTS sessions_session_token_idx ON sessions (session_token);

CREATE TABLE IF NOT EXISTS groups (
    group_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    password_hash TEXT,
    owner_id BIGINT NOT NULL REFERENCES users(user_id),
    primary_color CHAR(7) NOT NULL DEFAULT '#ffc72c',
    secondary_color CHAR(7) NOT NULL DEFAULT '#0d0d0d',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (is_public OR password_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS groups_group_id_lower_idx
    ON groups (LOWER(group_id));

CREATE TABLE IF NOT EXISTS group_members (
    group_id VARCHAR(64) NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL DEFAULT 'member'
        CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

UPDATE group_members
SET role = 'member'
WHERE role NOT IN ('admin', 'member');

ALTER TABLE group_members
    DROP CONSTRAINT IF EXISTS group_members_role_check;

ALTER TABLE group_members
    ADD CONSTRAINT group_members_role_check
    CHECK (role IN ('admin', 'member'));

CREATE TABLE IF NOT EXISTS organizations (
    org_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(64),
    admins JSON DEFAULT '[]',
    rec_sessions JSON DEFAULT '[]'
);

-- stores scheduled and live group sessions
CREATE TABLE IF NOT EXISTS recording_sessions (
    id VARCHAR(6) PRIMARY KEY
        CHECK (id ~ '^[a-z0-9]{6}$'),
    group_id VARCHAR(64) NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by BIGINT NOT NULL REFERENCES users(user_id),
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'active', 'complete', 'cancelled'))
);

UPDATE recording_sessions
SET status = 'complete'
WHERE status = 'completed';

ALTER TABLE recording_sessions
    DROP CONSTRAINT IF EXISTS recording_sessions_status_check;

ALTER TABLE recording_sessions
    ADD CONSTRAINT recording_sessions_status_check
    CHECK (status IN ('scheduled', 'active', 'complete', 'cancelled'));

CREATE INDEX IF NOT EXISTS recording_sessions_group_date_idx
    ON recording_sessions (group_id, scheduled_at);

-- tracks users who joined each session
CREATE TABLE IF NOT EXISTS recording_session_members (
    session_id VARCHAR(6) NOT NULL
        REFERENCES recording_sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS videos (
    recording_uri TEXT,
    session_id VARCHAR(255),
    author BIGINT
);

CREATE TABLE IF NOT EXISTS recordings (
    id uuid PRIMARY KEY,
    name text,
    status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'recording', 'stopped', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    stopped_at timestamptz,
    closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS posts (
    post_id     VARCHAR(255) PRIMARY KEY,
    author      BIGINT NOT NULL,
    content     TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    video_meta  JSON,
    reply       VARCHAR(255)
);

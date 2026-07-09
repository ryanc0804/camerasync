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

CREATE TABLE IF NOT EXISTS organizations (
    org_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(64),
    admins JSON DEFAULT '[]',
    rec_sessions JSON DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS videos (
    recording_uri TEXT,
    session_id VARCHAR(255),
    author BIGINT
);

CREATE TABLE IF NOT EXISTS recordings (
    sessions    JSON DEFAULT '[]',
    org_id      VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
    post_id     VARCHAR(255) PRIMARY KEY,
    author      BIGINT NOT NULL,
    content     TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    video_meta  JSON,
    reply       VARCHAR(255)
);
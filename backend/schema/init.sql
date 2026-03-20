-- Minimal schema for FastAPI app (PostgreSQL)
-- Tables in dependency order. UUID PKs, snake_case, ON DELETE CASCADE where appropriate.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. core_organization
CREATE TABLE IF NOT EXISTS core_organization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. core_user
CREATE TABLE IF NOT EXISTS core_user (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(254) NOT NULL UNIQUE,
    full_name varchar(255) NOT NULL,
    password varchar(128) NOT NULL,
    is_staff boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    is_superuser boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login timestamptz,
    avatar_url varchar(2048) NOT NULL DEFAULT '',
    login_otp_hash varchar(256),
    login_otp_expires_at timestamptz
);

-- 3. core_organizationmember
CREATE TABLE IF NOT EXISTS core_organizationmember (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    role varchar(32) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

-- 4. core_space
CREATE TABLE IF NOT EXISTS core_space (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. core_project
CREATE TABLE IF NOT EXISTS core_project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id uuid NOT NULL REFERENCES core_space(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. core_board
CREATE TABLE IF NOT EXISTS core_board (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id uuid NOT NULL REFERENCES core_space(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES core_project(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. core_column
CREATE TABLE IF NOT EXISTS core_column (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES core_board(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    order_index int NOT NULL DEFAULT 0,
    is_done boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. core_track
CREATE TABLE IF NOT EXISTS core_track (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES core_board(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    order_index int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. core_card
CREATE TABLE IF NOT EXISTS core_card (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id uuid NOT NULL REFERENCES core_board(id) ON DELETE CASCADE,
    column_id uuid NOT NULL REFERENCES core_column(id) ON DELETE CASCADE,
    track_id uuid REFERENCES core_track(id) ON DELETE SET NULL,
    title varchar(255) NOT NULL,
    description text,
    card_type varchar(32) NOT NULL DEFAULT '\''task'\'',
    due_at timestamptz,
    planned_start_at timestamptz,
    planned_end_at timestamptz,
    estimate_points int,
    parent_id uuid REFERENCES core_card(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. core_checklist
CREATE TABLE IF NOT EXISTS core_checklist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL
);

-- 11. core_checklistitem
CREATE TABLE IF NOT EXISTS core_checklistitem (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id uuid NOT NULL REFERENCES core_checklist(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    is_done boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. core_attachment
CREATE TABLE IF NOT EXISTS core_attachment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    uploaded_by_id uuid REFERENCES core_user(id) ON DELETE SET NULL,
    file_name varchar(255) NOT NULL,
    file_url varchar(2048) NOT NULL,
    content_type varchar(127) NOT NULL,
    size_bytes bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. core_cardcomment
CREATE TABLE IF NOT EXISTS core_cardcomment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 13.1 core_cardassignment
CREATE TABLE IF NOT EXISTS core_cardassignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    assigned_by_id uuid REFERENCES core_user(id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(card_id, user_id)
);

CREATE INDEX IF NOT EXISTS core_cardassignment_user_idx ON core_cardassignment(user_id);
CREATE INDEX IF NOT EXISTS core_cardassignment_card_idx ON core_cardassignment(card_id);

-- 13.2 core_cardcommentreadstate
CREATE TABLE IF NOT EXISTS core_cardcommentreadstate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    last_seen_comment_at timestamptz NOT NULL DEFAULT to_timestamp(0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(card_id, user_id)
);

CREATE INDEX IF NOT EXISTS core_cardcommentreadstate_user_idx ON core_cardcommentreadstate(user_id);
CREATE INDEX IF NOT EXISTS core_cardcommentreadstate_card_idx ON core_cardcommentreadstate(card_id);

-- 13.3 core_commentattachmentlink
CREATE TABLE IF NOT EXISTS core_commentattachmentlink (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id uuid NOT NULL REFERENCES core_cardcomment(id) ON DELETE CASCADE,
    attachment_id uuid NOT NULL REFERENCES core_attachment(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(comment_id, attachment_id)
);

-- 14. core_cardmovementevent
CREATE TABLE IF NOT EXISTS core_cardmovementevent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES core_user(id) ON DELETE SET NULL,
    event_type varchar(16) NOT NULL,
    from_column_id uuid REFERENCES core_column(id) ON DELETE SET NULL,
    to_column_id uuid REFERENCES core_column(id) ON DELETE SET NULL,
    from_track_id uuid REFERENCES core_track(id) ON DELETE SET NULL,
    to_track_id uuid REFERENCES core_track(id) ON DELETE SET NULL,
    metadata jsonb,
    happened_at timestamptz NOT NULL DEFAULT now()
);

-- 15. core_wiplimit
CREATE TABLE IF NOT EXISTS core_wiplimit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    board_id uuid NOT NULL REFERENCES core_board(id) ON DELETE CASCADE,
    scope_type varchar(16) NOT NULL,
    column_id uuid REFERENCES core_column(id) ON DELETE CASCADE,
    track_id uuid REFERENCES core_track(id) ON DELETE CASCADE,
    "limit" int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 16. core_automationrule
CREATE TABLE IF NOT EXISTS core_automationrule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    board_id uuid NOT NULL REFERENCES core_board(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    trigger_type varchar(64) NOT NULL,
    trigger_params jsonb NOT NULL,
    actions jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 17. core_automationexecution
CREATE TABLE IF NOT EXISTS core_automationexecution (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    rule_id uuid NOT NULL REFERENCES core_automationrule(id) ON DELETE CASCADE,
    event_id uuid NOT NULL,
    status varchar(32) NOT NULL,
    executed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rule_id, event_id)
);

-- 18. core_cardfielddefinition
CREATE TABLE IF NOT EXISTS core_cardfielddefinition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id uuid NOT NULL REFERENCES core_space(id) ON DELETE CASCADE,
    key varchar(64) NOT NULL,
    name varchar(255) NOT NULL,
    field_type varchar(16) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (space_id, key)
);

-- 19. core_cardfieldvalue
CREATE TABLE IF NOT EXISTS core_cardfieldvalue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
    definition_id uuid NOT NULL REFERENCES core_cardfielddefinition(id) ON DELETE CASCADE,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (card_id, definition_id)
);

-- 20. core_usergroup
CREATE TABLE IF NOT EXISTS core_usergroup (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    role varchar(32) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 21. core_groupmembership
CREATE TABLE IF NOT EXISTS core_groupmembership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES core_usergroup(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 22. core_notification
CREATE TABLE IF NOT EXISTS core_notification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    kind varchar(64) NOT NULL,
    title varchar(255) NOT NULL,
    body text NOT NULL,
    metadata jsonb,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_core_notification_user_created ON core_notification (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_notification_user_unread ON core_notification (user_id, is_read);

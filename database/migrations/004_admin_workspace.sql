BEGIN;

ALTER TABLE users
    ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN suspended_at TIMESTAMPTZ,
    ADD COLUMN suspended_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN suspension_reason TEXT,
    ADD CONSTRAINT chk_user_suspension_state CHECK (
        (is_suspended AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)
        OR (NOT is_suspended AND suspended_at IS NULL AND suspension_reason IS NULL)
    );

ALTER TABLE needs
    ADD COLUMN moderation_status VARCHAR(20) NOT NULL DEFAULT 'VISIBLE'
        CHECK (moderation_status IN ('VISIBLE', 'HIDDEN')),
    ADD COLUMN moderated_at TIMESTAMPTZ,
    ADD COLUMN moderated_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN moderation_reason TEXT,
    ADD CONSTRAINT chk_need_moderation_state CHECK (
        (moderation_status = 'HIDDEN' AND moderated_at IS NOT NULL AND moderation_reason IS NOT NULL)
        OR (moderation_status = 'VISIBLE' AND moderated_at IS NULL AND moderation_reason IS NULL)
    );

CREATE TABLE admin_action_history (
    action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    target_type VARCHAR(30) NOT NULL CHECK (target_type IN ('USER', 'NEED')),
    target_id UUID NOT NULL,
    action VARCHAR(30) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

GRANT SELECT, INSERT
ON TABLE public.admin_action_history
TO ngo_connect_runtime;

REVOKE UPDATE, DELETE, TRUNCATE
ON TABLE public.admin_action_history
FROM ngo_connect_runtime;

REVOKE UPDATE, DELETE, TRUNCATE
ON TABLE public.admin_action_history
FROM PUBLIC;

CREATE INDEX idx_admin_action_history_target ON admin_action_history(target_type, target_id, created_at DESC);
CREATE INDEX idx_users_admin_search ON users(role, is_suspended, created_at DESC);
CREATE INDEX idx_needs_admin_moderation ON needs(moderation_status, status, created_at DESC);

COMMIT;

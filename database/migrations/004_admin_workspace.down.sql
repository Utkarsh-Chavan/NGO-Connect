BEGIN;

DROP TABLE admin_action_history;
DROP INDEX idx_users_admin_search;
DROP INDEX idx_needs_admin_moderation;
ALTER TABLE needs
    DROP CONSTRAINT chk_need_moderation_state,
    DROP COLUMN moderation_reason,
    DROP COLUMN moderated_by_user_id,
    DROP COLUMN moderated_at,
    DROP COLUMN moderation_status;
ALTER TABLE users
    DROP CONSTRAINT chk_user_suspension_state,
    DROP COLUMN suspension_reason,
    DROP COLUMN suspended_by_user_id,
    DROP COLUMN suspended_at,
    DROP COLUMN is_suspended;

COMMIT;

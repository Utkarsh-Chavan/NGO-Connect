-- Install pgcrypto once as the database bootstrap role before applying this
-- file. Run this file with SET ROLE ngo_connect_owner (see MIGRATIONS.md).
SET ROLE ngo_connect_owner;

-- ============================================
-- NGO Connect - Database Schema
-- PostgreSQL
-- ============================================

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL,

    email VARCHAR(150) NOT NULL UNIQUE,

    password_hash VARCHAR(255) NOT NULL,

    role VARCHAR(20) NOT NULL
        CHECK (role IN ('INDIVIDUAL', 'NGO', 'ADMIN')),

    email_verified BOOLEAN NOT NULL DEFAULT FALSE,

    email_verified_at TIMESTAMPTZ,

    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    suspended_at TIMESTAMPTZ,
    suspended_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    suspension_reason TEXT,

    phone VARCHAR(20),

    city VARCHAR(100),

    availability JSONB,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_user_suspension_state CHECK (
        (is_suspended AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)
        OR (NOT is_suspended AND suspended_at IS NULL AND suspension_reason IS NULL)
    )
);

CREATE TABLE ngos (
    ngo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE,

    name VARCHAR(150) NOT NULL,

    description TEXT,

    email VARCHAR(150) NOT NULL,

    phone VARCHAR(20),

    address TEXT,

    city VARCHAR(100) NOT NULL,

    website_url VARCHAR(255),

    verification_status VARCHAR(20) NOT NULL DEFAULT 'NOT_SUBMITTED',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ngos_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_ngos_verification_status
        CHECK (
            verification_status IN (
                'NOT_SUBMITTED',
                'PENDING',
                'NEEDS_INFO',
                'APPROVED',
                'REJECTED'
            )
        ),
    CONSTRAINT chk_ngos_website_url_protocol
        CHECK (website_url IS NULL OR website_url ~* '^https?://')
);

CREATE TABLE email_verification_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_email_verification_tokens_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_email_verification_token_hash_length
        CHECK (octet_length(token_hash) = 32),

    CONSTRAINT chk_email_verification_token_expiry
        CHECK (expires_at > created_at)
);

CREATE TABLE ngo_verification_submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id UUID,
    ngo_id_snapshot UUID NOT NULL,
    submission_number INTEGER NOT NULL CHECK (submission_number > 0),
    status VARCHAR(20) NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    legacy_import BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_by_user_id UUID,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ngo_verification_submissions_ngo
        FOREIGN KEY (ngo_id)
        REFERENCES ngos(ngo_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_ngo_verification_submissions_submitter
        FOREIGN KEY (submitted_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL,

    CONSTRAINT uq_ngo_submission_number
        UNIQUE (ngo_id_snapshot, submission_number),

    CONSTRAINT chk_ngo_submission_status
        CHECK (
            status IN (
                'PENDING',
                'NEEDS_INFO',
                'APPROVED',
                'REJECTED',
                'SUPERSEDED'
            )
        ),

    CONSTRAINT chk_ngo_submission_current_status
        CHECK (
            (is_current AND status <> 'SUPERSEDED')
            OR
            (NOT is_current AND status = 'SUPERSEDED')
        ),

    CONSTRAINT chk_ngo_submission_legacy_timestamp
        CHECK (
            (legacy_import AND submitted_at IS NULL)
            OR
            (NOT legacy_import AND submitted_at IS NOT NULL)
        )
);

CREATE TABLE ngo_verification_documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID,
    submission_id_snapshot UUID NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    storage_provider VARCHAR(40) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(150) NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 BYTEA NOT NULL,
    uploaded_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ngo_verification_documents_submission
        FOREIGN KEY (submission_id)
        REFERENCES ngo_verification_submissions(submission_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_ngo_verification_documents_uploader
        FOREIGN KEY (uploaded_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_ngo_verification_document_type
        CHECK (
            document_type IN (
                'REGISTRATION_CERTIFICATE',
                'PAN',
                'NGO_DARPAN',
                'SUPPORTING_DOCUMENT'
            )
        ),

    CONSTRAINT chk_ngo_verification_document_size
        CHECK (size_bytes > 0 AND size_bytes <= 5242880),

    CONSTRAINT chk_ngo_document_sha256_length
        CHECK (octet_length(sha256) = 32),

    CONSTRAINT chk_ngo_document_storage_key
        CHECK (length(storage_key) > 0)
);

CREATE TABLE ngo_verification_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ngo_id_snapshot UUID NOT NULL,
    ngo_name_snapshot VARCHAR(150),
    verification_status_snapshot VARCHAR(20) NOT NULL,
    submission_id_snapshot UUID,
    actor_user_id_snapshot UUID,
    actor_name_snapshot VARCHAR(100),
    action VARCHAR(20) NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_ngo_verification_history_status
        CHECK (
            verification_status_snapshot IN (
                'NOT_SUBMITTED',
                'PENDING',
                'NEEDS_INFO',
                'APPROVED',
                'REJECTED'
            )
        ),

    CONSTRAINT chk_ngo_verification_history_action
        CHECK (
            action IN (
                'LEGACY_IMPORTED',
                'SUBMITTED',
                'RESUBMITTED',
                'INFO_REQUESTED',
                'APPROVED',
                'REJECTED'
            )
        ),

    CONSTRAINT chk_ngo_verification_info_message
        CHECK (
            action <> 'INFO_REQUESTED'
            OR (message IS NOT NULL AND length(trim(message)) > 0)
        ),

    CONSTRAINT chk_ngo_verification_legacy_message
        CHECK (
            action <> 'LEGACY_IMPORTED'
            OR (message IS NOT NULL AND length(trim(message)) > 0)
        )
);

CREATE TABLE causes (
    cause_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL UNIQUE,

    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_causes (
    user_id UUID NOT NULL,
    cause_id UUID NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, cause_id),

    CONSTRAINT fk_user_causes_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_causes_cause
        FOREIGN KEY (cause_id)
        REFERENCES causes(cause_id)
        ON DELETE CASCADE
);

CREATE TABLE skills (
    skill_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL UNIQUE,

    description TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_skills (
    user_id UUID NOT NULL,
    skill_id UUID NOT NULL,

    proficiency_level VARCHAR(20) NOT NULL DEFAULT 'BEGINNER'
        CHECK (
            proficiency_level IN (
                'BEGINNER',
                'INTERMEDIATE',
                'ADVANCED',
                'EXPERT'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, skill_id),

    CONSTRAINT fk_user_skills_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_skills_skill
        FOREIGN KEY (skill_id)
        REFERENCES skills(skill_id)
        ON DELETE CASCADE
);

CREATE TABLE needs (
    need_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ngo_id UUID NOT NULL,

    cause_id UUID NOT NULL,

    title VARCHAR(150) NOT NULL,

    description TEXT NOT NULL,

    contribution_type VARCHAR(30) NOT NULL
        CHECK (
            contribution_type IN (
                'VOLUNTEER',
                'MATERIAL',
                'MONEY',
                'SKILL'
            )
        ),

    location VARCHAR(150),

    availability JSONB,

    quantity_required INTEGER
        CHECK (quantity_required IS NULL OR quantity_required > 0),

    quantity_fulfilled INTEGER NOT NULL DEFAULT 0
        CHECK (quantity_fulfilled >= 0),

    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
        CHECK (
            priority IN (
                'LOW',
                'MEDIUM',
                'HIGH',
                'URGENT'
            )
        ),

    deadline TIMESTAMPTZ,

    status VARCHAR(25) NOT NULL DEFAULT 'DRAFT'
        CHECK (
            status IN (
                'DRAFT',
                'ACTIVE',
                'PARTIALLY_FULFILLED',
                'FULFILLED',
                'COMPLETED',
                'EXPIRED',
                'CLOSED'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    completed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,

    moderation_status VARCHAR(20) NOT NULL DEFAULT 'VISIBLE'
        CHECK (moderation_status IN ('VISIBLE', 'HIDDEN')),
    moderated_at TIMESTAMPTZ,
    moderated_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    moderation_reason TEXT,

    CONSTRAINT fk_needs_ngo
        FOREIGN KEY (ngo_id)
        REFERENCES ngos(ngo_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_needs_cause
        FOREIGN KEY (cause_id)
        REFERENCES causes(cause_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_needs_fulfilled_quantity
        CHECK (
            quantity_required IS NULL
            OR quantity_fulfilled <= quantity_required
        ),
    CONSTRAINT chk_needs_completed_at CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
    CONSTRAINT chk_needs_closed_at CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CONSTRAINT chk_needs_expired_at CHECK (
        status <> 'EXPIRED' OR expired_at IS NOT NULL
    ),
    CONSTRAINT chk_need_moderation_state CHECK (
        (moderation_status = 'HIDDEN' AND moderated_at IS NOT NULL AND moderation_reason IS NOT NULL)
        OR (moderation_status = 'VISIBLE' AND moderated_at IS NULL AND moderation_reason IS NULL)
    )
);

CREATE TABLE need_skills (
    need_id UUID NOT NULL,
    skill_id UUID NOT NULL,

    required_level VARCHAR(20) NOT NULL DEFAULT 'BEGINNER'
        CHECK (
            required_level IN (
                'BEGINNER',
                'INTERMEDIATE',
                'ADVANCED',
                'EXPERT'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (need_id, skill_id),

    CONSTRAINT fk_need_skills_need
        FOREIGN KEY (need_id)
        REFERENCES needs(need_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_need_skills_skill
        FOREIGN KEY (skill_id)
        REFERENCES skills(skill_id)
        ON DELETE RESTRICT
);

CREATE TABLE contributions (
    contribution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    need_id UUID NOT NULL,

    user_id UUID NOT NULL,

    contribution_type VARCHAR(30) NOT NULL
        CHECK (
            contribution_type IN (
                'MATERIAL',
                'MONEY',
                'SKILL'
            )
        ),

    description TEXT,

    quantity INTEGER
        CHECK (quantity IS NULL OR quantity > 0),

    amount NUMERIC(12,2)
        CHECK (amount IS NULL OR amount > 0),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'ACCEPTED',
                'IN_PROGRESS',
                'COMPLETED',
                'REJECTED'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolution_reason TEXT,

    CONSTRAINT fk_contributions_need
        FOREIGN KEY (need_id)
        REFERENCES needs(need_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_contributions_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
);

CREATE TABLE volunteer_applications (
    application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    need_id UUID NOT NULL,

    user_id UUID NOT NULL,

    message TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'APPLIED'
        CHECK (
            status IN (
                'APPLIED',
                'ACCEPTED',
                'REJECTED',
                'COMPLETED'
            )
        ),

    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolution_reason TEXT,

    CONSTRAINT fk_volunteer_applications_need
        FOREIGN KEY (need_id)
        REFERENCES needs(need_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_volunteer_applications_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_volunteer_application
        UNIQUE (need_id, user_id)
);

CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
        'APPLICATION_RECEIVED',
        'APPLICATION_ACCEPTED',
        'APPLICATION_REJECTED',
        'APPLICATION_COMPLETED',
        'CONTRIBUTION_RECEIVED',
        'CONTRIBUTION_ACCEPTED',
        'CONTRIBUTION_REJECTED',
        'CONTRIBUTION_IN_PROGRESS',
        'CONTRIBUTION_COMPLETED',
        'NGO_VERIFICATION_SUBMITTED',
        'NGO_VERIFICATION_NEEDS_INFO',
        'NGO_VERIFICATION_APPROVED',
        'NGO_VERIFICATION_REJECTED',
        'NEED_CLOSED',
        'NEED_EXPIRED'
    )),
    title VARCHAR(160) NOT NULL,
    message VARCHAR(500) NOT NULL,
    related_entity_type VARCHAR(30) NOT NULL CHECK (related_entity_type IN (
        'APPLICATION', 'CONTRIBUTION', 'NGO_VERIFICATION', 'NEED'
    )),
    related_entity_id UUID NOT NULL,
    event_key VARCHAR(200) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
);

CREATE TABLE need_lifecycle_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    need_id UUID NOT NULL,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
        'CREATED', 'ACTIVATED', 'EXPIRED', 'CLOSED', 'COMPLETED', 'FULFILLMENT_COMPLETED'
    )),
    from_status VARCHAR(25) CHECK (from_status IS NULL OR from_status IN (
        'DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'COMPLETED', 'EXPIRED', 'CLOSED'
    )),
    to_status VARCHAR(25) NOT NULL CHECK (to_status IN (
        'DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'COMPLETED', 'EXPIRED', 'CLOSED'
    )),
    actor_user_id UUID,
    actor_type VARCHAR(10) NOT NULL CHECK (actor_type IN ('NGO', 'SYSTEM')),
    reason TEXT NOT NULL,
    event_key VARCHAR(220) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION prevent_need_lifecycle_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Need lifecycle history is append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION prevent_need_lifecycle_history_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Need lifecycle history cannot be truncated'
        USING ERRCODE = '55000';
END;
$$;

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_needs_ngo_id
ON needs(ngo_id);

CREATE INDEX idx_needs_cause_id
ON needs(cause_id);

CREATE INDEX idx_needs_status
ON needs(status);

CREATE INDEX idx_needs_expirable_deadline
ON needs(deadline, need_id)
WHERE status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED') AND deadline IS NOT NULL;

CREATE INDEX idx_need_lifecycle_history_need_created
ON need_lifecycle_history(need_id, created_at DESC, history_id DESC);

CREATE INDEX idx_users_admin_search ON users(role, is_suspended, created_at DESC);
CREATE INDEX idx_needs_admin_moderation ON needs(moderation_status, status, created_at DESC);

CREATE TABLE admin_action_history (
    action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    target_type VARCHAR(30) NOT NULL CHECK (target_type IN ('USER', 'NEED')),
    target_id UUID NOT NULL,
    action VARCHAR(30) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_action_history_target ON admin_action_history(target_type, target_id, created_at DESC);

CREATE INDEX idx_needs_contribution_type
ON needs(contribution_type);

CREATE INDEX idx_contributions_need_id
ON contributions(need_id);

CREATE INDEX idx_contributions_user_id
ON contributions(user_id);

CREATE UNIQUE INDEX uq_contributions_one_non_rejected_per_user_need
ON contributions(need_id, user_id)
WHERE status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED');

CREATE INDEX idx_volunteer_applications_need_id
ON volunteer_applications(need_id);

CREATE INDEX idx_volunteer_applications_user_id
ON volunteer_applications(user_id);

CREATE INDEX idx_notifications_recipient_created
ON notifications(recipient_user_id, created_at DESC, notification_id DESC);

CREATE INDEX idx_notifications_recipient_unread_created
ON notifications(recipient_user_id, created_at DESC, notification_id DESC)
WHERE read_at IS NULL;

CREATE UNIQUE INDEX uq_email_verification_one_current_token
ON email_verification_tokens(user_id)
WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX idx_email_verification_tokens_user_created
ON email_verification_tokens(user_id, created_at DESC);

CREATE UNIQUE INDEX uq_ngo_one_current_submission
ON ngo_verification_submissions(ngo_id_snapshot)
WHERE is_current;

CREATE INDEX idx_ngo_submissions_status
ON ngo_verification_submissions(status, submitted_at);

CREATE INDEX idx_ngo_documents_submission
ON ngo_verification_documents(submission_id_snapshot);

CREATE INDEX idx_ngo_documents_type
ON ngo_verification_documents(submission_id_snapshot, document_type);

CREATE INDEX idx_ngo_verification_history_ngo
ON ngo_verification_history(ngo_id_snapshot, created_at);

CREATE INDEX idx_ngo_verification_history_submission
ON ngo_verification_history(submission_id_snapshot, created_at);

CREATE FUNCTION enforce_ngo_current_submission_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_ngo_id UUID;
    expected_status VARCHAR(20);
    current_count BIGINT;
    current_status VARCHAR(20);
BEGIN
    IF TG_TABLE_NAME = 'ngos' THEN
        IF TG_OP = 'DELETE' THEN
            target_ngo_id := OLD.ngo_id;
        ELSE
            target_ngo_id := NEW.ngo_id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            target_ngo_id := OLD.ngo_id_snapshot;
        ELSE
            target_ngo_id := NEW.ngo_id_snapshot;
        END IF;
    END IF;

    SELECT verification_status
      INTO expected_status
      FROM ngos
     WHERE ngo_id = target_ngo_id;

    -- A deleted NGO keeps its submission and audit snapshots independently.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT
        count(*) FILTER (WHERE is_current),
        max(status) FILTER (WHERE is_current)
      INTO current_count, current_status
      FROM ngo_verification_submissions
     WHERE ngo_id_snapshot = target_ngo_id;

    IF expected_status = 'NOT_SUBMITTED' THEN
        IF current_count <> 0 THEN
            RAISE EXCEPTION
                'NOT_SUBMITTED NGO % cannot have a current submission',
                target_ngo_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF current_count <> 1 OR current_status IS DISTINCT FROM expected_status THEN
        RAISE EXCEPTION
            'NGO % status must match exactly one current submission',
            target_ngo_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION prevent_ngo_verification_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'NGO verification history is append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION prevent_ngo_verification_history_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'NGO verification history cannot be truncated'
        USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION prevent_ngo_verification_snapshot_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'ngo_verification_submissions'
       AND NEW.ngo_id_snapshot IS DISTINCT FROM OLD.ngo_id_snapshot THEN
        RAISE EXCEPTION 'ngo_id_snapshot is immutable'
            USING ERRCODE = '55000';
    ELSIF TG_TABLE_NAME = 'ngo_verification_documents'
       AND NEW.submission_id_snapshot IS DISTINCT FROM OLD.submission_id_snapshot THEN
        RAISE EXCEPTION 'submission_id_snapshot is immutable'
            USING ERRCODE = '55000';
    ELSIF TG_TABLE_NAME = 'ngo_verification_history'
       AND (
           NEW.ngo_id_snapshot IS DISTINCT FROM OLD.ngo_id_snapshot
           OR NEW.submission_id_snapshot IS DISTINCT FROM OLD.submission_id_snapshot
       ) THEN
        RAISE EXCEPTION 'verification history snapshots are immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ngo_submission_consistency_from_ngo
AFTER INSERT OR UPDATE OR DELETE ON ngos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_ngo_current_submission_status();

CREATE CONSTRAINT TRIGGER trg_ngo_submission_consistency_from_submission
AFTER INSERT OR UPDATE OR DELETE ON ngo_verification_submissions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_ngo_current_submission_status();

CREATE TRIGGER trg_ngo_verification_history_append_only
BEFORE UPDATE OR DELETE ON ngo_verification_history
FOR EACH ROW
EXECUTE FUNCTION prevent_ngo_verification_history_mutation();

CREATE TRIGGER trg_ngo_verification_history_no_truncate
BEFORE TRUNCATE ON ngo_verification_history
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_ngo_verification_history_truncate();

CREATE TRIGGER trg_ngo_submission_identity_immutable
BEFORE UPDATE OF ngo_id_snapshot ON ngo_verification_submissions
FOR EACH ROW
EXECUTE FUNCTION prevent_ngo_verification_snapshot_changes();

CREATE TRIGGER trg_ngo_document_identity_immutable
BEFORE UPDATE OF submission_id_snapshot ON ngo_verification_documents
FOR EACH ROW
EXECUTE FUNCTION prevent_ngo_verification_snapshot_changes();

CREATE TRIGGER trg_ngo_history_identity_immutable
BEFORE UPDATE OF ngo_id_snapshot, submission_id_snapshot ON ngo_verification_history
FOR EACH ROW
EXECUTE FUNCTION prevent_ngo_verification_snapshot_changes();

CREATE TRIGGER trg_need_lifecycle_history_append_only
BEFORE UPDATE OR DELETE ON need_lifecycle_history
FOR EACH ROW
EXECUTE FUNCTION prevent_need_lifecycle_history_mutation();

CREATE TRIGGER trg_need_lifecycle_history_no_truncate
BEFORE TRUNCATE ON need_lifecycle_history
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_need_lifecycle_history_truncate();

-- Runtime access is deliberately separate from object ownership. The bootstrap
-- role creates both roles and removes PUBLIC's CREATE on public before this file.
GRANT USAGE ON SCHEMA public TO ngo_connect_runtime;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
    FROM ngo_connect_runtime, PUBLIC;

GRANT SELECT, INSERT ON TABLE public.users TO ngo_connect_runtime;
GRANT UPDATE (
    name, email_verified, email_verified_at, is_suspended, suspended_at,
    suspended_by_user_id, suspension_reason, phone, city, availability, updated_at
) ON TABLE public.users TO ngo_connect_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE public.ngos TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_verification_tokens TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngo_verification_submissions TO ngo_connect_runtime;
GRANT SELECT, INSERT ON TABLE public.ngo_verification_documents TO ngo_connect_runtime;
GRANT SELECT ON TABLE public.causes TO ngo_connect_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_causes TO ngo_connect_runtime;
GRANT SELECT ON TABLE public.skills TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_skills TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.needs TO ngo_connect_runtime;
GRANT SELECT ON TABLE public.need_skills TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.contributions TO ngo_connect_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.volunteer_applications TO ngo_connect_runtime;

-- Read state is the only mutable notification field exposed to the runtime.
GRANT SELECT, INSERT ON TABLE public.notifications TO ngo_connect_runtime;
GRANT UPDATE (read_at) ON TABLE public.notifications TO ngo_connect_runtime;

-- These histories are append-only. The runtime role is not their owner and
-- receives no UPDATE, DELETE, or TRUNCATE privilege.
GRANT SELECT, INSERT ON TABLE public.ngo_verification_history TO ngo_connect_runtime;
GRANT SELECT, INSERT ON TABLE public.admin_action_history TO ngo_connect_runtime;
GRANT SELECT, INSERT ON TABLE public.need_lifecycle_history TO ngo_connect_runtime;

RESET ROLE;

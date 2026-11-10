-- NGO Connect migration 001: email verification and NGO verification history.
-- Replace ngo_connect_app with the actual application database role before use.
-- Review database/MIGRATIONS.md and verify the live NGO constraint name first.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Existing users receive TRUE from the add-column default. The new default
-- applies only to users inserted after this migration. Historical timestamps
-- are unknown and intentionally remain NULL.
ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN email_verified_at TIMESTAMPTZ;

ALTER TABLE users
    ALTER COLUMN email_verified SET DEFAULT FALSE;

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

CREATE UNIQUE INDEX uq_email_verification_one_current_token
    ON email_verification_tokens(user_id)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX idx_email_verification_tokens_user_created
    ON email_verification_tokens(user_id, created_at DESC);

-- Accept only the two known names used for the legacy NGO verification check.
-- Validate that each matching name constrains verification_status before
-- dropping it; unrelated constraints are never selected or removed.
DO $$
DECLARE
    matched_constraint RECORD;
    status_column_number SMALLINT;
    matched_count INTEGER := 0;
BEGIN
    SELECT attnum
      INTO status_column_number
      FROM pg_attribute
     WHERE attrelid = 'ngos'::regclass
       AND attname = 'verification_status'
       AND NOT attisdropped;

    IF status_column_number IS NULL THEN
        RAISE EXCEPTION
            'Cannot migrate NGO verification status: ngos.verification_status column was not found';
    END IF;

    FOR matched_constraint IN
        SELECT
            constraint_row.conname,
            constraint_row.conkey,
            pg_get_constraintdef(constraint_row.oid) AS definition
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'ngos'::regclass
          AND constraint_row.contype = 'c'
          AND constraint_row.conname IN (
              'ngos_verification_status_check',
              'chk_ngos_verification_status'
          )
    LOOP
        IF NOT (matched_constraint.conkey = ARRAY[status_column_number]::SMALLINT[])
           OR position(
               'verification_status'
               IN lower(matched_constraint.definition)
           ) = 0 THEN
            RAISE EXCEPTION
                'Expected NGO verification constraint % does not constrain verification_status; refusing to drop it',
                matched_constraint.conname;
        END IF;

        EXECUTE format(
            'ALTER TABLE ngos DROP CONSTRAINT %I',
            matched_constraint.conname
        );
        matched_count := matched_count + 1;
    END LOOP;

    IF matched_count = 0 THEN
        RAISE EXCEPTION
            'Cannot migrate NGO verification status: neither known constraint name (ngos_verification_status_check, chk_ngos_verification_status) exists on ngos';
    END IF;
END;
$$;

ALTER TABLE ngos
    ADD CONSTRAINT chk_ngos_verification_status
    CHECK (
        verification_status IN (
            'NOT_SUBMITTED',
            'PENDING',
            'NEEDS_INFO',
            'APPROVED',
            'REJECTED'
        )
    );

ALTER TABLE ngos
    ALTER COLUMN verification_status SET DEFAULT 'NOT_SUBMITTED';

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

CREATE UNIQUE INDEX uq_ngo_one_current_submission
    ON ngo_verification_submissions(ngo_id_snapshot)
    WHERE is_current;

CREATE INDEX idx_ngo_submissions_status
    ON ngo_verification_submissions(status, submitted_at);

-- Create one current legacy record for every existing NGO. Preserve the
-- status exactly; NULL submitted_at and legacy_import=TRUE make no claim
-- that a document package was submitted.
INSERT INTO ngo_verification_submissions (
    ngo_id,
    ngo_id_snapshot,
    submission_number,
    status,
    is_current,
    legacy_import,
    submitted_by_user_id,
    submitted_at
)
SELECT
    ngo_id,
    ngo_id,
    1,
    verification_status,
    TRUE,
    TRUE,
    NULL,
    NULL
FROM ngos;

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

CREATE INDEX idx_ngo_documents_submission
    ON ngo_verification_documents(submission_id_snapshot);

CREATE INDEX idx_ngo_documents_type
    ON ngo_verification_documents(submission_id_snapshot, document_type);

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

CREATE INDEX idx_ngo_verification_history_ngo
    ON ngo_verification_history(ngo_id_snapshot, created_at);

CREATE INDEX idx_ngo_verification_history_submission
    ON ngo_verification_history(submission_id_snapshot, created_at);

-- Preserve an immutable audit event for every legacy NGO status.
INSERT INTO ngo_verification_history (
    ngo_id_snapshot,
    ngo_name_snapshot,
    verification_status_snapshot,
    submission_id_snapshot,
    actor_user_id_snapshot,
    actor_name_snapshot,
    action,
    message
)
SELECT
    g.ngo_id,
    g.name,
    g.verification_status,
    s.submission_id,
    NULL,
    NULL,
    'LEGACY_IMPORTED',
    'Imported existing verification status; no document submission is recorded.'
FROM ngos AS g
JOIN ngo_verification_submissions AS s
  ON s.ngo_id_snapshot = g.ngo_id
 AND s.legacy_import = TRUE;

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

    -- The snapshots remain valid after the live NGO row is deleted.
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

-- Ensure the backfill produced exactly one matching current submission per
-- existing NGO. Deferred triggers enforce this invariant for future writes.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ngos AS g
          LEFT JOIN ngo_verification_submissions AS s
            ON s.ngo_id_snapshot = g.ngo_id
           AND s.is_current
         GROUP BY g.ngo_id, g.verification_status
        HAVING count(s.submission_id) <> 1
            OR max(s.status) IS DISTINCT FROM g.verification_status
    ) THEN
        RAISE EXCEPTION 'NGO verification legacy backfill consistency check failed';
    END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

-- Placeholder role: replace ngo_connect_app with the actual application role
-- before execution. Do not make the app role table owner or superuser.
REVOKE UPDATE, DELETE, TRUNCATE
    ON ngo_verification_history
    FROM ngo_connect_app;

REVOKE UPDATE, DELETE, TRUNCATE
    ON ngo_verification_history
    FROM PUBLIC;

GRANT SELECT, INSERT
    ON ngo_verification_history
    TO ngo_connect_app;

COMMIT;

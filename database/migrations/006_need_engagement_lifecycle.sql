BEGIN;

-- Existing clients serialize deadlines with toISOString(). Treat stored
-- timestamp-without-zone values as UTC and store all future deadlines as instants.
ALTER TABLE public.needs
    ALTER COLUMN deadline TYPE TIMESTAMPTZ
    USING deadline AT TIME ZONE 'UTC';

ALTER TABLE public.needs
    DROP CONSTRAINT IF EXISTS needs_status_check,
    ADD CONSTRAINT chk_needs_lifecycle_status CHECK (status IN (
        'DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED',
        'COMPLETED', 'EXPIRED', 'CLOSED'
    )),
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD COLUMN closed_at TIMESTAMPTZ,
    ADD COLUMN expired_at TIMESTAMPTZ,
    ADD CONSTRAINT chk_needs_completed_at CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
    ADD CONSTRAINT chk_needs_closed_at CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    ADD CONSTRAINT chk_needs_expired_at CHECK (status <> 'EXPIRED' OR expired_at IS NOT NULL);

ALTER TABLE public.volunteer_applications
    ADD COLUMN resolution_reason TEXT;

ALTER TABLE public.contributions
    ADD COLUMN resolution_reason TEXT;

CREATE TABLE public.need_lifecycle_history (
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

CREATE INDEX idx_needs_expirable_deadline
    ON public.needs(deadline, need_id)
    WHERE status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED') AND deadline IS NOT NULL;

CREATE INDEX idx_need_lifecycle_history_need_created
    ON public.need_lifecycle_history(need_id, created_at DESC, history_id DESC);

CREATE FUNCTION public.prevent_need_lifecycle_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Need lifecycle history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.prevent_need_lifecycle_history_truncate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Need lifecycle history cannot be truncated' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_need_lifecycle_history_append_only
BEFORE UPDATE OR DELETE ON public.need_lifecycle_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_need_lifecycle_history_mutation();

CREATE TRIGGER trg_need_lifecycle_history_no_truncate
BEFORE TRUNCATE ON public.need_lifecycle_history
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_need_lifecycle_history_truncate();

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_event_type_check,
    DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check,
    ADD CONSTRAINT chk_notifications_event_type CHECK (event_type IN (
        'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED', 'APPLICATION_COMPLETED',
        'CONTRIBUTION_RECEIVED', 'CONTRIBUTION_ACCEPTED', 'CONTRIBUTION_REJECTED',
        'CONTRIBUTION_IN_PROGRESS', 'CONTRIBUTION_COMPLETED',
        'NGO_VERIFICATION_SUBMITTED', 'NGO_VERIFICATION_NEEDS_INFO',
        'NGO_VERIFICATION_APPROVED', 'NGO_VERIFICATION_REJECTED',
        'NEED_CLOSED', 'NEED_EXPIRED'
    )),
    ADD CONSTRAINT chk_notifications_related_entity_type CHECK (
        related_entity_type IN ('APPLICATION', 'CONTRIBUTION', 'NGO_VERIFICATION', 'NEED')
    );

REVOKE ALL PRIVILEGES ON TABLE public.need_lifecycle_history FROM ngo_connect_runtime, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.need_lifecycle_history TO ngo_connect_runtime;

COMMIT;

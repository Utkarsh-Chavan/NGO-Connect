BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.needs WHERE status IN ('COMPLETED', 'CLOSED')) THEN
        RAISE EXCEPTION 'Cannot roll back lifecycle states while COMPLETED or CLOSED needs exist; archive or explicitly convert them first';
    END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE event_type IN ('NEED_CLOSED', 'NEED_EXPIRED')) THEN
        RAISE EXCEPTION 'Cannot roll back while need lifecycle notifications exist; retain them or explicitly archive them first';
    END IF;
    IF EXISTS (SELECT 1 FROM public.need_lifecycle_history) THEN
        RAISE EXCEPTION 'Cannot roll back while lifecycle history exists; archive it before dropping the history table';
    END IF;
    IF EXISTS (SELECT 1 FROM public.volunteer_applications WHERE resolution_reason IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.contributions WHERE resolution_reason IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot roll back while engagement resolution reasons exist; archive them before dropping the columns';
    END IF;
END $$;

ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS chk_notifications_event_type,
    DROP CONSTRAINT IF EXISTS chk_notifications_related_entity_type,
    ADD CONSTRAINT notifications_event_type_check CHECK (event_type IN (
        'APPLICATION_RECEIVED', 'APPLICATION_ACCEPTED', 'APPLICATION_REJECTED', 'APPLICATION_COMPLETED',
        'CONTRIBUTION_RECEIVED', 'CONTRIBUTION_ACCEPTED', 'CONTRIBUTION_REJECTED',
        'CONTRIBUTION_IN_PROGRESS', 'CONTRIBUTION_COMPLETED',
        'NGO_VERIFICATION_SUBMITTED', 'NGO_VERIFICATION_NEEDS_INFO',
        'NGO_VERIFICATION_APPROVED', 'NGO_VERIFICATION_REJECTED'
    )),
    ADD CONSTRAINT notifications_related_entity_type_check CHECK (
        related_entity_type IN ('APPLICATION', 'CONTRIBUTION', 'NGO_VERIFICATION')
    );

DROP TABLE public.need_lifecycle_history;
DROP INDEX public.idx_needs_expirable_deadline;
DROP FUNCTION public.prevent_need_lifecycle_history_mutation();
DROP FUNCTION public.prevent_need_lifecycle_history_truncate();

ALTER TABLE public.needs
    DROP CONSTRAINT IF EXISTS chk_needs_lifecycle_status,
    DROP CONSTRAINT IF EXISTS chk_needs_completed_at,
    DROP CONSTRAINT IF EXISTS chk_needs_closed_at,
    DROP CONSTRAINT IF EXISTS chk_needs_expired_at,
    ADD CONSTRAINT needs_status_check CHECK (status IN (
        'DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'EXPIRED'
    )),
    DROP COLUMN completed_at,
    DROP COLUMN closed_at,
    DROP COLUMN expired_at,
    ALTER COLUMN deadline TYPE TIMESTAMP
    USING deadline AT TIME ZONE 'UTC';

ALTER TABLE public.volunteer_applications DROP COLUMN resolution_reason;
ALTER TABLE public.contributions DROP COLUMN resolution_reason;

COMMIT;

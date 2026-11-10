BEGIN;

CREATE TABLE public.notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
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
        'NGO_VERIFICATION_REJECTED'
    )),
    title VARCHAR(160) NOT NULL,
    message VARCHAR(500) NOT NULL,
    related_entity_type VARCHAR(30) NOT NULL CHECK (related_entity_type IN (
        'APPLICATION', 'CONTRIBUTION', 'NGO_VERIFICATION'
    )),
    related_entity_id UUID NOT NULL,
    event_key VARCHAR(200) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_recipient_created
    ON public.notifications(recipient_user_id, created_at DESC, notification_id DESC);

CREATE INDEX idx_notifications_recipient_unread_created
    ON public.notifications(recipient_user_id, created_at DESC, notification_id DESC)
    WHERE read_at IS NULL;

REVOKE ALL PRIVILEGES ON TABLE public.notifications FROM ngo_connect_runtime, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.notifications TO ngo_connect_runtime;
GRANT UPDATE (read_at) ON TABLE public.notifications TO ngo_connect_runtime;

COMMIT;

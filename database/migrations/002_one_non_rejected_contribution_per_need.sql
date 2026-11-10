BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM contributions
        WHERE status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED')
        GROUP BY need_id, user_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot create uq_contributions_one_non_rejected_per_user_need: duplicate non-rejected contributions exist; review and resolve them before retrying';
    END IF;
END;
$$;

CREATE UNIQUE INDEX uq_contributions_one_non_rejected_per_user_need
    ON contributions (need_id, user_id)
    WHERE status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED');

COMMIT;

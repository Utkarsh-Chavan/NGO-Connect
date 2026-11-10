BEGIN;

ALTER TABLE ngos
    ADD COLUMN website_url VARCHAR(255);

ALTER TABLE ngos
    ADD CONSTRAINT chk_ngos_website_url_protocol
    CHECK (website_url IS NULL OR website_url ~* '^https?://');

COMMIT;

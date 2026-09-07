-- A venue's mark lives in R2; D1 keeps only the immutable prefix it was
-- written under (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
-- Replacing a logo writes a new prefix and repoints the issuer, so a cached
-- URL never shows the wrong mark.
ALTER TABLE issuers ADD COLUMN logo_prefix TEXT;

-- The first logo is chosen before the venue exists, so an upload is staged
-- here and committed when the issuer is created or its logo is replaced. Rows
-- past `expires_at` are swept opportunistically on the next upload.
CREATE TABLE logo_uploads (
  id                 TEXT PRIMARY KEY,
  session_token_hash TEXT NOT NULL,
  asset_prefix       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed')),
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL
);
CREATE INDEX logo_uploads_expires_at ON logo_uploads(expires_at);

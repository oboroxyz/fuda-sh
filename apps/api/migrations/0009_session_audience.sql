-- Existing sessions belong to the dashboard operator contract. Member login
-- uses the same hashed-token storage with a separate credential audience.
ALTER TABLE sessions
ADD COLUMN audience TEXT NOT NULL DEFAULT 'operator'
CHECK (audience IN ('member', 'operator'));

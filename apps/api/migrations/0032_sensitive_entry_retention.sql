-- void:allow-destructive
-- Column moves preserve entry ids and both foreign keys while allowing Sensitive scans to omit verdict details.
ALTER TABLE entry_log ADD COLUMN decision_next TEXT;
ALTER TABLE entry_log ADD COLUMN path_next TEXT;
ALTER TABLE entry_log ADD COLUMN reason_next TEXT;
UPDATE entry_log SET decision_next = decision, path_next = path, reason_next = reason;
ALTER TABLE entry_log DROP COLUMN decision;
ALTER TABLE entry_log DROP COLUMN path;
ALTER TABLE entry_log DROP COLUMN reason;
ALTER TABLE entry_log RENAME COLUMN decision_next TO decision;
ALTER TABLE entry_log RENAME COLUMN path_next TO path;
ALTER TABLE entry_log RENAME COLUMN reason_next TO reason;

CREATE INDEX entry_log_uid_at ON entry_log(uid, at);

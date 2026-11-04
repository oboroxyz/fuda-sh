-- docs/specs/pass-types-and-flows.md#apple-wallet-updates. What Wallet needs to refresh an
-- installed pass. A device id and a push token come from Apple's Wallet, not from the
-- member, and both go when the last registration on that device does.
CREATE TABLE apple_pass_devices (
  device_id  TEXT PRIMARY KEY,
  push_token TEXT NOT NULL
);

-- `tag` answers passesUpdatedSince. It comes from one sequence across every pass because
-- a device compares it across all of its passes: per-pass values in seconds would let a
-- second pass change in the second the device last asked, and never surface.
-- `updated_at` answers If-Modified-Since, and is strictly increasing per pass.
CREATE TABLE apple_pass_updates (
  tag        INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  updated_at INTEGER NOT NULL
);

-- `serial` is the serial number as Wallet names it, which is what the list must answer.
-- `updated_tag` is the pass's tag, copied so that list reads this table alone.
CREATE TABLE apple_pass_registrations (
  device_id   TEXT NOT NULL REFERENCES apple_pass_devices(device_id),
  uid         TEXT NOT NULL,
  serial      TEXT NOT NULL,
  updated_tag INTEGER NOT NULL,
  PRIMARY KEY (device_id, uid)
);
CREATE INDEX apple_pass_registrations_uid ON apple_pass_registrations(uid);

ALTER TABLE ens_names
ADD COLUMN resolution_counter INTEGER NOT NULL DEFAULT 0 CHECK (resolution_counter >= 0);

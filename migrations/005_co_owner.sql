-- Keep the legacy role column compatible while adding a separately enforced rank.
ALTER TABLE users ADD COLUMN staff_rank TEXT NOT NULL DEFAULT '' CHECK(staff_rank IN ('','CO_OWNER'));

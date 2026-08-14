-- The office's official mailbox. Doubles as the Office Admin login and is the
-- only contact detail other offices are shown.
ALTER TABLE `Office` ADD COLUMN `email` VARCHAR(191) NULL;

-- Service cadre. Free text: establishment terminology varies between offices.
ALTER TABLE `User` ADD COLUMN `cadre` VARCHAR(191) NULL;

-- Tombstone. A deleted account disappears from every list, search and picker
-- and can never sign in, but historical rows still resolve to a real name.
ALTER TABLE `User` ADD COLUMN `deletedAt` DATETIME(3) NULL;

CREATE INDEX `User_deletedAt_idx` ON `User`(`deletedAt`);

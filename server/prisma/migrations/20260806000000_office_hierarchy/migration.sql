-- Office hierarchy: office heads, admin-minted logins, cross-office work requests.

-- ---------- Office: head + active flag ----------
ALTER TABLE `Office`
  ADD COLUMN `headId` CHAR(36) NULL,
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `Office_headId_idx` ON `Office`(`headId`);

ALTER TABLE `Office`
  ADD CONSTRAINT `Office_headId_fkey`
  FOREIGN KEY (`headId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- User: account lifecycle + provenance ----------
ALTER TABLE `User`
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `createdById` CHAR(36) NULL,
  ADD COLUMN `lastLoginAt` DATETIME(3) NULL;

CREATE INDEX `User_createdById_idx` ON `User`(`createdById`);

ALTER TABLE `User`
  ADD CONSTRAINT `User_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- TaskRequest: scope + target office ----------
ALTER TABLE `TaskRequest`
  ADD COLUMN `toOfficeId` CHAR(36) NULL,
  ADD COLUMN `scope` ENUM('USER', 'DEPARTMENT', 'OFFICE') NOT NULL DEFAULT 'USER';

CREATE INDEX `TaskRequest_toOfficeId_idx` ON `TaskRequest`(`toOfficeId`);

ALTER TABLE `TaskRequest`
  ADD CONSTRAINT `TaskRequest_toOfficeId_fkey`
  FOREIGN KEY (`toOfficeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing rows that carried a target department were cross-department.
UPDATE `TaskRequest` SET `scope` = 'DEPARTMENT' WHERE `toDepartmentId` IS NOT NULL;

-- Projects replace standing teams as the container that gathers people and work.
-- Also adds soft delete to work items and projects, so nothing is ever destroyed.

-- This migration is re-runnable. If a previous attempt failed partway, these
-- tables exist without their foreign keys and hold no data yet, because nothing
-- can write to them until the migration completes.
DROP TABLE IF EXISTS `ProjectMember`;
DROP TABLE IF EXISTS `Project`;

CREATE TABLE `Project` (
  `id`           CHAR(36) NOT NULL,
  `name`         VARCHAR(191) NOT NULL,
  `code`         VARCHAR(191) NULL,
  `description`  TEXT NULL,
  `status`       ENUM('PLANNING','ACTIVE','ON_HOLD','COMPLETED') NOT NULL DEFAULT 'ACTIVE',
  `officeId`     CHAR(36) NOT NULL,
  `departmentId` CHAR(36) NULL,
  `createdById`  CHAR(36) NULL,
  `startDate`    DATETIME(3) NULL,
  `dueDate`      DATETIME(3) NULL,
  `archivedAt`   DATETIME(3) NULL,
  `archivedById` CHAR(36) NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Project_officeId_idx` (`officeId`),
  INDEX `Project_status_idx` (`status`),
  INDEX `Project_archivedAt_idx` (`archivedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProjectMember` (
  `id`        CHAR(36) NOT NULL,
  `projectId` CHAR(36) NOT NULL,
  `userId`    CHAR(36) NOT NULL,
  `role`      ENUM('PRIMARY_LEAD','SECONDARY_LEAD','MEMBER','OBSERVER') NOT NULL DEFAULT 'MEMBER',
  `addedById` CHAR(36) NULL,
  `addedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ProjectMember_projectId_userId_key` (`projectId`, `userId`),
  INDEX `ProjectMember_userId_idx` (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Project`
  ADD CONSTRAINT `Project_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Project_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Project_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProjectMember`
  ADD CONSTRAINT `ProjectMember_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProjectMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Work items gain a project link and a soft-delete marker.
ALTER TABLE `Task`
  ADD COLUMN `projectId`    CHAR(36) NULL,
  ADD COLUMN `archivedAt`   DATETIME(3) NULL,
  ADD COLUMN `archivedById` CHAR(36) NULL;

CREATE INDEX `Task_projectId_idx`  ON `Task`(`projectId`);
CREATE INDEX `Task_archivedAt_idx` ON `Task`(`archivedAt`);

ALTER TABLE `Task`
  ADD CONSTRAINT `Task_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

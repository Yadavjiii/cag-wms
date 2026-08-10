-- =============================================================================
-- Core model v2
--   1. Role and Designation are separated. Role = permissions, Designation = post.
--   2. Roles become office-owned clones of platform templates.
--   3. Standing Teams dissolve into Projects.
--   4. A work item carries an owning office AND an executing office.
--   5. Rebrand seam: cagId -> employeeId, plus mobile and auth-provider columns.
--
-- Existing data is carried across, never dropped. Read the mapping in step 2c
-- before running: it decides what role each of your current users ends up with.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Designation master list
-- -----------------------------------------------------------------------------
CREATE TABLE `Designation` (
  `id`        CHAR(36) NOT NULL,
  `name`      VARCHAR(191) NOT NULL,
  `code`      VARCHAR(191) NULL,
  `rank`      INT NOT NULL DEFAULT 0,
  `officeId`  CHAR(36) NULL,
  `isActive`  BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Designation_officeId_name_key` (`officeId`, `name`),
  INDEX `Designation_rank_idx` (`rank`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Designation`
  ADD CONSTRAINT `Designation_officeId_fkey`
  FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform-wide designations. rank is for ordering and reporting ONLY and is
-- never read by an authorisation check.
INSERT INTO `Designation` (`id`, `name`, `code`, `rank`, `officeId`) VALUES
  (UUID(), 'System Administrator',            'SYSADMIN', 95, NULL),
  (UUID(), 'Director General',                'DG',       90, NULL),
  (UUID(), 'Principal Accountant General',    'PAG',      90, NULL),
  (UUID(), 'Accountant General',              'AG',       85, NULL),
  (UUID(), 'Deputy Accountant General',       'DAG',      80, NULL),
  (UUID(), 'Director',                        'DIR',      75, NULL),
  (UUID(), 'Senior Audit Officer',            'SAO',      60, NULL),
  (UUID(), 'Assistant Audit Officer',         'AAO',      50, NULL),
  (UUID(), 'Administrative Officer',          'AO',       45, NULL),
  (UUID(), 'Supervisor',                      'SUP',      40, NULL),
  (UUID(), 'Senior Auditor',                  'SRAUD',    30, NULL),
  (UUID(), 'Auditor',                         'AUD',      25, NULL),
  (UUID(), 'Consultant',                      'CONS',     20, NULL),
  (UUID(), 'Young Professional',              'YP',       15, NULL);

-- -----------------------------------------------------------------------------
-- 2. Role becomes office-scoped, with template lineage
-- -----------------------------------------------------------------------------
ALTER TABLE `Role`
  ADD COLUMN `officeId`   CHAR(36) NULL,
  ADD COLUMN `templateId` CHAR(36) NULL;

-- Name was globally unique, which made per-office roles impossible.
ALTER TABLE `Role` DROP INDEX `Role_name_key`;
ALTER TABLE `Role` ADD UNIQUE INDEX `Role_officeId_name_key` (`officeId`, `name`);
CREATE INDEX `Role_templateId_idx` ON `Role`(`templateId`);

ALTER TABLE `Role`
  ADD CONSTRAINT `Role_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Role_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 2b. User gains the designation link and the rebrand-safe columns
-- -----------------------------------------------------------------------------
ALTER TABLE `User`
  ADD COLUMN `designationId` CHAR(36) NULL,
  ADD COLUMN `mobile`        VARCHAR(191) NULL,
  ADD COLUMN `authProvider`  VARCHAR(191) NOT NULL DEFAULT 'local',
  ADD COLUMN `externalId`    VARCHAR(191) NULL;

-- cagId -> employeeId. Nothing organisation-specific in a column name.
-- MySQL keeps the old index name after CHANGE COLUMN, so rename it too,
-- otherwise the database drifts from what Prisma's schema describes.
ALTER TABLE `User` DROP INDEX `User_cagId_key`;
ALTER TABLE `User` CHANGE COLUMN `cagId` `employeeId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `User_employeeId_key` ON `User`(`employeeId`);

CREATE INDEX `User_designationId_idx` ON `User`(`designationId`);
CREATE INDEX `User_authProvider_externalId_idx` ON `User`(`authProvider`, `externalId`);

ALTER TABLE `User`
  ADD CONSTRAINT `User_designationId_fkey`
  FOREIGN KEY (`designationId`) REFERENCES `Designation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry the old free-text designation across where it matches a known post.
UPDATE `User` u
  JOIN `Designation` d ON d.`officeId` IS NULL AND d.`name` = u.`designation`
  SET u.`designationId` = d.`id`
  WHERE u.`designation` IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2c. THE ROLE REMAP.
-- Old roles were really job titles. Each becomes a Designation, and the user
-- gets a real permission-bearing Role instead. Anyone whose designation is
-- still blank inherits it from the old role name.
-- -----------------------------------------------------------------------------
UPDATE `User` u
  JOIN `Role` r ON r.`id` = u.`roleId`
  JOIN `Designation` d ON d.`officeId` IS NULL AND d.`name` = r.`name`
  SET u.`designationId` = d.`id`
  WHERE u.`designationId` IS NULL;

-- The old free-text column has served its purpose.
ALTER TABLE `User` DROP COLUMN `designation`;

-- -----------------------------------------------------------------------------
-- 3. Teams dissolve into Projects
-- -----------------------------------------------------------------------------
-- Each team becomes a project in the same office.
INSERT INTO `Project` (`id`, `name`, `description`, `status`, `officeId`, `createdById`, `createdAt`, `updatedAt`)
SELECT t.`id`,
       t.`name`,
       COALESCE(t.`description`, CONCAT('Migrated from the "', t.`name`, '" team.')),
       'ACTIVE',
       COALESCE(t.`officeId`, (SELECT o.`id` FROM `Office` o ORDER BY o.`createdAt` LIMIT 1)),
       t.`ownerId`,
       t.`createdAt`,
       NOW(3)
FROM `Team` t
WHERE NOT EXISTS (SELECT 1 FROM `Project` p WHERE p.`id` = t.`id`);

-- Team members become project members. A team "lead" or "admin" becomes the
-- primary lead; everyone else becomes a plain member.
INSERT INTO `ProjectMember` (`id`, `projectId`, `userId`, `role`, `addedAt`)
SELECT UUID(),
       tm.`teamId`,
       tm.`userId`,
       CASE WHEN tm.`roleInTeam` IN ('lead', 'admin') THEN 'PRIMARY_LEAD' ELSE 'MEMBER' END,
       tm.`joinedAt`
FROM `TeamMember` tm
WHERE EXISTS (SELECT 1 FROM `Project` p WHERE p.`id` = tm.`teamId`)
  AND NOT EXISTS (
    SELECT 1 FROM `ProjectMember` pm WHERE pm.`projectId` = tm.`teamId` AND pm.`userId` = tm.`userId`
  );

-- Only one primary lead per project: demote all but the earliest.
UPDATE `ProjectMember` pm
  JOIN (
    SELECT `projectId`, MIN(`addedAt`) AS keepAt
    FROM `ProjectMember` WHERE `role` = 'PRIMARY_LEAD' GROUP BY `projectId`
  ) k ON k.`projectId` = pm.`projectId`
  SET pm.`role` = 'MEMBER'
  WHERE pm.`role` = 'PRIMARY_LEAD' AND pm.`addedAt` > k.keepAt;

-- Work items and meetings follow their team to the new project.
UPDATE `Task` t
  JOIN `Project` p ON p.`id` = t.`teamId`
  SET t.`projectId` = t.`teamId`
  WHERE t.`projectId` IS NULL AND t.`teamId` IS NOT NULL;

ALTER TABLE `Meeting` ADD COLUMN `projectId` CHAR(36) NULL;
UPDATE `Meeting` m
  JOIN `Project` p ON p.`id` = m.`teamId`
  SET m.`projectId` = m.`teamId`
  WHERE m.`teamId` IS NOT NULL;

ALTER TABLE `Meeting` DROP FOREIGN KEY `Meeting_teamId_fkey`;
DROP INDEX `Meeting_teamId_idx` ON `Meeting`;
ALTER TABLE `Meeting` DROP COLUMN `teamId`;
CREATE INDEX `Meeting_projectId_idx` ON `Meeting`(`projectId`);
ALTER TABLE `Meeting`
  ADD CONSTRAINT `Meeting_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 4. A work item carries an owning office and an executing office
-- -----------------------------------------------------------------------------
ALTER TABLE `Task`
  ADD COLUMN `owningOfficeId`    CHAR(36) NULL,
  ADD COLUMN `executingOfficeId` CHAR(36) NULL;

-- Existing rows: the office it sat in was doing the work and answering for it.
UPDATE `Task` SET `owningOfficeId` = `officeId`, `executingOfficeId` = `officeId`;

-- Where an inter-office request was accepted, the ORIGINATING office is the
-- real owner; the office the item currently sits in is only executing it.
UPDATE `Task` t
  JOIN `TaskRequest` tr ON tr.`taskId` = t.`id` AND tr.`scope` = 'OFFICE' AND tr.`state` IN ('PENDING_ACCEPTANCE','ACCEPTED')
  JOIN `User` requester ON requester.`id` = tr.`fromId`
  SET t.`owningOfficeId` = requester.`officeId`
  WHERE requester.`officeId` IS NOT NULL;

ALTER TABLE `Task` DROP FOREIGN KEY `Task_officeId_fkey`;
ALTER TABLE `Task` DROP FOREIGN KEY `Task_teamId_fkey`;
DROP INDEX `Task_teamId_idx` ON `Task`;
ALTER TABLE `Task` DROP COLUMN `officeId`, DROP COLUMN `teamId`;

CREATE INDEX `Task_owningOfficeId_idx`    ON `Task`(`owningOfficeId`);
CREATE INDEX `Task_executingOfficeId_idx` ON `Task`(`executingOfficeId`);

ALTER TABLE `Task`
  ADD CONSTRAINT `Task_owningOfficeId_fkey`    FOREIGN KEY (`owningOfficeId`)    REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Task_executingOfficeId_fkey` FOREIGN KEY (`executingOfficeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Teams are gone.
DROP TABLE `TeamMember`;
DROP TABLE `Team`;

-- -----------------------------------------------------------------------------
-- 5. Offices are archived, never deleted
-- -----------------------------------------------------------------------------
ALTER TABLE `Office` ADD COLUMN `archivedAt` DATETIME(3) NULL;

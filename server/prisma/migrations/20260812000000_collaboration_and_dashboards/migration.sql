-- =============================================================================
-- Collaboration and dashboards
--
--   1. Every work item and every project carries a discussion thread. Anyone
--      who can see the item can post on it, reply to a post, and attach files
--      to their own post.
--   2. A post has a KIND, so "here is where we are" (STATUS_UPDATE) is not
--      mixed in with "please do X" (DIRECTION) and "we are stuck" (BLOCKER).
--   3. Attachments hang off a work item, a project, or a single post. One
--      table, so there is one upload path and one permission check.
--   4. Projects gain a priority of their own and a lastUpdateAt stamp; work
--      items gain lastUpdateAt. Both feed the "nothing reported for N days"
--      alert without a join per row.
--   5. The activity log can record project-level events, so a programme has a
--      timeline of its own.
--   6. Meetings gain an end time and minutes.
--
-- Nothing is dropped. Existing remarks become REMARK posts and existing files
-- stay attached to the work item they were uploaded against.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Discussion on work items
-- -----------------------------------------------------------------------------
ALTER TABLE `TaskComment`
  ADD COLUMN `kind`      ENUM('REMARK','STATUS_UPDATE','DIRECTION','DECISION','BLOCKER') NOT NULL DEFAULT 'REMARK',
  ADD COLUMN `meta`      JSON NULL,
  ADD COLUMN `parentId`  CHAR(36) NULL,
  ADD COLUMN `isPinned`  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `editedAt`  DATETIME(3) NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL;

CREATE INDEX `TaskComment_parentId_idx` ON `TaskComment`(`parentId`);
CREATE INDEX `TaskComment_authorId_idx` ON `TaskComment`(`authorId`);
CREATE INDEX `TaskComment_kind_idx` ON `TaskComment`(`kind`);

ALTER TABLE `TaskComment`
  ADD CONSTRAINT `TaskComment_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `TaskComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Discussion on projects
-- -----------------------------------------------------------------------------
CREATE TABLE `ProjectComment` (
  `id`         CHAR(36) NOT NULL,
  `projectId`  CHAR(36) NOT NULL,
  `authorId`   CHAR(36) NULL,
  `authorRole` VARCHAR(191) NULL,
  `kind`       ENUM('REMARK','STATUS_UPDATE','DIRECTION','DECISION','BLOCKER') NOT NULL DEFAULT 'REMARK',
  `body`       TEXT NOT NULL,
  `meta`       JSON NULL,
  `parentId`   CHAR(36) NULL,
  `isPinned`   BOOLEAN NOT NULL DEFAULT false,
  `editedAt`   DATETIME(3) NULL,
  `deletedAt`  DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ProjectComment_projectId_idx` (`projectId`),
  INDEX `ProjectComment_parentId_idx` (`parentId`),
  INDEX `ProjectComment_authorId_idx` (`authorId`),
  INDEX `ProjectComment_kind_idx` (`kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProjectComment`
  ADD CONSTRAINT `ProjectComment_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProjectComment_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ProjectComment_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `ProjectComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Attachments become multi-target
--    taskId was NOT NULL. It has to become nullable so the same table can hold
--    project files and per-post files. Existing rows keep their taskId.
-- -----------------------------------------------------------------------------
ALTER TABLE `Attachment` DROP FOREIGN KEY `Attachment_taskId_fkey`;

ALTER TABLE `Attachment`
  MODIFY COLUMN `taskId` CHAR(36) NULL,
  ADD COLUMN `projectId`        CHAR(36) NULL,
  ADD COLUMN `taskCommentId`    CHAR(36) NULL,
  ADD COLUMN `projectCommentId` CHAR(36) NULL,
  ADD COLUMN `size`             INT NULL,
  ADD COLUMN `mimeType`         VARCHAR(191) NULL;

CREATE INDEX `Attachment_projectId_idx` ON `Attachment`(`projectId`);
CREATE INDEX `Attachment_taskCommentId_idx` ON `Attachment`(`taskCommentId`);
CREATE INDEX `Attachment_projectCommentId_idx` ON `Attachment`(`projectCommentId`);

ALTER TABLE `Attachment`
  ADD CONSTRAINT `Attachment_taskId_fkey`
  FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Attachment_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Attachment_taskCommentId_fkey`
  FOREIGN KEY (`taskCommentId`) REFERENCES `TaskComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Attachment_projectCommentId_fkey`
  FOREIGN KEY (`projectCommentId`) REFERENCES `ProjectComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Urgency and freshness
-- -----------------------------------------------------------------------------
ALTER TABLE `Project`
  ADD COLUMN `priority`     ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `lastUpdateAt` DATETIME(3) NULL;

CREATE INDEX `Project_priority_idx` ON `Project`(`priority`);
CREATE INDEX `Project_dueDate_idx` ON `Project`(`dueDate`);

ALTER TABLE `Task`
  ADD COLUMN `lastUpdateAt` DATETIME(3) NULL;

CREATE INDEX `Task_priority_idx` ON `Task`(`priority`);
CREATE INDEX `Task_lastUpdateAt_idx` ON `Task`(`lastUpdateAt`);

-- Seed freshness from what we already know, so nothing looks stale on day one.
UPDATE `Task` t
  SET t.`lastUpdateAt` = COALESCE(
    (SELECT MAX(c.`createdAt`) FROM `TaskComment` c WHERE c.`taskId` = t.`id`),
    t.`updatedAt`
  );

UPDATE `Project` p
  SET p.`lastUpdateAt` = p.`updatedAt`;

-- -----------------------------------------------------------------------------
-- 5. Project-level activity timeline
-- -----------------------------------------------------------------------------
ALTER TABLE `ActivityLog`
  ADD COLUMN `projectId` CHAR(36) NULL;

CREATE INDEX `ActivityLog_projectId_idx` ON `ActivityLog`(`projectId`);
CREATE INDEX `ActivityLog_createdAt_idx` ON `ActivityLog`(`createdAt`);

ALTER TABLE `ActivityLog`
  ADD CONSTRAINT `ActivityLog_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 6. Meetings: end time and minutes
-- -----------------------------------------------------------------------------
ALTER TABLE `Meeting`
  ADD COLUMN `endsAt`  DATETIME(3) NULL,
  ADD COLUMN `minutes` TEXT NULL;

CREATE INDEX `Meeting_taskId_idx` ON `Meeting`(`taskId`);

-- One hour is the working assumption for meetings booked before this column
-- existed. Better than a calendar full of zero-length events.
UPDATE `Meeting` SET `endsAt` = DATE_ADD(`startsAt`, INTERVAL 1 HOUR) WHERE `endsAt` IS NULL;

-- -----------------------------------------------------------------------------
-- 7. New permissions
--    Posting on a thread needs no permission: if you can see the item you can
--    talk about it. These two cover the reporting surface instead.
-- -----------------------------------------------------------------------------
INSERT INTO `Permission` (`id`, `key`, `description`) VALUES
  (UUID(), 'dashboard.view_office', 'See the office-wide dashboard, not only own work'),
  (UUID(), 'task.update_progress',  'Post a progress update on any visible work item')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- Give the two reporting permissions to every role that already reports.
INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
  FROM `Role` r
  JOIN `Permission` p ON p.`key` IN ('dashboard.view_office', 'task.update_progress')
 WHERE EXISTS (
        SELECT 1 FROM `RolePermission` rp
          JOIN `Permission` ep ON ep.`id` = rp.`permissionId`
         WHERE rp.`roleId` = r.`id` AND ep.`key` IN ('report.view', 'task.view_office', 'office.manage_all')
      )
ON DUPLICATE KEY UPDATE `roleId` = `RolePermission`.`roleId`;

-- CreateTable
CREATE TABLE `Office` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Office_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `cagId` VARCHAR(191) NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `wing` VARCHAR(191) NULL,
    `role` ENUM('MEMBER', 'LEAD', 'OFFICE_ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'MEMBER',
    `avatarUrl` VARCHAR(191) NULL,
    `officeId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_cagId_key`(`cagId`),
    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_officeId_idx`(`officeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Team` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `officeId` CHAR(36) NULL,
    `ownerId` CHAR(36) NULL,
    `mergedIntoId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Team_officeId_idx`(`officeId`),
    INDEX `Team_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeamMember` (
    `teamId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `roleInTeam` VARCHAR(191) NOT NULL DEFAULT 'member',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TeamMember_userId_idx`(`userId`),
    PRIMARY KEY (`teamId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('YET_TO_BE_ASSIGNED', 'INITIATED', 'IN_PROGRESS', 'FINISHED', 'ON_HOLD') NOT NULL DEFAULT 'INITIATED',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `officeId` CHAR(36) NULL,
    `teamId` CHAR(36) NULL,
    `primaryLeadId` CHAR(36) NULL,
    `secondaryLeadId` CHAR(36) NULL,
    `currentlyWithId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `assignedDate` DATETIME(3) NULL,
    `dueDate` DATETIME(3) NULL,
    `pctComplete` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_primaryLeadId_idx`(`primaryLeadId`),
    INDEX `Task_teamId_idx`(`teamId`),
    INDEX `Task_dueDate_idx`(`dueDate`),
    INDEX `Task_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskRequest` (
    `id` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NOT NULL,
    `fromId` CHAR(36) NULL,
    `toId` CHAR(36) NULL,
    `message` TEXT NULL,
    `state` ENUM('REQUESTED', 'ACCEPTED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TaskRequest_taskId_idx`(`taskId`),
    INDEX `TaskRequest_toId_idx`(`toId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskComment` (
    `id` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NULL,
    `authorRole` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TaskComment_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `uploadedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attachment_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Meeting` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `agenda` TEXT NULL,
    `teamId` CHAR(36) NULL,
    `taskId` CHAR(36) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `mode` ENUM('PHYSICAL', 'ONLINE') NOT NULL DEFAULT 'PHYSICAL',
    `location` VARCHAR(191) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Meeting_teamId_idx`(`teamId`),
    INDEX `Meeting_startsAt_idx`(`startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MeetingParticipant` (
    `meetingId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,

    INDEX `MeetingParticipant_userId_idx`(`userId`),
    PRIMARY KEY (`meetingId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_isRead_idx`(`userId`, `isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityLog_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_mergedIntoId_fkey` FOREIGN KEY (`mergedIntoId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamMember` ADD CONSTRAINT `TeamMember_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TeamMember` ADD CONSTRAINT `TeamMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_primaryLeadId_fkey` FOREIGN KEY (`primaryLeadId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_secondaryLeadId_fkey` FOREIGN KEY (`secondaryLeadId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_currentlyWithId_fkey` FOREIGN KEY (`currentlyWithId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRequest` ADD CONSTRAINT `TaskRequest_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRequest` ADD CONSTRAINT `TaskRequest_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRequest` ADD CONSTRAINT `TaskRequest_toId_fkey` FOREIGN KEY (`toId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeetingParticipant` ADD CONSTRAINT `MeetingParticipant_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeetingParticipant` ADD CONSTRAINT `MeetingParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

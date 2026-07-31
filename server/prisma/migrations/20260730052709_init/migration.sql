/*
  Warnings:

  - You are about to alter the column `state` on the `taskrequest` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(2))` to `Enum(EnumId(2))`.

*/
-- AlterTable
ALTER TABLE `task` ADD COLUMN `departmentId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `taskrequest` ADD COLUMN `approvedById` CHAR(36) NULL,
    ADD COLUMN `requiresApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `resolvedAt` DATETIME(3) NULL,
    ADD COLUMN `toDepartmentId` CHAR(36) NULL,
    MODIFY `state` ENUM('PENDING_APPROVAL', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_ACCEPTANCE';

-- AlterTable
ALTER TABLE `user` ADD COLUMN `departmentId` CHAR(36) NULL,
    ADD COLUMN `managerId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `OrgSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'org',
    `name` VARCHAR(191) NOT NULL DEFAULT 'CAG Work Management',
    `logoPath` VARCHAR(191) NULL,
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#1e1b4b',
    `accentColor` VARCHAR(191) NOT NULL DEFAULT '#4f46e5',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `officeId` CHAR(36) NULL,
    `parentId` CHAR(36) NULL,
    `headId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Department_officeId_idx`(`officeId`),
    INDEX `Department_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Task_departmentId_idx` ON `Task`(`departmentId`);

-- CreateIndex
CREATE INDEX `TaskRequest_toDepartmentId_idx` ON `TaskRequest`(`toDepartmentId`);

-- CreateIndex
CREATE INDEX `TaskRequest_state_idx` ON `TaskRequest`(`state`);

-- CreateIndex
CREATE INDEX `User_departmentId_idx` ON `User`(`departmentId`);

-- CreateIndex
CREATE INDEX `User_managerId_idx` ON `User`(`managerId`);

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `Office`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_headId_fkey` FOREIGN KEY (`headId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRequest` ADD CONSTRAINT `TaskRequest_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRequest` ADD CONSTRAINT `TaskRequest_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

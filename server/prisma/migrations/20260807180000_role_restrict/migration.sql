-- Deleting a role that people still hold must not silently null their roleId
-- and strip their permissions. Prisma's default for an optional relation is
-- SetNull, which is exactly the wrong behaviour for an authorisation link:
-- it locks people out with no error raised anywhere.
--
-- Repair anyone already left in that state before tightening the constraint.
UPDATE `User` u
  SET u.`roleId` = (
    SELECT r.`id` FROM `Role` r WHERE r.`isDefault` = 1 AND r.`officeId` IS NULL LIMIT 1
  )
  WHERE u.`roleId` IS NULL;

ALTER TABLE `User` DROP FOREIGN KEY `User_roleId_fkey`;

ALTER TABLE `User`
  ADD CONSTRAINT `User_roleId_fkey`
  FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

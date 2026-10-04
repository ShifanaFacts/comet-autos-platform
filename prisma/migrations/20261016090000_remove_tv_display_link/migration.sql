-- Removes the waiting-area TV link (added in 20261012090000_team_work).
--
-- The TV screen is not used; the workshop board is only for staff, inside
-- the app. No workshop had a TV link set when this was written, so nothing
-- is lost.

-- DropIndex
DROP INDEX "organizations_display_token_hash_key";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "display_token_hash";

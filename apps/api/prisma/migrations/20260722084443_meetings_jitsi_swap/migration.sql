-- Video vendor swap: Daily.co -> self-hosted Jitsi (temporary, see CONTEXT.md).
-- Rename, not drop+recreate, to preserve any existing rows — an old
-- Daily-era "mtg-<uuid>" value is still a perfectly valid Jitsi room name.
ALTER TABLE "meetings" RENAME COLUMN "daily_room_name" TO "video_room_name";
ALTER TABLE "meetings" DROP COLUMN "daily_room_url";

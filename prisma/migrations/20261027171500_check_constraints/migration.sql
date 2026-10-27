-- Restrições de integridade que o Prisma não modela no schema.
-- Redundantes com a validação da aplicação: protegem contra escrita direta no banco.
ALTER TABLE "GuildSettings"
  ADD CONSTRAINT "GuildSettings_defaultVolume_check" CHECK ("defaultVolume" BETWEEN 1 AND 200),
  ADD CONSTRAINT "GuildSettings_maxVolume_check" CHECK ("maxVolume" BETWEEN 1 AND 200),
  ADD CONSTRAINT "GuildSettings_inactivity_check" CHECK ("inactivityTimeoutSec" BETWEEN 30 AND 86400),
  ADD CONSTRAINT "GuildSettings_maxQueueSize_check" CHECK ("maxQueueSize" >= 10),
  ADD CONSTRAINT "GuildSettings_maxTrackDuration_check" CHECK ("maxTrackDurationSec" IS NULL OR "maxTrackDurationSec" > 0);

ALTER TABLE "Playlist"
  ADD CONSTRAINT "Playlist_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 64);

ALTER TABLE "PlaylistTrack"
  ADD CONSTRAINT "PlaylistTrack_position_check" CHECK ("position" >= 1),
  ADD CONSTRAINT "PlaylistTrack_duration_check" CHECK ("durationMs" >= 0);

-- CreateEnum
CREATE TYPE "ControlMode" AS ENUM ('EVERYONE', 'DJ');

-- CreateEnum
CREATE TYPE "PlaylistVisibility" AS ENUM ('PRIVATE', 'GUILD');

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" VARCHAR(20) NOT NULL,
    "djRoleId" VARCHAR(20),
    "managerRoleId" VARCHAR(20),
    "controlMode" "ControlMode" NOT NULL DEFAULT 'DJ',
    "aloneIsDj" BOOLEAN NOT NULL DEFAULT true,
    "panelChannelId" VARCHAR(20),
    "defaultVolume" INTEGER NOT NULL DEFAULT 80,
    "maxVolume" INTEGER NOT NULL DEFAULT 150,
    "inactivityTimeoutSec" INTEGER NOT NULL DEFAULT 300,
    "autoplay" BOOLEAN NOT NULL DEFAULT false,
    "allowDuplicates" BOOLEAN NOT NULL DEFAULT true,
    "maxQueueSize" INTEGER NOT NULL DEFAULT 500,
    "maxTrackDurationSec" INTEGER,
    "historyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowHttpStreams" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "PanelState" (
    "guildId" VARCHAR(20) NOT NULL,
    "channelId" VARCHAR(20) NOT NULL,
    "messageId" VARCHAR(20) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PanelState_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "nameNormalized" VARCHAR(64) NOT NULL,
    "ownerId" VARCHAR(20) NOT NULL,
    "guildId" VARCHAR(20),
    "visibility" "PlaylistVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistTrack" (
    "id" UUID NOT NULL,
    "playlistId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "encoded" TEXT NOT NULL,
    "identifier" VARCHAR(512) NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "author" VARCHAR(256) NOT NULL,
    "uri" VARCHAR(1024),
    "sourceName" VARCHAR(32) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "isStream" BOOLEAN NOT NULL DEFAULT false,
    "artworkUrl" VARCHAR(1024),
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" VARCHAR(20) NOT NULL,
    "defaultSource" VARCHAR(32),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PlayHistory" (
    "id" BIGSERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "userId" VARCHAR(20) NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "author" VARCHAR(256) NOT NULL,
    "uri" VARCHAR(1024),
    "sourceName" VARCHAR(32) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "playedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "guildId" VARCHAR(20) NOT NULL,
    "actorId" VARCHAR(20) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Playlist_guildId_visibility_idx" ON "Playlist"("guildId", "visibility");

-- CreateIndex
CREATE INDEX "Playlist_ownerId_idx" ON "Playlist"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_ownerId_nameNormalized_key" ON "Playlist"("ownerId", "nameNormalized");

-- CreateIndex
CREATE INDEX "PlaylistTrack_playlistId_idx" ON "PlaylistTrack"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_position_key" ON "PlaylistTrack"("playlistId", "position");

-- CreateIndex
CREATE INDEX "PlayHistory_guildId_playedAt_idx" ON "PlayHistory"("guildId", "playedAt");

-- CreateIndex
CREATE INDEX "PlayHistory_playedAt_idx" ON "PlayHistory"("playedAt");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PanelState" ADD CONSTRAINT "PanelState_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayHistory" ADD CONSTRAINT "PlayHistory_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

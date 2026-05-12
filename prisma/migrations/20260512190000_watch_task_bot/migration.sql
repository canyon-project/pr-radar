-- AlterTable
ALTER TABLE "pr_radar_watch_task" ADD COLUMN "botWorkflowYaml" TEXT NOT NULL DEFAULT '';
ALTER TABLE "pr_radar_watch_task" ADD COLUMN "botOverlayFiles" JSONB NOT NULL DEFAULT '[]'::jsonb;

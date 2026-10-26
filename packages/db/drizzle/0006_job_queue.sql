DROP INDEX "job_state_lease";--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "run_after" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "job_claimable" ON "job" USING btree ("type","run_after") WHERE "job"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "job_running_lease" ON "job" USING btree ("lease_expires_at") WHERE "job"."state" = 'running';--> statement-breakpoint
ALTER TABLE "job" SET (fillfactor = 80);

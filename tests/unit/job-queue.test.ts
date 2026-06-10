// Job claim/retry logic against MemoryStore (the DataStore the job runner
// uses in MOCK_MODE). Covers: oldest-first claiming, running-state marking,
// no double-claims (sequential and under Promise.all concurrency),
// completeJob, failJob requeue semantics, and the MAX_JOB_ATTEMPTS=3 cap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "@/lib/store/memory";
import { MAX_JOB_ATTEMPTS, type Job } from "@/lib/types";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

describe("MemoryStore job queue", () => {
  let dataDir: string;
  let store: MemoryStore;
  let meetingId: string;

  beforeEach(async () => {
    dataDir = await makeTempDataDir();
    store = new MemoryStore(dataDir);
    const meeting = await store.createMeeting({
      title: "Test Meeting",
      body_name: "Test Council",
      source_type: "upload",
    });
    meetingId = meeting.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await cleanupDataDir(dataDir);
  });

  describe("claimNextJob ordering", () => {
    it("claims jobs oldest-first by created_at, not insertion order", async () => {
      // Fake only Date so created_at is fully controlled; fs stays real.
      vi.useFakeTimers({ toFake: ["Date"] });

      vi.setSystemTime(new Date("2026-06-09T12:00:02.000Z"));
      const newer = await store.enqueueJob(meetingId, "summarize");
      vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));
      const oldest = await store.enqueueJob(meetingId, "capture");
      vi.setSystemTime(new Date("2026-06-09T12:00:01.000Z"));
      const middle = await store.enqueueJob(meetingId, "transcribe");

      vi.setSystemTime(new Date("2026-06-09T12:00:10.000Z"));
      const first = await store.claimNextJob();
      const second = await store.claimNextJob();
      const third = await store.claimNextJob();

      expect(first?.id).toBe(oldest.id);
      expect(second?.id).toBe(middle.id);
      expect(third?.id).toBe(newer.id);
    });

    it("breaks created_at ties by insertion order (FIFO)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));

      const a = await store.enqueueJob(meetingId, "capture");
      const b = await store.enqueueJob(meetingId, "transcribe");
      const c = await store.enqueueJob(meetingId, "summarize");
      // All three share an identical created_at.
      expect(new Set([a.created_at, b.created_at, c.created_at]).size).toBe(1);

      expect((await store.claimNextJob())?.id).toBe(a.id);
      expect((await store.claimNextJob())?.id).toBe(b.id);
      expect((await store.claimNextJob())?.id).toBe(c.id);
    });

    it("returns null when there is no pending job", async () => {
      expect(await store.claimNextJob()).toBeNull();

      const job = await store.enqueueJob(meetingId, "capture");
      const claimed = await store.claimNextJob();
      expect(claimed?.id).toBe(job.id);
      // The only job is now running, so nothing is claimable.
      expect(await store.claimNextJob()).toBeNull();
    });
  });

  describe("claim marks running and never double-claims", () => {
    it("marks the claimed job running (returned and persisted)", async () => {
      const job = await store.enqueueJob(meetingId, "capture");

      const claimed = await store.claimNextJob();
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe("running");

      const stored = (await store.getJobsByMeeting(meetingId)).find(
        (j) => j.id === job.id
      );
      expect(stored?.status).toBe("running");
    });

    it("never double-claims under Promise.all concurrency", async () => {
      const jobCount = 6;
      const claimerCount = 10; // more claimers than jobs
      for (let i = 0; i < jobCount; i++) {
        await store.enqueueJob(meetingId, "capture", { index: i });
      }

      const results = await Promise.all(
        Array.from({ length: claimerCount }, () => store.claimNextJob())
      );

      const claimed = results.filter((j): j is Job => j !== null);
      const nulls = results.filter((j) => j === null);

      expect(claimed).toHaveLength(jobCount);
      expect(nulls).toHaveLength(claimerCount - jobCount);
      // Every claimed job is distinct — no job handed to two claimers.
      expect(new Set(claimed.map((j) => j.id)).size).toBe(jobCount);
      for (const job of claimed) {
        expect(job.status).toBe("running");
      }
    });
  });

  describe("completeJob", () => {
    it("marks the job complete and it is never claimable again", async () => {
      const job = await store.enqueueJob(meetingId, "capture");
      const claimed = await store.claimNextJob();
      expect(claimed?.id).toBe(job.id);

      await store.completeJob(job.id);

      const stored = (await store.getJobsByMeeting(meetingId)).find(
        (j) => j.id === job.id
      );
      expect(stored?.status).toBe("complete");
      expect(await store.claimNextJob()).toBeNull();
    });

    it("throws for an unknown job id", async () => {
      await expect(store.completeJob("nope")).rejects.toThrow(
        /Job not found/
      );
    });
  });

  describe("failJob retry semantics", () => {
    it("requeues to pending with attempts incremented and last_error set", async () => {
      const job = await store.enqueueJob(meetingId, "transcribe");
      await store.claimNextJob();

      const failed = await store.failJob(job.id, "boom: network down");

      expect(failed.status).toBe("pending");
      expect(failed.attempts).toBe(1);
      expect(failed.last_error).toBe("boom: network down");

      // Requeued job is claimable again.
      const reclaimed = await store.claimNextJob();
      expect(reclaimed?.id).toBe(job.id);
      expect(reclaimed?.status).toBe("running");
      expect(reclaimed?.attempts).toBe(1);
    });

    it("keeps requeueing until MAX_JOB_ATTEMPTS, then marks failed", async () => {
      expect(MAX_JOB_ATTEMPTS).toBe(3);

      const job = await store.enqueueJob(meetingId, "summarize");

      for (let attempt = 1; attempt < MAX_JOB_ATTEMPTS; attempt++) {
        const claimed = await store.claimNextJob();
        expect(claimed?.id).toBe(job.id);
        const failed = await store.failJob(job.id, `attempt ${attempt} failed`);
        expect(failed.status).toBe("pending");
        expect(failed.attempts).toBe(attempt);
      }

      // Final attempt: third failure flips to failed.
      const claimed = await store.claimNextJob();
      expect(claimed?.id).toBe(job.id);
      const failed = await store.failJob(job.id, "attempt 3 failed");

      expect(failed.status).toBe("failed");
      expect(failed.attempts).toBe(MAX_JOB_ATTEMPTS);
      expect(failed.last_error).toBe("attempt 3 failed");

      // A failed job is dead: nothing left to claim.
      expect(await store.claimNextJob()).toBeNull();

      const stored = (await store.getJobsByMeeting(meetingId)).find(
        (j) => j.id === job.id
      );
      expect(stored?.status).toBe("failed");
    });

    it("throws for an unknown job id", async () => {
      await expect(store.failJob("nope", "err")).rejects.toThrow(
        /Job not found/
      );
    });
  });
});

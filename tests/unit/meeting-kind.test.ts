// Meeting kind: defaults to civic, persists course, and filters listMeetings.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store/memory";
import { cleanupDataDir, makeTempDataDir } from "./helpers";

let dataDir: string;
let store: MemoryStore;

beforeEach(async () => {
  dataDir = await makeTempDataDir();
  store = new MemoryStore(dataDir);
});

afterEach(async () => {
  await cleanupDataDir(dataDir);
});

describe("meeting kind", () => {
  it("defaults to civic when not specified", async () => {
    const m = await store.createMeeting({
      title: "T",
      body_name: "B",
      source_type: "stream",
      source_url: "https://x/v",
    });
    expect(m.kind).toBe("civic");
  });

  it("persists course and filters listMeetings by kind", async () => {
    // Distinct source_urls so the source_key UNIQUE constraint does not collapse
    // these into one row.
    await store.createMeeting({
      title: "Civic",
      body_name: "Council",
      source_type: "stream",
      source_url: "https://x/civic",
    });
    const course = await store.createMeeting({
      title: "Course",
      body_name: "Channel",
      source_type: "stream",
      source_url: "https://x/course",
      kind: "course",
    });
    expect(course.kind).toBe("course");

    expect((await store.listMeetings("course")).map((m) => m.title)).toEqual([
      "Course",
    ]);
    expect((await store.listMeetings("civic")).map((m) => m.title)).toEqual([
      "Civic",
    ]);
    expect(await store.listMeetings()).toHaveLength(2);
  });
});

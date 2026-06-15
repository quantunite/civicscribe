import { describe, it, expect } from "vitest";

import {
  isTeamsHost,
  isMeetHost,
  detectMeetingPlatform,
  meetingHostError,
} from "@/lib/net/url";

describe("meeting platform host detection", () => {
  it("recognizes Teams hosts", () => {
    expect(isTeamsHost("teams.microsoft.com")).toBe(true);
    expect(isTeamsHost("teams.live.com")).toBe(true);
    expect(isTeamsHost("gov.teams.microsoft.com")).toBe(true);
    expect(isTeamsHost("zoom.us")).toBe(false);
    expect(isTeamsHost("evil-teams.microsoft.com.attacker.test")).toBe(false);
  });

  it("recognizes Meet hosts", () => {
    expect(isMeetHost("meet.google.com")).toBe(true);
    expect(isMeetHost("google.com")).toBe(false);
    expect(isMeetHost("meet.google.com.attacker.test")).toBe(false);
  });

  it("detects the platform from a URL", () => {
    expect(detectMeetingPlatform("https://us02web.zoom.us/j/123")).toBe("zoom");
    expect(
      detectMeetingPlatform("https://teams.microsoft.com/l/meetup-join/x")
    ).toBe("teams");
    expect(detectMeetingPlatform("https://meet.google.com/abc-defg-hij")).toBe(
      "meet"
    );
    expect(detectMeetingPlatform("https://youtube.com/watch?v=1")).toBeNull();
    expect(detectMeetingPlatform("not a url")).toBeNull();
  });

  it("meetingHostError flags a mismatched host", () => {
    const zoom = new URL("https://us02web.zoom.us/j/1");
    const meet = new URL("https://meet.google.com/x");
    expect(meetingHostError("zoom", zoom)).toBeNull();
    expect(meetingHostError("meet", meet)).toBeNull();
    expect(meetingHostError("teams", zoom)).not.toBeNull();
    expect(meetingHostError("zoom", meet)).not.toBeNull();
  });
});

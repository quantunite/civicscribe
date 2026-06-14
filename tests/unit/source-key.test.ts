// sourceKey: normalize a source_url into a stable dedup key. Two URLs that
// point at the same underlying video must collapse to the same key (lowercase
// host, stripped tracking params, extracted youtube/vimeo video id), while
// genuinely different sources must stay distinct.

import { describe, expect, it } from "vitest";

import { sourceKey } from "@/lib/net/source-key";

describe("sourceKey — youtube", () => {
  it("collapses watch, youtu.be, shorts, and embed forms to the same video id", () => {
    const expected = "youtube:dQw4w9WgXcQ";
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(sourceKey(url), url).toBe(expected);
    }
  });

  it("ignores tracking + playlist params but keeps the video id", () => {
    expect(
      sourceKey(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz&index=3&utm_source=x&t=42s"
      )
    ).toBe("youtube:dQw4w9WgXcQ");
  });

  it("distinguishes different video ids", () => {
    expect(sourceKey("https://youtu.be/aaaaaaaaaaa")).not.toBe(
      sourceKey("https://youtu.be/bbbbbbbbbbb")
    );
  });
});

describe("sourceKey — vimeo", () => {
  it("extracts the numeric id from a vimeo url", () => {
    expect(sourceKey("https://vimeo.com/123456789")).toBe("vimeo:123456789");
    expect(sourceKey("https://player.vimeo.com/video/123456789")).toBe(
      "vimeo:123456789"
    );
  });
});

describe("sourceKey — generic urls", () => {
  it("lowercases the host and strips tracking params + fragment", () => {
    expect(
      sourceKey(
        "HTTPS://Stream.Example.COM/live/Show?utm_source=fb&fbclid=abc&gclid=def#frag"
      )
    ).toBe("https://stream.example.com/live/show");
  });

  it("keeps meaningful query params but drops tracking ones, sorted", () => {
    // Same meaningful params in different orders / with tracking noise collapse.
    const a = sourceKey("https://x.example.com/v?id=7&page=2&utm_medium=email");
    const b = sourceKey("https://x.example.com/v?page=2&utm_campaign=z&id=7");
    expect(a).toBe(b);
    expect(a).toBe("https://x.example.com/v?id=7&page=2");
  });

  it("drops a trailing slash on the path so it does not split dupes", () => {
    expect(sourceKey("https://x.example.com/live/")).toBe(
      sourceKey("https://x.example.com/live")
    );
  });

  it("ignores the default port", () => {
    expect(sourceKey("https://x.example.com:443/v")).toBe(
      sourceKey("https://x.example.com/v")
    );
  });
});

describe("sourceKey — non-url / empty input", () => {
  it("returns null for null, empty, or unparseable input", () => {
    expect(sourceKey(null)).toBeNull();
    expect(sourceKey("")).toBeNull();
    expect(sourceKey("   ")).toBeNull();
    expect(sourceKey("not a url")).toBeNull();
    expect(sourceKey("ftp://x.com/a")).toBeNull();
  });
});

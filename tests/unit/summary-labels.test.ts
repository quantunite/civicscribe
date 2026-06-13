import { describe, expect, it } from "vitest";
import { summaryLabels } from "@/lib/summary-labels";

describe("summaryLabels", () => {
  it("civic uses decisions / action items", () => {
    expect(summaryLabels("civic")).toEqual({
      keyPoints: "Key decisions",
      takeaways: "Action items",
    });
  });

  it("course uses concepts / takeaways", () => {
    expect(summaryLabels("course")).toEqual({
      keyPoints: "Key concepts",
      takeaways: "Key takeaways",
    });
  });
});

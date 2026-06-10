import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    source_type: z.enum(["zoom", "stream"]),
    source_url: z.string().trim().min(1, "source_url is required"),
  })
  .superRefine((data, ctx) => {
    const url = parseHttpUrl(data.source_url);
    if (!url) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message: "source_url must be a valid http(s) URL",
      });
      return;
    }
    if (data.source_type === "zoom") {
      const host = url.hostname.toLowerCase();
      if (host !== "zoom.us" && !host.endsWith(".zoom.us")) {
        ctx.addIssue({
          code: "custom",
          path: ["source_url"],
          message: "source_url must be a zoom.us meeting link",
        });
      }
    }
  });

/** GET /api/meetings — all meetings, newest first. */
export async function GET() {
  try {
    const meetings = await getStore().listMeetings();
    return NextResponse.json(meetings);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list meetings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/meetings — create a zoom or stream meeting and enqueue capture. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json(
      {
        error: issues[0]?.message ?? "Invalid request",
        issues,
      },
      { status: 400 }
    );
  }

  try {
    const store = getStore();
    const meeting = await store.createMeeting({
      title: parsed.data.title,
      body_name: parsed.data.body_name,
      source_type: parsed.data.source_type,
      source_url: parsed.data.source_url,
    });
    await store.enqueueJob(meeting.id, "capture");
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

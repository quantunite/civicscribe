import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { createAndEnqueueCapture } from "@/lib/meetings/create";
import { isInternalHost, isZoomHost, parseHttpUrl } from "@/lib/net/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    body_name: z.string().trim().min(1, "body_name is required").max(300),
    source_type: z.enum(["zoom", "stream"]),
    kind: z.enum(["civic", "course"]).optional(),
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
    if (data.source_type === "zoom" && !isZoomHost(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message: "source_url must be a zoom.us meeting link",
      });
    }
    if (data.source_type === "stream" && isInternalHost(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message:
          "source_url must point at a public host — localhost and private/internal addresses are not allowed",
      });
    }
  });

/** GET /api/meetings — meetings newest first; optional ?kind=civic|course. */
export async function GET(request: Request) {
  try {
    const kindParam = new URL(request.url).searchParams.get("kind");
    const kind =
      kindParam === "civic" || kindParam === "course" ? kindParam : undefined;
    const meetings = await getStore().listMeetings(kind);
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
    const meeting = await createAndEnqueueCapture(getStore(), {
      title: parsed.data.title,
      body_name: parsed.data.body_name,
      source_type: parsed.data.source_type,
      kind: parsed.data.kind,
      source_url: parsed.data.source_url,
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

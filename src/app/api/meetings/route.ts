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

/**
 * Reject obviously-internal hosts for stream URLs (the server hands them to
 * yt-dlp, which will happily fetch them). This is a deliberate "obvious
 * cases" blocklist — localhost, *.local, loopback/private/link-local IPv4
 * ranges, [::1], 0.0.0.0. DNS-rebinding-grade SSRF protection (resolving the
 * host and re-validating at connect time) is out of scope for single-user v1.
 */
function isInternalHost(hostname: string): boolean {
  // URL.hostname keeps brackets on IPv6 literals ("[::1]").
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8 "this network"
  }
  return false;
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
    if (data.source_type === "stream" && isInternalHost(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["source_url"],
        message:
          "source_url must point at a public host — localhost and private/internal addresses are not allowed",
      });
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
    try {
      await store.enqueueJob(meeting.id, "capture");
    } catch (err) {
      // Don't strand a zombie "pending" meeting no job will ever advance.
      await store
        .setMeetingStatus(
          meeting.id,
          "failed",
          "failed to enqueue processing job"
        )
        .catch(() => {});
      const message =
        err instanceof Error ? err.message : "failed to enqueue processing job";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create meeting";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

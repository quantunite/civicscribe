"use client";

import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { Meeting, MeetingAttestation, MeetingKind } from "@/lib/types";
import { detectMeetingPlatform } from "@/lib/net/url";

type TabKey = "zoom" | "stream" | "upload";

const TABS: ReadonlyArray<{ key: TabKey; label: string; hint: string }> = [
  {
    key: "zoom",
    label: "Video call",
    hint: "A bot joins your Zoom, Teams, or Google Meet and records the audio.",
  },
  {
    key: "stream",
    label: "Stream URL",
    hint: "Audio is extracted from a public stream or video page.",
  },
  {
    key: "upload",
    label: "Upload file",
    hint: "Use a recording you already have (audio or video).",
  },
];

const ACCEPTED_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".webm",
  ".ogg",
  ".opus",
  ".aac",
  ".flac",
  ".mov",
];

interface FieldErrors {
  title?: string;
  bodyName?: string;
  source?: string;
  attestation?: string;
}

/** Outcome the form shows in place. A fresh create navigates away to the
 *  self-serve result page instead, so the only thing rendered in place is the
 *  neutral "already submitted" acknowledgement after a dedup hit. */
interface DuplicateResult {
  duplicate: true;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isAcceptableFile(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return true;
  }
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function extractErrorMessage(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return null;
}

const inputClass =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink shadow-sm placeholder:text-ink-soft/70";
const labelClass = "block font-semibold text-ink";
const errorClass = "mt-2 text-sm font-medium text-red-800";

export default function NewMeetingForm({
  kind = "civic",
}: {
  kind?: MeetingKind;
}) {
  const isCourse = kind === "course";
  const router = useRouter();

  // Courses are URL/upload videos, never Zoom — default to the Stream tab.
  const [activeTab, setActiveTab] = useState<TabKey>(
    isCourse ? "stream" : "zoom"
  );
  const [title, setTitle] = useState("");
  const [bodyName, setBodyName] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Live captions: opt-in, bot sources (video call) only. Default off.
  const [liveEnabled, setLiveEnabled] = useState(false);
  // Required lawful-basis attestation. Null until the submitter chooses one.
  const [attestation, setAttestation] = useState<MeetingAttestation | null>(
    null
  );

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<DuplicateResult | null>(null);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyNameRef = useRef<HTMLInputElement>(null);
  const zoomRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attestationRef = useRef<HTMLInputElement>(null);

  function selectTab(key: TabKey) {
    setActiveTab(key);
    setErrors((prev) => ({ ...prev, source: undefined }));
    setServerError(null);
    // A recording bot is only for open public meetings, so the "authorized"
    // (private, by-authority) basis does not apply to the Video call source.
    if (key === "zoom") {
      setAttestation((prev) => (prev === "authorized" ? null : prev));
    }
  }

  /** Arrow-key navigation per the WAI-ARIA tabs pattern (automatic activation). */
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tab = TABS[nextIndex];
    selectTab(tab.key);
    tabRefs.current[nextIndex]?.focus();
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) {
      next.title = "Enter a meeting title.";
    }
    if (!bodyName.trim()) {
      next.bodyName =
        "Enter the name of the public body, e.g. Lawrence City Council.";
    }
    if (activeTab === "zoom") {
      if (!zoomUrl.trim()) {
        next.source = "Enter the meeting link.";
      } else if (!detectMeetingPlatform(zoomUrl)) {
        next.source =
          "That doesn't look like a Zoom, Teams, or Google Meet link. Use the https:// invite URL.";
      }
    } else if (activeTab === "stream") {
      if (!streamUrl.trim()) {
        next.source = "Enter the stream or video page URL.";
      } else if (!parseHttpUrl(streamUrl)) {
        next.source = "Enter a full web address starting with http:// or https://.";
      }
    } else {
      if (!file) {
        next.source = "Choose an audio or video file to upload.";
      } else if (!isAcceptableFile(file)) {
        next.source =
          "That file type isn't supported. Use an audio or video file such as .mp3, .m4a, .wav, or .mp4.";
      }
    }
    if (attestation === null) {
      next.attestation = "Choose the basis for adding this recording.";
    }
    return next;
  }

  function focusFirstError(next: FieldErrors) {
    if (next.title) {
      titleRef.current?.focus();
    } else if (next.bodyName) {
      bodyNameRef.current?.focus();
    } else if (next.source) {
      if (activeTab === "zoom") zoomRef.current?.focus();
      else if (activeTab === "stream") streamRef.current?.focus();
      else fileRef.current?.focus();
    } else if (next.attestation) {
      attestationRef.current?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const nextErrors = validate();
    setErrors(nextErrors);
    if (
      nextErrors.title ||
      nextErrors.bodyName ||
      nextErrors.source ||
      nextErrors.attestation
    ) {
      setStatusMessage("The form has errors. Fix the highlighted fields.");
      focusFirstError(nextErrors);
      return;
    }

    setSubmitting(true);
    setStatusMessage(
      activeTab === "upload"
        ? "Uploading the recording. This can take a moment for large files."
        : "Adding the meeting…"
    );

    try {
      // attestation is non-null here (validate() blocked submit otherwise).
      const attestationValue = attestation as MeetingAttestation;
      let res: Response;
      if (activeTab === "upload") {
        const formData = new FormData();
        formData.set("title", title.trim());
        formData.set("body_name", bodyName.trim());
        formData.set("kind", kind);
        formData.set("attestation", attestationValue);
        if (file) formData.set("file", file);
        res = await fetch("/api/upload", { method: "POST", body: formData });
      } else {
        const sourceUrl = activeTab === "zoom" ? zoomUrl.trim() : streamUrl.trim();
        // The "Video call" tab accepts Zoom/Teams/Meet; detect which so the
        // server gets the precise platform (validated in validate() already).
        const sourceType =
          activeTab === "zoom"
            ? detectMeetingPlatform(sourceUrl) ?? "zoom"
            : "stream";
        res = await fetch("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            body_name: bodyName.trim(),
            source_type: sourceType,
            kind,
            source_url: sourceUrl,
            attestation: attestationValue,
            // Live captions only apply to a video-call bot source. The server
            // forces false for stream regardless, so it is safe to omit there.
            ...(activeTab === "zoom" ? { live_enabled: liveEnabled } : {}),
          }),
        });
      }

      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        throw new Error(
          extractErrorMessage(payload) ??
            `The server couldn't add the meeting (error ${res.status}). Try again.`
        );
      }

      // A genuine new create returns 201 with { ...meeting, viewToken }. A dedup
      // hit returns 200 with { duplicate: true } and NO id/token (non-staff). We
      // must not assume `meeting` is present on the dedup shape.
      const payload = (await res.json()) as
        | (Meeting & { viewToken: string | null })
        | { duplicate: true; message?: string };

      if (
        typeof payload === "object" &&
        payload !== null &&
        "duplicate" in payload
      ) {
        // Neutral acknowledgement: no id is handed back, so we cannot (and must
        // not) open a private preview for a meeting this caller did not create.
        setResult({ duplicate: true });
        setStatusMessage(
          "This meeting was already submitted. It will appear in the public library once staff approve it."
        );
        setSubmitting(false);
        return;
      }

      // Fresh create: stash the single-meeting view token in this tab's
      // sessionStorage (keyed by id, never in the URL) and go to the private,
      // view-only result page. In open mode viewToken is null; the result page's
      // detail read is open then, so storing null is harmless.
      const created = payload;
      try {
        if (created.viewToken) {
          window.sessionStorage.setItem(
            `cs-view:${created.id}`,
            created.viewToken
          );
        }
      } catch {
        // sessionStorage can be unavailable (private mode); the result page
        // degrades to its "preview not available" copy.
      }
      setStatusMessage("Submitted. Opening your private preview…");
      router.push(`/meetings/${created.id}/result`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setServerError(message);
      setStatusMessage("");
      setSubmitting(false);
    }
  }

  const activeTabConfig = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  // The Video call source dispatches a recording bot, which records everyone
  // present, so it is restricted to the public-meeting basis.
  const botSource = activeTab === "zoom";

  function resetForSubmitAnother() {
    setResult(null);
    setStatusMessage("");
    setServerError(null);
    setErrors({});
    setTitle("");
    setBodyName("");
    setZoomUrl("");
    setStreamUrl("");
    setFile(null);
    setLiveEnabled(false);
    setAttestation(null);
  }

  // A fresh create navigates to the private result page. The only in-place
  // confirmation is the neutral "already submitted" acknowledgement after a
  // dedup hit: we deliberately do NOT link to the existing item (no id is
  // returned, and the submitter of a duplicate did not create that record).
  if (result) {
    const noun = isCourse ? "video" : "meeting";
    return (
      <div
        role="status"
        className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
      >
        <h2 className="text-2xl">Already submitted</h2>
        <p className="mt-3 max-w-2xl text-ink-soft">
          This {noun} was already submitted, so we did not process it again. It
          will appear in the public library once staff approve it.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={resetForSubmitAnother}
            className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface px-6 font-semibold text-ink hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-offset-2"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      {/* Source tabs */}
      <div
        role="tablist"
        aria-label="Meeting source"
        className="flex flex-wrap gap-2 rounded-lg bg-primary-soft p-1.5"
      >
        {TABS.map((tab, index) => {
          const selected = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              className={`min-h-11 flex-1 rounded-md px-4 font-semibold whitespace-nowrap ${
                selected
                  ? "bg-primary text-white shadow-sm"
                  : "text-primary-strong hover:bg-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-ink-soft">{activeTabConfig.hint}</p>

      {/* Common fields */}
      <div className="mt-6 flex flex-col gap-6">
        <div>
          <label htmlFor="meeting-title" className={labelClass}>
            Meeting title <span aria-hidden="true" className="text-red-700">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={titleRef}
            id="meeting-title"
            name="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "error-title" : undefined}
            placeholder="City Council Regular Session, June 9"
            className={inputClass}
          />
          {errors.title && (
            <p id="error-title" role="alert" className={errorClass}>
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="meeting-body-name" className={labelClass}>
            {isCourse ? "Channel or subject" : "Public body"}{" "}
            <span aria-hidden="true" className="text-red-700">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={bodyNameRef}
            id="meeting-body-name"
            name="body_name"
            type="text"
            required
            value={bodyName}
            onChange={(e) => setBodyName(e.target.value)}
            aria-invalid={errors.bodyName ? true : undefined}
            aria-describedby={
              errors.bodyName ? "error-body-name" : "hint-body-name"
            }
            placeholder={isCourse ? "RoboNuggets" : "Lawrence City Council"}
            className={inputClass}
          />
          {errors.bodyName ? (
            <p id="error-body-name" role="alert" className={errorClass}>
              {errors.bodyName}
            </p>
          ) : (
            <p id="hint-body-name" className="mt-2 text-sm text-ink-soft">
              {isCourse
                ? "The channel, course, or creator behind the video."
                : "The committee, council, or board that held the meeting."}
            </p>
          )}
        </div>

        {/* Zoom panel */}
        <div
          role="tabpanel"
          id="panel-zoom"
          aria-labelledby="tab-zoom"
          hidden={activeTab !== "zoom"}
        >
          <label htmlFor="zoom-url" className={labelClass}>
            Meeting link (Zoom, Teams, or Google Meet){" "}
            <span aria-hidden="true" className="text-red-700">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={zoomRef}
            id="zoom-url"
            name="zoom_url"
            type="url"
            inputMode="url"
            value={zoomUrl}
            onChange={(e) => setZoomUrl(e.target.value)}
            aria-invalid={activeTab === "zoom" && errors.source ? true : undefined}
            aria-describedby={
              activeTab === "zoom" && errors.source ? "error-source" : "hint-zoom"
            }
            placeholder="Paste a Zoom, Teams, or Google Meet link"
            className={inputClass}
          />
          {activeTab === "zoom" && errors.source ? (
            <p id="error-source" role="alert" className={errorClass}>
              {errors.source}
            </p>
          ) : (
            <p id="hint-zoom" className="mt-2 text-sm text-ink-soft">
              A recording bot joins this meeting, so add it a little before the
              meeting starts.
            </p>
          )}

          {/* Live captions opt-in: video-call (bot) sources only, default off. */}
          <div className="mt-4 rounded-md border border-line bg-primary-soft p-4">
            <label
              htmlFor="live-enabled"
              className="flex cursor-pointer items-start gap-3"
            >
              <input
                id="live-enabled"
                name="live_enabled"
                type="checkbox"
                checked={liveEnabled}
                onChange={(e) => setLiveEnabled(e.target.checked)}
                className="mt-1 h-5 w-5 cursor-pointer rounded border-line-strong text-accent"
              />
              <span>
                <span className="font-semibold text-ink">Live captions</span>
                <span className="mt-1 block text-sm text-ink-soft">
                  Stream a public live transcript anyone can follow while the
                  meeting happens.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Stream panel */}
        <div
          role="tabpanel"
          id="panel-stream"
          aria-labelledby="tab-stream"
          hidden={activeTab !== "stream"}
        >
          <label htmlFor="stream-url" className={labelClass}>
            Stream or video URL{" "}
            <span aria-hidden="true" className="text-red-700">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={streamRef}
            id="stream-url"
            name="stream_url"
            type="url"
            inputMode="url"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            aria-invalid={
              activeTab === "stream" && errors.source ? true : undefined
            }
            aria-describedby={
              activeTab === "stream" && errors.source
                ? "error-source"
                : "hint-stream"
            }
            placeholder="https://www.youtube.com/watch?v=…"
            className={inputClass}
          />
          {activeTab === "stream" && errors.source ? (
            <p id="error-source" role="alert" className={errorClass}>
              {errors.source}
            </p>
          ) : (
            <p id="hint-stream" className="mt-2 text-sm text-ink-soft">
              Any public page with audio or video: YouTube, a municipal
              streaming portal, or a direct media link.
            </p>
          )}
        </div>

        {/* Upload panel */}
        <div
          role="tabpanel"
          id="panel-upload"
          aria-labelledby="tab-upload"
          hidden={activeTab !== "upload"}
        >
          <label htmlFor="upload-file" className={labelClass}>
            Recording file{" "}
            <span aria-hidden="true" className="text-red-700">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            ref={fileRef}
            id="upload-file"
            name="file"
            type="file"
            accept={`audio/*,video/*,${ACCEPTED_EXTENSIONS.join(",")}`}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-invalid={
              activeTab === "upload" && errors.source ? true : undefined
            }
            aria-describedby={
              activeTab === "upload" && errors.source
                ? "error-source"
                : "hint-upload"
            }
            className={`${inputClass} cursor-pointer file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white`}
          />
          {activeTab === "upload" && errors.source ? (
            <p id="error-source" role="alert" className={errorClass}>
              {errors.source}
            </p>
          ) : (
            <p id="hint-upload" className="mt-2 text-sm text-ink-soft">
              Audio or video: .mp3, .m4a, .wav, .mp4, and similar formats.
            </p>
          )}
        </div>
      </div>

      {/* Lawful-basis attestation (required). One of two bases must be chosen
          before this can be submitted. */}
      <fieldset
        className="mt-6 rounded-md border border-line bg-primary-soft p-4"
        aria-describedby={
          errors.attestation ? "error-attestation" : "hint-attestation"
        }
      >
        <legend className="px-1 font-semibold text-ink">
          Basis for adding this recording{" "}
          <span aria-hidden="true" className="text-red-700">
            *
          </span>
          <span className="sr-only">(required)</span>
        </legend>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              ref={attestationRef}
              type="radio"
              name="attestation"
              value="public"
              checked={attestation === "public"}
              onChange={() => {
                setAttestation("public");
                setErrors((prev) => ({ ...prev, attestation: undefined }));
              }}
              className="mt-1 h-5 w-5 cursor-pointer border-line-strong text-accent"
            />
            <span className="text-ink">
              This is an open meeting of a public body.
            </span>
          </label>
          {!botSource && (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="attestation"
                value="authorized"
                checked={attestation === "authorized"}
                onChange={() => {
                  setAttestation("authorized");
                  setErrors((prev) => ({ ...prev, attestation: undefined }));
                }}
                className="mt-1 h-5 w-5 cursor-pointer border-line-strong text-accent"
              />
              <span className="text-ink">
                I have explicit authority to record this meeting and add it to the
                public library.
              </span>
            </label>
          )}
        </div>
        {errors.attestation ? (
          <p id="error-attestation" role="alert" className={errorClass}>
            {errors.attestation}
          </p>
        ) : (
          <p id="hint-attestation" className="mt-2 text-sm text-ink-soft">
            {botSource
              ? "A recording bot is only for open public meetings. To add a private meeting you have authority over, use the Stream URL or Upload file source instead."
              : "We record the basis you choose. Pick one to continue."}
          </p>
        )}
      </fieldset>

      {/* Server-side failure */}
      {serverError && (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-900"
        >
          {serverError}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={submitting || attestation === null}
          className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-7 text-lg font-semibold text-white shadow-sm hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Adding meeting…" : "Add meeting"}
        </button>
        {/* Live status for screen readers and sighted users alike */}
        <p aria-live="polite" className="text-sm font-medium text-ink-soft">
          {statusMessage}
        </p>
      </div>
    </form>
  );
}

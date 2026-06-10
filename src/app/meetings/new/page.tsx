import type { Metadata } from "next";
import NewMeetingForm from "@/components/dashboard/NewMeetingForm";

export const metadata: Metadata = {
  title: "Add meeting",
  description:
    "Add a public meeting to CivicScribe — capture a Zoom meeting, ingest a public stream, or upload a recording.",
};

export default function NewMeetingPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl">Add a meeting</h1>
      <p className="mt-2 text-ink-soft">
        Choose how to bring the meeting in. CivicScribe captures the audio,
        transcribes it with speaker labels, and writes a summary.
      </p>
      <div className="mt-8">
        <NewMeetingForm />
      </div>
    </div>
  );
}

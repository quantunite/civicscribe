import type { Metadata } from "next";

import NewScheduleForm from "@/components/schedules/NewScheduleForm";

export const metadata: Metadata = {
  title: "New schedule",
  description:
    "Create a recurring capture schedule — CivicScribe materializes and processes each occurrence automatically.",
};

export default function NewSchedulePage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl">New schedule</h1>
      <p className="mt-2 text-ink-soft">
        CivicScribe will create and process a meeting for each occurrence — the
        same capture, transcription, and summary as adding one by hand.
      </p>
      <div className="mt-8">
        <NewScheduleForm />
      </div>
    </div>
  );
}

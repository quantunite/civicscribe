import type { Metadata } from "next";
import NewMeetingForm from "@/components/dashboard/NewMeetingForm";

export const metadata: Metadata = {
  title: "Add a video: Study Notes",
  description:
    "Add an educational video to Study Notes. CivicScribe fetches the captions and writes study notes.",
};

export default function NewCoursePage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-3xl">Add a video</h1>
      <p className="mt-2 text-ink-soft">
        Paste a public video URL. CivicScribe pulls the captions and writes
        study notes (a TL;DR, the key concepts, and the takeaways) so you can
        skip the watch.
      </p>
      <div className="mt-8">
        <NewMeetingForm kind="course" />
      </div>
    </div>
  );
}

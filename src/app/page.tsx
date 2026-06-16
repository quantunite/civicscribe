import Link from "next/link";
import Image from "next/image";

import { getStore } from "@/lib/store";
import MeetingList from "@/components/dashboard/MeetingList";
import LoginForm from "@/components/auth/LoginForm";
import { isStaff, currentUser } from "@/lib/auth/server";

// Role-aware + fresh per request: the visible meeting set depends on staff
// status, and statuses change as the worker runs.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const isAdmin = await isStaff();
  const user = await currentUser();

  const store = getStore();
  const meetings = isAdmin
    ? await store.listMeetings("civic")
    : await store.listLibrary({ kind: "civic" });

  return (
    <div className="home">
      {/* Cinematic civic hero: a dignified, non-partisan council-chamber scene. */}
      <section className="home-hero">
        <div className="home-hero__scene" aria-hidden="true">
          <Image
            src="/hero/home-hero.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="home-hero__img"
          />
          <div className="home-hero__grain" />
          <div className="home-hero__scrim" />
        </div>

        <div className="home-hero__inner">
          <p className="home-eyebrow home-entrance">A public record for everyone</p>
          <h1 className="home-display home-entrance home-entrance--2">
            We take the meeting,
            <br />
            so you can do <em>the great things you&apos;re meant to.</em>
          </h1>
          <p className="home-lede home-entrance home-entrance--3">
            CivicScribe captures city council, school board, and other public
            meetings and turns them into searchable, speaker-labeled transcripts
            and plain-language summaries that anyone can read.
          </p>
          <div className="home-cta-row home-entrance home-entrance--4">
            <Link href="/meetings/new" className="home-btn home-btn--primary">
              Add a meeting
            </Link>
            <Link href="/library" className="home-btn home-btn--ghost">
              Browse the archive
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="home-section">
        <p className="home-kicker">How it works</p>
        <h2>From a link to a readable record in three steps.</h2>
        <ol className="home-steps">
          <li className="home-step">
            <div className="home-step__n">1</div>
            <h3>Submit a meeting</h3>
            <p>
              Paste a Zoom link, a public stream or video URL, or upload a
              recording you already have.
            </p>
          </li>
          <li className="home-step">
            <div className="home-step__n">2</div>
            <h3>We capture &amp; transcribe</h3>
            <p>
              For Zoom, a bot joins and records; for streams and uploads we pull
              the audio. Then it&apos;s transcribed with speaker labels.
            </p>
          </li>
          <li className="home-step">
            <div className="home-step__n">3</div>
            <h3>Read, search &amp; share</h3>
            <p>
              Get a full transcript, a plain-language summary with key decisions
              and action items, and full-text search across the archive.
            </p>
          </li>
        </ol>
      </section>

      {/* Ways to capture */}
      <section className="home-section">
        <p className="home-kicker">Ways to capture</p>
        <h2>Three ways in.</h2>
        <div className="home-sources">
          <div className="home-source">
            <h3>Zoom meeting</h3>
            <p>Paste the Zoom link and a bot joins the meeting to record the audio.</p>
          </div>
          <div className="home-source">
            <h3>Public stream or video</h3>
            <p>Point us at a public stream or video page and we extract the audio.</p>
          </div>
          <div className="home-source">
            <h3>Upload a recording</h3>
            <p>Already have audio or video? Upload it and we take it from there.</p>
          </div>
        </div>
        <p style={{ marginTop: "1.25rem", color: "var(--color-ink-soft)" }}>
          Running a recurring series?{" "}
          <Link
            href="/schedules"
            style={{ color: "var(--color-accent-strong)", fontWeight: 600 }}
          >
            Schedule automatic captures
          </Link>{" "}
          so each meeting is recorded without lifting a finger.
        </p>
      </section>

      {/* How capture works: the recording bot */}
      <section className="home-section">
        <p className="home-kicker">How capture works</p>
        <h2>How the recording joins your meeting.</h2>
        <p
          style={{
            marginTop: "0.75rem",
            color: "var(--color-ink-soft)",
            maxWidth: "62ch",
          }}
        >
          For Zoom, Microsoft Teams, and Google Meet, CivicScribe sends a
          recording bot into the meeting. It joins as a visible participant and
          records the audio, then we transcribe it with speaker labels and write
          a plain-language summary. You do not install anything.
        </p>
        <ul className="home-notes">
          <li>Add the meeting a little before it starts so the bot is there in time.</li>
          <li>
            If the meeting has a waiting room, the host admits the bot like any
            other guest.
          </li>
          <li>Include any passcode in the link by using the full invite URL.</li>
          <li>
            For registration-only webinars, register first and paste your
            personal join link.
          </li>
          <li>
            Prefer not to use a live bot? Paste the posted recording or stream
            URL instead and we pull the audio directly.
          </li>
        </ul>
      </section>

      {/* Staff sign-in (or signed-in panel). The instructional page stays the
          home page either way. */}
      <section className="home-section">
        {isAdmin ? (
          <div className="home-signedin">
            <p className="home-kicker">Staff</p>
            <h2>You&apos;re signed in{user ? ` as ${user.role}` : ""}.</h2>
            <p style={{ color: "var(--color-ink-soft)" }}>
              Review submissions, publish to the public library, and manage
              scheduled captures.
            </p>
            <div className="home-links">
              <Link href="/review">Review queue</Link>
              <Link href="/meetings/new">Add a meeting</Link>
              <Link href="/schedules">Schedules</Link>
            </div>
          </div>
        ) : (
          <div className="home-signin-card">
            <div>
              <p className="home-kicker">Staff sign-in</p>
              <h2>Manage CivicScribe</h2>
              <p>
                Moderators and admins sign in to review submissions, publish to
                the public library, and manage schedules. Public visitors
                don&apos;t need an account to submit or read.
              </p>
            </div>
            <LoginForm />
          </div>
        )}
      </section>

      {/* The archive stays reachable right on the home page. */}
      <section className="home-section">
        <p className="home-kicker">The archive</p>
        <h2>{isAdmin ? "Your meetings" : "Recent meetings"}</h2>
        <p
          style={{
            marginTop: "0.25rem",
            marginBottom: "1.25rem",
            color: "var(--color-ink-soft)",
            maxWidth: "42rem",
          }}
        >
          {isAdmin
            ? "Captured meetings, including pending and failed, so you can moderate from here."
            : "A public archive of captured meetings. Open any one for a full transcript and summary."}
        </p>
        <MeetingList initialMeetings={meetings} kind="civic" isAdmin={isAdmin} />
      </section>
    </div>
  );
}

import Link from "next/link";

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
          <svg
            className="home-hero__flag"
            viewBox="0 0 76 40"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="76" height="40" fill="#f4efe6" />
            <rect y="0" width="76" height="5.71" fill="#8a2b34" />
            <rect y="11.43" width="76" height="5.71" fill="#8a2b34" />
            <rect y="22.86" width="76" height="5.71" fill="#8a2b34" />
            <rect y="34.29" width="76" height="5.71" fill="#8a2b34" />
            <rect width="30" height="22.86" fill="#16294a" />
            <g fill="#f4efe6">
              <circle cx="6" cy="5" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="24" cy="5" r="1" />
              <circle cx="10.5" cy="11.4" r="1" />
              <circle cx="19.5" cy="11.4" r="1" />
              <circle cx="6" cy="17.8" r="1" />
              <circle cx="15" cy="17.8" r="1" />
              <circle cx="24" cy="17.8" r="1" />
            </g>
          </svg>

          <svg
            className="home-hero__chamber"
            viewBox="0 0 1200 220"
            fill="none"
            preserveAspectRatio="xMidYMax slice"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g stroke="#f4efe6" strokeWidth="2" strokeLinejoin="round">
              <path d="M120 215 Q600 150 1080 215" />
              <path d="M170 215 Q600 168 1030 215" />
              <path d="M220 215 Q600 186 980 215" />
              <path d="M470 120 H730 V150 H470 Z" />
              <path d="M585 92 H615 V120 H585 Z" />
              <path d="M748 70 V150" />
              <path d="M748 70 H784 V84 H748" />
              <path d="M420 70 V150" />
              <path d="M780 70 V150" />
              <path d="M360 60 H840" />
            </g>
          </svg>

          <div className="home-hero__grain" />
          <div className="home-hero__vignette" />
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

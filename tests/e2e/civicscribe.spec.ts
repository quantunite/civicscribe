// End-to-end happy path through the full mock pipeline (MOCK_MODE=true,
// DATA_DIR=.data-e2e, wiped in global-setup):
//
//   empty dashboard -> upload-file meeting form -> drive /api/jobs/tick until
//   complete -> meeting page (summary, key decisions, virtualized transcript)
//   -> inline speaker rename + apply-to-all -> transcript search/highlight ->
//   global /search?q= -> deep-link back to the meeting page.
//
// The mock transcription provider always returns the 52-utterance Lawrence
// City Council fixture, so transcript-dependent assertions are deterministic.

import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { synthesizeWav } from "../../src/lib/fixtures/audio";

const MEETING_TITLE = "E2E Council Meeting";
const BODY_NAME = "Lawrence City Council";
const FIXTURE_UTTERANCE_COUNT = 52;
const MAX_TICKS = 60;

// global-setup.ts wipes .data-e2e, but Playwright launches the webServer
// (plugin setup) BEFORE globalSetup runs, and the server's readiness probe
// (GET /) renders the dashboard, which lazy-loads .data-e2e/db.json into the
// MemoryStore singleton. Any db.json left by a previous run is therefore
// already cached in server memory by the time globalSetup deletes the files,
// and the "empty state" step would fail on every second run. Wiping the data
// dir again AFTER the test guarantees the next run's server boots from an
// empty store, making back-to-back runs deterministic.
test.afterAll(async () => {
  const dir = path.resolve(__dirname, "../../.data-e2e");
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("full pipeline: upload, process, transcript, rename, search", async ({
  page,
  request,
}) => {
  let meetingId = "";

  await test.step("dashboard shows the empty state", async () => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "No meetings yet" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a meeting" })).toBeVisible();
  });

  await test.step("create a meeting via the Upload file tab", async () => {
    await page.goto("/meetings/new");
    await expect(
      page.getByRole("heading", { name: "Add a meeting" })
    ).toBeVisible();

    const uploadTab = page.getByRole("tab", { name: "Upload file" });
    await uploadTab.click();
    await expect(uploadTab).toHaveAttribute("aria-selected", "true");

    await page.getByLabel(/Meeting title/).fill(MEETING_TITLE);
    await page.getByLabel(/Public body/).fill(BODY_NAME);

    // Tiny but fully valid 16-bit PCM WAV, generated in-process.
    await page.getByLabel(/Recording file/).setInputFiles({
      name: "e2e-council.wav",
      mimeType: "audio/wav",
      buffer: synthesizeWav(2),
    });

    await page.getByRole("button", { name: /Add meeting/ }).click();

    // Successful submit navigates back to the dashboard, which now lists the
    // new meeting card.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: MEETING_TITLE })
    ).toBeVisible();
  });

  await test.step("drive the pipeline to completion via /api/jobs/tick", async () => {
    // The meeting id comes from the API list (the store was wiped, so the
    // upload is the only meeting).
    await expect
      .poll(async () => {
        const res = await request.get("/api/meetings");
        if (!res.ok()) return false;
        const meetings = (await res.json()) as Array<{
          id: string;
          title: string;
        }>;
        const found = meetings.find((m) => m.title === MEETING_TITLE);
        if (found) meetingId = found.id;
        return Boolean(found);
      })
      .toBe(true);

    let status = "pending";
    for (let tick = 0; tick < MAX_TICKS && status !== "complete"; tick++) {
      const tickRes = await request.post("/api/jobs/tick");
      expect(tickRes.ok()).toBeTruthy();

      const res = await request.get(`/api/meetings/${meetingId}`);
      expect(res.ok()).toBeTruthy();
      const detail = (await res.json()) as {
        meeting: { status: string; error_message: string | null };
      };
      status = detail.meeting.status;
      if (status === "failed") {
        throw new Error(
          `Pipeline failed: ${detail.meeting.error_message ?? "(no error_message)"}`
        );
      }
    }
    expect(status).toBe("complete");
  });

  const transcript = page.getByLabel("Transcript utterances (scrollable)");

  await test.step("meeting page renders summary, key decisions, transcript", async () => {
    await page.goto(`/meetings/${meetingId}`);

    await expect(
      page.getByRole("heading", { level: 1, name: MEETING_TITLE })
    ).toBeVisible();
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();

    // Summary overview (fixture council summary).
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(
      page.getByText(/held its regular session on Tuesday, June 2nd/)
    ).toBeVisible();

    // Key decisions section with fixture content.
    await expect(
      page.getByRole("heading", { name: "Key decisions" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Approved the minutes of the May 19th regular session unanimously."
      )
    ).toBeVisible();

    // Transcript: the list is virtualized, so assert the count indicator and
    // the first visible utterances rather than all 52 rows.
    await expect(
      page.getByText(`${FIXTURE_UTTERANCE_COUNT} utterances`, { exact: true })
    ).toBeVisible();
    await expect(transcript).toBeVisible();
    await expect(transcript.getByRole("listitem").first()).toContainText(
      "call this regular session of the Lawrence City Council to order"
    );
    await expect(
      transcript.getByRole("button", { name: /Edit name for speaker A/ }).first()
    ).toBeVisible();
  });

  await test.step("rename a speaker inline and apply to all", async () => {
    // First visible utterance belongs to fixture speaker A.
    await transcript
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: /Edit name for speaker A/ })
      .click();

    const nameInput = page.getByLabel(/New name for speaker A/);
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Mayor Reyes");
    await nameInput.press("Enter");

    // The renamed chip shows on the edited row.
    const renamedChips = transcript.getByRole("button", {
      name: /Edit name for speaker A \(currently Mayor Reyes\)/,
    });
    await expect(renamedChips.first()).toBeVisible();

    // Apply-to-all confirm bar appears; apply it.
    const applyBar = page.getByRole("region", {
      name: "Apply speaker name to all utterances",
    });
    await expect(applyBar).toBeVisible();
    await expect(applyBar).toContainText(
      /Apply [“"]Mayor Reyes[”"] to all utterances by Speaker A\?/
    );
    await applyBar.getByRole("button", { name: "Apply to all" }).click();
    await expect(applyBar).toBeHidden();

    // Another rendered row that was originally "Speaker A" now shows the
    // applied name too (speaker A has several rows in the rendered window).
    await expect(renamedChips.nth(1)).toBeVisible();
  });

  await test.step("transcript search filters and highlights", async () => {
    await page.getByLabel("Search this transcript").fill("zoning");

    // Exactly one fixture utterance mentions "zoning".
    await expect(
      page.getByText(`1 of ${FIXTURE_UTTERANCE_COUNT} utterances`)
    ).toBeVisible();
    const highlight = transcript.locator("mark", { hasText: /zoning/i });
    await expect(highlight.first()).toBeVisible();
    await expect(
      transcript.getByRole("listitem").first()
    ).toContainText("zoning variance application Z-2026-014");
  });

  await test.step("global search groups results and deep-links to the meeting", async () => {
    await page.goto("/search?q=zoning");

    await expect(page.getByText(/matching utterance/)).toBeVisible();

    // Result group headed by a link to the meeting.
    await expect(
      page.getByRole("link", { name: MEETING_TITLE })
    ).toBeVisible();

    // Snippet deep-link (with highlighted match) into the transcript.
    const snippetLink = page
      .locator(`a[href^="/meetings/${meetingId}#u-"]`)
      .first();
    await expect(snippetLink.locator("mark").first()).toBeVisible();
    await snippetLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/meetings/${meetingId}#u-`)
    );
    await expect(
      page.getByRole("heading", { level: 1, name: MEETING_TITLE })
    ).toBeVisible();
    await expect(
      page.getByText(`1 of ${FIXTURE_UTTERANCE_COUNT} utterances`).or(
        page.getByText(`${FIXTURE_UTTERANCE_COUNT} utterances`, { exact: true })
      )
    ).toBeVisible();
  });
});

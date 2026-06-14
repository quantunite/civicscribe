// Phase 3 cross-meeting synthesis: read the cache or (admin only) build it.
//
// THE #1 INVARIANT IS COST SAFETY. synthesizeTopic is an LLM call that spends
// real money, so it is reached ONLY inside the `if (opts.allowGenerate)` branch.
// A public / anonymous / non-admin caller passes allowGenerate:false and never
// triggers generation: it gets the cached synthesis if present, else a "not
// generated yet" status with no provider call.
//
// SECOND INVARIANT: published-only. The contributing meetings come from
// store.getTopicMeetings(slug), which is published-only by construction, so
// nothing unpublished can ever feed a synthesis.

import type { DataStore } from "@/lib/store/types";
import type { Providers } from "@/lib/providers/types";
import type { TopicMeeting } from "@/lib/types";
import { getConfig } from "@/lib/config";
import { topicMatchesSlug } from "@/lib/topics";

export type SynthesisStatus =
  | "too_few"
  | "fresh"
  | "generated"
  | "stale"
  | "absent";

export interface SynthesisResult {
  /** Published meetings on the topic, newest first (may be < 2). */
  meetings: TopicMeeting[];
  /** Display label for the topic (canonical raw spelling, else the slug). */
  topic: string;
  /** The synthesis markdown, or null when none is available to show. */
  content: string | null;
  status: SynthesisStatus;
  /** Present whenever a synthesis (fresh, generated, or stale) is returned. */
  generatedAt?: string;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The canonical display label for a slug: the first raw topic spelling across
 *  the (newest-first) meetings that re-slugifies to the slug, else the slug. */
function resolveLabel(meetings: TopicMeeting[], slug: string): string {
  for (const m of meetings) {
    for (const raw of m.topics) {
      if (topicMatchesSlug(raw, slug)) return raw;
    }
  }
  return slug;
}

export async function getOrBuildTopicSynthesis(
  store: DataStore,
  providers: Providers,
  slug: string,
  opts: { allowGenerate: boolean }
): Promise<SynthesisResult> {
  const meetings = await store.getTopicMeetings(slug);
  const topic = resolveLabel(meetings, slug);

  // Synthesis only adds value across multiple meetings.
  if (meetings.length < 2) {
    return { meetings, topic, content: null, status: "too_few" };
  }

  const currentIds = meetings.map((m) => m.meeting.id).sort();
  const cached = await store.getTopicSynthesis(slug);
  const fresh =
    cached !== null &&
    arraysEqual(cached.sourceMeetingIds.slice().sort(), currentIds);

  if (fresh) {
    return {
      meetings,
      topic,
      content: cached.content,
      status: "fresh",
      generatedAt: cached.generatedAt,
    };
  }

  if (opts.allowGenerate) {
    // getTopicMeetings omits key_decisions by design, so pull each meeting's
    // summary to supply the key points. N is small (a topic spans a handful of
    // meetings).
    const inputMeetings = await Promise.all(
      meetings.map(async (m) => {
        const summary = await store.getSummaryByMeeting(m.meeting.id);
        return {
          title: m.meeting.title,
          date: m.meeting.created_at,
          overview: m.overview,
          keyPoints: summary?.key_decisions ?? [],
        };
      })
    );

    const content = await providers.summary.synthesizeTopic({
      topic,
      meetings: inputMeetings,
    });
    const generatedAt = new Date().toISOString();
    await store.upsertTopicSynthesis({
      slug,
      topic,
      content,
      sourceMeetingIds: currentIds,
      meetingCount: meetings.length,
      model: getConfig().anthropicModel,
      generatedAt,
    });
    return { meetings, topic, content, status: "generated", generatedAt };
  }

  // Public path: NEVER generate. Serve stale cache content if present, else
  // signal "absent" so the page can show a friendly empty state.
  return {
    meetings,
    topic,
    content: cached?.content ?? null,
    status: cached ? "stale" : "absent",
    generatedAt: cached?.generatedAt,
  };
}

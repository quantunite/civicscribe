// Fixture: a second complete meeting — a Lawrence Planning Commission item
// hearing. Used by the seed script so the dashboard shows two distinct
// meetings out of the box. Four diarized speakers:
//   A = Chair Susan Vogel
//   B = Commissioner Dale Hartman
//   C = Staff planner Priya Nair
//   D = Applicant Jordan Wells AND a neighbor at the public podium
// Timeline is ~12 minutes with monotonically increasing start/end times.

import type { DiarizedUtterance } from "@/lib/providers/types";
import type { MeetingSummaryContent } from "@/lib/types";

function u(
  speaker_label: string,
  startSec: number,
  endSec: number,
  text: string
): DiarizedUtterance {
  return {
    speaker_label,
    start_ms: Math.round(startSec * 1000),
    end_ms: Math.round(endSec * 1000),
    text,
  };
}

export const FIXTURE_PLANNING_UTTERANCES: DiarizedUtterance[] = [
  u("A", 0, 16, "Good evening. I'll call this meeting of the Lawrence Planning Commission to order at 6:30 p.m. We have a quorum, and we have one public hearing item on tonight's agenda."),
  u("A", 18, 42, "That item is conditional use permit application CUP-2026-09, a request to operate a licensed child care center for up to forty children at 2100 Harper Street, in a single-family residential district. Ms. Nair will present the staff report."),
  u("C", 45, 160, "Thank you, Chair Vogel. The subject property is a former church annex on a corner lot at Harper and 21st Street, roughly half an acre, zoned RS-7. Child care centers are a conditional use in this district. The applicant proposes hours of seven a.m. to six p.m., Monday through Friday, with a licensed capacity of forty children and eight staff. The site has twelve existing off-street parking spaces and two curb cuts. Staff's traffic analysis estimates about sixty vehicle trips at each peak, which the corner location can absorb with a circulation plan. Staff recommends approval with four conditions: one, drop-off and pick-up shall follow the one-way circulation plan in the packet; two, the outdoor play area shall be enclosed by a six-foot fence before occupancy; three, hours of operation are limited to six a.m. through seven p.m.; and four, the permit shall be reviewed by this commission if a code complaint is sustained. Staff finds the use compatible with the neighborhood and recommends approval."),
  u("A", 163, 170, "Thank you, Ms. Nair. Questions for staff? Commissioner Hartman."),
  u("B", 172, 225, "Thanks, Chair. Ms. Nair, my main question is the morning drop-off. Harper Street narrows north of 21st, and sixty trips in an hour is a real number for that block. Does the one-way circulation plan keep queued cars on the site itself, or are we going to see them stacking on Harper? And second, were the twelve spaces evaluated against the staffing level, or just against the code minimum?"),
  u("C", 228, 290, "Both, Commissioner. The circulation plan routes vehicles in from 21st Street, through the drop-off loop, and out the Harper Street curb cut, and the loop itself stores eight vehicles, which exceeds the projected peak queue of five. On parking, the code minimum for this use is ten spaces; the twelve provided cover all eight staff plus four visitor spaces, so we're above both the code and the practical requirement. The applicant has also agreed to stagger classroom start times by fifteen minutes, which flattens the peak further."),
  u("A", 293, 300, "Other questions? Hearing none, we'll hear from the applicant. Please state your name for the record."),
  u("D", 303, 400, "Good evening, commissioners. Jordan Wells, applicant, 1532 New Hampshire Street. My wife and I have run a licensed in-home daycare in this neighborhood for nine years, and we have a waiting list of over fifty families, which tells you what the need looks like in Lawrence right now. The Harper Street building gives us room for forty children with classrooms that already meet state licensing standards from its time as a church preschool. We've committed to the one-way drop-off loop, the six-foot fence around the play yard, and staggered start times. We've also met with the neighborhood association twice, and the feedback shaped the plan, including moving the play area to the 21st Street side away from the closest homes. We'd be glad to answer questions."),
  u("B", 403, 432, "One for you, Mr. Wells. The play area on the 21st Street side, what's the buffering there beyond the fence? Forty kids at recess is a wonderful sound, but not everyone agrees at eight in the morning."),
  u("D", 435, 470, "Fair question. Beyond the six-foot solid cedar fence, the plan keeps the existing mature hedge along the property line and adds a row of evergreen screening trees inside it. Outdoor time also rotates in groups of no more than fifteen children at once, which is a licensing practice we already follow, so it's never all forty outside together."),
  u("A", 473, 490, "Thank you. This is a public hearing, so I'll open the floor. Anyone wishing to speak on CUP-2026-09, please come forward and state your name and address."),
  u("D", 494, 560, "Hello, my name is Ruth Castellanos, 2055 Harper Street, across the intersection from the site. Mostly I'm in favor. That building has sat empty for three years and an occupied building is safer for everybody. My one concern is parents parking on Harper during pick-up and blocking driveways, which already happens during events at the park. If the one-way loop really keeps the cars off the street, I'm satisfied. I'd just ask the commission to take the review condition seriously if it doesn't work out that way."),
  u("A", 563, 575, "Thank you, Ms. Castellanos. Anyone else wishing to speak? Seeing no one, I'll close the public hearing and bring the item back to the commission for discussion and a motion."),
  u("B", 578, 640, "Chair, I came in skeptical about the traffic and I'm satisfied. The on-site queue capacity covers the projected peak, the staggered start times help, and condition four gives the neighbors a real remedy: a sustained complaint brings the permit back in front of us. The town needs child care seats, and this is an appropriate corner-lot reuse of an institutional building. I move we approve CUP-2026-09 subject to the four conditions in the staff report."),
  u("A", 643, 648, "Is there a second? I'll second the motion myself."),
  u("A", 650, 668, "All those in favor of approving CUP-2026-09 with the four staff conditions, say aye. Opposed? The ayes have it, and the motion carries seven to zero. Congratulations, Mr. Wells."),
  u("A", 671, 680, "That concludes the public hearing items. Is there any other business before the commission tonight?"),
  u("B", 682, 685, "None from me, Chair. I move we adjourn."),
  u("A", 687, 698, "Without objection, we are adjourned at 6:42 p.m. Thank you all for coming."),
];

export const FIXTURE_PLANNING_SUMMARY: MeetingSummaryContent = {
  overview:
    "The Lawrence Planning Commission met to consider a single public hearing item: conditional use permit CUP-2026-09, a request by Jordan Wells to operate a licensed child care center for up to forty children in a vacant former church annex at 2100 Harper Street. Staff recommended approval with four conditions addressing drop-off circulation, play-area fencing, hours of operation, and complaint-triggered review. After questions focused on morning drop-off traffic and noise buffering, testimony from the applicant, and one largely supportive neighbor comment about street parking, the commission approved the permit 7-0 with all four staff conditions and adjourned at 6:42 p.m.",
  key_decisions: [
    "Approved conditional use permit CUP-2026-09 for a forty-child licensed child care center at 2100 Harper Street, 7-0.",
    "Attached all four staff conditions: mandatory one-way drop-off circulation, a six-foot play-area fence before occupancy, hours limited to 6 a.m.–7 p.m., and commission review if a code complaint is sustained.",
    "Accepted the applicant's commitment to staggered classroom start times to flatten the peak drop-off queue.",
  ],
  action_items: [
    "Applicant to install the six-foot play-area fence and evergreen screening before a certificate of occupancy is issued.",
    "Applicant to implement the one-way drop-off circulation plan routing vehicles in from 21st Street and out via Harper Street.",
    "Staff to bring the permit back before the commission for review if a code complaint regarding the operation is sustained.",
    "Applicant to maintain rotating outdoor play groups of no more than fifteen children at a time.",
  ],
  topics: [
    "Conditional use permit CUP-2026-09 — child care center at 2100 Harper Street",
    "Drop-off and pick-up traffic circulation on Harper Street",
    "Off-street parking adequacy",
    "Play-area noise buffering and screening",
    "Neighborhood reuse of a vacant institutional building",
  ],
  full_markdown: `# Lawrence Planning Commission — Public Hearing on CUP-2026-09

## Call to Order

Chair Vogel called the meeting to order at 6:30 p.m. with a quorum present. One public hearing item was on the agenda: conditional use permit CUP-2026-09 for a licensed child care center at 2100 Harper Street.

## Staff Report

Staff planner Priya Nair presented the application: a forty-child, eight-staff child care center in a former church annex on a half-acre corner lot zoned RS-7, operating weekdays from 7 a.m. to 6 p.m. Staff's traffic analysis projected roughly sixty peak-hour vehicle trips and recommended approval with four conditions covering a one-way drop-off circulation plan, a six-foot play-area fence before occupancy, an operating-hours limit of 6 a.m. to 7 p.m., and commission review upon any sustained code complaint.

## Commission Questions

Commissioner Hartman pressed on whether morning drop-off queues would stack on Harper Street and whether the twelve parking spaces covered actual staffing. Ms. Nair responded that the on-site loop stores eight vehicles against a projected peak queue of five, that the twelve spaces exceed both the ten-space code minimum and the practical need, and that the applicant agreed to stagger classroom start times.

## Applicant Presentation and Public Hearing

Applicant Jordan Wells, a nine-year in-home daycare operator with a fifty-family waiting list, described the building's suitability and the changes made after two neighborhood association meetings, including relocating the play area away from the nearest homes. Pressed on noise, he committed to the solid cedar fence, retained hedge, added evergreen screening, and rotating outdoor groups of no more than fifteen children. Neighbor Ruth Castellanos spoke mostly in favor, noting the building had been vacant for three years, but asked the commission to enforce the review condition if pick-up parking spills onto Harper Street.

## Decision and Adjournment

Commissioner Hartman, satisfied on traffic, moved approval with the four staff conditions; Chair Vogel seconded. The motion carried 7-0. With no other business, the commission adjourned at 6:42 p.m.`,
};

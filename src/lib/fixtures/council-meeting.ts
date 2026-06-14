// Fixture: a realistic fake Lawrence City Council regular session.
// Four diarized speakers, consistent with what AssemblyAI returns:
//   A = Mayor Deborah Whitfield (presiding)
//   B = Councilor Marcus Ramos
//   C = Councilor Alice Chen
//   D = City Clerk Brenda Boyd AND members of the public at the podium
//       (a shared clerk/podium microphone, so diarization groups them — a
//       realistic artifact of single-mic council chambers).
// Timeline is ~31 minutes with monotonically increasing start/end times.

import type { DiarizedUtterance } from "@/lib/providers/types";
import type { MeetingSummaryContent } from "@/lib/types";

/** Pacing factor applied to the second-based timings below. Council speech is
 *  deliberate and diarized utterances include leading/trailing silence, so the
 *  stretch keeps the whole session at a plausible ~26 minutes. */
const PACE = 1.25;

/** Build one utterance from second-based timings (kept in seconds here for
 *  readability; the contract is milliseconds). */
function u(
  speaker_label: string,
  startSec: number,
  endSec: number,
  text: string
): DiarizedUtterance {
  return {
    speaker_label,
    start_ms: Math.round(startSec * PACE * 1000),
    end_ms: Math.round(endSec * PACE * 1000),
    text,
  };
}

export const FIXTURE_COUNCIL_UTTERANCES: DiarizedUtterance[] = [
  // -- Call to order & roll call ------------------------------------------
  u("A", 0, 18, "Good evening, everyone. I'd like to call this regular session of the Lawrence City Council to order. It is Tuesday, June 2nd, and the time is 6:32 p.m. Welcome to those of you here in the chamber and everyone watching on the city stream."),
  u("A", 19, 24, "Madam Clerk, will you please call the roll."),
  u("D", 26, 31, "Thank you, Mayor Whitfield. Councilor Ramos?"),
  u("B", 32, 33, "Present."),
  u("D", 34, 36, "Councilor Chen?"),
  u("C", 37, 38, "Here."),
  u("D", 39, 41, "Mayor Whitfield?"),
  u("A", 42, 43, "Present."),
  u("D", 44, 52, "Mayor, you have three members present and voting. You have a quorum."),

  // -- Approval of minutes --------------------------------------------------
  u("A", 55, 70, "Thank you. Our first item is approval of the minutes from the May 19th regular session, which were distributed in the packet. Are there any corrections? Hearing none, do I have a motion to approve?"),
  u("B", 71, 73, "So moved, Mayor."),
  u("C", 74, 75, "Second."),
  u("A", 77, 90, "Moved by Councilor Ramos, seconded by Councilor Chen. All in favor, say aye. Any opposed? The minutes of May 19th are approved unanimously."),

  // -- Item 4A: zoning variance Z-2026-014 ----------------------------------
  u("A", 95, 135, "We now move to old business, item 4A, zoning variance application Z-2026-014 for the property at 847 Vermont Street. The applicant requests a reduction of the required rear setback from twenty-five feet to fifteen feet in order to construct a detached accessory dwelling unit above a new garage. The Planning Commission heard this case on May 27th and recommended approval by a vote of six to one, subject to five staff conditions. Madam Clerk, has proper notice been given?"),
  u("D", 137, 158, "Yes, Mayor. Notice was published in the Journal-World on May 15th, and notices were mailed to all property owners within four hundred feet of the subject property. The clerk's office received two written comments prior to tonight's meeting, both in support of the application."),
  u("A", 160, 172, "Thank you. The written comments are entered into the record. Councilors, I'll open discussion on the variance. Councilor Ramos."),
  u("B", 175, 250, "Thank you, Mayor. I walked the site on Saturday. The lot is deeper than most on that block, it backs onto the alley, and the proposed unit is a single story over the garage, so I don't see a privacy issue for the neighbors. The one thing I want on the record is drainage. That alley already ponds after a hard rain, and we'd be adding roof area. I see staff condition two requires a grading and drainage plan before a building permit issues, and I want to make sure engineering actually reviews it rather than rubber-stamping it. With that understanding, I can support this."),
  u("C", 253, 320, "I'll echo most of that, Mayor. When we adopted the accessory dwelling unit ordinance last year, this is exactly the kind of infill project we said we wanted: modest, alley-loaded, adding a rental unit in a neighborhood where people actually want to live. The hardship finding is straightforward because of the lot's unusual depth-to-width ratio. The staff conditions cover drainage, the off-street parking space, and owner occupancy of one of the units, so the guardrails we debated last year are all attached here. I'm prepared to support it."),
  u("A", 323, 342, "Thank you both. Item 4A is a public hearing, so I will now open the floor. Anyone wishing to speak on the variance, please come to the podium and state your name and address for the record. You'll have three minutes."),
  u("D", 346, 425, "Good evening, council. My name is Harold Finch, 851 Vermont Street, directly next door to the applicant. I want to say I support this. The Delgados take better care of that property than anyone on the block, and they showed me the plans over the fence months ago. Frankly we need more places for people to live in this town that aren't big apartment blocks out on the edge. My only ask is the same one Councilor Ramos raised: please make the drainage plan real, because my basement takes on water when that alley backs up. Thank you."),
  u("D", 430, 500, "Hello, my name is Marcy Delgado, 1208 East 9th Street. I'm not against the project itself, but I want the council to think about parking. That block already fills up on game days, and a second household means at least one more car. I read that the conditions require one off-street space, and I'd just ask that the space actually be built before anyone moves in, not promised for later. That's all. Thank you for your time."),
  u("A", 503, 520, "Thank you both for coming out tonight. Is there anyone else wishing to speak on item 4A? Seeing no one, I will close the public hearing and bring the matter back to the council."),
  u("B", 523, 560, "Mayor, briefly, to Ms. Delgado's point: condition three requires the off-street parking space to be completed and inspected before a certificate of occupancy is issued for the accessory unit, so that timing concern is already addressed. Nobody can legally move in until the space exists. I'm satisfied with the conditions as written."),
  u("C", 563, 580, "Then, Mayor, I move that we approve variance application Z-2026-014 for 847 Vermont Street, subject to the five staff conditions, as recommended by the Planning Commission."),
  u("B", 581, 582, "Second."),
  u("A", 584, 596, "We have a motion by Councilor Chen, seconded by Councilor Ramos. Variances require a roll-call vote. Madam Clerk, please call the roll."),
  u("D", 598, 600, "Councilor Ramos?"),
  u("B", 601, 602, "Aye."),
  u("D", 603, 605, "Councilor Chen?"),
  u("C", 606, 607, "Aye."),
  u("D", 608, 610, "Mayor Whitfield?"),
  u("A", 611, 612, "Aye."),
  u("D", 613, 620, "Mayor, that is three ayes and zero nays. The motion carries."),
  u("A", 622, 640, "The variance is approved with conditions. Good luck to the applicant, and thank you to the neighbors for engaging with the process. We'll move on to new business."),

  // -- Item 5A: budget amendment 2026-07 ------------------------------------
  u("A", 645, 700, "Item 5A is budget amendment 2026-07, a request from the City Manager to transfer one hundred eighty-five thousand dollars from the general fund contingency reserve to the Public Works sidewalk repair program, account 101-3300-440. The manager's memo in the packet notes that this spring's freeze-thaw cycle roughly doubled the number of panels flagged as trip hazards. Discussion?"),
  u("B", 703, 780, "Thank you, Mayor. I want to support this, and I will, but I want us to be honest about what it buys. Public Works tells me we have a backlog of a little over four hundred flagged sidewalk panels, and this transfer funds roughly half of them, prioritized by the hazard scoring in our ADA transition plan, which is the right order to do them in. What I'm asking for tonight is accountability: I'd like quarterly progress reports to this council showing panels repaired, dollars spent, and the remaining backlog, so this doesn't become a one-time patch we forget about by fall."),
  u("C", 783, 845, "I share Councilor Ramos's support and his caution, Mayor, but mine points the other direction. This transfer takes the contingency reserve down to about four point two percent of general fund expenditures. Our financial policy floor is three percent, so we're within policy, but it's only June and storm season isn't over. I just want it on the record that if another draw on contingency comes to us this summer, we should be looking at the unassigned fund balance first rather than going below the floor. With that said, the sidewalks are a genuine safety and accessibility issue and I'll vote yes."),
  u("A", 848, 855, "Understood, and well noted. Is there a motion on item 5A?"),
  u("B", 857, 868, "Mayor, I move approval of budget amendment 2026-07 as presented, with the addition that Public Works provide quarterly progress reports to the council."),
  u("C", 869, 870, "Second."),
  u("A", 872, 888, "Motion by Councilor Ramos, second by Councilor Chen. All in favor, say aye. Opposed? The amendment passes three to zero, with the reporting requirement attached."),

  // -- General public comment ------------------------------------------------
  u("A", 892, 915, "We now come to the general public comment period. Speakers may address any item not on tonight's agenda. Please state your name and address, and you'll have three minutes. The council generally won't respond tonight, but staff will follow up. Who would like to begin?"),
  u("D", 920, 1040, "Good evening. Tom Okafor, 1420 Rhode Island Street. I'm here about the crosswalk at 19th and Learnard, the one the kids use to get to Cordley Elementary. Drivers come off the hill and they are simply not stopping. Last Tuesday a crossing guard had to pull a second grader back off the pavement, and I watched it happen. I've submitted the request form twice through the website asking for a rapid flashing beacon like the ones installed on Harvard Road, and both times I got an automated reply and nothing since. I'm asking the council to direct staff to actually evaluate that crossing before school starts again in August. These beacons cost a fraction of what we just approved for sidewalks, and the data from Harvard Road shows compliance went way up. Thank you."),
  u("A", 1043, 1075, "Thank you, Mr. Okafor. Under our rules we can't act tonight on an item that isn't on the agenda, but I am going to ask the City Manager's office to refer that crossing to the Traffic Safety Commission for evaluation at their July meeting, and staff will follow up with you directly with a real answer this time. Next speaker, please."),
  u("D", 1080, 1175, "Hi, Linda Pham, president of the Brook Creek Neighborhood Association, 2014 Barker Avenue. Two quick things. First, a thank you: Parks staff replanted the rain garden at Brook Creek Park after the April flooding, and they did a beautiful job, so please pass that along. Second, a question we keep getting from residents: the fall leaf collection schedule used to be published in August, and last year it slipped to October, which left people guessing. If the schedule could come out earlier this year, with the map by zone like the city used to do, the association will happily distribute it in our newsletter. Thank you."),
  u("A", 1178, 1195, "Thank you, Ms. Pham, both for the kind words for Parks and the practical request. We'll get the compliment to the crews, and I'll ask Public Works to commit to an August publication date for the leaf collection schedule. Is there anyone else for public comment?"),

  // -- Clerk's wrap-up & adjournment -----------------------------------------
  u("A", 1198, 1208, "Seeing no one further, we'll close the public comment period. Madam Clerk, is there anything further on tonight's agenda?"),
  u("D", 1210, 1222, "Nothing further, Mayor. For the record, your next regular session is Tuesday, June 16th at 6:30 p.m. here in the council chamber."),
  u("A", 1225, 1232, "Thank you. Then I will entertain a motion to adjourn."),
  u("C", 1234, 1235, "So moved."),
  u("B", 1236, 1237, "Second."),
  u("A", 1239, 1252, "All in favor, say aye. We are adjourned at 6:58 p.m. Thank you, everyone, and good night."),
];

export const FIXTURE_COUNCIL_SUMMARY: MeetingSummaryContent = {
  overview:
    "The Lawrence City Council held its regular session on Tuesday, June 2nd with Mayor Whitfield and Councilors Ramos and Chen present, constituting a quorum. After approving the May 19th minutes, the council held a public hearing and unanimously approved zoning variance Z-2026-014, reducing the rear setback at 847 Vermont Street from twenty-five to fifteen feet for an accessory dwelling unit, subject to five staff conditions covering drainage, off-street parking, and owner occupancy. The council then approved budget amendment 2026-07, transferring $185,000 from the contingency reserve to the Public Works sidewalk repair program, adding a quarterly reporting requirement. During public comment, residents raised pedestrian safety at the 19th and Learnard crossing near Cordley Elementary and asked for earlier publication of the fall leaf collection schedule. The meeting adjourned at 6:58 p.m.",
  key_decisions: [
    "Approved the minutes of the May 19th regular session unanimously.",
    "Approved zoning variance Z-2026-014 (847 Vermont Street) reducing the rear setback from 25 to 15 feet for an accessory dwelling unit, subject to five staff conditions, by a 3-0 roll-call vote.",
    "Approved budget amendment 2026-07 transferring $185,000 from the general fund contingency reserve to the Public Works sidewalk repair program (account 101-3300-440), 3-0.",
    "Attached a requirement that Public Works deliver quarterly sidewalk repair progress reports to the council as part of the budget amendment.",
  ],
  action_items: [
    "Public Works to provide quarterly reports on sidewalk panels repaired, dollars spent, and remaining backlog.",
    "City Manager's office to refer the 19th and Learnard crossing near Cordley Elementary to the Traffic Safety Commission for evaluation at its July meeting and follow up directly with resident Tom Okafor.",
    "City engineering to substantively review the grading and drainage plan required by condition two before a building permit issues for 847 Vermont Street.",
    "Public Works to publish the fall leaf collection schedule, with the zone map, by August, for distribution through the Brook Creek Neighborhood Association newsletter.",
    "Mayor's office to pass along the Brook Creek Park rain garden compliment to Parks crews.",
  ],
  topics: [
    "Zoning variance Z-2026-014: accessory dwelling unit at 847 Vermont Street",
    "Alley drainage and stormwater concerns",
    "Budget amendment 2026-07: sidewalk repair funding and ADA backlog",
    "Contingency reserve policy and fund balance",
    "Pedestrian safety at 19th and Learnard near Cordley Elementary",
    "Parks maintenance and fall leaf collection scheduling",
  ],
  full_markdown: `# Lawrence City Council, Regular Session, June 2

## Call to Order and Roll Call

Mayor Whitfield called the regular session to order at 6:32 p.m. City Clerk Boyd called the roll: Councilor Ramos, Councilor Chen, and Mayor Whitfield were present, establishing a quorum. The minutes of the May 19th session were approved unanimously on a motion by Ramos, seconded by Chen.

## Zoning Variance Z-2026-014: 847 Vermont Street

The council took up a request to reduce the rear setback from twenty-five feet to fifteen feet to allow a detached accessory dwelling unit above a new garage. The Planning Commission had recommended approval 6-1 with five staff conditions, and the clerk confirmed proper notice and two written comments in support.

Councilor Ramos supported the project but pressed for substantive engineering review of the required grading and drainage plan, citing existing ponding in the alley. Councilor Chen framed the application as exactly the kind of infill the city's ADU ordinance was designed to enable, noting the conditions already cover drainage, parking, and owner occupancy. In the public hearing, neighbor Harold Finch spoke in support while echoing the drainage concern, and Marcy Delgado asked that the required off-street parking space be built before occupancy, which, Ramos noted, condition three already guarantees by tying it to the certificate of occupancy.

The council approved the variance with all five conditions on a 3-0 roll-call vote.

## Budget Amendment 2026-07: Sidewalk Repairs

The council considered transferring $185,000 from the contingency reserve to the Public Works sidewalk repair program after spring freeze-thaw damage roughly doubled flagged trip hazards. Ramos noted the transfer funds about half of the 400-panel backlog, prioritized by ADA hazard scoring, and asked for quarterly progress reports. Chen cautioned that the transfer brings the contingency reserve to roughly 4.2 percent of expenditures, within the 3 percent policy floor, but worth watching before storm season ends. The amendment passed 3-0 with the reporting requirement attached.

## Public Comment

Tom Okafor described near-misses at the 19th and Learnard crossing used by Cordley Elementary students and asked for a rapid flashing beacon; the Mayor directed staff to refer the crossing to the Traffic Safety Commission in July and to follow up with him directly. Linda Pham of the Brook Creek Neighborhood Association thanked Parks staff for replanting the Brook Creek rain garden and asked that the fall leaf collection schedule be published in August with the zone map.

## Adjournment

With no further business, the meeting adjourned at 6:58 p.m. The next regular session is June 16th at 6:30 p.m.`,
};

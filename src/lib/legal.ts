// Legal-text versioning. Single source of truth for which version of the Terms
// of Service + Privacy Policy is currently in force.
//
// This string is recorded with every meeting submission's clickwrap agreement
// (see the terms_version column, migration 0015) so there is a durable record of
// exactly which version of the legal text the submitter accepted. Bump it -- and
// the "Last updated" date shown on /terms and /privacy -- together whenever the
// legal text materially changes, so old records still point at the version the
// submitter actually agreed to.
//
// Kept in ISO (YYYY-MM-DD) form for a stable, sortable, machine-friendly value;
// it corresponds to the human-readable "Last updated" date on the legal pages
// (currently "June 18, 2026").
export const TERMS_VERSION = "2026-06-18";

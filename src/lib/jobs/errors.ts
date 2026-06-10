// Control-flow errors for the job pipeline.
//
// JobNotReadyError is NOT a failure: a stage throws it when the external work
// it depends on (e.g. a Recall bot still recording a live Zoom meeting) simply
// isn't finished yet. The runner catches it before the generic failure path
// and requeues the job — attempts, last_error, and the meeting's error state
// are all left untouched, so the job is simply re-checked on a later tick.

export class JobNotReadyError extends Error {
  /** Human-readable reason the job can't make progress yet. */
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "JobNotReadyError";
    this.reason = reason;
  }
}

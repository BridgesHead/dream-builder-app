import { runDeletion } from "./deletionJob.js";
import { DELETION_JOB_PREFIX, type Attempt } from "./queue.js";
import { runJob } from "./runJob.js";

// What the worker does with each entry on the queue:
//   "deletion-<id>"   a data deletion (BE-16)       → jobs/deletionJob.ts
//   anything else     a story job (BE-07 … BE-12)   → jobs/runJob.ts
export async function processJob(jobId: string, attempt: Attempt): Promise<void> {
  if (jobId.startsWith(DELETION_JOB_PREFIX)) return runDeletion(jobId.slice(DELETION_JOB_PREFIX.length), attempt);
  return runJob(jobId, attempt);
}

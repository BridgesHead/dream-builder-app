import { runBookPdf } from "./bookPdf.js";
import { runDeletion } from "./deletionJob.js";
import { BOOK_PDF_JOB_PREFIX, DELETION_JOB_PREFIX, type Attempt } from "./queue.js";
import { runJob } from "./runJob.js";

// What the worker does with each entry on the queue:
//   "deletion-<id>"   a data deletion (BE-16)       → jobs/deletionJob.ts
//   "bookpdf-<id>"    a book PDF (BE-18)            → jobs/bookPdf.ts
//   anything else     a story job (BE-07 … BE-12)   → jobs/runJob.ts
export async function processJob(jobId: string, attempt: Attempt): Promise<void> {
  if (jobId.startsWith(DELETION_JOB_PREFIX)) return runDeletion(jobId.slice(DELETION_JOB_PREFIX.length), attempt);
  if (jobId.startsWith(BOOK_PDF_JOB_PREFIX)) return runBookPdf(jobId.slice(BOOK_PDF_JOB_PREFIX.length), attempt);
  return runJob(jobId, attempt);
}

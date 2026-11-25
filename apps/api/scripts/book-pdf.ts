// Makes (or remakes) the book PDF for one PAID order (guide BE-18), right here, without the
// queue. For admin: a PDF that failed, an order paid before BE-18 existed, or a story whose
// pictures were fixed.
//
//   pnpm book-pdf <order id>              the order id, e.g. 6b06c7426f55adaa68102fc5
//   pnpm book-pdf DB-431591               or its order number
//   pnpm book-pdf <order> --save out.pdf  also saves a copy of the parent's PDF on this PC
//
// Works on the database and storage named in .env (MONGODB_URI, S3_BUCKET or STORAGE_DIR),
// so check .env before running it.
import { writeFile } from "node:fs/promises";
import { isValidObjectId } from "mongoose";
import { parseArgs } from "node:util";
import { config } from "../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../src/db/connect.js";
import { Order } from "../src/db/models/index.js";
import { runBookPdf } from "../src/jobs/bookPdf.js";
import { getStorage } from "../src/lib/storage.js";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { save: { type: "string" } } });
const which = positionals[0];
if (!which) {
  console.error("Which order? See the examples at the top of scripts/book-pdf.ts.");
  process.exit(1);
}

await connectToDatabase(config.mongodbUri);
let exitCode = 0;
try {
  const order = await Order.findOne(isValidObjectId(which) ? { _id: which } : { orderNumber: which });
  if (!order) throw new Error(`No order "${which}"`);
  if (order.paymentStatus !== "paid") throw new Error(`Order ${order.orderNumber} isn't paid (${order.paymentStatus}), so it gets no PDF`);

  const orderId = String(order._id);
  await Order.updateOne({ _id: order._id }, { $set: { pdfStatus: "queued", pdfError: null } });
  console.log(`Making the PDF for ${order.orderNumber} (${order.tier})…`);
  await runBookPdf(orderId, { attempt: 1, isLastAttempt: true });

  const done = (await Order.findById(orderId).lean())!;
  console.log(`Done: ${done.pageCount} pages, saved as ${done.pdfKey}`);
  if (done.printFileKey) console.log(`Printer's file (${done.printProfile}): ${done.printFileKey}`);
  for (const w of done.pdfWarnings) console.log(`  warning: ${w}`);
  if (values.save && done.pdfKey) {
    await writeFile(values.save, await getStorage().read(done.pdfKey));
    console.log(`Copy saved to ${values.save}`);
  }
} catch (err) {
  console.error(`Not made: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  await disconnectFromDatabase();
}
process.exit(exitCode);

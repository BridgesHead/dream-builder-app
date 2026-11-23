// Staff accounts and facilitator links (guide BE-05). The ONLY way to make an admin.
//
//   pnpm users create   --role admin --email ali@example.com --name "Ali Khan"
//   pnpm users create   --role facilitator --email teacher@example.com --name "Ms Noor"
//   pnpm users set-role --email someone@example.com --role facilitator
//   pnpm users link     --facilitator teacher@example.com --child <child id>
//   pnpm users unlink   --facilitator teacher@example.com --child <child id>
//
// A new account gets a "set your password" email (on your PC it is printed in this terminal).
// Works on the database named in MONGODB_URI, so check .env before running it.
import { parseArgs } from "node:util";
import { config } from "../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../src/db/connect.js";
import { createStaffUser, linkFacilitator, setRole, unlinkFacilitator } from "../src/services/userAdmin.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    role: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    facilitator: { type: "string" },
    child: { type: "string" },
  },
});

function need(name: keyof typeof values): string {
  const value = values[name];
  if (!value) {
    console.error(`Missing --${name}. See the examples at the top of scripts/users.ts.`);
    process.exit(1);
  }
  return value;
}

const command = positionals[0];
await connectToDatabase(config.mongodbUri);
try {
  switch (command) {
    case "create":
      console.log(await createStaffUser({ role: need("role"), email: need("email"), name: need("name") }));
      break;
    case "set-role":
      console.log(await setRole(need("email"), need("role")));
      break;
    case "link":
      console.log(await linkFacilitator(need("facilitator"), need("child")));
      break;
    case "unlink":
      console.log(await unlinkFacilitator(need("facilitator"), need("child")));
      break;
    default:
      console.error("Use one of: create, set-role, link, unlink. See the top of scripts/users.ts.");
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`Failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await disconnectFromDatabase();
}

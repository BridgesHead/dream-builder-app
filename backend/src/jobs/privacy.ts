import type { FamilyDetails } from "../ai/anonymise.js";
import { Child, Order, User } from "../db/models/index.js";

// The family's details for the anonymising gate (guide BE-14): everything we hold that could
// identify the child, so the gate can keep it OUT of every AI request. Read fresh for each job
// (a parent may rename the child, or add a delivery address, at any time).
//
//   the child's name           children.name
//   the parent's name, email   users.name, users.email
//   the author name            stories.authorName
//   phones, address lines      orders.deliveryAddress (BE-17)
//
// These details stay on our server: they're only used to find and remove the same words.

export async function familyDetailsFor(story: { _id: unknown; childId: unknown; authorName?: string | null }): Promise<FamilyDetails> {
  const child = await Child.findById(story.childId, { name: 1, parentId: 1 }).lean();
  const parent = child ? await User.findById(child.parentId, { name: 1, email: 1 }).lean() : null;
  const orders = child ? await Order.find({ parentId: child.parentId, deliveryAddress: { $ne: null } }, { deliveryAddress: 1 }).lean() : [];
  const addresses = orders.map((o) => o.deliveryAddress).filter((a): a is NonNullable<typeof a> => !!a);

  return {
    childNames: child ? [child.name] : [],
    grownUpNames: [parent?.name, ...addresses.map((a) => a.fullName)].filter((n): n is string => !!n?.trim()),
    authorNames: story.authorName?.trim() ? [story.authorName] : [],
    emails: parent?.email ? [parent.email] : [],
    phones: addresses.map((a) => a.phone).filter(Boolean),
    addressLines: addresses.flatMap((a) => [a.line1, a.line2 ?? ""]).filter((l) => l.trim().length >= 4),
  };
}

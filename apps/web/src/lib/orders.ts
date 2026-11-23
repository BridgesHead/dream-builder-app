// Orders and payment (backend BE-17). Parents only. The price always comes from the server:
// the browser only says WHICH book, and Stripe's own page takes the card (never our page).
import type * as Api from "@dream-builder/api-types";
import { api } from "./api";
import type { PlanId } from "@/data/content";

/** An order as the server describes it (from the API contract, openapi.yaml). Amounts in AED. */
export type ServerOrder = Api.Order;

export type PaymentStatus = ServerOrder["paymentStatus"];

/** The checkout form's address. Kept here (not from the contract) because the form holds the
 * emirate as plain text while typing; the server checks it against the Emirate list. */
export interface DeliveryAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  emirate: string;
  postalCode?: string;
}

export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] as const satisfies readonly Api.Emirate[];

export type Prices = Api.Prices;

export async function getPrices(): Promise<Prices> {
  return api<Prices>("/orders/prices");
}

/** Makes (or reuses) the order and returns Stripe's payment page to go to. */
export async function startCheckout(input: {
  storyId: string;
  tier: PlanId;
  deliveryAddress?: DeliveryAddress;
}): Promise<{ order: ServerOrder; checkoutUrl: string }> {
  return api("/orders", { method: "POST", body: input });
}

export async function getOrder(id: string): Promise<ServerOrder> {
  return (await api<{ order: ServerOrder }>(`/orders/${encodeURIComponent(id)}`)).order;
}

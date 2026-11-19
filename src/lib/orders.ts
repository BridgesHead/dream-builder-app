// Orders and payment (backend BE-17). Parents only. The price always comes from the server:
// the browser only says WHICH book, and Stripe's own page takes the card (never our page).
import { api } from "./api";
import type { PlanId } from "@/data/content";

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled";

export interface ServerOrder {
  id: string;
  orderNumber: string;
  storyId: string;
  tier: PlanId;
  /** In AED. */
  amount: number;
  currency: "AED";
  paymentStatus: PaymentStatus;
  printStatus: string;
  paidAt: string | null;
  createdAt: string;
}

export interface DeliveryAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  emirate: string;
  postalCode?: string;
}

export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] as const;

export interface Prices {
  currency: "AED";
  tiers: { tier: PlanId; name: string; price: number; delivery: number; total: number }[];
}

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

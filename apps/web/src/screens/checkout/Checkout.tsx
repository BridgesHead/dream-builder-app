import { useEffect, useState } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { AlertCircle, Check, CreditCard, Download, Eye, Loader2, ShieldCheck, Truck } from "lucide-react";
import { AppShell } from "@/components/Layout";
import { Arrow, Button, Card, Field, Heading, LinkButton, Subtle } from "@/components/ui";
import { CURRENCY, PLANS, type PlanId } from "@/data/content";
import { inPreviewMode, useAppState } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import { EMIRATES, getDownloadLink, getOrder, getPrices, startCheckout, type DeliveryAddress, type Prices, type ServerOrder } from "@/lib/orders";
import { cx, possessive } from "@/lib/text";
import { ROUTES } from "@/lib/routes";

// Checkout (FE-11, backend BE-17):
//   Plans    the two book types, with the SERVER's AED prices
//   Pay      a hardback's delivery address → our server makes the order → Stripe's own page
//            (card, Apple Pay, Google Pay, 3-D Secure). Card details are never typed here.
//   Success  Stripe sends the parent back here; we ask the server until the webhook says "paid"
// Preview mode (demo data, no login) keeps the old pretend checkout.

const price = (n: number) => `${CURRENCY} ${n.toLocaleString()}`;
const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/** The server's prices (or the preview prices while loading / in preview mode). */
function usePrices(): (id: PlanId) => { price: number; delivery: number; total: number } {
  const [prices, setPrices] = useState<Prices | null>(null);
  useEffect(() => {
    if (inPreviewMode()) return;
    getPrices()
      .then(setPrices)
      .catch(() => undefined); // the preview prices stay; the server still decides the charge
  }, []);
  return (id) => {
    const server = prices?.tiers.find((t) => t.tier === id);
    if (server) return { price: server.price, delivery: server.delivery, total: server.total };
    const plan = PLANS.find((p) => p.id === id)!;
    return { price: plan.price, delivery: 0, total: plan.price };
  };
}

export function PlansScreen() {
  const [, navigate] = useLocation();
  const priceOf = usePrices();
  const choose = (id: PlanId) => {
    navigate(`${ROUTES.pay}?plan=${id}`);
  };

  return (
    <AppShell>
      <div className="text-center">
        <Heading>Bring This Story to Life</Heading>
        <Subtle className="mt-1">Choose how you'd like to keep your child's story.</Subtle>
      </div>
      <div className="mx-auto mt-12 grid w-full max-w-[760px] items-center gap-5 md:grid-cols-2 lg:gap-7">
        {PLANS.map((p) => (
          <Card key={p.id} className={cx("flex h-full min-h-[440px] flex-col p-6 sm:p-7", p.popular && "border-2 border-brand-ring md:-my-6 md:min-h-[520px]")}>
            {p.popular && (
              <span className="mx-auto mb-3 rounded-full bg-brand px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
                Most Popular
              </span>
            )}
            <p className="text-sm font-bold text-ink">{p.title}</p>
            <p className="mt-2 font-display text-4xl font-bold text-ink">{price(priceOf(p.id).price)}</p>
            <ul className="mt-5 flex-1 space-y-3">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-ink-muted">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {f}
                </li>
              ))}
            </ul>
            <Button variant={p.popular ? "primary" : "outline"} className="mt-6 w-full" onClick={() => choose(p.id)}>
              {p.cta} <Arrow />
            </Button>
          </Card>
        ))}
      </div>
      <div className="mt-12 flex flex-col items-center gap-2">
        <LinkButton href={ROUTES.dashboard} variant="ghost" className="h-9 bg-white px-4 shadow-sm">
          Not Now
        </LinkButton>
        <Subtle className="text-xs">Your child's story stays saved, even if you decide to purchase later.</Subtle>
      </div>
    </AppShell>
  );
}

const EMPTY_ADDRESS: DeliveryAddress = { fullName: "", phone: "", line1: "", line2: "", city: "", emirate: "Dubai", postalCode: "" };

export function PayScreen() {
  const search = new URLSearchParams(useSearch());
  const { heroName, updateParent, storyId } = useAppState();
  const planId = search.get("plan") as PlanId | null;
  const cancelled = search.get("cancelled") === "1";
  const plan = PLANS.find((p) => p.id === planId);
  const priceOf = usePrices();
  const [, navigate] = useLocation();
  const [address, setAddress] = useState<DeliveryAddress>(EMPTY_ADDRESS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiError | null>(null);
  const demo = inPreviewMode() || !storyId;

  if (!plan) return <Redirect to={ROUTES.plans} />;
  const physical = plan.id === "hardback";
  const cost = priceOf(plan.id);
  const set = (key: keyof DeliveryAddress) => (e: { target: { value: string } }) => setAddress((a) => ({ ...a, [key]: e.target.value }));
  const fieldError = (key: string) => problem?.fields[`deliveryAddress.${key}`]?.[0] ?? problem?.fields[key]?.[0];

  const pay = async () => {
    if (busy) return;
    if (demo) {
      updateParent({ order: { plan: plan.id, orderNumber: `DB-${Math.floor(100000 + Math.random() * 899999)}`, amount: cost.total } });
      navigate(ROUTES.success);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const trimmed = Object.fromEntries(Object.entries(address).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) as unknown as DeliveryAddress;
      const { order, checkoutUrl } = await startCheckout({ storyId: storyId!, tier: plan.id, ...(physical && { deliveryAddress: trimmed }) });
      // Remembered for the success screen; it only counts once the server says "paid".
      updateParent({ order: { id: order.id, plan: order.tier, orderNumber: order.orderNumber, amount: order.amountPaid ?? order.amount, promoCode: order.promoCode, paymentStatus: order.paymentStatus } });
      // Off to Stripe's own payment page.
      window.location.assign(checkoutUrl);
    } catch (err) {
      setProblem(err instanceof ApiError ? err : new ApiError(messageOf(err), 0));
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="text-center">
        <Heading>Complete Your Order</Heading>
        <Subtle className="mt-1">You're one step away from bringing your child's story to life.</Subtle>
      </div>
      {cancelled && (
        <p role="status" className="mx-auto mt-6 flex max-w-[1000px] items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> Payment not completed, and you haven't been charged. You can try again whenever you're ready.
        </p>
      )}
      <div className="mx-auto mt-8 grid w-full max-w-[1000px] items-start gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-bold text-ink">How You'll Pay</h2>
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <CreditCard className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              Card, Apple Pay or Google Pay, on Stripe's secure payment page. Your card details never reach Dream Builder.
            </p>
          </Card>

          {physical && (
            <Card>
              <h2 className="mb-4 font-bold text-ink">Delivery Address</h2>
              <Field id="fullName" label="Full Name" autoComplete="name" value={address.fullName} onChange={set("fullName")} />
              {fieldError("fullName") && <FieldNote text={fieldError("fullName")!} />}
              <Field id="phone" label="Phone Number" placeholder="+971 50 123 4567" inputMode="tel" autoComplete="tel" value={address.phone} onChange={set("phone")} />
              {fieldError("phone") && <FieldNote text={fieldError("phone")!} />}
              <Field id="addr1" label="Address Line 1" placeholder="Villa, building, street" autoComplete="address-line1" value={address.line1} onChange={set("line1")} />
              {fieldError("line1") && <FieldNote text={fieldError("line1")!} />}
              <Field id="addr2" label="Address Line 2 (Optional)" placeholder="Apartment, suite, unit, etc." autoComplete="address-line2" value={address.line2} onChange={set("line2")} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Field id="city" label="City" placeholder="Dubai" autoComplete="address-level2" value={address.city} onChange={set("city")} />
                  {fieldError("city") && <FieldNote text={fieldError("city")!} />}
                </div>
                <div className="mb-4">
                  <label htmlFor="emirate" className="mb-1.5 block text-sm font-semibold text-ink">
                    Emirate
                  </label>
                  <select
                    id="emirate"
                    value={address.emirate}
                    onChange={set("emirate")}
                    className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm focus:border-brand focus:outline-none"
                  >
                    {EMIRATES.map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </div>
                <Field id="postal" label="Postal Code, if applicable" placeholder="e.g. 00000" autoComplete="postal-code" value={address.postalCode} onChange={set("postalCode")} />
                <Field id="country" label="Country / Region" value="United Arab Emirates" readOnly />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="mb-4 font-bold text-ink">Order Summary</h2>
            <dl className="space-y-2 text-sm">
              <Row k="Product" v={plan.title} />
              <Row k="Story" v={`${possessive(heroName)} Magical Journey`} />
              <Row k="Quantity" v="1" />
              <Row k="Subtotal" v={price(cost.price)} />
              {physical && <Row k="Delivery" v={cost.delivery ? price(cost.delivery) : "Included"} />}
              <div className="flex justify-between border-t border-ink/10 pt-3 font-bold">
                <dt>Total:</dt>
                <dd className="text-brand">{price(cost.total)}</dd>
              </div>
            </dl>
            {problem && !Object.keys(problem.fields).length && <p className="mt-3 text-xs font-semibold text-red-700">{problem.message}</p>}
            <Button className="mt-5 w-full" disabled={busy} onClick={() => void pay()}>
              {busy ? "Opening secure payment…" : `Pay ${price(cost.total)}`}
            </Button>
            <LinkButton href={ROUTES.plans} variant="outline" className="mt-2 w-full">
              Back to Plans
            </LinkButton>
          </Card>
          <Card className="p-4 text-center text-xs">
            <p className="flex items-center justify-center gap-1 text-ink-muted">
              <ShieldCheck className="h-4 w-4 text-emerald-500" /> Your payment is processed securely by Stripe.
            </p>
            <p className="mt-2 space-x-2 font-semibold text-brand">
              <a href="#">Refund Policy</a>
              <span className="text-ink-faint">•</span>
              <a href="#">Cancellation Policy</a>
              <span className="text-ink-faint">•</span>
              <a href="#">Contact Support</a>
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function FieldNote({ text }: { text: string }) {
  return <p className="-mt-3 mb-3 text-xs font-semibold text-red-700">{text}</p>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{k}:</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

const POLL_MS = 2000;
const POLL_FOR_MS = 90_000;
// After payment the book PDF takes a little while (backend BE-18): keep asking up to 5 minutes.
const PDF_POLL_FOR_MS = 5 * 60_000;
const pdfOnTheWay = (o: ServerOrder) => o.paymentStatus === "paid" && ["not_started", "queued", "making"].includes(o.pdfStatus);

export function SuccessScreen() {
  const { parent, heroName, updateParent } = useAppState();
  const search = new URLSearchParams(useSearch());
  const asked = search.get("order");
  // The order this browser remembers counts only if it IS the order in the address.
  const remembered = parent.order && (!asked || !parent.order.id || parent.order.id === asked) ? parent.order : null;
  const orderId = asked ?? remembered?.id ?? null;
  const demo = inPreviewMode() || !orderId;
  const [server, setServer] = useState<ServerOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);

  // Stripe sends the parent back straight away, but the "paid" news comes by webhook, usually a
  // second or two later: ask the server every 2 seconds until it knows.
  useEffect(() => {
    if (demo || !orderId) return;
    let cancelled = false;
    const until = Date.now() + POLL_FOR_MS;
    const pdfUntil = Date.now() + PDF_POLL_FOR_MS;
    let told = false;
    const check = async () => {
      try {
        const order = await getOrder(orderId);
        if (cancelled) return;
        setServer(order);
        if (order.paymentStatus !== "pending") {
          if (!told) {
            told = true;
            updateParent({ order: { id: order.id, plan: order.tier, orderNumber: order.orderNumber, amount: order.amountPaid ?? order.amount, promoCode: order.promoCode, paymentStatus: order.paymentStatus } });
          }
          // Paid: keep asking until the book PDF is ready, so the Download button turns on.
          if (pdfOnTheWay(order) && Date.now() < pdfUntil) setTimeout(() => void check(), POLL_MS);
          return;
        }
      } catch (err) {
        if (!cancelled) setProblem(messageOf(err));
      }
      if (Date.now() > until) setGaveUp(true);
      else setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [demo, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (demo && !remembered) return <Redirect to={ROUTES.plans} />;

  const status = demo ? "paid" : server?.paymentStatus;
  const tier: PlanId = server?.tier ?? remembered?.plan ?? "digital";
  const plan = PLANS.find((p) => p.id === tier)!;
  const physical = tier === "hardback";

  if (status !== "paid") {
    const failed = status === "failed" || status === "cancelled";
    return (
      <AppShell>
        <div className="mx-auto my-auto max-w-md text-center">
          {failed ? (
            <>
              <Heading>Payment Didn't Go Through</Heading>
              <Subtle className="mt-2">You haven't been charged. You can try again with another card or payment method.</Subtle>
              <LinkButton href={`${ROUTES.pay}?plan=${tier}`} className="mt-6">
                Try Again <Arrow />
              </LinkButton>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" aria-hidden />
              <Heading className="mt-4">Confirming Your Payment…</Heading>
              <Subtle className="mt-2" >
                {gaveUp
                  ? "This is taking longer than usual. You won't be charged twice; check your dashboard in a few minutes."
                  : "This usually takes a few seconds. Please keep this page open."}
              </Subtle>
              {problem && <p className="mt-3 text-xs font-semibold text-red-700">{problem}</p>}
              {gaveUp && (
                <LinkButton href={ROUTES.dashboard} variant="outline" className="mt-6">
                  Go to Dashboard
                </LinkButton>
              )}
            </>
          )}
        </div>
      </AppShell>
    );
  }

  const orderNumber = server?.orderNumber ?? remembered!.orderNumber;
  // What was actually paid: a promo code typed on Stripe's page lowers it.
  const amount = server ? (server.amountPaid ?? server.amount) : remembered!.amount;
  const discount = server?.discount ?? 0;
  const pdfReady = !demo && server?.pdfStatus === "ready";
  const pdfFailed = !demo && server?.pdfStatus === "failed";

  // Asks the server for a fresh short-lived link, then the browser saves the PDF.
  const download = async () => {
    if (!server) return;
    setDownloading(true);
    setDownloadProblem(null);
    try {
      const { url } = await getDownloadLink(server.id);
      window.location.assign(url);
    } catch (err) {
      setDownloadProblem(messageOf(err));
    } finally {
      setDownloading(false);
    }
  };
  const downloadButton = (
    <Button disabled={!pdfReady || downloading} onClick={() => void download()}>
      {downloading || (!pdfReady && !pdfFailed && !demo) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Story
    </Button>
  );

  return (
    <AppShell>
      <div className="mx-auto mt-auto max-w-2xl text-center">
        <Heading>{physical ? "Your Order Is Confirmed!" : "Your Digital Storybook Is Paid For!"}</Heading>
        <Subtle className="mt-2">
          {physical
            ? "Thank you for bringing your child's story to life. Your order has been received successfully."
            : "Thank you for bringing your child's imagination to life! Your payment was successful."}
        </Subtle>
      </div>
      <div className="mx-auto mb-auto mt-8 w-full max-w-[576px] space-y-4">
        <Card>
          <h2 className="mb-3 border-b border-ink/10 pb-3 text-xs font-extrabold uppercase tracking-wide text-ink">Order Details</h2>
          <dl className="space-y-2 text-sm">
            {/* The bought story's own title (from the order), never another open story's name. */}
            <Row k="Story" v={server?.storyTitle ?? `${possessive(heroName)} Magical Journey`} />
            <Row k="Format" v={plan.title} />
            <Row k="Order Number" v={orderNumber} />
            {discount > 0 && server && (
              <>
                <Row k="Price" v={price(server.amount)} />
                <Row k={server.promoCode ? `Discount (${server.promoCode})` : "Discount"} v={`− ${price(discount)}`} />
              </>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-muted">Amount Paid:</dt>
              <dd className="font-bold text-brand">{price(amount)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="bg-white/70 text-center">
          {/* The PDF is made by backend BE-18 (a hardback also gets one); tracking comes with BE-19. */}
          <p className="font-bold text-ink">
            {physical ? "Your Book Is Being Prepared" : pdfReady ? "Your PDF Is Ready!" : pdfFailed ? "We Couldn't Make Your PDF" : "Your PDF Is Being Prepared"}
          </p>
          <Subtle className="mt-1 text-xs">
            {pdfFailed
              ? "Something went wrong on our side. You won't be charged again; please contact us and we'll make it for you."
              : physical
                ? pdfReady
                  ? "We'll email you when it's on its way. Meanwhile, download the PDF of your story."
                  : "We'll email you when it's on its way."
                : pdfReady
                  ? "Download it any time from here."
                  : "This usually takes under a minute. Please keep this page open."}
          </Subtle>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {downloadButton}
            {physical ? (
              <Button disabled variant="outline" className="border-ink/10">
                <Truck className="h-4 w-4" /> Track My Order
              </Button>
            ) : (
              <LinkButton href={ROUTES.book} variant="outline" className="border-ink/10">
                <Eye className="h-4 w-4" /> View Story
              </LinkButton>
            )}
          </div>
          {downloadProblem && <p className="mt-3 text-xs font-semibold text-red-700">{downloadProblem}</p>}
        </Card>
        <div className="text-center">
          <LinkButton href={ROUTES.dashboard} variant="ghost">
            Go to Dashboard
          </LinkButton>
        </div>
      </div>
    </AppShell>
  );
}

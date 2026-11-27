import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/Layout";
import { Arrow, Button, Card, Subtle } from "@/components/ui";
import { CURRENCY, HEROES, PLANS } from "@/data/content";
import { inPreviewMode, modeOf, useAppState, type ChildProfile } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import { getDownloadLink, listOrders, type ServerOrder } from "@/lib/orders";
import { listStories, type StorySummary } from "@/lib/stories";
import { useServerChildren } from "@/screens/parent/Children";
import { cx, possessive } from "@/lib/text";
import { ROUTES } from "@/lib/routes";
import { resumePoint } from "@/screens/story/Start";

// Parent home after login (Figma "Parent Dashboard"): child profiles, stories
// waiting for review, recent stories, and orders with their status.
// Logged in, everything comes from the server: every story of every child, and every order
// (with its own Download button). Preview mode keeps the old local, one-story version.

type Tone = "amber" | "brand" | "green" | "slate";

const TONES: Record<Tone, string> = {
  amber: "bg-[#FEF3C7] text-[#92400E]",
  brand: "bg-brand-soft text-brand",
  green: "bg-[#DCFCE7] text-[#166534]",
  slate: "bg-[#F1F5F9] text-ink-muted",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-xs font-bold", TONES[tone])}>{children}</span>;
}

/** Joins non-empty parts with the Figma " • " separator. */
const meta = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join("  •  ");

const modeLabel = (child: ChildProfile) => (modeOf(child) === "junior" ? "Explorer Mode" : "Creator Mode");

function finishedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Finished today";
  if (days === 1) return "Finished yesterday";
  return `Finished ${date.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}`;
}

function Section({ title, badge, highlight, children }: { title: string; badge?: string; highlight?: boolean; children: ReactNode }) {
  return (
    <Card className={cx("p-5 sm:p-8", highlight && "border-2 border-brand")}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">{title}</h2>
        {badge && <Pill tone="brand">{badge}</Pill>}
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

/** Grey row: title + meta on the left, actions on the right (stacked on phones). */
function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-tile p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
      <div className="min-w-0">
        <p className="font-display text-[17px] font-semibold text-ink sm:text-xl">{title}</p>
        <p className="mt-1 text-[13px] text-ink-muted sm:text-sm">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">{children}</div>
    </div>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline">
      {children} <Arrow />
    </button>
  );
}

/**
 * Preview mode only (/screens, demo data, no login): the old dashboard that shows the one
 * story and one order kept in this browser.
 */
function PreviewDashboard() {
  const [, navigate] = useLocation();
  const { parent, updateParent, story, heroName } = useAppState();

  const firstName = parent.account?.name.trim().split(/\s+/)[0] ?? "";
  const author = parent.children.find((c) => c.id === (story.childId ?? parent.activeChildId)) ?? null;
  const authorMode = author ? modeOf(author) : "junior";
  // The children come from the server (backend BE-04).
  useServerChildren();
  const hasStory = !!story.heroType && !!author;
  const storyTitle = `${possessive(heroName)} Magical Journey`;
  const finished = finishedLabel(story.storyGeneratedAt);
  // Only a PAID order counts (an unpaid checkout, backend BE-17, isn't an order yet).
  const order = parent.order && (parent.order.paymentStatus ?? "paid") === "paid" ? parent.order : null;
  const waitingForReview = hasStory && story.confirmedByChild && !order;
  const inProgress = hasStory && !story.confirmedByChild;

  const asChild = (child: ChildProfile, route: string) => {
    updateParent({ activeChildId: child.id });
    navigate(route);
  };

  const plan = order ? PLANS.find((p) => p.id === order.plan) : undefined;
  const digital = order?.plan === "digital";

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1216px] space-y-6 sm:space-y-8">
        <header>
          <h1 className="font-display text-[28px] font-bold leading-tight text-ink sm:text-4xl">
            Welcome back{firstName && `, ${firstName}`}
          </h1>
          <Subtle className="mt-1.5 sm:text-base">Here's what's happening with your young authors.</Subtle>
        </header>

        {/* Child profiles: swipe row on phones, three columns on desktop. */}
        <section aria-label="Child profiles" className="-mx-4 snap-x overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0">
          <div className="flex gap-3 sm:grid sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {parent.children.map((child) => {
              const busy = inProgress && author?.id === child.id;
              return (
                <Card key={child.id} className="flex w-[250px] shrink-0 flex-col gap-4 p-6 sm:w-auto sm:p-6">
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-[22px] font-bold text-brand">
                      {child.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-[22px] font-semibold text-ink">{child.name}</span>
                      {/* Phones drop the word "Mode" so the line fits the 250px swipe card. */}
                      <span className="block text-sm text-ink-muted">
                        {meta(`${child.age} years`, modeLabel(child).replace(" Mode", ""))}
                        <span className="hidden sm:inline"> Mode</span>
                      </span>
                    </span>
                  </div>
                  <Pill tone={busy ? "amber" : "slate"}>{busy ? "1 story in progress" : "No story in progress"}</Pill>
                  <Button className="w-fit" onClick={() => asChild(child, ROUTES.handover)}>
                    Hand over to {child.name} <Arrow />
                  </Button>
                </Card>
              );
            })}
            <button
              type="button"
              onClick={() => navigate(ROUTES.addChild)}
              className="flex min-h-[205px] w-[250px] shrink-0 flex-col items-center justify-center gap-3 rounded-3xl border-[1.5px] border-dashed border-ink/40 bg-white/50 hover:border-brand/60 sm:w-auto"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white">
                <Plus className="h-6 w-6" />
              </span>
              <span className="text-[15px] font-extrabold tracking-wider text-ink">{parent.children.length ? "ADD CHILD" : "ADD YOUR FIRST CHILD"}</span>
            </button>
          </div>
        </section>

        {waitingForReview && author && (
          <Section title="Stories waiting for review" badge="1 waiting" highlight>
            <Row title={storyTitle} detail={meta(`By ${author.name}`, modeLabel(author), finished)}>
              <Button className="w-full sm:w-auto" onClick={() => asChild(author, ROUTES.review)}>
                Review Story <Arrow />
              </Button>
            </Row>
          </Section>
        )}

        <Section title="Recent stories">
          {hasStory && author ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              <div className="flex flex-col gap-2 rounded-2xl bg-tile p-5">
                {inProgress ? (
                  <Pill tone="amber">In Progress</Pill>
                ) : waitingForReview ? (
                  <Pill tone="brand">Waiting for review</Pill>
                ) : (
                  <Pill tone="green">Ordered</Pill>
                )}
                <p className="font-display text-lg font-semibold text-ink">{storyTitle}</p>
                <p className="text-sm text-ink-muted">
                  {meta(
                    `By ${author.name}`,
                    inProgress ? `Chapter ${resumePoint(story, authorMode).chapter} of 7` : finished,
                  )}
                </p>
                <div className="mt-1">
                  {inProgress ? (
                    <TextLink onClick={() => asChild(author, ROUTES.handover)}>Continue with {author.name}</TextLink>
                  ) : waitingForReview ? (
                    <TextLink onClick={() => asChild(author, ROUTES.review)}>Review</TextLink>
                  ) : (
                    <TextLink onClick={() => asChild(author, ROUTES.success)}>View order</TextLink>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Subtle>No stories yet. Hand the device to a child to start their first story.</Subtle>
          )}
        </Section>

        {order && plan && author && (
          <Section title="Orders">
            <Row title={storyTitle} detail={meta(`Order ${order.orderNumber}`, plan.title, `${CURRENCY} ${order.amount.toLocaleString()}${order.promoCode ? ` (${order.promoCode})` : ""}`, `By ${author.name}`)}>
              <Pill tone={digital ? "green" : "amber"}>{digital ? "Ready to download" : "Being prepared"}</Pill>
              <TextLink onClick={() => asChild(author, ROUTES.success)}>{digital ? "Download" : "View Order"}</TextLink>
            </Row>
          </Section>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// The real dashboard (logged in): stories and orders from the server.

const IN_PROGRESS: StorySummary["status"][] = ["draft", "generating", "child_review"];
const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/** A story's name: its title, or the hero's ("Ember's Story") while it has none yet. */
function storyName(s: StorySummary): string {
  if (s.title?.trim()) return s.title.trim();
  const typed = s.charName.trim();
  const hero = typed ? typed[0].toUpperCase() + typed.slice(1) : HEROES.find((h) => h.id === s.heroType)?.defaultName;
  return hero ? `${possessive(hero)} Story` : "A New Story";
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/** The parent's stories and orders, refreshed while something is still being made. */
function useParentLibrary() {
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [orders, setOrders] = useState<ServerOrder[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listStories(), listOrders()])
      .then(([s, o]) => {
        if (cancelled) return;
        setStories(s);
        setOrders(o);
        setProblem(null);
      })
      .catch((err) => !cancelled && setProblem(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // A story being written or a PDF being made: look again in a few seconds.
  const busy =
    !!stories?.some((s) => s.status === "generating") ||
    !!orders?.some((o) => o.paymentStatus === "paid" && ["not_started", "queued", "making"].includes(o.pdfStatus));
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setTick((n) => n + 1), 5000);
    return () => clearTimeout(t);
  }, [busy, tick]);

  return { stories, orders, problem, reload: () => setTick((n) => n + 1) };
}

export function DashboardScreen() {
  return inPreviewMode() ? <PreviewDashboard /> : <ServerDashboard />;
}

function ServerDashboard() {
  const [, navigate] = useLocation();
  const { parent, updateParent, openStory } = useAppState();
  const childrenProblem = useServerChildren();
  const { stories, orders, problem, reload } = useParentLibrary();
  const [opening, setOpening] = useState<string | null>(null);
  const [actionProblem, setActionProblem] = useState<string | null>(null);

  const firstName = parent.account?.name.trim().split(/\s+/)[0] ?? "";
  const childOf = (id: string) => parent.children.find((c) => c.id === id) ?? null;
  const paidOrders = (orders ?? []).filter((o) => o.paymentStatus === "paid");
  const paidFor = (storyId: string) => paidOrders.find((o) => o.storyId === storyId) ?? null;
  const waiting = (stories ?? []).filter((s) => s.status === "parent_review");
  // A draft with no hero yet was only opened, never started: not worth a card.
  const shown = (stories ?? []).filter((s) => s.status !== "draft" || !!s.heroType);

  const asChild = (child: ChildProfile, route: string) => {
    updateParent({ activeChildId: child.id });
    navigate(route);
  };

  /** Makes this story the open one (review and checkout work on the open story), then goes there. */
  const openAndGo = async (s: StorySummary, route: string, order?: ServerOrder) => {
    if (opening) return;
    setOpening(s.id);
    setActionProblem(null);
    try {
      // The success page shows the order it's given; it's also remembered as this browser's order.
      const remembered = order && { id: order.id, plan: order.tier, orderNumber: order.orderNumber, amount: order.amountPaid ?? order.amount, promoCode: order.promoCode, paymentStatus: order.paymentStatus };
      updateParent({ activeChildId: s.childId, ...(remembered && { order: remembered }) });
      await openStory(s.id);
      navigate(route);
    } catch (err) {
      setActionProblem(errorText(err));
    } finally {
      setOpening(null);
    }
  };

  const download = async (order: ServerOrder) => {
    if (opening) return;
    setOpening(order.id);
    setActionProblem(null);
    try {
      const { url } = await getDownloadLink(order.id);
      window.location.assign(url);
    } catch (err) {
      setActionProblem(errorText(err));
    } finally {
      setOpening(null);
    }
  };

  const message = actionProblem ?? problem ?? childrenProblem;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1216px] space-y-6 sm:space-y-8">
        <header>
          <h1 className="font-display text-[28px] font-bold leading-tight text-ink sm:text-4xl">
            Welcome back{firstName && `, ${firstName}`}
          </h1>
          <Subtle className="mt-1.5 sm:text-base">Here's what's happening with your young authors.</Subtle>
        </header>

        {message && (
          <Card className="flex flex-col gap-3 border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-red-800">{message}</p>
            {problem && (
              <Button variant="outline" className="w-fit border-red-200" onClick={reload}>
                Try again
              </Button>
            )}
          </Card>
        )}

        {/* Child profiles: swipe row on phones, three columns on desktop. */}
        <section aria-label="Child profiles" className="-mx-4 snap-x overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0">
          <div className="flex gap-3 sm:grid sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {parent.children.map((child) => {
              const busy = shown.filter((s) => s.childId === child.id && IN_PROGRESS.includes(s.status)).length;
              return (
                <Card key={child.id} className="flex w-[250px] shrink-0 flex-col gap-4 p-6 sm:w-auto sm:p-6">
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-[22px] font-bold text-brand">
                      {child.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-[22px] font-semibold text-ink">{child.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {meta(`${child.age} years`, modeLabel(child).replace(" Mode", ""))}
                        <span className="hidden sm:inline"> Mode</span>
                      </span>
                    </span>
                  </div>
                  <Pill tone={busy ? "amber" : "slate"}>{busy ? `${busy} ${busy === 1 ? "story" : "stories"} in progress` : "No story in progress"}</Pill>
                  <Button className="w-fit" onClick={() => asChild(child, ROUTES.handover)}>
                    Hand over to {child.name} <Arrow />
                  </Button>
                </Card>
              );
            })}
            <button
              type="button"
              onClick={() => navigate(ROUTES.addChild)}
              className="flex min-h-[205px] w-[250px] shrink-0 flex-col items-center justify-center gap-3 rounded-3xl border-[1.5px] border-dashed border-ink/40 bg-white/50 hover:border-brand/60 sm:w-auto"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white">
                <Plus className="h-6 w-6" />
              </span>
              <span className="text-[15px] font-extrabold tracking-wider text-ink">{parent.children.length ? "ADD CHILD" : "ADD YOUR FIRST CHILD"}</span>
            </button>
          </div>
        </section>

        {waiting.length > 0 && (
          <Section title="Stories waiting for review" badge={`${waiting.length} waiting`} highlight>
            {waiting.map((s) => {
              const child = childOf(s.childId);
              return (
                <Row key={s.id} title={storyName(s)} detail={meta(child && `By ${child.name}`, s.mode === "senior" ? "Creator Mode" : "Explorer Mode", `Finished ${shortDate(s.updatedAt)}`)}>
                  <Button className="w-full sm:w-auto" disabled={!!opening} onClick={() => void openAndGo(s, ROUTES.review)}>
                    {opening === s.id ? "Opening…" : "Review Story"} <Arrow />
                  </Button>
                </Row>
              );
            })}
          </Section>
        )}

        <Section title="Recent stories">
          {stories === null ? (
            <Subtle>{problem ? "Your stories couldn't be loaded." : "Loading your stories…"}</Subtle>
          ) : shown.length === 0 ? (
            <Subtle>No stories yet. Hand the device to a child to start their first story.</Subtle>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {shown.map((s) => {
                const child = childOf(s.childId);
                const order = paidFor(s.id);
                let pill: ReactNode;
                let action: ReactNode = null;
                if (s.status === "draft" || s.status === "child_review") {
                  pill = <Pill tone="amber">{s.status === "draft" ? "In Progress" : `${child?.name ?? "Your child"} is checking it`}</Pill>;
                  if (child) action = <TextLink onClick={() => asChild(child, ROUTES.handover)}>Continue with {child.name}</TextLink>;
                } else if (s.status === "generating") {
                  pill = <Pill tone="amber">Being created</Pill>;
                } else if (s.status === "parent_review") {
                  pill = <Pill tone="brand">Waiting for review</Pill>;
                  action = <TextLink onClick={() => void openAndGo(s, ROUTES.review)}>Review</TextLink>;
                } else if (order) {
                  pill = <Pill tone="green">Ordered</Pill>;
                  action = <TextLink onClick={() => void openAndGo(s, `${ROUTES.success}?order=${order.id}`, order)}>View order</TextLink>;
                } else {
                  pill = <Pill tone="green">Approved</Pill>;
                  action = <TextLink onClick={() => void openAndGo(s, ROUTES.plans)}>Choose your book</TextLink>;
                }
                return (
                  <div key={s.id} className="flex flex-col gap-2 rounded-2xl bg-tile p-5">
                    {pill}
                    <p className="font-display text-lg font-semibold text-ink">{storyName(s)}</p>
                    <p className="text-sm text-ink-muted">{meta(child && `By ${child.name}`, `Updated ${shortDate(s.updatedAt)}`)}</p>
                    {action && <div className="mt-1">{opening === s.id ? <Subtle>Opening…</Subtle> : action}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {paidOrders.length > 0 && (
          <Section title="Orders">
            {paidOrders.map((o) => {
              const s = stories?.find((x) => x.id === o.storyId);
              const child = s ? childOf(s.childId) : null;
              const plan = PLANS.find((p) => p.id === o.tier);
              const pdf =
                o.pdfStatus === "ready" ? (
                  <Pill tone="green">Ready to download</Pill>
                ) : o.pdfStatus === "failed" ? (
                  <Pill tone="amber">PDF problem: please contact us</Pill>
                ) : o.pdfStatus === "deleted" ? (
                  <Pill tone="slate">Deleted</Pill>
                ) : (
                  <Pill tone="amber">Preparing PDF…</Pill>
                );
              return (
                <Row
                  key={o.id}
                  title={o.storyTitle ?? (s ? storyName(s) : "Your story")}
                  detail={meta(`Order ${o.orderNumber}`, plan?.title, `${CURRENCY} ${(o.amountPaid ?? o.amount).toLocaleString()}${o.promoCode ? ` (${o.promoCode})` : ""}`, child && `By ${child.name}`)}
                >
                  {pdf}
                  {o.pdfStatus === "ready" && <TextLink onClick={() => void download(o)}>{opening === o.id ? "Preparing…" : "Download"}</TextLink>}
                  {s && <TextLink onClick={() => void openAndGo(s, `${ROUTES.success}?order=${o.id}`, o)}>View order</TextLink>}
                </Row>
              );
            })}
          </Section>
        )}
      </div>
    </AppShell>
  );
}

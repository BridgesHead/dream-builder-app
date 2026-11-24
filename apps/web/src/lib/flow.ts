import type { DeviceHolder, Mode, ParentState, StoryState } from "@/state/AppState";
import { ROUTES } from "./routes";

export interface FlowStep {
  path: string;
  done: boolean;
}

function actSteps(act: 1 | 2 | 3, story: StoryState, mode: Mode): FlowStep[] {
  const k = {
    1: { o: story.obstacles, f: story.heartColor, m: story.braveMove, w: story.heroWords },
    2: { o: story.obstacles2, f: story.heartColor2, m: story.braveMove2, w: story.heroWords2 },
    3: { o: story.obstacles3, f: story.heartColor3, m: story.braveMove3, w: story.heroWords3 },
  }[act];
  const base = `/story/act/${act}`;
  if (mode === "senior") {
    return [{ path: `${base}/all`, done: !!(k.o.length && k.f && k.m && k.w.trim()) }];
  }
  return [
    { path: `${base}/obstacle`, done: k.o.length > 0 },
    { path: `${base}/feeling`, done: !!k.f },
    { path: `${base}/move`, done: !!(k.m && k.w.trim()) },
  ];
}

/** The child's story wizard, in order, with each step's completion state. */
export function storyFlow(story: StoryState, mode: Mode): FlowStep[] {
  const explorer = mode === "junior";
  const generated = !!story.storyGeneratedAt;
  return [
    { path: ROUTES.author, done: !!story.authorName.trim() },
    { path: ROUTES.format, done: !!story.selectedFormat },
    { path: ROUTES.style, done: !!story.comicVibe },
    { path: ROUTES.hero, done: !!story.heroType && (explorer || !!story.heroPronoun) },
    ...(explorer ? [{ path: ROUTES.heroName, done: !!story.heroType && !!story.heroPronoun }] : []),
    { path: ROUTES.strength, done: story.charStrengths.length > 0 },
    // Tools are optional; reaching the dream step counts as done.
    ...(explorer ? [{ path: ROUTES.tools, done: story.charStrengths.length > 0 }] : []),
    { path: ROUTES.dream, done: !!story.aspiration.trim() },
    ...actSteps(1, story, mode),
    { path: ROUTES.rest, done: !!story.safePlaceText.trim() },
    ...actSteps(2, story, mode),
    { path: ROUTES.gate, done: story.facesChallenge3 !== null },
    ...(story.facesChallenge3 ? actSteps(3, story, mode) : []),
    { path: ROUTES.generating, done: generated },
    { path: ROUTES.ready, done: generated },
    { path: ROUTES.book, done: story.confirmedByChild },
    { path: ROUTES.done, done: story.confirmedByChild },
  ];
}

/**
 * Where the visitor should be sent instead of `path`, or null if they may stay.
 * Enforces: account → child profile → handover → story steps in order → parent checkout.
 * After a handover the child holds the device: parent pages need the parent's password
 * first (the ask-a-parent screen), because the server refuses them a child session anyway.
 */
export function redirectFor(path: string, story: StoryState, parent: ParentState, mode: Mode, storyId: string | null): string | null {
  const holder: DeviceHolder = parent.holder ?? (parent.account ? "parent" : null);
  if (path === ROUTES.askParent) return holder === "child" ? null : ROUTES.dashboard;
  const childPage = path === ROUTES.start || path === ROUTES.library || path.startsWith("/story/");
  if (holder === "child" && !childPage) {
    // Email links still work for whoever opened them; everything else is for grown-ups.
    const linkPages: string[] = [ROUTES.verifyEmail, ROUTES.forgotPassword, ROUTES.resetPassword];
    return linkPages.includes(path) ? null : `${ROUTES.askParent}?next=${encodeURIComponent(path)}`;
  }
  if (holder === "child") return storyRedirect(path, story, mode, storyId);

  // Opened from email links: they work whether or not this browser is logged in.
  const linkPages: string[] = [ROUTES.verifyEmail, ROUTES.forgotPassword, ROUTES.resetPassword];
  if (linkPages.includes(path)) return null;

  const authPages: string[] = [ROUTES.signup, ROUTES.login];
  if (authPages.includes(path)) return parent.account ? ROUTES.dashboard : null;
  if (!parent.account) return ROUTES.signup;

  const parentSetup: string[] = [ROUTES.dashboard, ROUTES.children, ROUTES.addChild];
  if (parentSetup.includes(path)) return null;
  if (!parent.activeChildId) return ROUTES.children;

  if (path === ROUTES.handover) return null;
  // The story pages need a child session: the parent hands the device over first
  // (from the dashboard or the children screen).
  if (childPage) return ROUTES.dashboard;

  // Parent review & checkout need the child's confirmed story.
  if (!story.confirmedByChild) return ROUTES.dashboard;
  if (path === ROUTES.success && !parent.order) return ROUTES.plans;
  return null;
}

/** For the child holding the device: the story steps in order. */
function storyRedirect(path: string, story: StoryState, mode: Mode, storyId: string | null): string | null {
  if (path === ROUTES.start || path === ROUTES.library) return null;
  // Every answer is saved to a draft on the server: start (or open) one first.
  if (!storyId) return ROUTES.start;
  const flow = storyFlow(story, mode);
  const firstOpen = flow.find((s) => !s.done)?.path ?? null;

  const index = flow.findIndex((s) => s.path === path);
  // Unknown step for this mode (e.g. an Explorer opening a Creator screen).
  if (index === -1) return firstOpen ?? ROUTES.book;
  const blocker = flow.slice(0, index).find((s) => !s.done);
  return blocker ? blocker.path : null;
}

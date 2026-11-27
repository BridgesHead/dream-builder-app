import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { HEROES, PRONOUNS, type ArtStyle, type HeroType, type PlanId, type Pronoun } from "@/data/content";
import { ApiError } from "@/lib/api";
import { restoreSession } from "@/lib/auth";
import { createStory, getStory, saveStory, savableFields } from "@/lib/stories";

// The app's shared state. Field names follow StoryState in the PRD (§5), the same names the
// API uses. The story lives on the server (backend BE-08); localStorage keeps a copy so the
// screen fills in straight away after a reload.

export type Mode = "junior" | "senior";

export interface StoryState {
  authorName: string;
  selectedFormat: "storybook" | "comic" | null;
  comicVibe: ArtStyle | null;
  heroType: HeroType | null;
  charName: string;
  /** null until the child picks one; nothing is preselected. */
  heroPronoun: Pronoun | null;
  charStrengths: string[];
  selfLove: string;
  charTools: string[];
  aspiration: string;
  obstacles: string[];
  heartColor: string;
  braveMove: string;
  heroWords: string;
  safePlaceText: string;
  obstacles2: string[];
  heartColor2: string;
  braveMove2: string;
  heroWords2: string;
  /** null = not decided yet; false = child skipped the Challenge Gate. */
  facesChallenge3: boolean | null;
  obstacles3: string[];
  // Not in the PRD StoryState yet — the Figma final act collects a feeling.
  heartColor3: string;
  braveMove3: string;
  heroWords3: string;
  storyGeneratedAt: string | null;
  confirmedByChild: boolean;
  // Not in the PRD StoryState yet — which child profile is writing this story (parent dashboard).
  childId: string | null;
}

export const EMPTY_STORY: StoryState = {
  authorName: "",
  selectedFormat: null,
  comicVibe: null,
  heroType: null,
  charName: "",
  heroPronoun: null,
  charStrengths: [],
  selfLove: "",
  charTools: [],
  aspiration: "",
  obstacles: [],
  heartColor: "",
  braveMove: "",
  heroWords: "",
  safePlaceText: "",
  obstacles2: [],
  heartColor2: "",
  braveMove2: "",
  heroWords2: "",
  facesChallenge3: null,
  obstacles3: [],
  heartColor3: "",
  braveMove3: "",
  heroWords3: "",
  storyGeneratedAt: null,
  confirmedByChild: false,
  childId: null,
};

export interface ChildProfile {
  id: string;
  name: string;
  age: number;
  language: string;
  /** Explorer or Creator, as stored on the server (the parent's choice). Missing for demo data. */
  mode?: Mode;
}

export interface Order {
  plan: PlanId;
  orderNumber: string;
  /** What was paid, in AED (after any promo code). */
  amount: number;
  /** The promo code used on Stripe's page, e.g. "TEST20". */
  promoCode?: string | null;
  /** The server's order id (backend BE-17); missing for demo data. */
  id?: string;
  /** Missing for demo data (counts as paid). */
  paymentStatus?: "pending" | "paid" | "failed" | "cancelled";
}

/** Who holds this device: the parent, a child (after a handover), or nobody. */
export type DeviceHolder = "parent" | "child" | null;

export interface ParentState {
  /** The logged-in parent, as the API last described them. emailVerified is missing for demo data. */
  account: { name: string; email: string; emailVerified?: boolean } | null;
  children: ChildProfile[];
  activeChildId: string | null;
  order: Order | null;
  /** Cached from the server; the server decides (restoreSession when the app opens). */
  holder?: DeviceHolder;
}

const EMPTY_PARENT: ParentState = { account: null, children: [], activeChildId: null, order: null, holder: null };

const STORY_KEY = "dreamBuilder.storyState.v1";
const STORY_ID_KEY = "dreamBuilder.storyId.v1";
const PARENT_KEY = "dreamBuilder.parentState.v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode etc.) — state stays in memory.
  }
}

// The /screens preview tool fills in demo data with no real login; don't undo it, and
// don't call the API.
export function inPreviewMode(): boolean {
  try {
    return sessionStorage.getItem("dreamBuilder.preview") === "1";
  } catch {
    return false;
  }
}

export function modeForAge(age: number): Mode {
  return age < 12 ? "junior" : "senior";
}

/** A child's mode: the stored choice, or the age default for demo data. */
export function modeOf(child: Pick<ChildProfile, "age" | "mode">): Mode {
  return child.mode ?? modeForAge(child.age);
}

const THIRD_ACT_EMPTY: Partial<StoryState> = { obstacles3: [], heartColor3: "", braveMove3: "", heroWords3: "" };

interface AppStateValue {
  story: StoryState;
  /** Changes the story here at once, and saves it to the server a moment later. */
  updateStory: (patch: Partial<StoryState>) => void;
  /** The server id of the story being written, or null (not saved on the server). */
  storyId: string | null;
  /** Starts a new draft on the server for the child holding the device. */
  startNewStory: () => Promise<void>;
  /** Loads a saved story from the server, to continue it. */
  openStory: (id: string) => Promise<void>;
  /** Forgets the local story (e.g. a different child, or logging out). */
  clearStory: (childId?: string | null) => void;
  /** Sends any unsaved answers now (e.g. before asking to generate). */
  flushStory: () => Promise<void>;
  /** Set when answers couldn't be saved; cleared by the next good save. */
  saveProblem: string | null;
  parent: ParentState;
  updateParent: (patch: Partial<ParentState>) => void;
  activeChild: ChildProfile | null;
  mode: Mode;
  heroName: string;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [story, setStory] = useState<StoryState>(() => {
    const saved = load(STORY_KEY, EMPTY_STORY);
    // Drafts saved before "They" was removed go back to "not chosen".
    return saved.heroPronoun === null || PRONOUNS.some((p) => p.id === saved.heroPronoun) ? saved : { ...saved, heroPronoun: null };
  });
  const [storyId, setStoryId] = useState<string | null>(() => loadText(STORY_ID_KEY));
  const [parent, setParent] = useState<ParentState>(() => load(PARENT_KEY, EMPTY_PARENT));
  const [saveProblem, setSaveProblem] = useState<string | null>(null);

  useEffect(() => save(STORY_KEY, story), [story]);
  useEffect(() => save(STORY_ID_KEY, storyId), [storyId]);
  useEffect(() => save(PARENT_KEY, parent), [parent]);

  // ---- Saving answers to the server (backend BE-08) ----
  // Each tap or keystroke changes the story here at once. The changed fields are collected
  // in `pending` and sent together a moment later, so typing a word is one save, not ten.
  const pending = useRef<Partial<StoryState>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sending = useRef<Promise<void>>(Promise.resolve());
  const idRef = useRef(storyId);
  idRef.current = storyId;
  const holderRef = useRef(parent.holder);
  holderRef.current = parent.holder;

  const flushStory = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // One save at a time, in order.
    sending.current = sending.current.then(async () => {
      const id = idRef.current;
      const patch = pending.current;
      if (!id || Object.keys(patch).length === 0) return;
      pending.current = {};
      try {
        await saveStory(id, patch);
        setSaveProblem(null);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
          // Offline or a server hiccup: keep the answers and try again soon.
          pending.current = { ...patch, ...pending.current };
          setSaveProblem("Couldn't save your story just now. We'll keep trying.");
          timer.current = setTimeout(() => void flushStory(), 5000);
        } else {
          // The server refused these answers (they'd be refused again): drop them and say so.
          setSaveProblem(err instanceof ApiError ? err.message : "Some answers couldn't be saved.");
        }
      }
    });
    return sending.current;
  }, []);

  const queueSave = useCallback(
    (patch: Partial<StoryState>) => {
      if (!idRef.current || holderRef.current !== "child" || inPreviewMode()) return;
      const fields = savableFields(patch);
      if (Object.keys(fields).length === 0) return;
      const next = { ...pending.current, ...fields };
      // Two acts: the server clears Act 3 itself and refuses Act 3 answers, so don't send any.
      if (fields.facesChallenge3 === false) {
        for (const key of Object.keys(THIRD_ACT_EMPTY)) delete next[key as keyof StoryState];
      }
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushStory(), 600);
    },
    [flushStory],
  );

  // When the app opens, ask the API who holds this device (refresh cookie).
  // What localStorage remembers is only a cache: the server decides.
  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((result) => {
      if (cancelled || result === "offline" || inPreviewMode()) return; // server unreachable: keep things as they are
      setParent((p) => {
        if (!result) return p.account || p.holder ? { ...p, account: null, activeChildId: null, order: null, holder: null } : p;
        if (result.kind === "parent") {
          const { user } = result;
          return { ...p, holder: "parent", account: { name: user.name, email: user.email, emailVerified: user.emailVerified } };
        }
        // A child session: this child has the device.
        const others = p.children.filter((c) => c.id !== result.child.id);
        return { ...p, holder: "child", activeChildId: result.child.id, children: [...others, result.child] };
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppStateValue>(() => {
    const activeChild = parent.children.find((c) => c.id === parent.activeChildId) ?? null;
    const defaultName = HEROES.find((h) => h.id === story.heroType)?.defaultName ?? "Sparky";
    return {
      story,
      updateStory: (patch) => {
        // Choosing two acts clears the third act here too, as the server does.
        const local = patch.facesChallenge3 === false ? { ...patch, ...THIRD_ACT_EMPTY } : patch;
        setStory((s) => ({ ...s, ...local }));
        queueSave(patch);
      },
      storyId,
      startNewStory: async () => {
        await flushStory();
        const created = await createStory();
        pending.current = {};
        // flushSync: the caller navigates right after this, and the route guard must already
        // see the new story; otherwise it finds no story and sends the child back to the start.
        flushSync(() => {
          setStoryId(created.id);
          setStory(created.story);
        });
      },
      openStory: async (id) => {
        await flushStory();
        const loaded = await getStory(id);
        pending.current = {};
        flushSync(() => {
          setStoryId(id);
          setStory(loaded);
        });
      },
      clearStory: (childId = null) => {
        pending.current = {};
        setStoryId(null);
        setStory({ ...EMPTY_STORY, childId });
      },
      flushStory,
      saveProblem,
      parent,
      updateParent: (patch) => setParent((p) => ({ ...p, ...patch })),
      activeChild,
      mode: activeChild ? modeOf(activeChild) : "junior",
      // charName → heroType default → 'Sparky' (PRD F1 fallback chain)
      heroName: story.charName.trim() || defaultName,
    };
  }, [story, storyId, parent, saveProblem, queueSave, flushStory]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}

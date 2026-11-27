import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { heroArt } from "@/data/assets";
import type { HeroType } from "@/data/content";
import { burstPoints, ovalAround, SPIKE_REACH, tailBase, type Point } from "@/lib/balloon";
import type { ComicBubble, ComicCellView } from "@/lib/stories";
import { cx } from "@/lib/text";

/*
 * One comic panel (FE-07, backend BE-11), styled like a printed children's comic. The comic is
 * shown inside the storybook (Flipbook.tsx), its panels in the page's arrangement (a big panel
 * for the big moment, see COMIC_LAYOUTS there).
 *
 * A panel: the picture, with the balloon ON it in the top-left corner (read first, its tail
 * pointing down at the hero; the AI leaves calm space there), the sound effect ("WHOOSH!") and
 * Tempo's music notes, then the short picture-book line under it, when there is one. The AI
 * pictures have no words in them, so the words here are always the child's own.
 *
 * Balloons, as in real comics: speech, thought and whisper are one solid white oval with a pointed
 * tail; a shout is a spiky burst. Nothing else (no thought circles, no dashed outline). The shapes come from lib/balloon.ts, the same maths the
 * printed book uses (apps/api/src/print/balloon.ts), so the screen and the book match.
 */

/** Pictures narrower than this are the stub AI's placeholder (a 1×1 PNG), as in the flipbook. */
const PLACEHOLDER_MAX_WIDTH = 16;

function CellPicture({ src, heroType, label }: { src: string | null; heroType: HeroType | null; label: string }) {
  const [placeholder, setPlaceholder] = useState(false);
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth < PLACEHOLDER_MAX_WIDTH) setPlaceholder(true);
  };
  if (src && !placeholder) {
    return <img src={src} alt={label} draggable={false} onLoad={onLoad} className="h-full w-full select-none object-cover" />;
  }
  // No picture yet (or the stub's placeholder): the hero on a soft storybook sky.
  const art = heroArt(heroType, "standing");
  return (
    <div role="img" aria-label={label} className="relative h-full w-full bg-[linear-gradient(180deg,#DDEBFA_0%,#EEF0EC_52%,#F2E6CC_100%)]">
      {art && <img src={art} alt="" draggable={false} className="absolute inset-x-[15%] bottom-[6%] top-[8%] h-[86%] w-[70%] select-none object-contain" />}
    </div>
  );
}

const pointsOf = (pts: Point[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const INK = "#1D1B2E";

/**
 * The balloon, ON the picture in its top-left corner. The words are measured first, then the
 * oval (or burst) is drawn around them and the tail leans down towards the hero in the middle.
 */
function Balloon({ text, kind }: { text: string; kind: Exclude<ComicBubble, "none"> }) {
  const [ref, { w, h }] = useSize<HTMLParagraphElement>();
  const shout = kind === "shout";
  const reach = shout ? SPIKE_REACH : 1; // a burst's points stick out past its oval
  const margin = 6; // px from the panel's edge
  const pad = 3; // px between the words and the oval
  const { rx, ry } = ovalAround(w + pad * 2, h + pad * 2);
  // The oval's centre, relative to the panel's top-left corner.
  const ox = margin + rx * reach;
  const oy = margin + ry * reach;
  const tip: Point = [ox + rx * 0.45, oy + ry * reach + 14];
  const [b0, b1] = tailBase(ox, oy, rx, ry, tip, shout ? 0.85 : 0.92);
  return (
    <>
      {w > 0 && (
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible" width={ox * 2} height={tip[1]}>
          {shout ? (
            <>
              <polygon points={pointsOf([b0, tip, b1])} fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
              <polygon points={pointsOf(burstPoints(ox, oy, rx, ry, Math.max(12, Math.round((rx + ry) / 7))))} fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="miter" />
            </>
          ) : (
            // Speech, thought and whisper: one solid white oval with a pointed tail. The white tail
            // covers the oval's outline where they join; then its two sides are inked.
            <>
              <ellipse cx={ox} cy={oy} rx={rx} ry={ry} fill="#fff" stroke={INK} strokeWidth="2" />
              <polygon points={pointsOf([b0, tip, b1])} fill="#fff" />
              <polyline points={pointsOf([b0, tip, b1])} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
            </>
          )}
        </svg>
      )}
      <p
        ref={ref}
        style={{ left: ox - w / 2, top: oy - h / 2, visibility: w > 0 ? "visible" : "hidden" }}
        className={cx(
          // At most ~58% of the panel's width, so the oval around it (√2 wider) fits inside the panel.
          "absolute z-10 w-max text-center font-sans text-[0.72em] leading-[1.25] text-ink",
          shout ? "max-w-[46%] font-extrabold" : "max-w-[56%] font-bold",
        )}
      >
        {text}
      </p>
    </>
  );
}

/** A sound effect on the picture, big and bold like a printed comic ("WHOOSH!"). */
function SoundEffect({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-[6%] left-[6%] origin-bottom-left -rotate-[8deg] font-sans text-[1.5em] font-black leading-none tracking-wide text-[#FFC93C] [-webkit-text-stroke:0.16em_#1D1B2E] [paint-order:stroke_fill]"
    >
      {text}
    </span>
  );
}

export function ComicCell({ cell, heroType, className }: { cell: ComicCellView; heroType: HeroType | null; className?: string }) {
  const talking = !!cell.dialogue && cell.bubbleType !== "none";
  const narration = cell.caption.trim();
  return (
    <figure className={cx("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2px] border-[2.5px] border-ink bg-white shadow-[3px_3px_0_rgba(29,27,46,0.18)]", className)}>
      <div className={cx("relative min-h-[45%] flex-1 overflow-hidden bg-tile", narration && "border-b-[2.5px] border-ink")}>
        <div className="absolute inset-0">
          <CellPicture src={cell.imageUrl} heroType={heroType} label={`Comic picture ${cell.cell} on page ${cell.page}`} />
        </div>
        {talking && <Balloon text={cell.dialogue!} kind={cell.bubbleType as Exclude<ComicBubble, "none">} />}
        {cell.sfx && <SoundEffect text={cell.sfx} />}
        {cell.tempo && (
          <span
            title="Tempo the musical squirrel"
            className="absolute bottom-[5%] right-[4%] rounded-full border-[1.5px] border-amber-600 bg-amber-50/95 px-[0.6em] py-[0.1em] text-[0.8em] font-bold tracking-[0.15em] text-amber-800 shadow-sm"
          >
            {cell.tempo}
          </span>
        )}
      </div>
      {narration && (
        <p className="shrink-0 bg-[#FFFDF6] px-[0.7em] py-[0.4em] text-center font-display text-[0.74em] italic leading-[1.35] text-ink">{narration}</p>
      )}
    </figure>
  );
}

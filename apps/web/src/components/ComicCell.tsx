import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { heroArt } from "@/data/assets";
import type { HeroType } from "@/data/content";
import type { ComicBubble, ComicCellView } from "@/lib/stories";
import { cx } from "@/lib/text";

/*
 * One comic panel (FE-07, backend BE-11), styled like a printed children's comic. The comic is
 * shown inside the storybook (Flipbook.tsx), its panels in the page's arrangement (a big panel
 * for the big moment, see COMIC_LAYOUTS there).
 *
 * A panel, top to bottom: the balloon in a white band (its tail reaching down into the
 * picture), the picture (with the sound effect, "WHOOSH!", and Tempo's music notes on it), and
 * the short picture-book line under it, when there is one. The words never hide the art. The AI
 * pictures have no words in them, so the words here are always the child's own.
 *
 * Balloons: speech (oval), thought (straight edges, cut corners, little circles), whisper (dashed), shout (spiky).
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

// The burst and the cloud follow the box around the words, like a letterer draws them. They are
// drawn at the balloon's real size (measured), so the spikes and bumps keep an even size.
/** A point on the edge of the box [x0, y0]–[x1, y1], `d` pixels along it, going round. */
function onBox(d: number, x0: number, y0: number, x1: number, y1: number): [number, number] {
  const w = x1 - x0;
  const h = y1 - y0;
  d = ((d % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
  if (d < w) return [x0 + d, y0];
  d -= w;
  if (d < h) return [x1, y0 + d];
  d -= h;
  if (d < w) return [x1 - d, y1];
  return [x0, y1 - (d - w)];
}

/** The burst's outline around a w × h box of words, `m` px outside it. */
function shoutPath(w: number, h: number, m: number): string {
  const round = 2 * (w + h);
  const n = Math.max(10, Math.round(round / 22));
  const pts: [number, number][] = [];
  // The same share of the way round on both boxes, so each spike points straight out.
  const at = (t: number, pad: number) => onBox(t * 2 * (w + h + 4 * pad), -pad, -pad, w + pad, h + pad);
  for (let k = 0; k < n; k += 1) {
    pts.push(at(k / n, m * 1.25), at((k + 0.5) / n, m * 0.3));
  }
  return `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
}

/** The thought balloon: straight edges with the corners cut off, around a w × h box of words. */
function cutCornerPath(w: number, h: number, m: number): string {
  const [x0, y0, x1, y1] = [-m, -m * 0.75, w + m, h + m * 0.75];
  const c = Math.min(m * 1.3, (y1 - y0) / 3); // the cut at each corner
  return `M${x0 + c},${y0}L${x1 - c},${y0}L${x1},${y0 + c}L${x1},${y1 - c}L${x1 - c},${y1}L${x0 + c},${y1}L${x0},${y1 - c}L${x0},${y0 + c}Z`;
}

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

function Balloon({ text, kind }: { text: string; kind: Exclude<ComicBubble, "none"> }) {
  const shaped = kind === "shout" || kind === "thought";
  const [ref, { w, h }] = useSize<HTMLParagraphElement>();
  const m = 9; // the outline's room outside the words, in px
  return (
    <div className="relative mx-auto w-fit max-w-[84%] -translate-x-[8%]">
      {shaped && w > 0 && (
        <svg aria-hidden className="absolute left-0 top-0 overflow-visible" width={w} height={h}>
          {kind === "shout" ? (
            <path d={shoutPath(w, h, m)} fill="#fff" stroke="#1D1B2E" strokeWidth="2" strokeLinejoin="miter" />
          ) : (
            <path d={cutCornerPath(w, h, m)} fill="#fff" stroke="#1D1B2E" strokeWidth="2" strokeLinejoin="miter" />
          )}
        </svg>
      )}
      <p
        ref={ref}
        className={cx(
          "relative text-center font-sans font-bold leading-[1.3] text-ink",
          // The burst and the cut-corner thought balloon are drawn just outside the words (shoutPath / cutCornerPath).
          kind === "shout" ? "px-[0.3em] font-extrabold" : shaped ? "px-[0.2em]" : "bg-white px-[1em] py-[0.45em]",
          kind === "speech" && "rounded-[50%/45%] border-2 border-ink",
          kind === "whisper" && "rounded-[50%/45%] border-2 border-dashed border-ink",
        )}
      >
        {text}
      </p>
      {/* The tail: a pointer down to the speaker; little circles for a thought. */}
      {kind === "thought" ? (
        <>
          <span aria-hidden className="absolute left-[54%] top-[calc(100%+0.7em)] z-10 h-[0.55em] w-[0.55em] rounded-full border-2 border-ink bg-white" />
          <span aria-hidden className="absolute left-[50%] top-[calc(100%+1.35em)] z-10 h-[0.35em] w-[0.35em] rounded-full border-2 border-ink bg-white" />
        </>
      ) : (
        <svg aria-hidden viewBox="0 0 20 24" className={cx("absolute left-[52%] z-10 h-[1.4em] w-[1.1em] overflow-visible", kind === "shout" ? "top-[calc(100%+0.45em)]" : "top-[calc(100%-2px)]")}>
          <path d="M1 0 L9 23 L19 0" fill="#fff" stroke="#1D1B2E" strokeWidth="2" strokeLinejoin="round" strokeDasharray={kind === "whisper" ? "3 2.5" : undefined} />
          <path d="M2.5 -1.2 L17.5 -1.2" stroke="#fff" strokeWidth="3.2" />
        </svg>
      )}
    </div>
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
      {talking && (
        // A cloud or a burst is drawn around the words, so it needs more room.
        <figcaption
          className={cx(
            "relative z-10 shrink-0 px-[0.6em] text-[0.72em]",
            cell.bubbleType === "thought" ? "pb-[1.35em] pt-[0.95em]" : cell.bubbleType === "shout" ? "pb-[1.25em] pt-[1.3em]" : "pb-[0.5em] pt-[0.55em]",
          )}
        >
          <Balloon text={cell.dialogue!} kind={cell.bubbleType as Exclude<ComicBubble, "none">} />
        </figcaption>
      )}
      <div className={cx("relative min-h-[45%] flex-1 overflow-hidden bg-tile", talking && "border-t-[2.5px] border-ink", narration && "border-b-[2.5px] border-ink")}>
        <div className="absolute inset-0">
          <CellPicture src={cell.imageUrl} heroType={heroType} label={`Comic picture ${cell.cell} on page ${cell.page}`} />
        </div>
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

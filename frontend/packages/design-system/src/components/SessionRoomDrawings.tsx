import { useId } from "react";

// The three drawings a Session Room holds (D51; board 2), each the studio as
// that kind of session uses it, drawn in the program's own line: the brand's
// objects are commissioned artwork and are not imitated. Each is an SVG group
// in the Room's 600 × 880 frame, its things standing on the floor (590 to
// 880) and against the back wall (90 to 510 across, 100 to 590 down), lit
// from the skylight. They hold no text.
//
// The inks are the Room's (SessionRoom.module.css): `data-ink` names what a
// thing takes, a fill and the line (`obj line`), the line `fine` or `heavy`;
// `data-light` marks the drawing's own lights, which come on with the Room's.

/** An id for `url(#…)`: React's own, kept to the characters every reader takes. */
function useSvgId() {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** An arc of a circle round (cx, cy), from one angle to another in degrees. */
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const at = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return `M${x1!.toFixed(1)} ${y1!.toFixed(1)} A${r} ${r} 0 0 1 ${x2!.toFixed(1)} ${y2!.toFixed(1)}`;
}

/** A camera on its tripod, its lens towards the Room's middle. */
function Tripod({ x, facing }: { x: number; facing: 1 | -1 }) {
  return (
    <>
      <ellipse data-ink="shadow" cx={x} cy={690} rx={34} ry={6} />
      <path
        data-ink="line"
        d={`M${x} 616 L${x} 632 M${x} 632 L${x - 22} 688 M${x} 632 L${x + 22} 688 M${x} 632 L${x} 688`}
      />
      <rect data-ink="obj line" x={x - 26} y={582} width={52} height={34} rx={6} />
      <rect data-ink="obj2 line" x={facing > 0 ? x + 26 : x - 42} y={589} width={16} height={20} rx={4} />
      <path data-ink="line fine" d={`M${x - 14} 582 V574 H${x + 6} V582`} />
    </>
  );
}

/** A person seen from the front: the shoulders down to `base`, and the head. */
function Person({ cx, cy, base }: { cx: number; cy: number; base: number }) {
  return (
    <>
      <path
        data-ink="obj line"
        d={`M${cx - 42} ${base} C${cx - 42} ${cy + 58} ${cx - 28} ${cy + 40} ${cx} ${cy + 38} C${cx + 28} ${cy + 40} ${cx + 42} ${cy + 58} ${cx + 42} ${base} Z`}
      />
      <circle data-ink="obj line" cx={cx} cy={cy} r={21} />
    </>
  );
}

/** A light's beam, brightest at the light and fading away from it. */
function Beam({ id, along, end }: { id: string; along: "right" | "left" | "down"; end: number }) {
  const [x1, y1, x2, y2] = along === "right" ? [0, 0, 1, 0] : along === "left" ? [1, 0, 0, 0] : [0, 0, 0, 1];
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" stopOpacity="0.32" data-stop="light" />
      <stop offset="1" stopOpacity={end} data-stop="light" />
    </linearGradient>
  );
}

/** Green Screen Recording: the presenter at the screen, two soft lights, CAM 1 with the prompter's hood. */
export function GreenScreenDrawing() {
  const id = useSvgId();
  const lights = [128, 472].map((x) => {
    const facing = x < 300 ? 1 : -1;
    return { x, beam: `${id}-beam-${facing > 0 ? "right" : "left"}`, X: (v: number) => x + v * facing };
  });
  return (
    <g data-drawing="green-screen">
      <defs>
        <Beam id={`${id}-beam-right`} along="right" end={0} />
        <Beam id={`${id}-beam-left`} along="left" end={0} />
      </defs>
      {/* Two soft lights at the back corners, their light on the screen. */}
      {lights.map(({ x, beam, X }) => (
        <g key={x}>
          <path data-light="" fill={`url(#${beam})`} d={`M${X(24)} 236 L${X(96)} 214 L${X(96)} 346 L${X(24)} 324 Z`} />
          <ellipse data-ink="shadow" cx={x} cy={612} rx={26} ry={5} />
          <path data-ink="line" d={`M${x} 608 L${x} 330 M${x} 596 L${X(-16)} 612 M${x} 596 L${X(16)} 612`} />
          <path data-ink="obj2 line" d={`M${X(-22)} 262 L${X(24)} 236 L${X(24)} 324 L${X(-22)} 300 Z`} />
          <path data-ink="line heavy" d={`M${X(24)} 238 L${X(24)} 322`} />
        </g>
      ))}
      {/* The screen on its bar, sweeping onto the floor. */}
      <path data-ink="line" d="M150 172 H450" />
      <path data-ink="accent line" d="M156 176 H444 V536 Q444 606 470 640 H130 Q156 606 156 536 Z" />
      <path data-ink="accent2" d="M156 536 Q156 606 130 640 H470 Q444 606 444 536 Z" opacity={0.9} />
      <path data-ink="line fine" d="M156 536 H444" opacity={0.45} />
      {/* The presenter: arms at the sides, a jacket, two legs. */}
      <ellipse data-ink="shadow" cx={300} cy={606} rx={58} ry={8} />
      <rect data-ink="obj line" x={275} y={476} width={21} height={126} rx={7} />
      <rect data-ink="obj line" x={304} y={476} width={21} height={126} rx={7} />
      <rect data-ink="obj line" x={248} y={402} width={16} height={96} rx={8} transform="rotate(6 256 402)" />
      <rect data-ink="obj line" x={336} y={402} width={16} height={96} rx={8} transform="rotate(-6 344 402)" />
      <path data-ink="obj line" d="M262 410 C262 398 270 391 284 390 H316 C330 391 338 398 338 410 L332 490 H268 Z" />
      <circle data-ink="obj line" cx={300} cy={358} r={23} />
      <path data-ink="line fine" d="M290 391 L300 408 L310 391 M300 408 V488" />
      {/* CAM 1 with the prompter's hood, seen from the side, facing the presenter. */}
      <ellipse data-ink="shadow" cx={176} cy={690} rx={44} ry={7} />
      <path data-ink="line" d="M176 622 L176 636 M176 636 L150 688 M176 636 L202 688 M176 636 L176 688" />
      <rect data-ink="obj line" x={144} y={590} width={58} height={32} rx={6} />
      <rect data-ink="obj2 line" x={202} y={597} width={12} height={18} rx={3} />
      <path data-ink="obj line" d="M214 584 L266 568 L266 640 L214 626 Z" />
      <path data-ink="line fine" d="M220 622 L260 574" />
      <path data-light="" data-ink="line fine" d="M226 606 H236 M230 597 H244 M236 588 H250" />
    </g>
  );
}

const VOICES = [
  [194, 420],
  [300, 404],
  [406, 420],
] as const;

/** Podcast Recording: three voices with headphones at a round table under a pendant, a camera each side. */
export function PodcastDrawing() {
  const id = useSvgId();
  return (
    <g data-drawing="podcast">
      <defs>
        <Beam id={`${id}-beam`} along="down" end={0.02} />
      </defs>
      {/* The pendant over the table, and its warm light. */}
      <path data-light="" fill={`url(#${id}-beam)`} d="M268 262 L332 262 L452 556 L148 556 Z" />
      <path data-ink="line fine" d="M300 0 V234" />
      <path data-ink="obj line" d="M262 264 Q264 236 300 232 Q336 236 338 264 Z" />
      <ellipse data-light="" data-ink="light" cx={300} cy={266} rx={30} ry={5} />
      {/* The voices, each in headphones. */}
      {VOICES.map(([cx, cy]) => (
        <g key={cx}>
          <Person cx={cx} cy={cy} base={560} />
          <path data-ink="line" d={`M${cx - 25} ${cy + 3} A25 25 0 0 1 ${cx + 25} ${cy + 3}`} />
          <rect data-ink="accent line fine" x={cx - 30} y={cy - 8} width={10} height={21} rx={4} />
          <rect data-ink="accent line fine" x={cx + 20} y={cy - 8} width={10} height={21} rx={4} />
        </g>
      ))}
      {/* The round table: the voices sit behind it. */}
      <ellipse data-ink="shadow" cx={300} cy={660} rx={120} ry={11} />
      <ellipse data-ink="obj line" cx={300} cy={556} rx={180} ry={23} />
      <path data-ink="line" d="M300 579 V650" />
      <ellipse data-ink="obj2 line" cx={300} cy={654} rx={56} ry={9} />
      {/* A microphone on its arm before each voice. */}
      {VOICES.map(([cx, cy]) => (
        <g key={cx}>
          <path data-ink="line fine" d={`M${cx + 28} ${cy + 64} L${cx + 52} ${cy + 92} L${cx + 52} 540`} />
          <rect
            data-ink="accent line"
            x={cx + 9}
            y={cy + 28}
            width={17}
            height={40}
            rx={8.5}
            transform={`rotate(-24 ${cx + 17.5} ${cy + 48})`}
          />
        </g>
      ))}
      <Tripod x={112} facing={1} />
      <Tripod x={488} facing={-1} />
    </g>
  );
}

// The screen of faces: three across and two down, 6 apart, inside the screen's frame.
const FACE_WIDTH = (212 - 12) / 3;
const FACE_HEIGHT = (132 - 6) / 2;
const FACES = [0, 1].flatMap((row) =>
  [0, 1, 2].map((column) => ({ x: 194 + column * (FACE_WIDTH + 6), y: 178 + row * (FACE_HEIGHT + 6) }))
);

/** Webinar: the presenter at a desk with a laptop and a microphone, a screen of faces with its signal, a camera. */
export function WebinarDrawing() {
  return (
    <g data-drawing="webinar">
      {/* The screen with the audience, and the signal over it. */}
      <rect data-light="" data-ink="light" x={170} y={156} width={260} height={178} rx={14} />
      <rect data-ink="accent2 line" x={184} y={168} width={232} height={152} rx={8} />
      {FACES.map(({ x, y }) => (
        <g key={`${x}-${y}`}>
          <rect data-ink="accent" x={x.toFixed(1)} y={y} width={FACE_WIDTH.toFixed(1)} height={FACE_HEIGHT} rx={4} />
          <circle data-ink="line fine" cx={(x + FACE_WIDTH / 2).toFixed(1)} cy={y + 24} r={9} />
          <path
            data-ink="line fine"
            d={`M${(x + 15).toFixed(1)} ${y + 57} Q${(x + FACE_WIDTH / 2).toFixed(1)} ${y + 35} ${(x + FACE_WIDTH - 15).toFixed(1)} ${y + 57}`}
          />
        </g>
      ))}
      <circle data-ink="dot" cx={300} cy={148} r={4} />
      {[12, 21, 30].map((r) => (
        <path key={r} data-light="" data-ink="line fine" d={arc(300, 148, r, 214, 326)} />
      ))}
      {/* The presenter at the desk, the laptop and a microphone. */}
      <Person cx={300} cy={426} base={534} />
      <path data-ink="accent2 line" d="M318 488 H384 L378 532 H324 Z" />
      <rect data-ink="accent line" x={230} y={494} width={15} height={28} rx={7.5} />
      <path data-ink="line fine" d="M237.5 522 V532" />
      <ellipse data-ink="shadow" cx={300} cy={644} rx={150} ry={10} />
      <rect data-ink="obj line" x={166} y={530} width={268} height={16} rx={4} />
      <rect data-ink="obj2 line" x={178} y={546} width={244} height={92} />
      <Tripod x={486} facing={-1} />
    </g>
  );
}

import type { PrompterAnchor } from "../generated/snapshots/PrompterAnchor";

// Which of two anchors a view draws (fix C, 2026-10-02). The hardware link
// numbers every anchor under the prompter's lock (`revision`): the number
// rises whenever the anchor says something new and stays while it does not,
// whoever asks. A view that holds an anchor therefore takes one with a higher
// number, keeps its own for an equal one (with its moment, so an unchanged
// read never moves the text), and drops a lower one, which came late from
// another thread. The numbers count within one run of the hardware link: a
// view forgets the anchor it holds when the link stops, and takes the first
// one after it whatever its number.

/** What a view does with an anchor that came: take it, keep its own, or drop the late one. */
export type AnchorOrder = "take" | "keep" | "drop";

export function anchorOrder(held: PrompterAnchor | null, next: PrompterAnchor): AnchorOrder {
  if (held === null) return "take";
  // An anchor without a number (an older hardware link, a hand-made one) is
  // taken, as every anchor was before there were numbers.
  if (!Number.isFinite(next.revision) || !Number.isFinite(held.revision)) return "take";
  if (next.revision > held.revision) return "take";
  if (next.revision === held.revision) return next.layoutKey === held.layoutKey ? "keep" : "take";
  return "drop";
}

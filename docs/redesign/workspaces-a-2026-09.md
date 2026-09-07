# Lighting, Planning and Setup in Concept A's language (2026-09-06)

Status: step 4 of the handoff continues. With A chosen for the Console (`console-concepts-2026-09.md`) and its states and material settled (`console-a-states-2026-09.md`), the other three workspaces are now drawn in the same language, each as a self-contained mock in three themes with its own blocked states: `docs/redesign/assets/concepts/A-lighting.html` (`?state=ready|unreachable|unsaved|preview`), `A-planning.html`, `A-setup.html` (`?state=ready|degraded|setup-required`). Every board renders from the fixtures' real values. No source, token or test was edited; nothing is committed.

Renders and numbers (outside git): `../gold-standard-evidence-2026-09/concepts/` — `A-lighting__…`, `A-lighting--<state>__…`, `A-planning__…`, `A-setup__…`, `A-setup--<state>__…` PNGs and JSON, `census.md`, `contrast.md`. The full evidence set is now 49 boards (four concepts, the Console in ten states, three workspaces in their states, three themes, the prior candidate); all 49 pass pixel-sampled contrast.

## 1. What "the same language" means: the cluster rule

The Console's stance was that the left column is the instrument's control cluster and its first element is the state. Applied to the other three workspaces it becomes one rule the operator's hand can learn once:

| Region              | Console                                                    | Lighting                                                       | Planning                                               | Setup / Support                                                |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Header (56)         | the shell: tabs, three subsystem lamps, latches, the clock | same                                                           | same                                                   | same — Setup is a workspace, not a second application          |
| State display (180) | `VERIFIED` … `ACTION FAILED`, sentence, way out            | `REACHABLE` / `UNREACHABLE` / `UNSAVED` / `PREVIEW`            | `ON TIME` / `SLIPPED` with the day's counts            | `READY` / `DEGRADED` / `SETUP REQUIRED`, the engine's sentence |
| Take-time keys      | talkback, dim, mono, mix target, main level, master meter  | `LIGHTING` on, `CUT ALL`, grand master, the scenes, the groups | the running timers, Timeline · Board, the day          | Runner · Support, the five steps                               |
| Lists               | snapshots                                                  | —                                                              | projects                                               | probes with their results                                      |
| Standing actions    | Sync, probe, clear clips                                   | Add fixture, Patch, Preview, DMX monitor                       | New task, Time report, Backup                          | Export backup, Engine log, back to the console                 |
| Bay (recessed)      | the thirteen strips                                        | the stage plot as a backlit screen                             | the timeline as a backlit screen, the unscheduled tray | the current step as a backlit screen, only as tall as it needs |
| Plate (416, right)  | the selected strip                                         | the selected fixture                                           | the selected task                                      | Support: workstation settings, backups, diagnostics, versions  |
| Footer (40)         | console link, metering, sync, bank                         | bridge, channels, fixtures, scene                              | day, scheduled, unscheduled, tracked                   | step, probes, commissioning, version                           |

The material tokens are copied verbatim from the Console mock (plates with a top sheen, a recessed bay, black backlit wells with an inset shade, machined keys, blooms only on lit states); the system pass turns them into one token file. One hue was added: **blue for information / offline editing** (Lighting's preview mode), the fourth and last role hue after amber (engaged), green (live / ok) and red (hazard).

## 2. Lighting

- **State display.** The bridge's two engine booleans as words: `REACHABLE` (green) with "Apollo bridge · 192.168.1.80 · universe 1 · 12 of 512 channels" and the scene line; `UNREACHABLE` (red) with the sentence the current program already prints and the review kept ("Lighting commands won't reach the rig until the bridge at 192.168.1.80 responds. Check the network connection or run the bridge probe in Setup.") and the key **Run bridge probe**; `UNSAVED` (amber) when the rig holds changes the current scene does not, with **Save · press twice** and **Discard changes…**, plus the cross-workspace latch `Scene unsaved` in the header; `PREVIEW` (blue) with "Editing offline. The rig is unchanged until you save or discard." and a blue keyline on the plot.
- **Take-time.** `LIGHTING` is a lit amber key (a toggle that is on), `CUT ALL` is the one red command on the surface, the grand master is a 44 px readout with a slider like the Console's main level, the two scenes are keys that recall on one press with the fade printed on them (recall is not arm-then-apply; saving over a scene is, so the Save key says "press twice"), the two groups are one slider each with the fixtures they hold printed under the name.
- **The plot.** 12 m × 8 m at 1:1 in the bay (1,688 × 1,125 px, 141 px per metre), a 1 m grid with 0.5 m minor lines, each fixture at its real position with its real rotation and beam angle, the beam filled in its colour temperature at its intensity (an off fixture shows a dashed outline), the camera and subject marks, the selected fixture keylined. Labels print name, intensity, colour temperature and DMX start.
- **Unreachable locks the rig.** Every key that would send to the rig becomes a dashed outline at 55 % (master, cut all, grand master, scene recall, group and fixture levels); the plot keeps the last confirmed state and says so; the shell lamp goes red. Names, patch, preview edits and the plot itself stay usable.
- **Plate.** Identify (a hold, 1.2 s), on/off, intensity and colour temperature (the track carries the warm-to-cool ramp, the one gradient that is information), position and patch as printed fields, and "In scene Warm wash" — what the saved scene holds for this fixture, so drift is visible before it becomes `UNSAVED`. "Delete fixture…" is a plain key at the bottom, not red at rest.

## 3. Planning

- **State display.** `ON TIME` with the day, the count of scheduled tasks and the window, then "0 slipped · 1 blocked · lighting · 2 timers running · 1 unscheduled". The word comes from the same slipped / blocked counts the current workspace computes; it is not an engine field, and it should become one if the engine ever owns planning health.
- **Take-time.** The running timers are live rows with a green lamp and a Stop key (in the plate the running task's own key is lit green: `RUNNING · 1h 18m · press to stop`). Timeline · Board is the same switch form as the Console's mix target; the day sits under it.
- **The timeline.** 09:00 – 22:00 across the bay, one lane per project, a card at each task's start with its duration drawn as a bar (green while running, red when blocked) so a 15-minute task stays readable; a card that would cover another in the lane drops to a second row; a card that would run past 22:00 hangs to the left of its start; the now marker at 09:11 is amber. The unscheduled tray is a dashed well under the screen. Filters and search live on the screen's header, not in the cluster.
- **Plate.** The selected task: schedule fields, priority, status, the checklist with a real tick, notes, and "Delete task…" at the bottom.

## 4. Setup / Support

- **State display.** `READY` with the engine's sentence "Commissioning complete and operator mode unlocked."; `DEGRADED` with "Operator mode is available, but lighting and control-surface support need attention." and **Run all probes**; `SETUP REQUIRED` with "Complete commissioning to unlock operator mode." and **Start with Import profile**. The three shell lamps mirror the probes (`Lighting · not commissioned`, `Audio · not commissioned`).
- **Cluster.** Runner · Support, then the five steps as keys (done = green lamp, current = keyline, pending = unlit) with the current program's own one-line descriptions, then the three probes with their result sentences ("Universe 1 responding.", "OSC sync healthy.", "Profile export current.") and a Run all key.
- **The step screen.** Step 5 prints what publish does (the current program's sentence, with "returns you to the console" in place of its developer phrasing), the two rules that matter, three fact cards (latest backup, startup target, support archives) and, beside them, what publish records. When probes are not green the primary key becomes **Publish with override…** in red and the note says an override will be recorded with a timestamp. The screen is only as tall as the step needs; the bay floor below it is the same recessed floor the Console's strips sit on, which answers the review's 23 % of empty monitor without inflating the content.
- **Support plate, always present.** Theme and UI scale (the theme switch's one home, as the review asked), backups with export and restore, diagnostics export and the engine log, sample data (asks first), versions and the hardware profile. "Restart the bridge…" is the one red command on this surface, at the bottom of the plate.
- **Step 1** renders for `setup-required`: the Companion export with its server base URL and export target printed as "not set" (the fixture leaves them empty; nothing was invented), a "before you start" list, and Export profile / Continue.

## 5. Measured

2560×1440, 1:1; Studio numbers, identical in Graphite and Bone unless noted; pixel-sampled contrast; locked controls at 55 % exempt (so the unreachable board measures 132 nodes). Blooms are the box-shadows with blur over 8 px, all on lit lamps or engaged keys.

| Board                     | Text nodes | Sizes / floor | Uppercase | Contrast fails S / G / B | Targets (all ≥ 24 px; take-time ≥ 28 px) | Shadows · negative offsets · blooms | Gradients | Idle motion |
| ------------------------- | ---------: | ------------- | --------: | ------------------------ | ---------------------------------------- | ----------------------------------- | --------: | ----------: |
| Lighting ready            |        143 | 8 / 12 px     |       8 % | 0 / 0 / 0                | 32 · yes                                 | 50 · 0 · 9                          |        31 |           0 |
| Lighting unreachable      |  145 (132) | 8 / 12 px     |       8 % | 0                        | 33 · yes                                 | 39 · 0 · 7                          |        20 |           0 |
| Lighting unsaved          |        147 | 8 / 12 px     |       7 % | 0                        | 35 · yes                                 | 53 · 0 · 11                         |        33 |           0 |
| Lighting preview          |        145 | 8 / 12 px     |       8 % | 0                        | 34 · yes                                 | 52 · 0 · 9                          |        33 |           0 |
| Planning ready            |        169 | 6 / 12 px     |       9 % | 0 / 0 / 0                | 35 · yes                                 | 49 · 0 · 12                         |        27 |           0 |
| Setup ready               |        150 | 8 / 12 px     |      14 % | 0 / 0 / 0                | 35 · yes                                 | 58 · 0 · 28                         |        27 |           0 |
| Setup degraded            |        151 | 8 / 12 px     |      14 % | 0                        | 36 · yes                                 | 59 · 0 · 28                         |        28 |           0 |
| Setup required            |        143 | 8 / 12 px     |      15 % | 0                        | 36 · yes                                 | 43 · 0 · 12                         |        28 |           0 |
| Console ready (for scale) |        376 | 8 / 12 px     |       5 % | 0 / 0 / 0                | 96 · yes                                 | 141 · 0 · 10                        |       121 |           0 |

Setup's 28 blooms are its many lit lamps (five done steps, three probes, six record rows, three cards); the count is honest and worth watching in the system pass, where a "lit list lamp" may deserve a smaller bloom than a state lamp.

The first pass of these three failed on eleven text nodes across the light theme and the primary keys, all with causes already on the list: edge labels drawn past their screen ("12 m", "22:00"), a `kbd` inheriting the muted ink on a white primary key, dark inks inside black wells in Bone, and a tick glyph printed in dark green on dark green. Each is now a rule in the mocks (the last axis label anchors inward; a primary key's `kbd` takes the key's ink; wells and lit fills carry their own inks).

## 6. Decisions to take with this

- **`ON TIME` is derived, not reported.** Planning's state word comes from counts the workspace computes; the other three state words are engine fields. Either the engine owns a planning status or the display's word is labelled as the app's own reading.
- **Blue is the fourth hue** (information, offline editing). It appears only for `PREVIEW`; the deck has no blue and never needs one.
- **Scene recall is one press; saving over a scene is two.** The brief lists scene overwrite, not scene recall, as arm-then-apply, and a recall has a fade the operator can see. If a wrong recall during a take is judged as costly as a wrong snapshot, recall becomes arm-then-apply here too, as it is on the Console.
- **Setup's step screen is content-height by design**, leaving the bay floor visible; if the operator prefers a full-height screen, the step's lower half should carry something real (the deck echo grid in step 4, the bindings table in step 3), not padding.

## 7. Next

`1920×1080` for all four (strips banked 4 / 4 / 3 beside a narrower cluster; the plot, the timeline and the step screen at 1920 widths), `1280×800` (the cluster as a key rail, the plate as a drawer, Setup in full), the three themes as one token set, the system sheet (type scale, colour roles, elevation and material, motion, component sheet, copy rules) and the revised sliced plan. Still no source edits until the plan is approved.

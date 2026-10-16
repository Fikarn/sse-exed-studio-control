# The Session page: the start of every session

Written 2026-10-15. This note goes with board 2, `docs/design/boards/session-2.html`. Board 1, `session-1.html`, stays beside it for comparison.

The owner asked for a new start page, the first page the operator sees in every session. On it the operator chooses what this session records or streams: **Green Screen Recording**, **Podcast Recording** or **Webinar**. Choosing one shows more options, such as presets and the folders a session needs. Those options are defined later.

On board 1 the owner's word was: clearer and more concise, too much information on the page. Present the three choices, and let a window appear with the options of the one chosen. This is the operator's first interaction with the program, so it has to set the tone. Board 2 is that page.

**To see it:** open `http://127.0.0.1:4190/session-2.html` from the browser pane's `design-boards` entry. The corner panel switches:

- **Moment:** Choose, Window, In session, or the running session's window ("Its window");
- **Kind:** the three kinds;
- **Window:** **Step 1** (what step 1 builds) or **Later steps** (examples of what later steps could add, nothing decided);
- **Notes** (11 numbered pins), and **Replay the start**.

Everything on the board works: the Rooms, the name field, Use this name, Sync from TotalMix, Begin, Cancel, Esc, a press on the dimmed page, Continue and End session.

## 1. The idea

One question, three Rooms, one window.

- **The Room is the brand's own device** (Brand Guidelines p.41): a one-point-perspective space, every horizontal line level, a few planes in one hue, here with a skylight in the ceiling. The brand's "A space for…" posters are exactly this: a portrait Room with one subject in it and a line of Adelia. Three Rooms say "three ways to use the studio" without a word of explanation.
- **Each Room holds the studio as that session uses it,** drawn in the program's own line. The brand's objects are commissioned artwork, and the brand reference asks that they not be imitated, so the drawings do not try to look like them.
- **The tones are the Overview's rooms' tones, made richer:** green for the picture (Dark Green), umber for the sound (Brown), slate for the screen (Sky and Blue). They are identity, never status.
- **Nothing else stands on the page.** No status card and no lists. The header's lamps carry the studio's state here as on every page, and the window says what needs the operator before a session begins.

## 2. The page, part by part

| Part            | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header          | The skylight (D48). A `Session` tab is first on the pages' platter, the open page's Dark Green segment here, with no lamp.                                                                                                                                                                                                                                                                                                                        |
| The question    | The date in SSE Adelia 18, tracked, in the quiet ink; **What are we making today?** in Adelia 40. Centred, with nothing under it.                                                                                                                                                                                                                                                                                                                 |
| Three Rooms     | Three keys, 600 × 880 each, 56 apart, centred. The whole Room is the key. Its name (Adelia 28, tracked `0.08em`) and one line (PT Serif italic 20) stand on its floor, as the brand's posters set theirs.                                                                                                                                                                                                                                         |
| The Room's look | Back wall, ceiling, a lit and a shaded side wall and the floor, in the brand's shading. The brand's Grain and Watercolour textures are drawn by SVG filters, so no image file ships. A skylight in the ceiling lights the back wall.                                                                                                                                                                                                              |
| The light       | Under the pointer, a Room's skylight brightens and the drawing's own lights come on: the soft lights on the green screen, the pendant over the table, the screen of faces. Only colour changes; nothing moves. The Room of a running session stays lit.                                                                                                                                                                                           |
| In session      | A platter under the question: `● IN SESSION   Podcast Recording · Leading Through Change — episode 3 · since 09:16   [Continue]`. The running Room's line reads `● IN SESSION · since 09:16`.                                                                                                                                                                                                                                                     |
| The window      | A floating layer (radius 12, the one soft shadow) over a dimmed page; the header stays live above it. The Room stands on its left; the options are on its right. Step 1 is 1200 × 620; the later steps' window is 1680 × 960.                                                                                                                                                                                                                     |
| Step 1's form   | `NEW SESSION · Thursday 15 October`. **Name this session**: a 64 px field, optional, up to 80 characters. **Last time**, with the date and name of the last session of this kind, and `Use this name` for a series. Then only what needs the operator, if anything: the worst page's word and way out (here `ASSUMED` and `Sync from TotalMix`), or the running session Begin would end. Last, `Cancel` and `Begin session` (opens the Overview). |
| Its window      | Opened from the running Room: `IN SESSION since 09:16 today`, the name, when it began and its takes. `End session` on the left; `Close` and `Continue` (on the Overview) on the right.                                                                                                                                                                                                                                                            |
| Footer          | The day so far, as on every page.                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 3. Motion

- **The start.** The Rooms come in once after a start of the app: an 8 px rise and a fade each, 70 ms apart, about half a second in all.
- **Opening.** The window opens from its Room. The window's face grows from the Room's outline to its own, while the Room's picture travels into the window's left side at the same proportions. The options fade in beside it (340 ms, the program's ease).
- **Closing.** Closing runs it back (260 ms). Cancel, Esc, a press on the dimmed page, Begin and End session all close it this way.
- **Hover** changes colour only.
- **Reduced motion:** with `prefers-reduced-motion` the window and the page only fade.

DESIGN.md §6 would gain these lines (the Rooms' entrance, a Room's window), and §9 the window as a floating layer of its own.

## 4. What a session is

- A session begins at **Begin**. It ends at **End session**, or when another session begins. No clock ends it.
  - The studio's app runs for days without a restart, so a rule such as "at midnight" would mean the page moving by itself.
  - A session from an earlier day shows its day: "since Wed 14:02".
- Choosing a Room changes nothing. Begin is the one press that acts. In step 1 it changes nothing in the studio either: it notes the session and opens the Overview.
- The hardware link keeps the session, not the pages:
  - the running session is one setting, `session.current`;
  - the last session of each kind is another, `session.last`, and the window's "Last time" comes from it, not from the log: the log keeps its newest 5,000 rows, which would lose a kind unused for months (the build plan of 2026-10-15);
  - each begin and end is a row in the action log, the record;
  - both settings stand outside the backup archive's restore, so a restore brings no old session back;
  - no schema changes.
- The deck stays where it is while the Session page is open, as on Setup. Begin opens the Overview, which turns the deck to PROMPTER (D49). So there is no new Companion profile and no re-import.

## 5. Questions for the owner

**The owner's answer (2026-10-15): every recommendation is taken.** That means the `Session` tab first, the landing at every start, no gate, and drawings in step 1. The questions stay below as the record.

1. **The way to the page.**
   - **Recommended:** a `Session` tab, first on the pages' platter. Measured on 2026-10-15 in the app's fullest header (every page's longest word and every chip): there are 110 px to spare today. The tab is 77 px wide, which leaves 31 px; the shell's test asks for 16.
   - **Otherwise:** a `Start` tab (59 px), or no tab, with the page reached only at a start and from the Overview's ⋯.
2. **The landing.**
   - **Recommended:** the app opens on the Session page at every start, unless the setup is not published. A running session shows its platter with `Continue`. This amends D1 and D47: the Overview stays the page that Begin, Continue and every return key open.
   - **Otherwise:** the Session page only when no session runs.
3. **A session first?**
   - **Recommended:** no. Every page stays open without a session. A control the operator needs must never wait behind a choice.
   - **Otherwise:** the pages stay locked until a session begins.
4. **Drawings or photos in the Rooms?** The brand lets one photo hang on a Room's back wall.
   - **Recommended:** the drawings in step 1. They ship with it and never go out of date.
   - **Later, if you want it:** a photo of each real setup on its Room's back wall, three photos in all.

## 6. Decided without asking

- **Gone from the page:** board 1's status card, studio list, recent sessions and plate (the owner's "too much information"). The last session of a kind moved into its window, where it helps name a series.
- **An exception to the frame:** the Session page is the one page without the frame's cluster and plate, and without a state display. DESIGN.md §2 and the measure "the state display at the same place on every page" name it as the exception.
- **The window's keys:** `Cancel` and `Begin` at the bottom right, the primary at the right; Esc and a press on the dimmed page close it.
- **Enter does not begin.** Enter in the name field does nothing, because in later steps Begin will press the rig and the desk.
- **Names:** the kinds keep the owner's names. The board uses made-up session names, because the repository is public.
- **Colours:** the Rooms' colours are tokens of their own, the Overview's tones made richer.

## 7. Step 1: the plan

Three pull requests (the build plan of 2026-10-15; this section said two until then, as for the Overview).

**PR 1: the hardware link keeps the session** (#351). One independent review, because it writes saved data.

- `session.snapshot` returns `{ current, last }`: the running session, and the last session of each kind, newest first;
- `session.begin { kind, name }` ends a running session first; `session.end` ends the running one;
- `session.changed` is the event, with the refusals `SESSION_KIND_UNKNOWN`, `SESSION_NAME_TOO_LONG` and `SESSION_NOT_RUNNING`;
- the running session is the setting `session.current`, the last of each kind `session.last`, and each begin and end is an action-log row (domain `session`);
- `WORKSPACES` gains `session`;
- the test double and the store get the same requests;
- the engine's tests and the contract test.

**PR 2: the design system's parts** (#352). No review.

- **Tokens:** `--session-<tone>-*` for the planes, the line, the objects, the accents and the light; the window's 340 and 260 ms; the Room's hover edge; the scrim.
- **A Room:** `SessionRoom`, its planes, the textures as SVG filters and the skylight, with the three drawings as React SVG.
- **The window:** a new floating layer in the design system, a `Sheet`.
  - It is a modal form over a dimmed page that keeps the header live.
  - Focus moves into it; Esc and the dimmed page close it; focus returns to its Room.
  - The opening and closing are Web Animations, with the reduced-motion fade.
- **Storybook:** the boards "Session" and "Session window, open".

**PR 3: the page** (#TBD). No review.

- **The shell:**
  - `session` joins `WorkspaceId`, `workspaceChunks`, `WORKSPACE_IDS` and `deriveWorkspace`;
  - the `Session` tab goes first, locked with the others until the setup is published;
  - the landing page becomes `session` (D47's one-time write kept).
- **The page** (`frontend/app/src/app/session/`): the question, three `SessionRoom`s, the running session's platter, and the window's two forms.
- **The measures:** the Session page's exception (the header and the footer, no cluster, plate or state display). The Rooms are not marked as pictures: their names and lines are the page's words, and are measured.
- **Test data:** the fixtures `session-choose`, `session-window`, `session-running` and `session-running-window`; captures of the page, a window, the running session and its window; the header's sixth tab moves the ten header strips (the page captures mask the header).
- **Page tests:**
  - a start lands on Session, and a Room opens its window;
  - Begin sends `session.begin` and opens the Overview;
  - `Use this name`, and the worst page's note with its way out;
  - Esc, Cancel and the dimmed page close the window;
  - the platter's Continue, another Room's window while a session runs, and End session;
  - the tab is locked before the setup is published, and the fullest header still has 16 px to spare;
  - reduced motion.
- **Docs:** DESIGN.md (the page, the Room, the window, the motion), OPERATIONS.md, CHECKLIST.md, ROADMAP.md (with D51) and CHANGELOG.md. Both boards and this note are committed with it.

Then, on the owner's word: `npm run release`, the walk with the Session lines, and `release:verified`. There is no deck export and no re-import.

**Not in step 1:** presets, folders, checks, a session's takes, and photos in the Rooms.

## 8. The later steps (examples only)

The board's **Later steps** window shows one way the same window could fill. Each step gets its own board pass and its own questions when it starts.

- **Name:** it now names the session and its folder.
- **Preset:** a few for each kind, each saying what it sets up: the rig's scene, a TotalMix snapshot, the cameras, the prompter's script, perhaps vMix's preset. Begin presses them in order and stops at the first that fails, saying which. This is device I/O, with a review.
- **Folder:** `<name> (YYYY-MM-DD)`, as the studio's project folders are named today, with the kind's subfolders, made at Begin by the hardware link on a root the owner names.
- **Before you roll:** the checks the hardware link can make, and a Tick for what it cannot see.
- **When it begins:** one line saying everything Begin will do, above the keys.

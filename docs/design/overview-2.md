# The Overview: board 2

Written 2026-10-09. The owner asked for an Overview page. It is the program's landing page, and during a take it shows the key facts of every page at once. The owner's example: during a take they turn the speed knob on the deck while watching the camera's picture and the audio levels. This note goes with the board `docs/design/boards/overview-2.html`. Nothing here is built yet. Where the board and this note differ, the board wins.

The same day the owner found the first drawing cluttered: there was nothing to guide the eye. This version groups the page into four **rooms**, an idea taken from the SSE brand reference. The flat version stays beside it, as `overview-2-flat.html`, for comparison.

After that the owner asked for a new **header**: the logo at the left, and a header that no longer blends into the page. A Dark Green band came first. The owner liked the direction but not the band, and asked for Apple's design philosophy to be combined with the SSE brand. Section 2 describes the result, the **skylight**. The header belongs to the shell, so it would change on every page. The board shows five headers (`?header=today|skylight|facade|panel|doors`, or the corner panel's `Header` row). The skylight is the default.

**To see it:** open `http://127.0.0.1:4190/overview-2.html` from the browser pane's `design-boards` entry. The board is live. The meters move, the script scrolls at its speed, and the take and the clock count. To turn the SPEED dial, use the mouse wheel over the speed instrument, or the arrow keys ↑ ↓; Space plays and pauses. The corner panel switches between the three moments, shows the numbered notes and opens a drawn Stream Deck+ with the PROMPTER page. Its dials and keys work.

| Address             | Shows                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?state=take`       | The owner's example: CAM 1 records, the script plays at 140, every link answers. The deck's dial has just been turned.                              |
| `?state=landing`    | 09:14, the first look of the day. Nothing records, the script waits at ¶ 1, and the Console reads ASSUMED. Press `Sync from TotalMix` on the board. |
| `?state=fault`      | Mid-take, CAM 1 stops answering while a clip is held on SM7B 1.                                                                                     |
| `&notes=1`          | The numbered notes of section 6, as pins.                                                                                                           |
| `&ui=0`, `&still=1` | No corner panel, and a still frame (for captures).                                                                                                  |

## 1. The idea: four rooms, four jobs

During a take the operator does four things: **act, watch, read and listen**. Each job gets one room, and each room is visibly its own place:

| Room            | Job    | Tone  | Holds                                                                                                       |
| --------------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------- |
| **THE TAKE**    | act    | stone | Everything pressed during a take: REC and the take's facts, then the prompter's transport                   |
| **THE PICTURE** | watch  | green | CAM 1, as it is recorded; CAM 2, CAM 3 and CAM 1's loupe                                                    |
| **THE SCRIPT**  | read   | slate | The speed, the glass where the presenter's eyes are, what comes next; the whole script laid along the floor |
| **THE SOUND**   | listen | umber | Main Out, then the inputs on one meter bridge                                                               |

The state display and the latches stand outside the rooms, at the top left as on every page: they speak for all four. A quiet list of what each page has set sits outside the rooms too, under THE TAKE, so it never competes with them.

**From the brand.** A Room is SSE's graphic signature (Brand Guidelines, p.35–42). It is a space seen from the front: a back wall, and four planes whose seams run to the corners, with horizontal lines kept parallel to the format. Each room here is drawn that way, flat and matte:

- the **back wall** is where everything sits;
- the **lintel**, the top plane, is deep. It carries the room's name in SSE Adelia, spaced like a carved inscription, with its job in PT Serif italic (`THE SCRIPT read`), what it holds right now, and its **door** (`Teleprompter →`);
- the **side planes** and the **floor** are a step darker, and carry the brand's faint grain. The walls stay smooth, because the brand says no texture behind small text.
- **THE SCRIPT's floor** is deep and carries the whole-script bar. **THE SOUND's floor** carries Phones 1 and 2.

**The tones.** Each room takes the dark member of one brand colour pair, pulled down to the page's depth: Beige for the take (stone), Dark Green for the picture, Sky and Blue for the script (slate), and Brown and Yellow for the sound (umber). The bright member of each pair already lives inside its room: green lamps, blue cues, yellow mutes. The tones are identity, not status, like the colour tags on Lighting. They are dark enough that a lamp, a lit key or a meter always stands out. Keys and hairlines inside a room take the room's tone, one and two steps up from its wall.

**The handrails, in one list:**

- **Common region:** a room per job, with the page's floor showing between rooms.
- **Names:** a carved name on every room, so the eye can be told where to go.
- **Colour:** a tone per room, so the eye knows where it is without reading.
- **Doors:** a way to the room's own page, where the eye already is.
- **The trouble shows on the room:** a page in trouble lights its own room. The state display names the page, and that page's room takes the same keyline: coral for an error, yellow for attention. In the fault moment THE PICTURE is outlined in coral. In the landing moment THE SOUND is outlined in yellow until TotalMix is read.

The landing page and the take are the same page at two moments. When a take starts, nothing moves. Lamps light, the PLAY key fills green, and the meters wake. This is the system's first rule (DESIGN.md §1): controls used during a take never move.

## 2. The header: a skylight

**The problem.** The header as built is drawn on the page's own surface, with a 1 px line under it. Once the rooms stood out, it sank back into the page. A first answer, a Dark Green band with the states in black windows, solved the visibility, but the owner found it heavy: a large flat block of colour at the top that competed with the pictures.

**What Apple's design teaches here.** These points come from Apple's design system as presented at WWDC 2025 (Liquid Glass) and refined for macOS 27, announced on 9 June 2026:

- **Controls are their own layer above the content, and the content leads.** Apple asks for custom backgrounds and borders to be removed from bars: "hierarchy should come from layout and grouping, not decoration."
- **Group by function and frequency.** Items in a group share one background, a platter; different kinds of control get platters of their own.
- **Concentric shapes.** A shape nested in another keeps its curve: the inner radius is the outer radius minus the padding between them.
- **Tint only for focus.** Colour marks the one thing to look at, such as the selected item or a prominent state. It does not fill a bar.
- **Depth in the dark appearance comes from lighter, raised surfaces, not shadows.** The heavy shadows of macOS 26's toolbars were the most criticised part of that design. macOS 27 answered with "uniform toolbars", clear dividers between toolbar and content, and "improved contrast".
- **Bolder type**, for legibility.

**The skylight: those rules, with the SSE brand.** The bar is the atrium's glass roof: light, quiet, and part of the building:

- **The bar** is a quiet raised surface, a step lighter than the page, closed by a crisp one-pixel divider. Nothing on it is decoration.
- **The logotype** stands on the bar in the top-left corner, where the brand puts the horizontal logotype. It is 40 px high with its 20 px clear space, then a thin rule.
- **The studio's pages share one platter:** `Overview` first, then Lighting, Audio, Cameras and Teleprompter, each with its lamp and state word. The names are now bold.
- **The system's own things share a second platter** at the right: `Setup / Support`, the deck, the backup and the latches.
- **REC has a platter of its own.** While CAM 1 records it takes the coral edge and a faint coral tint: Apple's "prominent" state, kept within DESIGN.md's rule that a hazard is a coral edge and word, never a coral fill.
- **The clock** stands on the bar.
- **The brand's colour is the focus.** The open page is the one Dark Green segment, the same Dark Green the system already uses for the selected object's title plate. The Dark Green has moved from the whole band to the one thing it marks.
- **Concentric shapes:** a platter of 12, segments of 8, 4 px between them. Both radii are DESIGN.md's own.
- **Elevation:** a lighter tone and a one-pixel light top edge, with no shadow.
- **Every state word keeps its contrast.** On the platter, coral stands at 5.7:1.
- **The footer takes the same surface**, so the page is held between two matching bars.

**The product's name moves to the footer.** "STUDIO CONTROL" set next to the logotype would read as a new lockup, and the brand asks for none. The name now ends the footer, as a quiet colophon at the right. Moving the logotype off the right end frees about 150 px, so the Overview gets a tab of its own, and the name no longer has to double as one.

**Measured on the board.** With every word at its longest and every chip lit at once, the fullest row still has **113 px to spare**. The header as built has 2 px to spare, and overflows once an Overview tab is added.

**The other directions**, kept on the board for comparison:

- **Façade:** the Dark Green band, with every state in a black window. It is the most visible, but heavy.
- **Panel:** a black band closed by a 4 px Dark Green rule. It is quiet, but too close to the page.
- **Doors:** a Dark Green tile for the logotype, and each page's tab filled with its room's tone. It is the busiest, and it would give every page a colour of its own.

Sources on Apple's design:

- [Get to know the new design system (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/356/)
- [Build an AppKit app with the new design (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Liquid Glass: hierarchy, harmony and consistency](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/)
- [macOS 27 Golden Gate, 9to5Mac](https://9to5mac.com/2026/06/09/macos-27-golden-gate-includes-these-changes-that-tahoe-critics-will-appreciate/)
- [Golden Gate sidebars and toolbars, Michael Tsai](https://mjtsai.com/blog/2026/06/09/golden-gate-sidebars-and-toolbars/)
- [Tahoe toolbars, Benjamin Mayo](https://bzamayo.com/tahoe-toolbars)

## 3. The owner's example: the speed knob

The speed has an instrument of its own, in THE SCRIPT, beside the glass copy:

- **A tape with one tick per detent.** The deck's SPEED dial moves 5 words/min per detent (40–300). The tape draws one tick per detent and slides one tick per click of the knob, so the screen moves in step with the hand. The value stands in the pointer at the display size, the one number on this page read from a metre away.
- **It shows that the deck turned it.** A speed change the page did not send itself came from the deck. For a moment the pointer takes the selection keyline and says "turned on the deck".
- **The range of this take.** A short bar beside the labels marks the range of speeds used in this take, and the line under the pointer says it in words ("this take 140 to 150").
- **The dials, as they sit on the deck.** At the foot, the deck's four dials are drawn left to right with SPEED lit, so the hand knows which knob it is on.
- **What the speed changes, beside it.** At the right of the glass: the place, the time left with its end time (`ends 10:44`), and **every cue ahead with the time until it** at this speed (`0:10 turn to the guest`). Turn the knob and these numbers follow.

## 4. Room by room

The frame is the shell's: header 88 · cluster 440 | bay 1680 | plate 440 · footer 40. On this page, the rooms take the place of the shell's column hairlines and of the plate's Dark Green title plate. Every component inside the rooms is the design system's, except the speed tape, which is new.

| Where                      | What it holds                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header                     | The skylight (section 2): the logotype at the left, the pages' platter with `Overview` first and in Dark Green while it is open, the system's platter, REC and the clock.                                                                                                                                                      |
| Cluster, outside the rooms | The state display (section 7) and the latch slot with every page's latches, where every page has them. Under THE TAKE, **the studio**: one line each for the lighting, the Console, the Prompter XL, the pictures and the deck.                                                                                                |
| THE TAKE                   | CAM 1's **REC** and the take's rows (length, timecode, card time left, battery), then **PLAY, BACK, TOP, − 5, + 5, ◂ Cue, Cue ▸** in the Teleprompter page's order.                                                                                                                                                            |
| THE PICTURE                | CAM 1 at 1236 × 695 on the back wall. Beside it, CAM 2, CAM 3 and **CAM 1's loupe at 2:1**, each at 340 × 191, so focus can be judged without leaving the page. These are the pictures helper's four pictures, its limit. Guides and Zebras are the helper's own aids, in the lintel. The dashed box is the loupe's point.     |
| THE SCRIPT                 | The speed instrument, **the glass copy** (the glass's own component at 55 %, cropped to its text column, the reading line at the glass's own 35 %, the text already read dimmed as on the glass), the place, the time left and the cues ahead. The whole-script bar is on the floor and is read only here.                     |
| THE SOUND                  | **Main Out** first: its level, M and stereo meter, flat as on the Console's outputs block. Then **the inputs TotalMix shows** as one meter bridge on the Console's own scale (−60 to 0, the −18 line, a 2 px peak tick), each with its name, its level and M. A held clip outlines its meter. Phones 1 and 2 are on the floor. |
| Footer                     | Takes today, with the minutes recorded (counted from the action log's CAM 1 start and stop rows), the start time, the last sync and the backup. At the right, the product's name as a colophon.                                                                                                                                |

## 5. What stays as it was in the flat version

The data, the keys and their order, the three moments, the speed instrument, the glass, the cue times, the gated meters and the questions are unchanged. Three things changed:

- **The CAM 1 caption moved into the lintel.** CAM 1 is a little smaller (1236 × 695, against 1274 × 717).
- **The captions say less.** The small pictures show only their camera and state word. The script's file and word count, and the inputs' "input meters", are gone from this page; the Teleprompter and Console pages still show them.
- **The studio list has one line a row**, without its second line of facts.

## 6. The notes on the board

1. **The header is a skylight** (section 2): one quiet raised bar, the pages and the system on their own platters, the open page the one Dark Green segment. The fullest row has 113 px to spare.
2. **The studio's state is the worst page's.** It shows that page's own word, its sentence with the page named first, and that page's own way-out key, so a fix is one press here too (landing: `Sync from TotalMix`; fault: `Open Cameras`). It reads READY when every link answers. The room whose page it names takes the same keyline.
3. **Every page's latches go in the one latch slot:** solo, a clip, a scene drift, a highlight, each with its clear key. The header leaves them off on this page.
4. **THE TAKE, act.** Everything pressed during a take is in one room. REC is the Cameras page's key, with the same forms (recording, armed, last known, locked). The prompter's transport is in the Teleprompter page's order, and the deck has the same keys.
5. **Outside the rooms**, what each page has set takes one quiet line each.
6. **Four rooms, four jobs**, as section 1 describes.
7. **The helper's four pictures are all used.** Since the Cameras page and the Overview are never on screen together, the four never clash.
8. **THE SCRIPT, read:** the speed (section 3), the glass, and what comes next.
9. **The glass is cropped to its column.** It is the same component that draws the Prompter XL, so its line breaks are the glass's own.
10. **The whole script lies on the floor.** It is the Teleprompter page's bar, read only here, so no press on the Overview jumps the script.
11. **THE SOUND, listen.** The strips TotalMix hides (D45) are left out. While the Console is not sure of the desk, the meters are **gated, as on the Console**. They stay still and say "The meters wait for a Sync from TotalMix.", and the levels carry the doubt keyline.
12. **Doors.** Each room's lintel ends in a door to its own page. The tabs do the same; the door is where the eye already is.
13. **Quiet telemetry.** The footer holds the day so far.

## 7. The three moments

- **Take.** READY: "Every link answers. Nothing on any page needs you." The REC tally is lit and PLAY is lit. The speed pointer shows the deck's turn.
- **Landing.** The Console's ASSUMED is the worst state, so the display carries it, with the Console's own way out, and **THE SOUND is outlined in yellow**. The meters are gated and the Console's line shows doubt. One press on `Sync from TotalMix` makes the page READY, takes the outline away and wakes the meters (try it on the board).
- **Fault.** CAM 1 does not answer, so the display shows the error keyline, UNREACHABLE and `Open Cameras`, and **THE PICTURE is outlined in coral**. REC turns to last known, with dashed yellow on the take's values. The picture keeps coming, because it travels through vMix and not over Bluetooth, and the lintel says so. A clip on SM7B 1 is held in the latch slot.

## 8. Questions for the owner

1. **The header, on every page.**
   - **Recommended:** the skylight (section 2): the logotype at the left, an `Overview` tab first, the pages and the system on their own platters, the open page in Dark Green, and the product's name in the footer.
   - **Otherwise:**
     - the façade, the panel or the doors (all on the board);
     - the header as built, with the product's name doubling as the Overview's tab. It fits by 2 px, and only without a sixth tab.
2. **Where the app opens.**
   - **Recommended:** on the Overview at every start. D1 changes: the page last used is no longer where the app opens.
   - **Otherwise:** on the page last used, with the Overview only on new saved data.
3. **The deck while the Overview is open.**
   - **Recommended:** the deck turns to PROMPTER, where the SPEED dial is. This needs one new trigger in the Companion profile, so the next export and a Full Reset & Import.
   - **Otherwise:** the deck stays where it was, as it does on Setup.

A fourth, if the rooms are liked: whether they stay on the Overview, or later reach the other pages. They would suit the Console's and Lighting's crowded clusters too. That is a change to the whole system, for another day.

## 9. Decided without asking

- **The rooms are this page's alone.** No other page changes, and DESIGN.md's rules are kept inside the rooms.
- **The state display stays outside the rooms**, as the page's anchor at the place every page has it.
- **The state display mirrors the worst page.** It adds no words of its own, and the trouble lights the matching room.
- **REC and the prompter's keys keep the order of their own pages**, and both sit in THE TAKE.
- **Four pictures, with CAM 1's loupe.** The alternative, CAM 1 alone at 1680 × 945, left no room for the glass.
- **The glass is a crop of its own copy**, not a second layout.
- **The speed is drawn as a tape**, one tick per detent.
- **Cue times are shown.**
- **The sound gets the right-hand column.** Main Out is shown flat, as on the Console, and the inputs as one bridge.
- **No Recent list.** The action log does not keep the prompter's speed, play or jumps, so during a take it would show nothing of what happens. It stays on Cameras and in Support.
- **The whole-script bar is read only here.**
- **The footer counts the day's takes.**

## 10. How this board differs from board 1

Board 1 is `overview-1.html` from the same morning's other session. The differences:

- **The rooms.** Board 1 is one flat surface.
- **The picture.** CAM 1 is 1236 × 695 here against 1040 × 585, and CAM 2, CAM 3 and the loupe are added.
- **The glass.** Here it is a band at 55 % cropped to its column, against a full copy at 54 % that took as much room as the picture.
- **The speed.** Board 1 has a 20 px number in a cell. Here it has an instrument that moves with the knob and says when the deck turned it, and the cue times follow it.
- **The meters.** Here they are gated while the Console is not sure, as the Console itself does.
- **The header.** Here it is redrawn, with the logotype at the left and an `Overview` tab of its own. The header's room was measured.
- **No Recent list.** Board 1's Recent showed speed changes, which the log does not keep.

## 11. What building it means, roughly

There is no new device input or output and no saved-data change. The implementation plan is the next step, on the owner's word. In outline:

- **A small engine pull request:**
  - `overview` joins the page names (`shell.workspace`, the contract, the double's guard);
  - D1's start page;
  - the deck's `words.workspace` and its follow trigger;
  - the day's take count from the action log.
- **One page pull request, the size of the Cameras page's:**
  - the page and its model, from the five pages' reports;
  - the picture places (four), and the glass copy cropped;
  - cue times from the layout and the anchor, worked out as `Left` is;
  - the meter bridge on the Console's canvas;
  - two design-system primitives: the speed tape, and the **Room** (its planes, lintel, door and alert keyline, with four tone sets as tokens);
  - test data, page tests and captures.
- **The header, its own pull request, since it is the shell's and changes every page.** This covers:
  - `AppShellFrame`'s row reordered: the logotype first, the pages' platter, the spacer, the system's platter, REC and the clock;
  - the raised bar and its platters, the open page's Dark Green segment, and the footer on the same surface;
  - `Setup / Support` moved into the system's window;
  - the product's name moved to the `Footer`;
  - the fullest-row test rewritten for the new order (with the Overview tab, every longest word and every chip);
  - about fifty captures refreshed;
  - DESIGN.md §2's header paragraph.
- **What the measures must learn.** The rooms' planes and their grain count as material (`data-material`). The shell's column hairlines are hidden on this page only.
- **Documents:** DESIGN.md §2, §4 (the room tones, as identity, beside the colour tags), §5 (a fourth plane, the room), §7 and §8, and OPERATIONS.md.

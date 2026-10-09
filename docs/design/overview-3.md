# The Overview: board 3, the whole page in one language

Written 2026-10-09, after the skylight header (`overview-2.md`, section 2). The owner liked that header and asked for the same pass over the whole page. This note goes with `docs/design/boards/overview-3.html`. Everything the page shows, how it behaves, the three moments and the questions are as `overview-2.md` describes them. This note covers only what the pass changes. Board 2 stays beside it for comparison.

**To see it:** open `http://127.0.0.1:4190/overview-3.html` from the browser pane's `design-boards` entry. The corner panel switches the moments, shows the notes (`&notes=1`), opens the drawn deck, and puts back the header as built for comparison.

## 1. The rules of the pass

The skylight header took five rules from Apple's interfaces (WWDC 2025, macOS 27) and set them in SSE's colours. The pass carries the same five rules into every part of the page:

1. **Content first, and in black.** The pictures, the glass, the speed instrument and the meters are the hero, in black wells. Everything that is not content sits on the raised layer around it.
2. **Hierarchy from grouping, not decoration.** Things that belong together share one shape: a tray of keys, a grouped list, a card. Nothing is boxed for its own sake.
3. **Concentric shapes.**
   - 12 for a room, a card, a tray or a list;
   - 8 for what sits inside them: a key, a well, a picture;
   - 4 for what sits inside that: a segment, a meter bar.

   DESIGN.md already allows all three radii.

4. **Depth from light, never from shadows.** A raised surface is a step lighter and carries a one-pixel light top edge. A recess (a tray) is a step darker, with a soft inner edge.
5. **Tint only for focus.** Colour is a lamp, a lit key, a meter, a cue, REC, or the open page's Dark Green. The rooms keep their quiet tones as the page's handrails.

## 2. What changed, part by part

| Part                                         | Board 2                                             | Board 3                                                                                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header and footer                            | The skylight header; the footer on the page         | One raised layer, top and bottom: the footer takes the header's surface and its line, so the page sits between two matching bars                                                                                                                      |
| State and latches                            | A black display, and a latch slot under it          | **One status card** at radius 12. The state is above, at the same place and size as on every page; the latch row is below it, under a hairline, yellow-tinted while something is latched. An error draws the coral line round the whole card.         |
| Rooms                                        | Brand Rooms with bevelled planes and diagonal seams | **Rooms refined.** Each is a raised panel at radius 12 in its tone, with its name band across the top and a floor where it needs one. The names, jobs, doors, tones and the trouble keyline stay. The drawn planes give way to Apple's rule of light. |
| Keys                                         | Flat faces, a 1 px edge, radius 4                   | A raised face at radius 8, with a light top edge                                                                                                                                                                                                      |
| REC                                          | The hazard key: a coral lamp and word               | The take's one prominent key: a coral edge and a faint coral tint while CAM 1 records, as the header's tally. Still never a coral fill.                                                                                                               |
| The transport                                | Keys in a grid                                      | **Two trays:** PLAY, BACK and TOP in one, the speed steps and cues in the other. Keys that belong together sit in one recess (12 outside, 8 inside, 4 between).                                                                                       |
| Lists                                        | Rows on hairlines, each list its own                | **One grouped list** for the take's facts, the studio and the cues ahead: rounded, rows on hairlines that start after the row's margin, the value bold at the right                                                                                   |
| Pictures and glass                           | Square                                              | Rounded at 8, in black                                                                                                                                                                                                                                |
| The whole script                             | Segments on the floor                               | A tray along the floor. The paragraphs are segments, with the cues and the place marked on it.                                                                                                                                                        |
| The sound                                    | Main Out flat, the meters in a square well          | Main Out as one raised row; the meters in black wells at radius 12, the bars rounded at 4                                                                                                                                                             |
| Segmented choices (Guides, Zebras, 2:1, 4:1) | Outlined keys                                       | A small tray, with the choice a raised segment                                                                                                                                                                                                        |

## 3. What it would mean to build

- **On the Overview alone,** this is the page pull request of `overview-2.md` section 11. It adds three design-system parts: the tray, the grouped list and the status card. The room is drawn as a raised panel, not as bevelled planes, which is simpler to build.
- **Across the program, the pass is larger.** The keys' faces, the radii, the status card and the grouped list would change every page, as the visual overhaul's polish did. That is a pull request of its own:
  - DESIGN.md §5 rewritten: the planes, a raised surface and a recess, one light edge;
  - §7, the components;
  - every page's captures written again.
- **Two parts need engineering beyond the pages:**
  - the pictures' rounded corners: the pictures helper would clip its own corners at 8, a small change in its shader;
  - the status card on every page: the latch slot moves into the state display's card.

## 4. Questions for the owner

Beside the questions of `overview-2.md`:

1. **Where the language goes.**
   - **Recommended:** decide after the Overview is built and used once. The Overview is drawn in board 3's language from the start, and the other pages follow in their own pass if it holds up in the studio.
   - **Otherwise:** the whole program now, as one visual pass before the Overview.
2. **The rooms' planes.**
   - **Recommended:** board 3's raised panels, quieter and simpler to build.
   - **Otherwise:** board 2's bevelled planes, closer to the brand's drawn Rooms.

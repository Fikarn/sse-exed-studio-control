# Slice 3 — No keyboard shortcuts: the inventory

For the operator, before any code changes (D6). 2026-09-26.

Built from six read-only surveys (the shell, the Console, Lighting, Setup with the startup and recovery screens, the design system, and the tests and docs) and one completeness check. They were read from the working tree at e80b5c7, where the screen code matches `main` (7fb6f4d). Every "no on-screen twin" claim in section 2 was checked again in the code. Where a survey was wrong, the section says what is true.

**Where** column: `file:line`. App files are under `frontend/app/src/app/`, design-system files under `frontend/packages/design-system/src/components/`, and tests under `frontend/app/tests/`.

## 1. Summary

The command palette (Ctrl+K) holds 40 kinds of command: 12 from the shell, 19 from the Console and 9 from Lighting. **37 keys and 32 palette commands go with no loss**, because an on-screen control already does the same thing (section 3). This count includes talkback's T (D7) and F2 (D8). The `?` key and "Show keyboard shortcuts" go with the shortcut guide, which exists only to list keys. **11 kinds of plain keyboard operation stay** under D6 (section 4). **12 items need your decision** (section 2). Most of them are keys or commands with no on-screen twin, or with only half of one. The rest are points where the surveys disagreed. **36 on-screen hints go or are reworded** (section 5). Screen captures in the design system's stories and some lines in the operator docs change too. **Tests** (section 6):

- Page tests (Playwright): 14 cases go because they only tested a shortcut, 12 are rewritten to click, 5 lose some lines, 4 check a hint or a file list, and a few wait on your decisions.
- Unit tests: 2 files and 1 case go, and 8 files plus one style list change.

## 2. Decisions for you

| #   | Decision                                             | Recommendation                                                                                                    |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | The command palette, and its Studio Preview commands | Drop the palette (D6). Studio Preview opens only from its address, and the app stops remembering it.              |
| 2   | The three window commands                            | Three keys in Setup / Support › Workstation; "Reset the window layout" also on both recovery screens              |
| 3   | Console bank paging (`[` `]`, Previous / Next bank)  | Add a ‹ › pair beside the bank readout on the Inputs heading                                                      |
| 4   | The plate's section keys P / Q / E / D / R           | Drop                                                                                                              |
| 5   | Lighting's undo and redo (Ctrl+Z, Ctrl+Shift+Z)      | Add an Undo key and an Undo on "Fixture added."; drop redo                                                        |
| 6   | Page-wide Esc in Lighting and the Console            | Remove; the Find key reads "Stop" while Find runs                                                                 |
| 7   | Lighting's quick palette panel (Ctrl+Shift+P)        | Drop the panel                                                                                                    |
| 8   | Resetting a value to its default                     | Add a "Reset to …" key in the typed-entry dialog                                                                  |
| 9   | The keys a focused slider keeps                      | Arrows, Home, End, Page Up and Page Down only; no Shift step; no arrows on the Gain key; talent marks keep arrows |
| 10  | A key held while pointing (Shift+click and similar)  | These count as shortcuts and go; two new visible controls replace the ones that had no other way                  |
| 11  | Borderline keyboard operation                        | Keep all four; add Esc to "Skip ahead?"; Lighting search: Enter recalls only while the list is open               |
| 12  | The web view's own keys (F5, Ctrl+R, Ctrl+Shift+R …) | Block them on purpose with one guard that does nothing else                                                       |

### 1. The command palette, and its Studio Preview commands

- **Today.** Ctrl+K opens a searchable list of commands: 12 kinds from the shell, 19 from the Console and 9 from Lighting. Ctrl+K is the only way in, because no on-screen button opens it (`OperatorShell.tsx:340-345`). It works in every state, even while you are typing in a field.
- **Twins.** Every command has an on-screen twin (section 3) except these:
  - the three window commands (decision 2);
  - Previous bank and Next bank (decision 3);
  - Enter Studio Preview and Exit Studio Preview.

  The palette's "Select <channel>" also reaches channels on another bank, or hidden by a chip, which nothing on screen can reach (decision 3).

- **Studio Preview** draws the 2560 × 1440 screen scaled into a smaller window, for design review on a laptop. Nothing on screen enters or leaves it. The corner badge "Studio Preview — 2560 × 1440 at N%" is not a button. The app remembers the choice (`OperatorLayoutProvider.tsx:69-71, :187`). If the palette goes and the choice is still remembered, the scaled view has no way out.
- **Options.**
  - (a) Drop the palette and both Studio Preview commands, as D6 says. Studio Preview opens only from the address `?operatorReview=studio`, and the app stops remembering it.
  - (b) Keep a Studio Preview key in Support › Workstation.
- **Recommendation: (a).** On display 3 at 2560 × 1440 Studio Preview does nothing. The tests and design reviews already open it by address.

### 2. The three window commands (planned: keys in Setup / Support › Workstation)

- **Today.** Three commands, all only in the palette (`OperatorShell.tsx:252-272`). No control on screen calls them, and the palette offers them in every state, including startup and recovery.
  - "Enter studio fullscreen" goes fullscreen on the studio monitor and is remembered for the next launch.
  - "Use the windowed layout" puts the window centred and is remembered for the next launch.
  - "Reset the window layout" forgets the saved window, then goes fullscreen on the studio monitor, or windowed if there is none.

  `OPERATIONS.md:273` tells you to run Reset when the app opens on the wrong screen.

- **The open point.** Workstation (`SupportPlate.tsx:94-166`) is part of Setup / Support, which exists only once the hardware link is ready. The startup and recovery screens have no Workstation.
- **Options.**
  - (a) Three keys in Workstation only.
  - (b) As (a), plus "Reset the window layout" on the two recovery screens, beside "Retry startup".
- **Recommendation: (b).**
  - Put a "Window" row after UI scale with the keys "Studio fullscreen", "Windowed" and "Reset the window layout".
  - A refusal, such as "No monitor is available for studio fullscreen.", shows in Setup's message line.
  - The keys do nothing outside the installed app, so on test pages they sit inert.
  - `OPERATIONS.md:273` is reworded.

### 3. Console bank paging

- **Today.** `[` and `]`, and the palette's "Previous bank" and "Next bank", page the Inputs and Playback strips. Nothing on screen pages them. The footer only reads "Bank 1 of 3". The Inputs heading reads "Bank 2 / 3 · ch …" from bank 2 on, but on bank 1 it shows the row's description instead.
- **The surveys disagreed.** The tests survey said there is one bank at 2560 ("all 13 strips") and proposed dropping the keys. **That is wrong.** The code says:
  - At 2560 × 1440 a bank holds 4 inputs and 6 playback pairs (`audioViewModel.ts:308-325`). Below 2200 px the layout is narrower, not wider: 4 inputs and 4 playback pairs.
  - The desk has 12 inputs and 6 playback pairs, and so does the test desk (`audio_backend.rs:100-240`). So the Inputs row has **3 banks**: bank 1 is Host, Guest, Boom and Guitar DI, and banks 2–3 are Line 1–8.
  - The group chips do not help. A row only offers chips for the groups on the current bank, so bank 1 offers only "Talent" (`audioViewModel.ts:340-348`).
  - The deck's BANK key switches its own four dials between inputs, playback and outputs, and it also never reaches Line 1–8 (`control_surface_audio.rs:393-425`).

  So without the keys, **Line 1–8 cannot be reached on screen at all**.

- **Options.**
  - (a) Two small keys, ‹ Previous bank and Next bank ›, beside the bank readout on the Inputs heading. They show while there is more than one bank and are dimmed at the first and last bank. One pair pages both rows, as the keys do today.
  - (b) The same pair in the footer, beside "Bank 1 of 3".
  - (c) Drop paging, which leaves Line 1–8 unreachable.
- **Recommendation: (a).** Keep the pair visible on bank 1, even though the heading shows no bank text there.

### 4. The plate's section keys P / Q / E / D / R

- **Today.** With a channel selected, these keys scroll the plate to a section (`useAudioKeyboardShortcuts.ts:96-103`):
  - P or Q: "Preamp"
  - E: "Equaliser"
  - D: "Dynamics"
  - R: "Send to <mix>"
- **No twin, and none needed.** Since the visual overhaul the plate shows every section at once (`AudioInspector.tsx:167-174`), so the keys only save a scroll.
- **Options.**
  - (a) Drop the keys.
  - (b) Add section-jump keys to the plate.
- **Recommendation: (a).**

### 5. Lighting's undo and redo

- **Today.**
  - Ctrl+Z undoes the newest of the last 25 steps: Save scene, Delete scene, Add fixture or Delete fixture.
  - Ctrl+Shift+Z redoes (`useLightingCommands.ts:257-266`; `useUndoStack.ts:3`).
  - On screen, an "Undo" button appears only on the pop-up message after Save scene, Delete scene and Delete fixture. It covers only the newest step, and only for the 3.5 s the message shows. "Fixture added." has no Undo button (`useLightingFixtureEditor.ts:403`), and nothing on screen redoes.
- **Options.**
  - (a) An "Undo" key in the Rig section whose small print names the step it will undo, dimmed when there is nothing to undo. "Fixture added." also gets an Undo button. Redo is dropped.
  - (b) As (a), plus a "Redo" key.
  - (c) Keep only the pop-up Undo buttons, add one to "Fixture added.", and drop the deeper history.
- **Recommendation: (a).** To redo, you save, add or delete again. The message becomes "Undid ‘X’."

### 6. Page-wide Esc in Lighting (and the Console's)

- **Today, Lighting.** Esc, when focus is not in a field, does all of this (`useLightingCommands.ts:419-428`):
  - clears the selection and the group;
  - turns Highlight and Solo off;
  - stops a running Find, including flashes still waiting.
- **Today, the Console.** Esc lets the selected channel go (`useAudioKeyboardShortcuts.ts:80-88`).
- **Why this needs a decision.** D6 keeps Esc only to close a dialog or drawer and to cancel an armed action. These are neither.
- **Twins.**
  - Selection: "Clear" on the selection strip, "Clear selection" in the plate, or a click on the empty plot.
  - Highlight and Solo: press the lit key again.
  - Console: click a row heading ("Inputs", "Playback", "Outputs") or the empty floor.
  - **Stopping Find: nothing.** Find flashes each selected fixture in turn, about 0.5 s each, and ends by itself, so 12 fixtures take about 6 s. Otherwise only leaving the Lighting page stops it (`useLightingFixtureEditor.ts:616-692`).
- **Options.**
  - (a) Remove both Escs, and the Find key reads "Stop" while a Find runs.
  - (b) Remove both, with no Stop.
  - (c) Keep both as they are.
- **Recommendation: (a).** The two error messages that say "Press Esc to try again" are reworded (section 5).

### 7. Lighting's quick palette panel (Ctrl+Shift+P)

- **Today.** Ctrl+Shift+P opens the "Lighting palettes" search panel, which applies a palette to the selection. The key is its only way in (`useLightingCommands.ts:192-196`). The panel's "Recent" row is fed by the command palette, which goes.
- **Twin for the job.** The plate's Palettes section applies the same palettes to the same selection with its "Apply <name>" buttons (`InspectorPalettes.tsx:211-218`).
- **Options.**
  - (a) Drop the panel.
  - (b) Keep the panel and add a "Palettes" key to the cluster.
- **Recommendation: (a).**

### 8. Resetting a value to its default

- **Today.** Backspace or Delete on a focused control resets it to its default. That works on:
  - a knob (preamp gain, EQ, dynamics);
  - the strip's Gain key;
  - Lighting's fixture sliders (intensity to 100 %, CCT to the middle, a control to its default);
  - the Position scrub labels (Rotation, Beam angle).

  With the mouse, Alt+double-click resets knobs and Lighting's fixture sliders, because a plain double-click opens typed entry. A plain double-click resets Rotation, Beam angle and the bulk sliders (`ScrubSlider.tsx:207-228, :296-302`; `AudioKnob.tsx:164-169`; `AudioStripGainKey.tsx:68-72`).

- **After S3.** D6 removes Backspace, Delete and, if decision 10 goes that way, Alt+double-click. Knobs, the Gain key and Lighting's fixture sliders are then left with no reset except typing the default. Strip faders keep right-click › "Reset to unity".
- **Options.**
  - (a) A "Reset to <default>" key in the typed-entry dialog beside "Cancel" and "Set value", for example "Reset to 0 dB" or "Reset to 100 %".
  - (b) No reset control; you type the value.
- **Recommendation: (a).**

### 9. The keys a focused slider keeps

The surveys disagreed on four points and one survey raised a fifth.

- (i) **Home and End**, plus Page Up and Page Down where a slider has them. These are a slider's standard keys.
- (ii) **Shift+arrow for 5× steps** on knobs, faders, plate sliders and the Gain key. Also Shift for 0.5 m on talent marks and in Lighting's page-wide nudge.
- (iii) **The arrows on the strip's Gain key.** The Gain key is a button that prints dB, and the arrows nudge it 1 dB.
- (iv) **The arrows on a focused talent mark**, which move it 0.1 m. This is the only keyboard way to move one, because marks have no position field (`TalentMarkMarker.tsx:112-129`).
- (v) **Lighting's page-wide arrows**, which move the selected fixture wherever focus is. They go under D6, but they could be tied to the focused fixture marker instead.

**Recommendation: one rule.** A focused slider takes the arrows, Home, End, Page Up and Page Down, and nothing with Shift, Ctrl or Alt.

- Keep (i).
- Remove (ii) everywhere.
- Remove (iii): the plate's gain knob takes the arrows.
- Keep (iv) at 0.1 m.
- Do not re-tie (v): Stage X and Stage Y and their scrub labels already take the arrows.

### 10. A key held while pointing

- **What is in this group.**
  - Console:
    - Shift+click on a group chip adds it to the filter. **There is no other way to do this.**
    - Alt+click inverts the chips. **There is no other way to do this.**
    - Shift+click on a fader or plate slider jumps to unity.
    - Ctrl+drag gives a fine drag, and Shift+drag makes a knob finer.
    - Alt+double-click resets.
  - Lighting:
    - Shift+click on a marker, and a Shift+drag box, add to the selection. **There is no other way to add a single fixture.**
    - Shift+click on a chip in the bulk plate removes that fixture. The twin is the × on the selection strip.
    - Alt+drag drops a fixture or mark without the 0.5 m snap.
    - Ctrl or Shift while scrubbing gives a fine or coarse step.
    - Shift+Enter on a focused marker is a key chord and adds that fixture to the selection.
- **Answer A: they are shortcuts, so they go.**
  - A plain click switches a chip on or off, and several chips can be lit. Alt+click is dropped.
  - The plot toolbar gets an "Add to selection" toggle: while it is lit, a click adds or removes a fixture. Shift+Enter goes.
  - The rest are dropped. Their twins are typed entry, the Reset key (decision 8), right-click › "Reset to unity", a drag that settles on unity near 0 dB, and the arrow keys.
  - The hint "Shift-click to remove it from the selection" goes.
  - About four tests change.
- **Answer B: they are pointing, not shortcuts, so they stay.** Nothing changes in how the mouse works. The written Shift hint still goes under D6's hint rule, so these gestures become hidden. Shift+Enter could stay as the keyboard's copy of Shift+click (the tests survey) or go (the Lighting survey).
- **Recommendation: A.** It matches D6's "every key Studio Control binds itself", and the two gestures with no other way get a control you can see.

### 11. Borderline keyboard operation

The surveys kept these four and asked you to confirm them:

- Esc closes a right-click menu, the colour picker and the search field's Recent list. These are popups, treated like a dialog.
- Esc in a rename field or the patch start-channel field puts the old value back. This is ordinary field editing.
- Enter in the bulk plate's "value or change" field applies the value. That field has no Apply button.
- Scene tiles and group chips reorder from the keyboard: Space picks one up, the arrows move it, Space or Enter drops it, and Esc puts it back. This is a focused list.

Two fixes were found on the way:

- "Skip ahead?" in Setup is a dialog that ignores Esc and does not take focus (`SetupPilotDialogs.tsx:40-72`). D6 says Esc closes a dialog, so it should be drawn as a standard confirm.
- In Lighting, Enter in the empty search field recalls the most recent scene even while the Recent list is closed (`LightingSearchField.tsx:79-84`). That is a live recall with nothing shown.

**Recommendation.** Keep all four. Make "Skip ahead?" a standard confirm, and let Enter recall a scene only while the Recent list is open.

### 12. The web view's own keys (reload and the like)

- **Facts.** The screen runs inside Microsoft's WebView2, the Edge browser built into Windows. WebView2 has keys of its own:
  - F5, Ctrl+R and Ctrl+Shift+R reload the screen;
  - Ctrl+F opens a find bar, and Ctrl+P prints;
  - Alt+Left goes back.

  The native shell switches none of them off (`tauri.conf.json:13-24`; `main.rs`).

- **What is blocked today.** Only Ctrl+Shift+R is swallowed, as a side effect of the restart key, and only when focus is not in a text field (`OperatorShell.tsx:347, :388-391`). **F5 and Ctrl+R are not blocked today.** So the idea that the shell's handler blocks the reload keys is only partly true.
- **What S3 would newly let through.** Ctrl+Shift+R everywhere, Ctrl+S in the Console and Lighting, and Ctrl+F and Ctrl+A in Lighting.
- **What was not checked.** None of this was tried on the workstation. An unsaved Lighting scene raises a "leave?" prompt on reload (`useUnsavedScenePrompt.ts:32-50`), but nothing else guards a reload of your screen during a show.
- **Options.**
  - (a) Block the keys on purpose, with one guard for the whole window that binds no function. Preferably, switch WebView2's browser keys off in the native shell: that covers reload, find, print, zoom and back, while copy, paste and select-all in fields keep working. A page-level catch of F5, Ctrl+R and Ctrl+Shift+R is the fallback. The source-scan guard allows exactly this one guard.
  - (b) Leave WebView2's defaults.
- **Recommendation: (a),** and add "F5 does nothing" to Appendix B item 2.

## 3. Goes, with its on-screen twin

Rows marked "palette" are command-palette commands. Items that wait on a decision are not repeated here.

### Shell

| Key / command                                                                          | What it does                                                     | The on-screen control that does the same                                                           | Where                                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Ctrl+1 · Ctrl+2 · Ctrl+3; palette "Switch to Setup / Support", "… Lighting", "… Audio" | Opens that page                                                  | The header tabs "Setup / Support", "Lighting", "Audio"                                             | `OperatorShell.tsx:378-386, :202-225`                             |
| A                                                                                      | Opens Audio                                                      | "Audio" tab; Setup's "Console" key                                                                 | `OperatorShell.tsx:359-365`                                       |
| Shift+S (outside Setup)                                                                | Opens Setup / Support                                            | "Setup / Support" tab; "Open Setup" in the Console                                                 | `OperatorShell.tsx:351-357`                                       |
| Ctrl+Shift+R; palette "Restart the hardware link"                                      | Asks "Restart the hardware link?" ("Retry startup?" in recovery) | "Restart the hardware link…" in Setup / Support › Support; "Retry startup" on the recovery screens | `OperatorShell.tsx:388-391, :226-233`; `SupportPlate.tsx:220-224` |
| palette "Switch to the Studio / Graphite / Bone theme"                                 | Theme                                                            | Workstation › Theme: "Studio", "Graphite", "Bone"                                                  | `OperatorShell.tsx:237-243`; `SupportPlate.tsx:95-109`            |
| palette "Set UI scale to 90 / 100 / 110 / 125 %"                                       | UI scale                                                         | Workstation › UI scale: "90", "100", "110", "125"                                                  | `OperatorShell.tsx:193-199`; `SupportPlate.tsx:110-125`           |
| `?`; palette "Show keyboard shortcuts"; the five "Shortcuts ?" keys                    | Shows the shortcut guide                                         | None needed: the guide goes with the keys it lists                                                 | `OperatorShell.tsx:367-376, :244-251`; `ShortcutOverlay.tsx`      |

### Console

| Key / command                                               | What it does                                               | The on-screen control that does the same                         | Where                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1 … 8; palette "Select <channel>"                           | Selects a strip                                            | Click the strip                                                  | `useAudioKeyboardShortcuts.ts:144-151`; `AudioMixerLane.tsx:123`        |
| M; palette "Mute <channel>"                                 | Mute                                                       | The strip's "M" key                                              | `useAudioKeyboardShortcuts.ts:152-156`; `AudioMixerLane.tsx:198-216`    |
| S; palette "Solo <channel>"                                 | Solo                                                       | The strip's "S" key                                              | `useAudioKeyboardShortcuts.ts:157-161`; `AudioMixerLane.tsx:217-235`    |
| U; palette "Reset selected fader to unity"                  | Selected channel's send to 0 dB                            | Right-click the strip › "Reset to unity"                         | `useAudioKeyboardShortcuts.ts:162-166`; `AudioWorkspace.tsx:610-616`    |
| Shift+1 … 8; palette "Recall snapshot N"                    | Arms, then recalls, snapshot N                             | The numbered snapshot key, pressed twice                         | `useAudioKeyboardShortcuts.ts:135-143`; `AudioSnapshotKeys.tsx:116-157` |
| Ctrl+S; palette "Save current snapshot"                     | Arms, then saves into the last-recalled snapshot           | The slot's save key ("Arm save <name>" then "Apply save <name>") | `useAudioKeyboardShortcuts.ts:117-124`; `AudioSnapshotKeys.tsx:202-211` |
| Alt+C; palette "Clear clips"                                | Clears every clip hold                                     | "Clear clips" (and on the clip latch)                            | `useAudioKeyboardShortcuts.ts:105-109`; `AudioCluster.tsx:394-403`      |
| Alt+S; palette "Clear all solo"                             | Clears every solo                                          | "Clear all solo" on the solo latch, shown while a solo is on     | `useAudioKeyboardShortcuts.ts:110-116`; `AudioCluster.tsx:196-204`      |
| Arrow keys anywhere on the page                             | Walks the selection through every source, then the outputs | Click a strip or an output strip                                 | `useAudioKeyboardShortcuts.ts:167-187`                                  |
| T, held (D7)                                                | Talkback                                                   | The "Talkback" key, held; the deck's TALK                        | `useMomentaryTalkback.ts:91-118`; `AudioCluster.tsx:231-249`            |
| palette "Switch active mix to <output>"                     | Selects the output                                         | Click the output strip; the "Mix target" keys                    | `buildAudioPaletteActions.ts:82-88`                                     |
| palette "Sync from TotalMix"                                | Sync                                                       | "Sync from TotalMix"                                             | `buildAudioPaletteActions.ts:100-106`; `AudioCluster.tsx:384-392`       |
| palette "Toggle meter peak hold" / "Reset meter peak holds" | Peak marks                                                 | "Peak hold" / "Reset peaks"                                      | `buildAudioPaletteActions.ts:147-160`; `AudioInspector.tsx:149-162`     |
| palette "Clear selected channel clip"                       | Clears one channel's clip                                  | The strip's "Clip" key ("Clear clip for <name>")                 | `buildAudioPaletteActions.ts:161-179`; `AudioMixerLane.tsx:238-252`     |
| palette "Rename selected channel"                           | Rename dialog                                              | "Rename" on the plate; right-click › "Rename channel"            | `buildAudioPaletteActions.ts:180-198`                                   |
| palette "Toggle polarity on the selected channel"           | Polarity                                                   | "Polarity" on the plate; right-click › "Flip polarity"           | `buildAudioPaletteActions.ts:199-221`                                   |
| palette "Capture new snapshot"                              | Capture                                                    | "Capture" on the Snapshots heading                               | `buildAudioPaletteActions.ts:222-228`; `AudioSnapshotKeys.tsx:63-77`    |
| palette "Clear the channel selection"                       | Lets the channel go                                        | Click a row heading or the empty floor                           | `buildAudioPaletteActions.ts:123-130`                                   |

### Lighting

| Key / command                                  | What it does                                        | The on-screen control that does the same                                        | Where                                      |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| P; palette "Enter / Exit patch mode"           | Patch mode                                          | "Patch"                                                                         | `useLightingCommands.ts:377-379, :85-92`   |
| B; palette "Enter / Exit preview mode"         | Preview mode                                        | "Preview"                                                                       | `useLightingCommands.ts:380-382, :94-102`  |
| S                                              | Re-saves a changed scene, otherwise saves "Scene N" | "Save · press twice"; the "New scene" tile; for a changed scene, "Save changes" | `useLightingCommands.ts:402-410`           |
| Ctrl+S; palette "Save changes to active scene" | Saves changes to the active scene                   | "Save changes" (state display and plate)                                        | `useLightingCommands.ts:335-348, :103-111` |
| Ctrl+Shift+S; palette "Save as new scene…"     | Name dialog                                         | "Save as new" / "Save as new…" on the plate                                     | `useLightingCommands.ts:336-337, :112-120` |
| 1 … 9; palette "Recall scene: <name>"          | Recalls a scene                                     | Click the scene tile; "Recall scene" on the plate                               | `useLightingCommands.ts:411-418, :153-160` |
| F2 on a scene tile (D8)                        | Rename                                              | Double-click the name; right-click › "Rename"                                   | `SceneTile.tsx:204-213`                    |
| T (Lighting's, not talkback)                   | Steps the recall fade 0 / 1 / 2 / 5 s               | "Fade <n> s", which sets any value 0–10 s                                       | `useLightingCommands.ts:383-397`           |
| H / Shift+H / Shift+I                          | Highlight / Solo / Find                             | "Highlight" / "Solo" / "Find"                                                   | `useLightingCommands.ts:356-366, :398-401` |
| Ctrl+Shift+M; palette "Open full DMX monitor"  | DMX monitor                                         | "DMX monitor"; the DMX strip's open button                                      | `useLightingCommands.ts:271-275, :129-136` |
| Ctrl+Shift+1–3                                 | Saves view N                                        | Right-click the view slot › "Save current view to N"                            | `useLightingCommands.ts:282-290`           |
| Shift+1–3                                      | Recalls view N                                      | The view slots "1", "2", "3"                                                    | `useLightingCommands.ts:367-373`           |
| Arrow keys anywhere (Shift for 0.5 m)          | Moves the selected fixture                          | Drag the marker; "Stage X (m)" / "Stage Y (m)" on the plate                     | `useLightingCommands.ts:296-311`           |
| Ctrl+A                                         | Selects every fixture                               | Drag a box across the empty plot                                                | `useLightingCommands.ts:315-323`           |
| Ctrl+F                                         | Focuses search                                      | Click "Search fixtures, scenes and groups"                                      | `useLightingCommands.ts:327-331`           |
| palette "Add fixture…"                         | Add fixture dialog                                  | "Add fixture"                                                                   | `useLightingCommands.ts:121-128`           |
| palette "Cut all fixtures (blackout)"          | Cut all confirm                                     | "Cut all"                                                                       | `useLightingCommands.ts:137-144`           |
| palette "Apply palette: <name>"                | Applies a palette                                   | "Apply <name>" on the plate                                                     | `useLightingCommands.ts:145-152`           |

### Setup, startup and recovery

| Key                      | What it does                                               | The on-screen control that does the same                                                                                                    | Where                             |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Shift+S (in Setup)       | Switches between Runner and Support                        | "Runner" / "Support"                                                                                                                        | `useSetupPilotShortcuts.ts:17-21` |
| Tab / Shift+Tab (Runner) | Next or previous step, skipping the "Skip ahead?" question | The step keys; "Back to <step>"; "Continue to verify" / "Continue to publish". Afterwards Tab moves focus again (D6).                       | `useSetupPilotShortcuts.ts:27-31` |
| Enter (Runner, anywhere) | Runs the step's main action, whatever has focus            | The step's main key: "Download profile", "Run all probes", "Continue to verify", "Continue to publish", "Publish setup", "Open the Console" | `useSetupPilotShortcuts.ts:33-37` |
| J / K (Map, Verify)      | Previous or next deck control                              | Click a deck key or a dial chip                                                                                                             | `useSetupPilotShortcuts.ts:39-49` |
| 1–4 (Map)                | Chooses a deck page                                        | The page tabs "LIGHTS", "AUDIO"                                                                                                             | `useSetupPilotShortcuts.ts:51-58` |

### Design system

| Key                                              | What it does                  | The on-screen control that does the same                                        | Where                                 |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Esc, Tab, ↑ ↓ Home End, Enter inside the palette | Operate the palette           | None needed: they go with the palette                                           | `CommandPalette.tsx:97-139, :243-273` |
| Esc inside the shortcut guide                    | Closes the guide              | None needed: it goes with the guide                                             | `ShortcutOverlay.tsx:171-177`         |
| Backspace / Delete on a Position scrub label     | Resets Rotation or Beam angle | Double-click the label ("Rotation (°)", "Beam angle (°)"), or type in its field | `ScrubLabel.tsx:226-232`              |

## 4. Stays (plain keyboard operation, D6)

| Key                                      | Where it works                                                                                                                                                    | D6 clause                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Tab / Shift+Tab                          | Everywhere; kept inside an open dialog                                                                                                                            | Tab moves focus                            |
| Enter / Space                            | Any focused key or button, including the "Talkback" key held (D7), a scene tile or group chip (D8), a scene's pin, a fixture marker, a menu item, a colour swatch | Enter or Space presses the focused control |
| Enter on a focused fader, slider or knob | Opens typed entry: strip faders, plate knobs, Grand master, Lighting's fixture sliders                                                                            | Enter presses the focused control          |
| Typing; Enter submits                    | Every field: rename, dialog forms, patch start channel, Position fields, bulk "value or change", the palette-draft form, search                                   | Typing in fields                           |
| ↑ ↓ in a number field or a closed list   | Typed-entry dialogs, Add fixture, patch                                                                                                                           | Typing in fields / a focused list          |
| Arrow keys on a focused slider           | Strip faders, monitor level, plate sends and knobs, Grand master, Lighting sliders and scrub labels, talent marks (decision 9)                                    | A focused slider                           |
| Home, End, Page Up, Page Down            | The same sliders (decision 9)                                                                                                                                     | A focused slider (proposed)                |
| Arrow keys on a focused list             | Segmented switches (Theme, UI scale, plot mode), right-click menus, colour picker, search Recent list, tile and chip reorder (decision 11)                        | A focused list                             |
| Esc closes a dialog or drawer            | Every dialog: "Close Studio Control?", "Restart the hardware link?", "Publish with failing probes?", typed entry, Rename, Save as new, DMX monitor                | Esc closes a dialog or drawer              |
| Esc cancels an armed action              | Console: 48 V, snapshot recall, snapshot save                                                                                                                     | Esc cancels an armed action                |
| Esc in popups and fields                 | Right-click menus, colour picker, Recent list; rename and patch fields put the old value back (decision 11)                                                       | Proposed as dialog / field                 |

These are Windows' own and Studio Control binds none of them:

- Alt+F4 and the title-bar X, which ask "Close Studio Control?";
- the Menu key and Shift+F10, which open the same right-click menus;
- Ctrl+C, V, X, A and Z in text fields.

## 5. Hints that go

### Every page (the shell)

| Visible text                                                                                                                                                | Where it shows                                                            | Becomes     | Where                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "Ctrl+1", "Ctrl+2", "Ctrl+3"                                                                                                                                | On the header tabs                                                        | nothing     | `OperatorShell.tsx:301, :308, :310`; `Tab.tsx:36-40`                                                                                           |
| "Ctrl+K Command palette" · "? Shortcuts"                                                                                                                    | Footer of the Console, Lighting and Setup                                 | nothing     | `AudioFooter.tsx:26-27`; `LightingFooter.tsx:73-74`; `SetupFooter.tsx:42-43`                                                                   |
| "Shortcuts ?" key                                                                                                                                           | Startup, Setup startup, recovery, Setup recovery, Setup / Support heading | key removed | `StartupSurface.tsx:28`; `SetupStartupSurface.tsx:36`; `RecoverySurface.tsx:66`; `SetupRecoverySurface.tsx:194`; `useSetupPilotChrome.tsx:103` |
| The "Keyboard shortcuts" guide, all of it                                                                                                                   | Overlay                                                                   | removed     | `ShortcutOverlay.tsx:22-236`                                                                                                                   |
| The palette's key column ("Ctrl+Shift+R", "Shift+S", "[", "]", "Esc", "U", "P" …), "Type a command — try: recall, save, patch, identify", "… · Esc closes." | Palette                                                                   | removed     | `CommandPalette.tsx:66-67, :344-346`                                                                                                           |

### Console

| Visible text                                                                             | Becomes                                                            | Where                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Footer "[ ] Bank" · "T Hold to talk"                                                     | nothing (the "Bank 1 of 3" readout stays)                          | `AudioFooter.tsx:28-29`        |
| Talkback key "Hold · T"                                                                  | "Hold" (D7)                                                        | `AudioCluster.tsx:234`         |
| Talkback hover "… release to stop. Or hold T."                                           | without "Or hold T." (D7)                                          | `AudioCluster.tsx:247`         |
| Armed state display "<label> · press again to apply · Esc cancels"                       | "<label> · press again to apply"                                   | `AudioCluster.tsx:188`         |
| Armed snapshot key "ARMED · press again · Esc cancels"                                   | "ARMED · press again"                                              | `Key.tsx:122`                  |
| Snapshots heading "Shift 1–8"                                                            | nothing                                                            | `AudioSnapshotKeys.tsx:59`     |
| Strip hover "Mute <name> (M)", "Solo <name> (S)"                                         | "Mute <name>", "Solo <name>"                                       | `AudioMixerLane.tsx:198, :217` |
| Empty plate "Press 1–8, click a strip, or use the command palette to select a source. …" | "Click a strip to select a source. Output selection stays active." | `AudioInspector.tsx:331`       |
| Gain key hover "… — press to type a value, arrows to nudge"                              | "… — press to type a value"                                        | `AudioStripGainKey.tsx:90`     |
| Error "Talkback could not be changed. Release T and press it again."                     | "… Release Talkback and press it again." (D7)                      | `AudioWorkspace.tsx:489`       |

### Lighting

| Visible text                                                                                                         | Becomes                                                            | Where                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Footer "Ctrl+Shift+M DMX monitor"                                                                                    | nothing                                                            | `LightingFooter.tsx:75`              |
| "Open full DMX monitor (Ctrl+Shift+M)"                                                                               | "Open full DMX monitor"                                            | `DMXCompactStrip.tsx:288`            |
| "Recall view N · Shift+N. Right-click for options."                                                                  | "Recall view N. Right-click for options."                          | `StagePlotControls.tsx:172`          |
| "Empty slot N. Right-click to save current view · Ctrl+Shift+N."                                                     | "Empty slot N. Right-click to save the current view."              | `StagePlotControls.tsx:173`          |
| Spoken: "Stage plot. Use Tab to focus a fixture, then arrow keys to nudge its position. Hold Shift for 0.5 m steps." | removed                                                            | `StagePlot.tsx:377-379`              |
| "… Press P to leave patch mode." (P drawn as a key)                                                                  | "… Press Patch to leave patch mode."                               | `InspectorPatch.tsx:61-62`           |
| "No scene is active. Press S after editing fixtures …"                                                               | "No scene is active. Use Save scene …, or Save as new to name it." | `InspectorScene.tsx:124-125`         |
| "No scenes saved yet. Press S after editing fixtures to save the current state."                                     | "No scenes saved yet."                                             | `SceneRail.tsx:261`                  |
| Locked reason "Patch mode is on: … Press P to leave it."                                                             | "… Press Patch to leave it."                                       | `LightingCluster.tsx:138`            |
| Message "Patch mode is on. Press P to leave it, then recall the scene."                                              | "… Press Patch …"                                                  | `useLightingSceneEditor.ts:584`      |
| Message "Undid ‘X’ · Ctrl+Shift+Z to redo" / "Redid ‘X’ · Ctrl+Z to undo"                                            | "Undid ‘X’." (decision 5)                                          | `useLightingCommands.ts:210`         |
| Message "Saved view N. Shift+N recalls it."                                                                          | goes with the key                                                  | `useLightingCommands.ts:286`         |
| Message "No scene is active. Press ⇧S to save the rig as a new scene." (wrong today)                                 | goes with the key                                                  | `useLightingCommands.ts:342`         |
| Error "Could not clear Highlight and Solo. Press Esc to try again."                                                  | "… Press the lit key again."                                       | `useLightingFixtureEditor.ts:682`    |
| Error "Could not stop the Find sequence. Press Esc to try again."                                                    | "… Press Stop again." (decision 6)                                 | `useLightingFixtureEditor.ts:689`    |
| "Press Esc or click empty plot to clear."                                                                            | "Or click the empty plot to clear."                                | `InspectorFixtureBulk.tsx:192`       |
| "Click a chip to focus that fixture · Shift-click to remove it from the selection." (and spoken)                     | without the Shift part (decision 10)                               | `InspectorFixtureBulk.tsx:136, :148` |
| Quick panel texts "Exit patch mode to apply", "Select fixtures to apply"                                             | go with the panel (decision 7)                                     | `useLightingRigControls.ts:340-346`  |

### Setup, startup and recovery

| Visible text                        | Becomes                             | Where                       |
| ----------------------------------- | ----------------------------------- | --------------------------- |
| Footer "Ctrl+3 Back to the console" | nothing                             | `SetupFooter.tsx:44`        |
| "Console" key small print "Ctrl+3"  | the key stays, the small print goes | `SetupCluster.tsx:197`      |
| Map page tabs "LIGHTS 1", "AUDIO 2" | "LIGHTS", "AUDIO"                   | `SetupMapVerifyStep.tsx:74` |

### Outside the operator's screens

- **Design-system stories.** These carry the same hints: "? Shortcuts", "⌘ K command palette", "⌘ ⇧ M full DMX monitor", "Ctrl+1–3" on tabs, "[ ] Bank", "T hold to talk" and "… · Esc cancels" (`DesignSystemPrimitives.stories.tsx:313, :333, :463-466, :505-507, :543-548`; `APrimitives.stories.tsx:65, :129, :298-301`).
- **Operator docs.**
  - `OPERATIONS.md:130, :285`: "or `T`" (D7).
  - `OPERATIONS.md:273`: "from the command palette (`Ctrl+K`)". This becomes Setup / Support › Workstation.
  - `OPERATIONS.md:156`: "like Shift", if the Shift step goes.

## 6. Tests

### Page tests (Playwright)

| Spec                             | Go: they only tested a shortcut                                                                                                                                                    | Rewritten to click                                                                                                                                                                                                                                         | Lines dropped / other                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.spec.ts`                  | 4: `:10` keyboard overlays + switching (its restart and Map checks move to `setup.spec.ts` as clicks), `:98` palette focus, `:126` palette vs guide, `:214` labels follow platform | 2: `:294` crash (open "Close Studio Control?" instead, then Esc), `:361` lazy loads (click "Audio")                                                                                                                                                        | `:65` Esc on close stays                                                                                                                                    |
| `audio.spec.ts`                  | 2: `:956` palette and guide, `:1036` palette recall                                                                                                                                | 3: `:46` main case (next-bank key, click strip, click "M", click recall twice; Esc-deselect becomes a click on the heading; E/D/R/P lines go; footer check becomes "hint slot gone"), `:996` recall twice by click, `:1066` right-click › "Reset to unity" | 4 lose lines: `:461` page arrows, `:483` 30 arrows plus Shift chip click (decision 10), `:1110` Gain-key arrow (decision 9), `:1242` bank keys (decision 3) |
| `audio-arm-countdown.spec.ts`    | 1: `:79` held Shift+digit                                                                                                                                                          | —                                                                                                                                                                                                                                                          | —                                                                                                                                                           |
| `audio-talkback.spec.ts`         | 1: `:64` holding T (D7)                                                                                                                                                            | 1: `:107` press the dimmed button instead of T (D7)                                                                                                                                                                                                        | `:21` checks "Hold · T"                                                                                                                                     |
| `audio-render-budget.spec.ts`    | 1: `:83` plate section keys (or rewrite to scroll)                                                                                                                                 | —                                                                                                                                                                                                                                                          | —                                                                                                                                                           |
| `audio-metering.spec.ts`         | 1: `:458` palette registration steady                                                                                                                                              | —                                                                                                                                                                                                                                                          | —                                                                                                                                                           |
| `audio-hierarchy.spec.ts`        | —                                                                                                                                                                                  | —                                                                                                                                                                                                                                                          | `:31` checks "Hold · T" (at `:59`)                                                                                                                          |
| `audio-file-structure.spec.ts`   | —                                                                                                                                                                                  | —                                                                                                                                                                                                                                                          | file lists `:32, :34, :94-98`                                                                                                                               |
| `audio-inspector-polish.spec.ts` | —                                                                                                                                                                                  | —                                                                                                                                                                                                                                                          | `:93` checks "Mute Host (M)". The surveys missed it. `:24`'s comment wrongly says one bank.                                                                 |
| `lighting.spec.ts`               | 3: `:340` palette Studio Preview, `:593` page-wide nudge, `:791` DMX monitor by key                                                                                                | 4: `:33` S becomes "New scene", `:461` Ctrl+F becomes a click on search, `:542` view slots by right-click and tabs, `:580` "Save as new"                                                                                                                   | `:404` quick-panel half (decision 7); `:561` Shift+Enter (decision 10)                                                                                      |
| `lighting-keyboard.spec.ts`      | 1: `:31` F2 (D8)                                                                                                                                                                   | 1: `:103` open the rename by double-click                                                                                                                                                                                                                  | `:19, :47` stay (D8); `:75, :87` stay (decision 11)                                                                                                         |
| `lighting-rig-actions.spec.ts`   | —                                                                                                                                                                                  | 1: `:223` tabs instead of Ctrl+1/2                                                                                                                                                                                                                         | `:123` Esc ends Find becomes "Stop" (decision 6); the selection helper's Shift+Enter (decision 10); the keyboard reorder helper stays (decision 11)         |
| **Total**                        | **14**                                                                                                                                                                             | **12**                                                                                                                                                                                                                                                     | 5 lose lines, 4 check a hint or a list, 3 wait on a decision                                                                                                |

The helper `modifier-shortcut.ts` goes, and so does the palette check in `helpers/view-models.ts`. The Esc, Enter, Tab and focused-slider presses stay, for example `audio.spec.ts:261, :602, :747` and `lighting.spec.ts:818`.

### Unit tests (Vitest)

- **Go.**
  - `shortcutGlyphs.test.ts` (4 cases).
  - `CommandPalette.test.tsx` (8 cases).
  - "holds while T is down…" in `useMomentaryTalkback.test.tsx` (D7). The same file's disabled case loses its T press.
- **Change.**
  - `HealthBar.test.tsx`: 2 cases go and the others lose their hints.
  - `ShellPrimitives.test.tsx`: no tab or footer hints.
  - `APrimitives.test.tsx`: the arm words; the Shift ×5 and Shift-to-unity cases follow decisions 9 and 10.
  - `ScrubSlider.test.tsx` and `ScrubLabel.test.tsx`: Backspace, Delete and Alt+double-click follow decision 8, and a new test covers the Reset key.
  - `SetupSupportPilot.test.tsx` and `SetupHardwareLinkWords.test.tsx`: lose the guide prop.
  - The style-literals list loses the guide's stylesheet.
- **Stay.** The Esc, Tab, Enter and arrow cases in `Dialog`, `ConfirmDialog`, `ContextMenu`, `Button`, `IconButton`, `Tooltip`, the arm (`useArm`) and the drawer.

### Captures and guards

- **Screen captures.** Every screen capture moves, because the tab hints show at 2560 and the footers change. 14 design-system story captures and the shell's stories move as well. They are refreshed under the capture ruling: win32 2560 × 1440, plus the linux capture of every board that changes.
- **New guard.** The plan's source-scan guard.
- **Two more checks the tests survey suggested:**
  - a count of key glyphs on every board, held at 0;
  - one page test that presses Ctrl+1, Ctrl+K, `?`, M, the Lighting arrows, T and F5 (decision 12), and checks that nothing moves.

## 7. Notes and caveats

1. **Survey corrections, checked in the code.**
   - **The workspace keys and the tab locks.** Ctrl+2, Ctrl+3 and A did not open Lighting or Audio before Setup was published. The screen stays on Setup (`createShellStore.ts:154-161`). They did rewrite the page the app opens on. Removing the keys ends that.
   - **Bank count.** See decision 3.
   - **"Clear selected channel clip".** Its twin is the strip's "Clip" key, not "Clear clips", which clears every channel.
   - **Lighting's S on a changed scene.** Its twin is "Save changes", not "New scene".
   - **F5 and Ctrl+R.** They are not blocked today (decision 12).
   - **"Nothing opens a right-click menu from the keyboard".** Probably wrong: Windows' Menu key and Shift+F10 open the same menus. This is the browser's own behaviour and was not checked on the workstation.
2. **The palette is the only way into several things.** It was the only way into:
   - the three window commands;
   - Studio Preview;
   - bank paging;
   - selecting a channel that sits on another bank or is hidden by a chip.

   Decisions 1–3 cover all of them.

3. **Talkback stays inside D7.** Only these go:
   - the T key;
   - "Hold · T" (it becomes "Hold");
   - "Or hold T.";
   - "Release T" in the error;
   - the T test, and the T press in one other test.

   Releasing a pointer hold when the window loses focus stays. So do Space and Enter on the Talkback key, the refused hint and the deck's TALK. Lighting's T is the recall fade and has nothing to do with talkback.

4. **Old faults that go with the keys.**
   - In Setup, a capital S typed in any field flipped Runner and Support and was swallowed, for example while typing `C:\Users\Stora Studion\…`.
   - In Setup, Tab never moved focus in the Runner.
   - In Setup, Enter ran the step's main action whatever had focus, even behind an open dialog.
   - Lighting's S saved a scene while the Save key was locked (patch mode, lights unreachable).
   - In the Console, Shift+S with a strip selected collided with the shell's Shift+S.
   - Two Lighting hints were wrong: "Shift+S" for Save as new, and "Press ⇧S".
5. **Esc must be kept in the Console.** The Esc that cancels a Console arm, and the one that closes the strip's right-click menu, live in the Console key file that is being deleted. They must move, or Esc silently stops cancelling arms. `audio.spec.ts:602` and `:747` would catch it.
6. **Right-click becomes the only one-press way to some actions.** After U and F2 go, right-click menus are the only one-press way to "Reset to unity" on a strip, one of two ways to "Rename" a scene, and the only way to "Save current view to N". From the keyboard, you reach them with the Menu key or Shift+F10.
7. **Lighting's narrow-window drawer.** Lighting's Esc also closes the inspector drawer on narrow windows. That never happens at 2560. If the page-wide Esc goes, that drawer needs its own Esc (D6 drawer clause).
8. **The startup screens lose their only key**, "Shortcuts". The recovery screens keep "Retry startup", Setup's recovery screen keeps "Back to Console", and both get Reset under decision 2.
9. **The footer's action key.** When the key hints leave the footer, the action key must stay at the right edge. That is a layout detail, but it touches every board.
10. **Noticed in passing, outside S3, not checked.** Lighting's "Save · press twice" saves on the first press.
11. **Docs to update.**
    - `OPERATIONS.md` (section 5).
    - The Studio Preview lines in `DEVELOPMENT.md:154, :179-183`, `DEVELOPER_QUICKSTART.md:104` and `HANDOFF.md:270`. They name the palette with labels that are already wrong; they should give the address `?operatorReview=studio` instead.
    - `docs/redesign/lighting.md` §6, which lists the shortcuts as current.
    - The system doc.
    - A new CHANGELOG entry.
    - The plan: `:361` should say Ctrl+1–3, not 1–4, and Appendix B item 2 should say "the arrow keys on Lighting with no control focused" (`:420`), because the arrows on focused sliders stay.
    - `docs/redesign/claude-design-product-brief-2026-09.md:21, :34, :36, :70` still promises shortcuts, a palette and T. Update it before C0 (the Cameras and Teleprompter design) reads it.
12. **What the source-scan guard must allow.**
    - The strip keys' caps "M" and "S".
    - "Press Sync from TotalMix", "press twice", "press again" and "Press Lighting again.".
    - The deck's "Press a button or dial…".
    - Audit numbers such as "F2 — marquee…", and "Fixture symbol key".
    - Windows' own keys in the docs (Alt+F4).
    - The guard of decision 12.
    - The token descriptions that say "kbd": reword them or exempt them.
13. **Size.** If the inventory makes the slice too large for one review, the plan allows a split: S3 for the shell, palette, guide and window keys, and S3b for the pages' keys and hints.

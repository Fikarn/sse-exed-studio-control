# SSE ExEd Studio Control — product brief for a from-scratch UI design

This document is for a designer who has never seen the product. It contains only requirements and verified facts: who uses it, on what hardware, what the software must do, what the engine can and cannot report, and what fails the operator today. It contains no visual direction. Layout, hierarchy, type, colour, material, motion, iconography, component design, copy tone and the look of the themes are yours to decide and to defend, one decision at a time, in terms of the operator.

## 1. The operator and the room

- One person operates a small recording studio at SSE Executive Education (Stockholm School of Economics). They record and stream executive-education sessions: a host, a co-host, guests, sometimes a remote participant.
- The app runs full-time on a dedicated 27-inch monitor at `2560×1440`, roughly 60–80 cm from the operator's eyes, beside a primary monitor that runs RME TotalMix, Bitfocus Companion and the recording software.
- Their hands, besides the mouse and keyboard, are on three physical things: the RME Fireface UFX III audio interface (its real state lives in TotalMix), a Stream Deck+ (8 keys, 4 dials, a touch strip) driven by Companion from the same engine as the app, and occasionally the lights themselves.
- Two people share every screen with no mode switch: the recording operator (about 95 % of session time: recall a lighting scene, ride a fader, mute, dim the monitors, hold talkback, nudge one fixture) and the setup operator (patch fixtures, edit and save scenes, commission the deck, run hardware probes, back up).
- The moments that matter: the pre-session check (is everything ready, is the console verified, is the rig up), the take (one glance, one free hand, a guest in the room, no second chances), between takes (recall, adjust, save), an incident (bridge drops, desk disconnects, metering goes stale) and commissioning (a slower, deliberate walk through steps).
- The cost of a wrong glance is a wrong mute, a wrong scene, a phantom-power hit on a ribbon microphone, or a missed clip. The cost of a slow glance is a missed cue.

## 2. Hard constraints

- Primary surface `2560×1440` logical pixels, fullscreen, fixed. `1920×1080` must fully work for live use. `1280×800` is a utility mode for setup, inspection and recovery, not full show control.
- No page scroll during normal operation. Dense, fixed-height surfaces; internal scrolling only where a list is unbounded by nature.
- Windows workstation. Mouse, keyboard and the Stream Deck. No touch, no mobile.
- Three themes must exist: a default suited to a dim control room, a second alternative, and a light one. Their character and names are open (the current product calls them Studio, Graphite, Bone).
- A UI scale setting of 90 / 100 / 110 / 125 % exists and must not break layout.
- Legibility is measured, not judged: text contrast ≥ 4.5:1 against its rendered background, UI components and indicators ≥ 3:1, keyboard operability everywhere, reduced-motion respected. Propose and defend your minimum text sizes for this monitor at this distance; we measure every render.
- The screen is a witness, not the source of truth. The engine (a separate process) owns all state, persistence and device I/O. The UI shows only what the engine reports and never invents a state, a value or a confirmation.

## 3. The four workspaces and what each must offer

The product has a shell holding four workspaces. Their feature sets are fixed; their arrangement, hierarchy and presentation are open.

**Setup / Support.** A five-step commissioning runner: 1 Import profile (export the Companion profile for the deck; server base URL; export target), 2 Probe hardware (lighting bridge, audio console, control surface probes, each passes or fails with a reason), 3 Map bindings (the deck's pages, keys and dials; 48 controls over 4 pages), 4 Verify live echo (press physical deck controls, the matching on-screen control lights), 5 Publish (commits commissioning, writes a support backup, returns to the console; publishing with a failing probe needs an explicit override). Support: export and restore backups (native archive or legacy `db.json`), diagnostics export, engine log, restart the engine bridge, load sample planning data (asks first). Also the place for workstation settings such as the theme.

**Lighting.** A top-down stage plot of a 12 m × 8 m room with fixtures at real positions, beam angles and colour temperature; talent marks; fixtures are Litepanels Astra Bi-Color, Aputure Infinimat 2×4 and Aputure Infinibar PB12 through a Litepanels Apollo bridge over sACN (universe 1, 512 DMX channels). Per fixture: on/off, intensity %, colour temperature K (2700–6500), position, rotation, rig height, beam angle, patch (DMX start address, mode), identify burst, delete. Scenes: recall (with an optional fade in seconds), save, save as new, rename, delete; a scene is "current" after recall; edits after recall make the scene "unsaved" until saved. Preview mode: edit offline, rig unchanged until save or discard. Groups of fixtures with a shared level. Master: lighting on/off, grand master %, cut all. Patch mode with address tags on the plot. DMX monitor of all 512 channels. Search across fixtures, scenes and groups. The bridge can be unreachable; commands then reach the engine but not the rig.

**Audio.** A control surface for the UFX III, modelled on TotalMix: three tiers, Inputs (the four front preamps, named for the people: Host, Co-host, Guest 1, Guest 2), Playback (six software playback pairs: Program 1/2, FX 3/4, N-1 5/6, Music 7/8, Playback 9/10, Playback 11/12) and Outputs (Main Out, Phones 1, Phones 2). The operator picks a mix target (Main, Phones 1 or Phones 2) and the input and playback faders then set the sends into that target. Per strip: fader (0..1, printed in dB on RME's curve, unity at 0 dB), live meter (reference −18 dBFS, warn at −3, latched clip at 0), mute, solo, and on inputs 48 V phantom and preamp gain in whole dB (0–75). Monitor section: talkback (momentary hold, never latches), dim (−20 dB), mono, main level, master stereo meter. Eight snapshot slots: capture, recall, overwrite, rename, delete; recall pushes everything except 48 V and reports what was confirmed. Inspector for the selected strip: preamp, EQ (low cut plus three bands), dynamics, sends/routing, meter readouts, peak hold toggle and reset. Sync pulls the console's real state and never changes hardware. Run audio probe. Clear clips. Bank keys `[` `]` when strips are hidden at smaller widths (the `1920×1080` layout shows 4 / 4 / 3 strips with the rest banked).

**Planning.** Projects (title, status todo / in progress / blocked / done, priority P0–P2, description) and tasks (title, project, scheduled start and duration, due date, priority, labels, checklist, notes, a timer that tracks time). Two views: a board by status and a day timeline (09:00–22:00) with a now marker; an unscheduled tray; search and filters; new project; a time report (tracked time by project and task); backup. Keyboard-first operation.

**Shell.** Workspace switching (Ctrl+1–4), a command palette (Ctrl+K), a shortcut guide (?), a per-subsystem health readout visible from every workspace, restart the engine bridge (confirm), close the app (confirm; closing ends the console link, TotalMix keeps its state, lights hold their last levels, the deck goes idle). Startup shows progress while the engine starts; recovery surfaces exist for a protocol mismatch or a failed start with diagnostics and restore.

## 4. The engine's truth: every state the UI may show

The UI may show these and only these; each has a precise meaning and, where blocking, a way out.

Subsystem health (lighting, audio, control surface): `ok`, `attention`, `error`, with a one-line summary from the engine.

Audio console badge, in priority order:

- `DISABLED` — OSC control switched off in Setup; the console is read-only.
- `DISCONNECTED` — TotalMix reports the UFX III is gone. Way out: check USB and power.
- `OFFLINE` (console unreachable) — the console did not answer; audio may still pass but the app cannot see or change it.
- `NOT VERIFIED` — the audio probe has not passed since the last transport change. Every console write is refused by the engine and every control is locked until the probe passes. Way out: run the audio probe.
- `STALE` — no meter data for a few seconds.
- `OFFLINE` (metering) — TotalMix is not sending meter data. Way out: enable Send Peak Level Data, run the probe.
- `ASSUMED` — the app is showing the last state the console confirmed; a send was not confirmed within 1.5 s or a recall was only partly confirmed. Way out: Sync. The engine reports a global confidence (`aligned`, `assumed`, `unknown`) and a count in its message; it does not yet report per-channel confidence (a planned addition).
- `ACTION FAILED` — the last action failed, with a code and a message.
- `SIMULATED` — metering is simulated (test benches), shown so nobody trusts fake meters.
- `VERIFIED` / ready — everything above is clear.
- `TALKBACK REFUSED` — TotalMix has no talkback channel assigned; the hold is refused with that instruction.

Per value, after a write: `Confirmed` (the desk echoed the value), `Adjusted` (the desk kept a different value; the desk wins), `External` (changed in TotalMix itself, arrives within about 200 ms), or unconfirmed (counts toward `ASSUMED`).

Lighting: bridge reachable or unreachable (with IP and universe); preview mode on or off with dirty or clean edits; scene current / unsaved changes / saved with a last-saved time; fade in progress; patch overlaps (two fixtures on the same channels); fixtures patched versus total; identify burst running.

Cross-workspace latches the operator must see from anywhere: a solo engaged on the console; unsaved lighting scene changes.

Commissioning: `setup-required`, ready, degraded; per step done / current / pending; per probe passed / failed with reason; publish override recorded with a timestamp. Startup lifecycle: launching, awaiting ready, loading health, loading app, ready, failed (with the failure's reason, engine log path and backups). Protocol mismatch: shell version versus engine version.

## 5. Actions and their consequence classes

These behaviours are engine-enforced and must be legible on screen:

- **Momentary hold.** Talkback and identify bursts engage while held and release on let-go; the engine auto-releases 2 s after the last hold; a click never latches. Talkback is `T` on the keyboard and `TALK` on the deck.
- **Toggle.** Mute, solo, dim, mono, lighting on, fixture on: one press flips; the screen shows the optimistic result at once, then the engine's confirmation; a value the desk kept different flips back and is reported as Adjusted.
- **Continuous.** Faders, gain, intensity, colour temperature, grand master: drag, wheel, arrow keys (Shift ×5), double-click to default, typed entry; commits throttled while dragging, final on release.
- **Arm-then-apply.** 48 V phantom, snapshot recall, snapshot overwrite, scene overwrite: the first press arms, a second press on the same control at least 350 ms later applies, anything else or a 4.5 s timeout disarms; only one thing is armed at a time; the deck mirrors the arm. Held keys never auto-repeat into an apply.
- **Dialog.** Only closing the app, restarting the engine bridge, discarding an unsaved scene, publishing over a failing probe, loading sample data, restoring a backup, and deleting a fixture / scene / project / snapshot.
- **Gating.** While the console is not verified, disabled or disconnected, every console write is refused by the engine; app-local edits (names, snapshot slots, settings) stay allowed. Refusals carry a reason.
- **Sync is a pull** and never changes hardware. **Recall is a push** of everything except 48 V; 48 V differences are listed per channel and applied only by arming each one.

## 6. The words and numbers the screen prints

Channel and target names as above; snapshot names such as "Show open", "Interview block"; scene names such as "Warm wash", "Interview"; groups "Front", "Back"; fixtures "Key", "Fill". dB with sign and one decimal; gain in whole dB; DMX addresses 1–512 and universe `U1`; colour temperature in K; intensity in %; times as 24-hour `HH:MM`; durations in minutes and hours; a bridge IP such as `192.168.1.80`. The engine's own summaries are sentences written for the operator; raw codes such as `AUDIO_SNAPSHOT_RECALL_FAILED` exist and should not be the thing the operator reads.

## 7. The Stream Deck+ beside the screen

When the app is on Audio, the deck's page shows keys `→ MAIN`, `→ PH 1`, `→ PH 2`, `BANK`, `DIM`, `GAIN`, `TALK`, `SOLO CLR`; the touch strip shows one segment per strip with name, level in dB and a drawn fader position with the unity notch; the dials ride levels and push to mute. Its state colours today: the active mix target solid amber, `TALK` green while live, `SOLO CLR` yellow with the live count, `DIM` and `GAIN` amber while engaged, muted strips in an ember palette, the selected strip with an amber accent. The deck's colours are generated by the engine; the screen and the deck should not disagree about what a state means. If your system argues for different meanings, say so; changing the deck is a separate, engine-side change.

## 8. What fails the operator today (problems, not solutions)

Measured on the current program, ranked by cost:

1. Arming a recall, or any action result, moves the Console's monitor section (talkback, dim, mono, master meter) from the top of the screen to the bottom.
2. Values the desk has not confirmed look identical to confirmed ones; locked controls in the not-verified state look almost identical to live ones.
3. The header's subsystem readout and the workspace disagree on severity for the same condition; a failed action shows green in the header.
4. Setup and the recovery screens are clipped at `1280×800`, the very mode documented for them.
5. Setup is a different application: no workspace tabs, no health readout, and 23 % of the monitor left empty at `2560×1440`.
6. Four workspaces, four different top bars and three different footers; Planning's toolbar wraps to two or three rows at `1920` and `1280`; the footer at `1280` truncates every value it exists to show.
7. The Console uses a different accent colour from the rest of the program and carries its own theme switch.
8. Empty states wrap one word per line in narrow panels; loading states drop the chrome and shift the layout when data arrives.
9. In the light theme, 40 % of Lighting's text and 20 % of the Console's text fail 4.5:1.
10. Two workspaces render text at 8.5–9.5 px; 60 % of the Console's text is 9.5 px; up to 14 distinct type sizes and 12 corner radii on one screen; 35–42 % of all text is uppercase.
11. Copy contradicts itself ("Attention required" over "System healthy and ready") and speaks in developer terms (engine, snapshot, protocol, OSC ping, raw error codes).
12. Take-time controls smaller than 24 px; a continuously pulsing indicator on an idle screen; hover motion on every button; 129 shadows on the idle Console with no shared light direction.

## 9. What "perfect" has to achieve

Outcomes, not looks. From the operator's chair, in one fixation and without reading a sentence, the operator can tell: whether it is safe to act, what is live right now, what is unconfirmed, and where they are. Take-time controls are always in the same place. Nothing scrolls. The four workspaces read as one instrument, and the screen reads as a sibling of the desk and the deck beside it. Every state in §4 has one unmistakable form. Every action class in §5 feels like what it is. All three themes pass measurement on every surface at all three sizes. The design system that falls out of it can be built as tokens and components, and every decision can be explained in terms of the operator.

## 10. What to deliver, in order

1. Three to five genuinely different concepts for the Audio Console at `2560×1440`, one board each, with two sentences per concept: what it gives the operator at a glance, and what it costs. Concepts, not skins: they should differ in composition, hierarchy and material logic.
2. After one is chosen: the Console in its blocked states (not verified, assumed, offline, armed), then Lighting, Planning and Setup in the same language, then `1920×1080` and `1280×800`, then the three themes.
3. The system behind it: type scale, colour roles, elevation and material, motion, component sheet, copy rules, with the reason for each.

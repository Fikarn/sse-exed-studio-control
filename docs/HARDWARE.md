# Hardware

The studio's devices, how Studio Control reaches each one, and the rules that keep tests away from them. Operation and recovery: [OPERATIONS.md](OPERATIONS.md).

## The room

- **Workstation.** One PC, Windows 11, for development and for the studio. Smart App Control is off and must stay off: the app is not signed.
- **Display.** The app runs fullscreen on the studio display: 2560×1440 at 100 % Windows scaling. It opens on the display it was last on, found by its place on the desktop, else on that one. `Reset the window layout` in Setup / Support › Workstation puts it back.
- **Keep that display at 100 %.** The primary display is the same size at 125 %, and the scaling tells them apart. Windows' display numbers can change, so the app goes by a display's place, size and scaling before its number. The studio display stands at x 2560: the window is right when it covers x 2560 to 5120, y 0 to 1440.
- **Networks.** `Ethernet 2` is the office network (`172.16.16.0/21`), with the BGH1s. `Ethernet 3` is the lighting network (`10.1.0.0/16`), with the Apollo Bridge. Both have a default route, the office's first: with the office network down, a packet to an unknown address leaves towards the bridge. That is why nothing here may send to an address nobody typed, and why the two shell lanes run in CI only.
- **Beside the app** run TotalMix FX, Bitfocus Companion and vMix.

## Devices

| Device                     | For                   | How the app reaches it                   | Set up in          |
| -------------------------- | --------------------- | ---------------------------------------- | ------------------ |
| RME Fireface UFX III       | Audio console         | OSC over UDP to `127.0.0.1:7001`–`7004`  | TotalMix FX, Setup |
| Litepanels Apollo Bridge   | Lights                | sACN over UDP to `10.1.0.1:5568`         | Setup, the bridge  |
| Stream Deck+               | Keys and dials        | Companion calls `http://127.0.0.1:38201` | Setup, Companion   |
| Blackmagic Pocket 6K Pro   | `CAM 1`, main camera  | Bluetooth                                | Setup              |
| Panasonic LUMIX BGH1 (two) | `CAM 2`, `CAM 3`      | Ethernet, to the address in Setup        | Setup              |
| vMix                       | The cameras' pictures | NDI, from vMix on this PC only           | vMix               |
| Elgato Prompter XL         | Teleprompter          | A Windows display named `Prompter XL`    | Windows            |

## Audio console

The app talks to the console's mixer, TotalMix FX 2.1 or newer (for Global OSC). Front preamps 9–12 are the live inputs; rear line inputs 1–8 are secondary. The outputs are Main Out, Phones 1 and Phones 2.

In TotalMix FX, `Options › Settings › OSC`, four remote controllers are `In Use`, each with the address `127.0.0.1`:

- Remote 1: port incoming `7001`, port outgoing `9001`. Hardware inputs.
- Remote 2: `7002`, `9002`. Software playback.
- Remote 3: `7003`, `9003`. Hardware outputs.
- Remote 4: `7004`, `9004`, in `Global OSC` mode. Control and metering.
- Remotes 1 to 3 have `Send Peak Level Data` on. They are the meters' fallback, and remote 1 carries EQ and Low Cut.
- Remote 4 has `Send changes` on, `Follow Submix` off and re-sending off. The engine reads each value back itself.
- In the Channel Layout, keep the channels in use visible, or turn on `Receive on hidden channels`. A hidden channel drops writes silently.

Setup holds the TotalMix address `127.0.0.1`, the send port `7001` and the receive port `9001`. The other ports are these plus 1, 2 and 3.

The engine listens on UDP `9001`–`9004`, bound to `127.0.0.1`, and reads only what comes from the TotalMix address. `netstat -an | findstr 900` shows the four ports.

What the app never does:

- It never loads a TotalMix snapshot by itself. `/snapshot/load/N` goes out only at the operator's second press on the slot, and only from a studio build; the desk is then read back. It never stores a snapshot (`/snapshot/save` is never sent) and renames nothing: snapshots and names are TotalMix's (2026-10-01).
- `Sync from TotalMix` only reads.
- Nothing is written while the audio probe has not passed or OSC is off in Setup.
- Closing the app recalls and resets nothing.

Talkback is not used, and the app has none: it sends TotalMix no talkback and reads past the desk's report of it.

Measured on the studio's desk (2026-09), for whoever probes by hand or reads a log:

- Channels count from 0, and the right side of a stereo pair is the left plus 1. The outputs are 0/1 Main, 8/9 Phones 1 and 10/11 Phones 2.
- TotalMix never echoes a write to the remote that sent it. It must be asked (`/sendchan/<input|playback|output>/<ch>`, `/sendsubmix/<out> 2` then `/sendstate`, `/sendsettings`), and answers in one burst about 30 ms later.
- A dump gives a fader in dB, never as a position. `/sendsubmix 2` sends nothing for a mix with no send above −65 dB. `/sendall 2` is 3,100 to 3,500 messages.
- `/output/0/volume` in a dump is the level after dim (−20 dB), so the fader is set before dim is switched off.
- TotalMix sends to a remote only while it hears from it. A command marked `(f)` in RME's table ignores a value under 0.5.
- Playback 1/2 is Windows' sound and 3/4 is vMix's. The preamps are inputs 9 to 12, and which of them has 48 V on changes: compare with the state read before, never with "off".
- The desk's reference state is TotalMix's own snapshot `Mix 1`: Main Out at 0 dB, dim off. It is loaded in TotalMix, or at a second press on its slot in the Console; the app never loads it by itself, and the assistant never loads it.
- TotalMix reports each of its eight snapshots on `/snapshot/load/N` (N from 1): 0 off, 2 active, 3 changed since it was loaded. It takes only `1` there. Whether it reports a load to the remote that sent it is read on the walk; the app marks the slot itself after the read-back when it does not.
- 48 V does not switch when a TotalMix snapshot loads (the owner, 2026-10-01).
- TotalMix's OSC carries no snapshot names. A studio build on the real console reads them from TotalMix's own settings file, `%LOCALAPPDATA%\TotalMixFX\last.<device>.xml` (`SnapshotName 0` to `7`; here `last.FirefaceUFXIII1.xml`), which TotalMix writes when it closes, so a name changed in TotalMix shows after TotalMix has closed once. Development builds and tests never read the file.
- A channel's name comes in TotalMix's dumps as `/input|playback|output/<ch>/name`, and the Console shows it. A channel TotalMix sends no name for keeps the app's.
- The OSC library reads a string only as UTF-8. A datagram it cannot read is lost, and in a bundle so is everything after the element it stopped at.

What `engine.log` says of TotalMix, for the walk (2026-10-01):

- `Load of slot N "<name>" sent to TotalMix:` whether TotalMix reported the load itself (and after how many ms) or the app marked the slot after the read-back, what the read-back brought or why it failed, and the eight slots' states after it. A load that was not sent says why, as a warning.
- `TotalMix's names read from <path>`: how the file was found (by the device's name, or as the only `last.*.xml`), when TotalMix saved it, and the names it held. When there is no file, one line says where it looked; it is written again only when that changes.
- `TotalMix's device:` the name on `/status/device` the first time the link hears it, and again when it changes, with the names file that name points to.
- `Sync's read-back carried …` (or `The read-back after loading …`): every channel name the dump carried, quoted as TotalMix sent it, channels counted from 0.
- `TotalMix sent N datagrams … that could not be read in full`: a warning at once, then once a minute at most, with the bytes where the reading stopped.

## Lights

The engine streams to the Litepanels Apollo Bridge as unicast sACN (E1.31) on UDP port `5568`. The bridge drives the fixtures: Litepanels Astra Bi-Color Soft, Aputure Infinimat 2x4 and Aputure Infinibar PB12.

- The bridge is at `10.1.0.1`. Setup's lighting probe connects to it on TCP port `80`, waiting 1.5 s.
- During a session the studio build looks at the bridge the same way every 5 s. Two silent looks in a row make Lighting read `NOT ANSWERING`, amber, and the header's lamp `not answering`; one answer ends it. It locks nothing: the sACN stream does not need port 80. The watch writes to `engine.log` when the bridge stops answering, when it answers again, and when the kind of answer changes (taken or refused); a single missed look writes nothing. Development runs and tests never look (the simulated lights). The watch is about 17,000 short connections a day to the bridge's web page: the first walk with it checks that the bridge's output stays steady.
- On Windows a refused connection is reported about 2 s after the refusal (Windows tries twice more), later than the probe waits, so a refusal reads as silence. The studio's probe has passed, so the bridge takes the connection on port 80.
- Setup holds the bridge address and the universe, `1` unless changed. New saved data has no address, so nothing is sent.
- The bridge must route that universe to its DMX/CRMX output. Each fixture's DMX address, mode and universe must match its patch on the Lighting page.
- The stream has priority `100` and the source name `SSE ExEd Studio Control`.

`Held` means nothing is sent: no frame, no keep-alive. It is not a blackout: the rig keeps its last look. The DMX monitor shows what would be sent, the header's Lighting lamp reads `held`, and so does the Lighting page (`HELD`). A light output that could not open its port reads `no output`, red.

`Armed` means the rig follows the app. Arming sends the current state within 40 ms.

The switch is `Light outputs` in Setup / Support › Workstation. A start with `SSE_SAFE_START=1` holds the outputs before anything is sent. Set for the Windows account (`setx SSE_SAFE_START 1`), it holds every start. A hold is saved, so later starts are held until the switch arms. Saved data that has never been held is armed. Every restore comes back held, a database backup's and an archive's alike: no backup brings its own setting back.

## Stream Deck

Bitfocus Companion 5.0.6, on this PC, drives the Stream Deck+. Its connection `SSE_Studio_Control` (generic-http 2.7.0) calls the engine's bridge at `http://127.0.0.1:38201`.

- The bridge listens on `127.0.0.1` only and has no fallback port. `SSE_CONTROL_SURFACE_PORT` names another port.
- Every request must carry the bridge token. The app makes it once, as `control-surface.token` in the app-data folder, and writes it into the exported profile. Do not share that file.
- `401` in Companion's log means the profile's token is missing or wrong: export and import again.
- The profile is Companion 5's own format (2026-10-03): layered keys with no top bar, no yellow pressed border and no status icons, an image of its own for every key and strip cell at the deck's size, and the approved layout (`docs/OPERATIONS.md`, Stream Deck). Until then it was Companion's version 9, which Companion upgraded at import, guessing each key's look.
- The images are the deck's look, the screen's (2026-10-03): every fixed word drawn in PT Sans and SSE Adelia in the screen's palette, a picture for each state a key shows, picked by a rule on a word the bridge already sends; only values, names and counts are Companion's own type. `scripts/deck-assets.py` draws them into `native/rust-engine/assets/deck/` with the SSE Adelia installed on this PC: the rendered pictures are committed, the font file never is. A change to the pictures reaches the deck with the next export and Full Reset & Import.
- The profile reads every display once a second in one request, `GET /api/deck/displays` (2026-10-03; until then a request a display, 47 at once). A key's press or a dial's detent sends its action and that one read again. A few thousand sockets in `TIME_WAIT` on port `38201` are normal.
- The answer lands in Companion's custom variable `deck_raw`, whatever it is: generic-http stores an error's body too, and tries a refused read again, twice, up to 3 s later. A trigger keeps it in `deck_displays` only when it carries the bridge's mark (`"sse": "deck"`) and is not older than the one kept, so an error or a late answer never shows. Each line a key or a cell shows is an expression variable read out of `deck_displays`.
- After 4 s without an answer the deck keeps, the deck greys every key and cell and shows no value (`deck_link` reads `lost`): what it showed is no longer known. It comes back with the next answer. An answer it does not keep (an error, a late one) does not count as heard. The deck's page stays where it is: the page-follow triggers read the app's page from the kept answer, which a silence leaves as it was, so the deck turns only when the app's page changes, never when the link comes back.
- A key's own read can be answered before its action is: the display then follows at the next read, within a second.
- The AUDIO dials, setting a level, step five times as far on a fast turn, two detents within 80 ms of each other by their arrival at the bridge: a detent that waited behind the poll is not taken for part of a fast turn. The dials always set a level: a gain mode the old profile's `GAIN` key saved is no longer read (2026-10-03), the dial mode reads `fader` wherever it is reported, and the old `GAIN` key is refused (`501`). Detents that Companion itself bunches before it sends them still look fast.
- The reads are how the app knows Companion runs with the profile. Setup's deck probe passes when one with the token arrived in the last 5 s, and the header's Surface lamp reads `no deck`, amber, while none has. It locks nothing. Companion closed, or a profile without the right token, reads `no deck`. Companion's poll runs whether the Stream Deck is plugged in or not: the deck itself is proven by Setup's `Verify live echo`.
- A display never reads a camera by itself. The hardware link reads the cameras once for all the displays of a poll, as the open Cameras page does once a second, and once for a key, whose own read answers its displays. Every press of every page reads every display again, so the deck's one read keeps the cameras' texts about a second (250 ms while `REC`'s stop is armed): a fast spin of an AUDIO or LIGHTS dial reads the cameras about once a second. `REC`'s take length is counted from the start the hardware link saw: nothing new is asked of a camera.
- `REC` on the deck starts a take with one press and stops it with two, and with nothing else: a press that arrives twice is one press, an armed stop stops the take it was made for and no other, and a press starts no take while the key can still read `STOP?`.
- `ALL OFF` asks as `REC`'s stop does: `OFF?` for 3 s, and the second press acts only on the rig the first asked about. `PLAY`, `DIM`, `PHONES`, a mute and the LIGHT dial's push drop a second press within 350 ms. The hardware link keeps the arm and the moments in memory: a new build with an old profile arms the key without showing it, so the build and the profile go together. An old build with the new profile greys the whole deck (`/api/deck/displays` answers `400`), `PHONES` answers `400` and `RECALL` recalls at once: import the new profile once the new build is on.
- `RECALL` and the SCENE dial's push fade as the Lighting page's recall does, with the page's Fade (saved, 2026-10-03; until then the deck recalled at once). Into the preview a recall loads at once.
- Companion's generic-http connection tries a refused `GET` again, twice, and a `POST` never: a display recovers, a refused key press is lost.
- It stores a reply only in a custom variable that exists already, so the profile brings its own (`deck_raw`, `deck_displays`, `deck_age`).
- The bridge writes one refusal line a minute at most for each status, and counts the rest in it. A key a page refuses (`REC` while CAM 1 is released) is a `WARN` line of its own in `engine.log`, with the key and the reason: one a second at most for each key, counting the rest.
- Companion can press a key without hands (`POST http://127.0.0.1:8000/api/location/<page>/<row>/<column>/press`). With the studio's app running, that drives the real devices.

To put the profile on the deck:

1. Start Companion. The export asks it for the deck, at `http://127.0.0.1:8000`: the page-follow triggers name the deck (`streamdeck:<serial>`), which a trigger needs. A profile exported with Companion closed follows the app's page nowhere.
2. In Setup step 1, export the Companion profile. It lands in the app-data `exports` folder.
3. In Companion's Import / Export page, import it with `Full Reset & Import`, never `Import Preserving Unselected`. The reset puts Companion's settings and the deck's surface settings back to their defaults, the deck's "Horizontal Swipe Changes Page" off among them; the profile cannot carry that setting.
4. In Companion's Surfaces, check that "Horizontal Swipe Changes Page" is off for the deck: a swipe on the strip would turn Companion's page away from the app's.
5. In Setup's Verify step, press each key and dial: its cell pulses.

The pages are `LIGHTS`, `AUDIO`, `CAMERAS` and `PROMPTER`, in the order of the app's tabs. The deck follows the app's page, and each page has one page key, top right, to the page after it; `PROMPTER`'s goes round to `LIGHTS`. When the pages change, export and import again: the deck has a new layout only after the next import.

## Cameras

- **`CAM 1`** is the Blackmagic Pocket Cinema Camera 6K Pro, the only camera that records. Its link is Bluetooth, with Blackmagic's published protocol (service `291D567A-6D75-11E6-8B77-86F30CA893D3`). It is paired once, in Setup: the camera shows a 6-digit PIN.
- **`CAM 2` and `CAM 3`** are Panasonic LUMIX BGH1s on the office network, powered over Ethernet (`172.16.16.85` and `172.16.16.30` when last read). Their link is Panasonic's LUMIX SDK. The SDK takes no address: it finds cameras by an SSDP search from every network adapter, and the app connects only to a found camera whose address is typed into Setup (D29). A LAN connection has a password, which a reset of the camera's network settings clears. The SDK's licence is read first.
- `Release` hands `CAM 1` to the iPad (Bluetooth+), and lets a BGH1 go. `Connect` takes it back. After LUMIX Tether has held a BGH1, the SDK cannot connect to it until its network settings are reset in its menu (Panasonic's note).
- **Pictures.** Each camera's HDMI goes to vMix: `CAM 1` into the DeckLink 8K Pro, one BGH1 through an SDI converter into the DeckLink, the other into a Cam Link 4K. The app gets pictures only as NDI from vMix on this PC, through vMix's Outputs 2, 3 and 4 (D31): in vMix (`Settings › Outputs`) each is pointed at one camera's input and switched to NDI, `CAM 1` on Output 2, `CAM 2` on Output 3, `CAM 3` on Output 4. Output 1 is vMix's own: it is what vMix records and streams. vMix's switch "Cameras / Calls / Audio Inputs" stays off: it would publish the microphones' inputs too. Two Windows firewall rules, made by the owner, keep other machines from vMix's sources (inbound Block on TCP 5960–6100 and 6400–6600 and on UDP 5960–6100). Setup / Support's `CAMERAS` names each camera's output and changes none of it. There is no OBS path.
- **Not built yet:** the links. Until a camera's link is built, the Cameras page reads it `NOT SET UP`, and Setup takes neither its pairing nor its address. The studio's build shows vMix's Outputs 2 to 4 with no switch (D34), its helper loading NDI's library from the build's own folder, held to the pinned hash. A development run shows test pictures from the pictures helper's simulated source, which sends vMix inputs 1 to 4: a camera whose saved input is another (a fixture's; Setup no longer sets it) reads `NO PICTURE`, and the page `PICTURE MISSING`. A development run started with `npm run app -- --vmix-pictures` shows vMix's Outputs 2 to 4 instead (rule 3's exception, below).

What limits the design:

- A DeckLink input belongs to one program at a time, so the app never opens one.
- A BGH1's own network stream switches off its recording, its menus and LUMIX Tether's live view, so it is not used.
- A write to the Pocket's status characteristic can switch the camera off.
- The app never changes a camera or a recording by itself. A start, a reconnect, a restore, a close and a crash send nothing. The camera wins a disagreement.

## Teleprompter

- The Elgato Prompter XL is a 1920×1080 screen on one USB-C cable that carries picture and power (15 W). Windows treats it as one more display, named `Prompter XL`.
- Studio Control knows it by that name and by nothing else. `shell.log`, in the logs folder, names every screen as Windows does, with its refresh rate, at the start, whenever a screen comes or goes, and whenever a rate changes: `The screens: … Prompter XL (60 Hz) 1920×1080 at 5120,0. The Prompter XL is connected, 1920×1080 at 60 Hz.` A Prompter XL that Windows calls otherwise reads there under the name it has.
- **Every screen at 60 Hz** (59.94 or 59.95 Hz where 60 is not offered). Studio Control's windows, the prompter's among them, draw at the main screen's rate, and a copy of the main screen counts: on 2026-10-02 the Samsung beside the CS2731 stood at 30 Hz, and the prompter's text scrolled at 30 frames a second, unevenly. `shell.log` warns of a screen below 50 Hz beside the screens' line: `A screen runs below 50 Hz: SAMSUNG at 30 Hz. …`
- Plugging it in or out leaves Studio Control on the studio display: if Windows moves the window, it is put back a second or two after the screens have stopped changing.
- The studio display switched off, or asleep, is away from Windows' desktop, and Windows moves the window to another screen. Studio Control remembers its display, by the screen's own name, and goes back to it when it returns. **Studio fullscreen** in Setup / Support makes the display the window is sent to its own.
- The app finds it by that name and draws the script there and on no other screen, in a window of its own that fills the screen. The window is put there only once it stands on the Prompter XL's part of the desktop, and it is hidden at once when Windows moves it: Windows moves the windows of a screen that goes.
- The window's page tells the app once a second that it draws. The hardware link hears that the Prompter XL is connected only while it does, so `PLAY` unlocks only with the script on the glass. A page that stops is `NOT SHOWING`, and its window is opened again.
- `shell.log` says each step: `The prompter's window opened on the Prompter XL: 1920×1080 at 5120,0.`, `The prompter's page draws.`, `The hardware link has the Prompter XL as CONNECTED.`
- The taskbar: a window that takes no keyboard cannot ask Windows to hide a taskbar under it. If a taskbar shows on the Prompter XL, switch it off for that screen in Windows' taskbar settings (taskbar behaviours, show my taskbar on all displays).
- The Prompter XL flips what it shows, so the app draws the script unmirrored.
- In Windows' display settings it extends the desktop at 1920×1080. Otherwise the page reads `DUPLICATED` or `LOW RESOLUTION`.
- Set by hand: a black desktop background on the Prompter XL, and Elgato Camera Hub's own prompter off, if Camera Hub is installed.

## Safety rules

The studio build is a build `npm run release` made, which the owner starts on the real saved data. Every other build is a development build.

Always:

- Never let a test write to TotalMix's ports `7001`–`7010` or to the sACN bridge.
- Give every test and development run its own data folder (`SSE_APP_DATA_DIR`), the simulated console (`SSE_AUDIO_SIMULATED_INPUT_MODE=1`), the simulated cameras (`SSE_CAMERAS_SIMULATED=1`), the simulated lights (`SSE_LIGHTS_SIMULATED=1`), a safe start (`SSE_SAFE_START=1`) and a bridge port other than `38201` (`SSE_CONTROL_SURFACE_PORT`), and keep vMix's switch off (`SSE_VMIX_PICTURES`, rule 3's exception). `npm run app` and the test lanes set them all (the lanes refuse vMix's switch), and a development build takes the safe value of any that is not set.
- Open the real saved data, `%APPDATA%\ExEd Studio Control Native`, only with the studio build. A development build refuses it.
- Do not close TotalMix FX, Companion or vMix. They are the owner's to start and stop.
- Never write the Pocket's status characteristic.
- Never scan the network. Talk only to the addresses typed into Setup. Two searches are allowed, with limits: the LUMIX SDK's for the BGH1s (D29), and NDI's for vMix's Outputs 2 to 4 on this PC, only while the pictures helper takes them: in the studio's build, or in a development run under `--vmix-pictures` (D32, D34).

Cameras and the prompter, the six rules the code's comments cite as D15:

1. Use a camera address only once the owner has typed it into Setup. Test builds refuse any address that is not on this PC.
2. Use Bluetooth only in the studio build. Pair once, in Setup, with the owner present.
3. Never open the DeckLink, the Cam Link, a camera stream or an NDI source from a test or a development build. They get test pictures: a still one, or the simulated source's. The one exception is a development run started with `npm run app -- --vmix-pictures`, a hardware test the owner asks for and attends (D33): its pictures helper receives vMix's Outputs 2, 3 and 4 over NDI on this PC, and opens nothing else. Only that command sets its switch; every other run sets it off, the lanes refuse it, the tests remove it, and the helper checks it again.
4. Draw on the Prompter XL only from the studio build. Anything else draws into an ordinary window: a development build's prompter is a window with a frame, wherever the Prompter XL is, and the hardware link is told of a screen of 1920×1080 so that the prompter can be tried.
5. Check against the real cameras only with the owner present and nothing recording. Put back every setting touched.
6. Learn the BGH1's protocol by listening only, and only with the owner's go-ahead at the time.

## Hardware tests

Tests that need a real device are opt-in: `npm run native:test:hardware`. Run them only when the owner asks and is present. Today's one test reads the console and changes nothing. It needs the app closed, because it binds `127.0.0.1:9004`, and `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`.

vMix's pictures in a development run: `npm run app -- --vmix-pictures` (D33), only when the owner asks and is present, with vMix running and Outputs 2, 3 and 4 sent over NDI, and nothing recording until it is known what the pictures cost vMix. It starts only when the NDI SDK's library matches its pin (`native/pictures-link/ndi-library.json`: version and SHA-256). The helper takes only this PC's `vMix - Output 2`, `3` and `4` at one of this PC's addresses, connects while Cameras shows the pictures and for 30 s after, and says in `engine.log` which sources it passed over and, once a minute, what it received. The cameras' links, the lights and the console stay simulated.

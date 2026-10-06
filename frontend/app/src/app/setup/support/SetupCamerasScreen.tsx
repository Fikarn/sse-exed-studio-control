import { useRef, useState } from "react";

import { Key, LampWord, MenuButton, Tooltip, type UseArmResult } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot, JsonValue } from "@sse/engine-client";

import { SetupStepScreen } from "../components/SetupStepScreen";
import type { SetupPilot } from "../useSetupPilot";
import { buildCameraSetupMenu } from "./supportMenus";
import styles from "./SetupCamerasScreen.module.css";

// Setup / Support's third screen: what Studio Control needs to hold each
// camera (D15). CAM 1 is paired, with the operator beside it; CAM 2 and CAM 3
// take the address entered here and no other (D12, D29). Each camera's
// picture comes from its own vMix output, fixed (D31), which the screen names
// and does not change. Saving sends nothing to a camera: the hardware link
// holds the camera and reads it.
//
// The visual overhaul (2026-10-05): each camera is a block of rows under a
// hairline, not a card, with its ⋯ in its head and the same menu on a
// right-click. `Forget CAM n…` is the menu's last item and arms in place: it
// drops a pairing that takes the camera beside you to make again.
//
// The visual overhaul's polish (2026-10-05): the hardware link's sentence
// about a camera is its state word's tooltip, the pairing a word with its
// lamp, and the blocks reach the well's padding, as the other screens do.
//
// In a build with no link to a camera (`setup.noLink`) its pairing and its
// address are locked, with the hardware link's sentence on screen.
//
// CAM 1's pairing is two steps (the Pocket's link, 2026-10-06): `Pair CAM 1`
// begins it, and once the camera shows its 6-digit PIN a PIN row stands under
// the pairing, with a `Pair` key that hands the PIN over. The pairing's step
// is said under the rows as the hardware link words it (`setup.pairing`).

const PIN_DIGITS = 6;

const cameraNumber = (camera: CameraSnapshot): CameraNumber => (camera.camera === 2 ? 2 : camera.camera === 3 ? 3 : 1);

/** The answer's camera is paired now (`{ camera, setup }`). */
const pairedNow = (answer: JsonValue): boolean => {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return false;
  const setup = answer.setup;
  return setup !== null && typeof setup === "object" && !Array.isArray(setup) && setup.paired === true;
};

/** `CAM 2 and CAM 3`. */
const tagsOf = (cameras: CameraSnapshot[]) =>
  cameras.length < 2
    ? (cameras[0]?.tag ?? "")
    : `${cameras
        .slice(0, -1)
        .map((camera) => camera.tag)
        .join(", ")} and ${cameras[cameras.length - 1]!.tag}`;

/** What the screen says of the cameras this version has no link to; `null` when it has one to each. */
function noLinkRule(cameras: CameraSnapshot[]): string | null {
  const unlinked = cameras.filter((camera) => camera.setup.noLink !== null);
  if (unlinked.length === 0) return null;
  if (unlinked.length === cameras.length || unlinked.some((camera) => camera.link === "bluetooth")) {
    return "This version has no link to the cameras yet, so it takes no pairing and no address.";
  }
  return `This version has no link to ${tagsOf(unlinked)} yet, so it takes no address for ${
    unlinked.length === 1 ? "it" : "them"
  }.`;
}

export interface SetupCamerasScreenProps {
  editor: SetupPilot;
  camerasSnapshot: CamerasSnapshot | null;
}

function CameraBlock({
  camera,
  address,
  pin,
  busy,
  arm,
  onAddress,
  onSaveAddress,
  onPin,
  onPair,
  onSendPin,
  onForget,
}: {
  camera: CameraSnapshot;
  address: string;
  pin: string;
  busy: boolean;
  arm: UseArmResult;
  onAddress: (value: string) => void;
  onSaveAddress: () => void;
  onPin: (value: string) => void;
  onPair: () => void;
  onSendPin: () => void;
  onForget: () => void;
}) {
  const blockRef = useRef<HTMLElement | null>(null);
  const locked = camera.setup.noLink;
  const addressChanged = address.trim() !== "" && address.trim() !== (camera.setup.address ?? "");
  const pairing = camera.setup.pairing;
  // Looking for the camera, or Windows pairing it: a new pairing waits until it ends.
  const pairingRuns = pairing?.state === "finding" || pairing?.state === "pairing";
  const pinWanted = pairing?.state === "pin";
  const pinComplete = pin.length === PIN_DIGITS;
  return (
    <section
      ref={blockRef}
      className={styles.camera}
      aria-label={camera.tag}
      data-testid={`setup-camera-${camera.camera}`}
    >
      <header className={styles.head}>
        <span className={styles.tag}>{camera.tag}</span>
        <span className={styles.model}>{camera.model}</span>
        {/* The record's test id stays on what holds the sentence. */}
        <span data-testid={`setup-camera-record-${camera.camera}`}>
          <Tooltip content={camera.sentence} placement="bottom">
            <LampWord tone={camera.tone} testId={`setup-camera-${camera.camera}-state`}>
              {camera.word}
            </LampWord>
          </Tooltip>
        </span>
        <MenuButton
          buttonLabel={`${camera.tag} menu`}
          buttonTestId={`setup-camera-menu-${camera.camera}`}
          contextTarget={blockRef}
          menu={{
            ...buildCameraSetupMenu({
              camera: camera.camera,
              tag: camera.tag,
              model: camera.model,
              bluetooth: camera.link === "bluetooth",
              paired: camera.setup.paired,
              // Forget also stops a pairing that runs.
              setUp: camera.setup.setUp || (pairing !== null && pairing.state !== "failed"),
              noLink: locked,
              busy,
              onPair,
              onForget,
            }),
            arm,
          }}
        />
      </header>

      {camera.link === "bluetooth" ? (
        <div className={styles.row}>
          <span className={styles.label}>Pairing</span>
          <LampWord
            tone={camera.setup.paired ? "ok" : "attention"}
            className={styles.pairing}
            testId={`setup-camera-${camera.camera}-paired`}
          >
            {camera.setup.paired ? "paired" : "not paired"}
          </LampWord>
          <Tooltip content={`Pair with ${camera.tag} beside you: it shows a 6-digit PIN.`} placement="left">
            <span className={styles.keyCell}>
              <Key
                size="small"
                disabled={busy}
                locked={locked !== null || camera.setup.paired || pairingRuns}
                reason={
                  locked ??
                  (camera.setup.paired
                    ? `${camera.tag} is paired already.`
                    : pairingRuns
                      ? pairing.sentence
                      : undefined)
                }
                testId={`setup-camera-${camera.camera}-pair`}
                onClick={onPair}
              >
                Pair {camera.tag}
              </Key>
            </span>
          </Tooltip>
        </div>
      ) : (
        <div className={styles.row}>
          <span className={styles.label} id={`setup-camera-${camera.camera}-address-label`}>
            Address
          </span>
          <input
            className={styles.address}
            aria-labelledby={`setup-camera-${camera.camera}-address-label`}
            disabled={busy || locked !== null}
            inputMode="decimal"
            autoComplete="off"
            // What Setup holds, not an example: an example here reads as a camera's address.
            placeholder="no address"
            value={address}
            data-testid={`setup-camera-${camera.camera}-address`}
            onChange={(event) => onAddress(event.target.value)}
          />
          <Key
            size="small"
            disabled={busy}
            locked={locked !== null || !addressChanged}
            reason={
              locked ??
              (address.trim() === ""
                ? `Enter ${camera.tag}'s address first.`
                : `This is the address Setup holds for ${camera.tag}.`)
            }
            testId={`setup-camera-${camera.camera}-save-address`}
            onClick={onSaveAddress}
          >
            Save address
          </Key>
        </div>
      )}

      {pinWanted ? (
        <div className={styles.row}>
          <span className={styles.label} id={`setup-camera-${camera.camera}-pin-label`}>
            PIN
          </span>
          <input
            className={styles.address}
            aria-labelledby={`setup-camera-${camera.camera}-pin-label`}
            disabled={busy}
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_DIGITS}
            placeholder={`the ${PIN_DIGITS} digits ${camera.tag} shows`}
            value={pin}
            data-testid={`setup-camera-${camera.camera}-pin`}
            onChange={(event) => onPin(event.target.value.replace(/[^0-9]/g, "").slice(0, PIN_DIGITS))}
          />
          <Key
            size="small"
            disabled={busy}
            locked={!pinComplete}
            reason={pinComplete ? undefined : `Enter the ${PIN_DIGITS} digits ${camera.tag} shows.`}
            testId={`setup-camera-${camera.camera}-send-pin`}
            onClick={onSendPin}
          >
            Pair
          </Key>
        </div>
      ) : null}

      <div className={styles.row}>
        <span className={styles.label}>Picture</span>
        <span className={styles.value} data-testid={`setup-camera-${camera.camera}-output`}>
          vMix Output {camera.setup.vmixOutput}
        </span>
        <span />
      </div>

      {pairing ? (
        <p className={styles.step} data-state={pairing.state} data-testid={`setup-camera-${camera.camera}-pairing`}>
          {pairing.sentence}
        </p>
      ) : null}

      {/* A lock's reason stays on screen. */}
      {locked ? (
        <p className={styles.locked} data-testid={`setup-camera-${camera.camera}-no-link`}>
          {locked}
        </p>
      ) : null}
    </section>
  );
}

export function SetupCamerasScreen({ editor, camerasSnapshot }: SetupCamerasScreenProps) {
  const { store } = editor.props;
  const { busyAction, arm } = editor.state;
  const { performAction } = editor.actions;
  // What was typed and not saved yet; a field without an entry shows what Setup holds.
  const [addresses, setAddresses] = useState<Partial<Record<CameraNumber, string>>>({});
  // The PIN CAM 1 shows, as typed; handed over by its `Pair` key.
  const [pin, setPin] = useState("");
  const busy = busyAction !== null;
  const cameras = camerasSnapshot?.cameras ?? [];
  const noLink = noLinkRule(cameras);

  const without = <Value,>(held: Partial<Record<CameraNumber, Value>>, camera: CameraNumber) => {
    const rest = { ...held };
    delete rest[camera];
    return rest;
  };

  const saveAddress = (camera: CameraSnapshot, address: string) =>
    void performAction(`camera-address-${camera.camera}`, async () => {
      await store.updateCameraSetup({ camera: cameraNumber(camera), address });
      setAddresses((held) => without(held, cameraNumber(camera)));
      return {
        message: `${camera.tag}'s address is saved. Studio Control holds ${camera.tag} now; nothing was sent to it.`,
        tone: "ok" as const,
      };
    });

  // The pairing's step stands under CAM 1's rows; the feedback says only that it paired.
  const pair = (camera: CameraSnapshot) =>
    void performAction("camera-pair", async () => {
      setPin("");
      await store.pairCamera(cameraNumber(camera));
      return null;
    });

  const sendPin = (camera: CameraSnapshot) =>
    void performAction("camera-pin", async () => {
      const answer = await store.pairCamera(cameraNumber(camera), pin);
      setPin("");
      return pairedNow(answer)
        ? { message: `${camera.tag} is paired. Studio Control holds it now.`, tone: "ok" as const }
        : null;
    });

  const forgetCamera = (camera: CameraSnapshot) =>
    void performAction(`camera-forget-${camera.camera}`, async () => {
      await store.forgetCamera(cameraNumber(camera));
      setAddresses((held) => without(held, cameraNumber(camera)));
      return {
        message:
          camera.link === "bluetooth"
            ? `${camera.tag}'s pairing is forgotten.`
            : `${camera.tag}'s address is forgotten.`,
        tone: "ok" as const,
      };
    });

  return (
    <SetupStepScreen
      title="Camera setup"
      lead="What Studio Control needs to hold each camera: CAM 1's pairing and CAM 2's and CAM 3's addresses. Studio Control connects only to a camera whose address is entered here. Each picture comes from its own vMix output; saving sends nothing to a camera."
      wide
      rules={noLink ? [{ id: "no-link", text: noLink, tone: "attention" }] : []}
      facts={
        camerasSnapshot ? (
          cameras.map((camera) => {
            const number = cameraNumber(camera);
            const address = addresses[number] ?? camera.setup.address ?? "";
            return (
              <CameraBlock
                key={camera.camera}
                camera={camera}
                address={address}
                pin={pin}
                busy={busy}
                arm={arm}
                onAddress={(value) => setAddresses((held) => ({ ...held, [number]: value }))}
                onSaveAddress={() => saveAddress(camera, address.trim())}
                onPin={setPin}
                onPair={() => pair(camera)}
                onSendPin={() => sendPin(camera)}
                onForget={() => forgetCamera(camera)}
              />
            );
          })
        ) : (
          <p className={styles.waiting} data-testid="setup-cameras-waiting">
            Reading the cameras…
          </p>
        )
      }
      testId="setup-screen-cameras"
    />
  );
}

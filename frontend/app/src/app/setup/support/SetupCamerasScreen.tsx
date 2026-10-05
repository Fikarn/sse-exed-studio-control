import { useRef, useState } from "react";

import { Key, LampWord, MenuButton, Tooltip, type UseArmResult } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

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
// In a build with no link to a camera (`setup.noLink`) its pairing and its
// address are locked, with the hardware link's sentence on screen.

const cameraNumber = (camera: CameraSnapshot): CameraNumber => (camera.camera === 2 ? 2 : camera.camera === 3 ? 3 : 1);

export interface SetupCamerasScreenProps {
  editor: SetupPilot;
  camerasSnapshot: CamerasSnapshot | null;
}

function CameraBlock({
  camera,
  address,
  busy,
  arm,
  onAddress,
  onSaveAddress,
  onPair,
  onForget,
}: {
  camera: CameraSnapshot;
  address: string;
  busy: boolean;
  arm: UseArmResult;
  onAddress: (value: string) => void;
  onSaveAddress: () => void;
  onPair: () => void;
  onForget: () => void;
}) {
  const blockRef = useRef<HTMLElement | null>(null);
  const locked = camera.setup.noLink;
  const addressChanged = address.trim() !== "" && address.trim() !== (camera.setup.address ?? "");
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
        <LampWord tone={camera.tone} testId={`setup-camera-${camera.camera}-state`}>
          {camera.word}
        </LampWord>
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
              setUp: camera.setup.setUp,
              noLink: locked,
              busy,
              onPair,
              onForget,
            }),
            arm,
          }}
        />
      </header>
      {/* The hardware link's sentence about the camera, as the Cameras page prints it. */}
      <p className={styles.sentence} data-testid={`setup-camera-record-${camera.camera}`}>
        {camera.sentence}
      </p>

      {camera.link === "bluetooth" ? (
        <div className={styles.row}>
          <span className={styles.label}>Pairing</span>
          <span className={styles.value} data-testid={`setup-camera-${camera.camera}-paired`}>
            {camera.setup.paired ? "paired" : "not paired"}
          </span>
          <Tooltip content={`Pair with ${camera.tag} beside you: it shows a 6-digit PIN.`} placement="left">
            <span className={styles.keyCell}>
              <Key
                size="small"
                disabled={busy}
                locked={locked !== null || camera.setup.paired}
                reason={locked ?? (camera.setup.paired ? `${camera.tag} is paired already.` : undefined)}
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

      <div className={styles.row}>
        <span className={styles.label}>Picture</span>
        <span className={styles.value} data-testid={`setup-camera-${camera.camera}-output`}>
          vMix Output {camera.setup.vmixOutput}
        </span>
        <span />
      </div>

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
  const { bayHead } = editor.chrome;
  const { busyAction, arm } = editor.state;
  const { performAction } = editor.actions;
  // What was typed and not saved yet; a field without an entry shows what Setup holds.
  const [addresses, setAddresses] = useState<Partial<Record<CameraNumber, string>>>({});
  const busy = busyAction !== null;
  const cameras = camerasSnapshot?.cameras ?? [];
  const noLink = cameras.find((camera) => camera.setup.noLink !== null) ?? null;

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

  const pair = (camera: CameraSnapshot) =>
    void performAction("camera-pair", async () => {
      await store.pairCamera(cameraNumber(camera));
      return {
        message: `${camera.tag} is paired. Studio Control holds it now; nothing was sent to it.`,
        tone: "ok" as const,
      };
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
      head={bayHead}
      eyebrow="Cameras"
      title="Camera setup"
      lead="What Studio Control needs to hold each camera: CAM 1's pairing and CAM 2's and CAM 3's addresses. Studio Control connects only to a camera whose address is entered here. Each picture comes from its own vMix output; saving sends nothing to a camera."
      wide
      rules={
        noLink
          ? [
              {
                id: "no-link",
                text: "This version has no link to the cameras yet, so it takes no pairing and no address.",
                tone: "attention",
              },
            ]
          : []
      }
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
                busy={busy}
                arm={arm}
                onAddress={(value) => setAddresses((held) => ({ ...held, [number]: value }))}
                onSaveAddress={() => saveAddress(camera, address.trim())}
                onPair={() => pair(camera)}
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

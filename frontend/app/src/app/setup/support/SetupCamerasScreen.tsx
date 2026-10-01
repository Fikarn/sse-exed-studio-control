import { useState } from "react";

import { Key, LampWord } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { SetupRecordHeading, SetupRecordRow, SetupStepScreen } from "../components/SetupStepScreen";
import pilotStyles from "../SetupSupportPilot.module.css";
import type { SetupPilot } from "../useSetupPilot";
import styles from "./SetupCamerasScreen.module.css";

// Setup / Support's third screen: what Studio Control needs to hold each
// camera (D15). CAM 1 is paired, with the operator beside it; CAM 2 and CAM 3
// take the address entered here and no other (D12: nothing scans the
// network). Each camera's picture comes from its own vMix output, fixed
// (D31), which the screen names and does not change. Saving sends nothing to
// a camera: the hardware link holds the camera and reads it.
//
// In a build with no link to a camera (`setup.noLink`) its pairing and its
// address are locked, with the hardware link's sentence; Forget stays.

const cameraNumber = (camera: CameraSnapshot): CameraNumber => (camera.camera === 2 ? 2 : camera.camera === 3 ? 3 : 1);

export interface SetupCamerasScreenProps {
  editor: SetupPilot;
  camerasSnapshot: CamerasSnapshot | null;
}

export function SetupCamerasScreen({ editor, camerasSnapshot }: SetupCamerasScreenProps) {
  const { store } = editor.props;
  const { bayHead } = editor.chrome;
  const { busyAction } = editor.state;
  const { performAction } = editor.actions;
  // What was typed and not saved yet; a field without an entry shows what Setup holds.
  const [addresses, setAddresses] = useState<Partial<Record<CameraNumber, string>>>({});
  const busy = busyAction !== null;
  const cameras = camerasSnapshot?.cameras ?? [];
  const noLink = cameras.find((camera) => camera.setup.noLink !== null) ?? null;

  const forget = <Value,>(held: Partial<Record<CameraNumber, Value>>, camera: CameraNumber) => {
    const rest = { ...held };
    delete rest[camera];
    return rest;
  };

  const saveAddress = (camera: CameraSnapshot, address: string) =>
    void performAction(`camera-address-${camera.camera}`, async () => {
      await store.updateCameraSetup({ camera: cameraNumber(camera), address });
      setAddresses((held) => forget(held, cameraNumber(camera)));
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
      setAddresses((held) => forget(held, cameraNumber(camera)));
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
      lead="What Studio Control needs to hold each camera: CAM 1's pairing and CAM 2's and CAM 3's addresses. Each picture comes from its own vMix output. Saving sends nothing to a camera."
      rules={[
        {
          id: "addresses",
          text: "Studio Control contacts only an address entered here. It never looks for cameras on the network.",
          tone: "ok",
        },
        ...(noLink
          ? [
              {
                id: "no-link",
                text: "This version has no link to the cameras yet, so it takes no pairing and no address.",
                tone: "attention" as const,
              },
            ]
          : []),
      ]}
      facts={
        camerasSnapshot ? (
          cameras.map((camera) => {
            const number = cameraNumber(camera);
            const locked = camera.setup.noLink;
            const address = addresses[number] ?? camera.setup.address ?? "";
            const addressChanged = address.trim() !== "" && address.trim() !== (camera.setup.address ?? "");
            return (
              <section
                key={camera.camera}
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
                </header>

                {camera.link === "bluetooth" ? (
                  <div className={styles.row}>
                    <span className={styles.label}>Pairing</span>
                    <span className={styles.value} data-testid={`setup-camera-${camera.camera}-paired`}>
                      {camera.setup.paired ? "paired" : "not paired"}
                    </span>
                    <Key
                      size="small"
                      disabled={busy}
                      locked={locked !== null || camera.setup.paired}
                      reason={locked ?? (camera.setup.paired ? `${camera.tag} is paired already.` : undefined)}
                      testId={`setup-camera-${camera.camera}-pair`}
                      onClick={() => pair(camera)}
                    >
                      Pair {camera.tag}
                    </Key>
                  </div>
                ) : (
                  <label className={styles.row}>
                    <span className={styles.label}>Address</span>
                    <input
                      className={pilotStyles.textField}
                      disabled={busy || locked !== null}
                      inputMode="decimal"
                      // What Setup holds, not an example: an example here reads as a camera's address.
                      placeholder="no address"
                      value={address}
                      data-testid={`setup-camera-${camera.camera}-address`}
                      onChange={(event) => setAddresses((held) => ({ ...held, [number]: event.target.value }))}
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
                      onClick={() => saveAddress(camera, address.trim())}
                    >
                      Save address
                    </Key>
                  </label>
                )}

                <div className={styles.row}>
                  <span className={styles.label}>Picture</span>
                  <span className={styles.value} data-testid={`setup-camera-${camera.camera}-output`}>
                    vMix Output {camera.setup.vmixOutput}
                  </span>
                  <span />
                </div>

                <div className={styles.foot}>
                  {locked ? (
                    <span className={styles.locked} data-testid={`setup-camera-${camera.camera}-no-link`}>
                      {locked}
                    </span>
                  ) : (
                    <span />
                  )}
                  <Key
                    size="small"
                    disabled={busy}
                    locked={!camera.setup.setUp}
                    reason={`${camera.tag} is not set up, so there is nothing to forget.`}
                    testId={`setup-camera-${camera.camera}-forget`}
                    onClick={() => forgetCamera(camera)}
                  >
                    Forget {camera.tag}
                  </Key>
                </div>
              </section>
            );
          })
        ) : (
          <p className={styles.waiting} data-testid="setup-cameras-waiting">
            Reading the cameras…
          </p>
        )
      }
      note="Pairing CAM 1 is done with the camera beside you, showing its PIN."
      record={
        <>
          <SetupRecordHeading>The cameras, as the hardware link holds them</SetupRecordHeading>
          {cameras.map((camera) => (
            <div key={camera.camera} className={pilotStyles.probeRecord}>
              <SetupRecordRow
                label={camera.tag}
                value={camera.word.toLowerCase()}
                tone={camera.tone}
                testId={`setup-camera-record-${camera.camera}`}
              />
              <div className={pilotStyles.checkDetail}>{camera.sentence}</div>
            </div>
          ))}
        </>
      }
      testId="setup-screen-cameras"
    />
  );
}

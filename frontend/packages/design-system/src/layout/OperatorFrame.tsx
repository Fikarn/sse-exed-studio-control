import type { ReactNode } from "react";
import styles from "./OperatorFrame.module.css";

export interface OperatorFrameProps {
  children: ReactNode;
  contextRail: ReactNode;
  monitorRail: ReactNode;
  workspaceRail: ReactNode;
}

export const OperatorFrame = ({
  children,
  contextRail,
  monitorRail,
  workspaceRail
}: OperatorFrameProps) => {
  return (
    <div className={styles.frame}>
      <header className={styles.monitorRail}>{monitorRail}</header>
      <aside className={styles.workspaceRail}>{workspaceRail}</aside>
      <main className={styles.main}>{children}</main>
      <aside className={styles.contextRail}>{contextRail}</aside>
    </div>
  );
};

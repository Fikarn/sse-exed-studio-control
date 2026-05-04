export type StudioWall = "north" | "east" | "south" | "west";

export interface StudioDoor {
  wall: StudioWall;
  offsetMeters: number;
  widthMeters: number;
}

export interface StudioControlBoothWindow {
  wall: "south";
  offsetMeters: number;
  widthMeters: number;
}

export interface StudioWalls {
  backdrop: boolean;
  door?: StudioDoor;
  controlBoothWindow?: StudioControlBoothWindow;
}

export interface StudioBenchElement {
  kind: "bench";
  xMeters: number;
  yMeters: number;
  widthMeters: number;
  depthMeters: number;
  label: string;
}

export type StudioSetElement = StudioBenchElement;

export interface StudioTalentMark {
  id: string;
  xMeters: number;
  yMeters: number;
  label: string;
}

export interface StudioCamera {
  id: string;
  xMeters: number;
  yMeters: number;
  rotationDegrees: number;
  label: string;
}

export interface StudioLayout {
  roomWidthMeters: number;
  roomDepthMeters: number;
  walls: StudioWalls;
  setElements: readonly StudioSetElement[];
  talentMarks: readonly StudioTalentMark[];
  cameras: readonly StudioCamera[];
}

export const STUDIO_LAYOUT: StudioLayout = {
  roomWidthMeters: 12,
  roomDepthMeters: 8,
  walls: {
    backdrop: true,
    door: { wall: "east", offsetMeters: 5.6, widthMeters: 1.3 },
    controlBoothWindow: { wall: "south", offsetMeters: 2.2, widthMeters: 1.7 },
  },
  setElements: [
    {
      kind: "bench",
      xMeters: 6,
      yMeters: 2.3,
      widthMeters: 1.4,
      depthMeters: 0.3,
      label: "Bench",
    },
  ],
  talentMarks: [
    { id: "talent-1", label: "Talent 1", xMeters: 4.7, yMeters: 4.7 },
    { id: "talent-2", label: "Talent 2", xMeters: 6.0, yMeters: 4.7 },
    { id: "talent-3", label: "Talent 3", xMeters: 7.3, yMeters: 4.7 },
  ],
  cameras: [
    { id: "cam-a", xMeters: 6.0, yMeters: 7.2, rotationDegrees: 0, label: "CAM A" },
    { id: "cam-b", xMeters: 9.4, yMeters: 6.7, rotationDegrees: -25, label: "CAM B" },
  ],
};

export interface JointControl {
  real: boolean;
  name: string;
  angle: number;
  joint: any;
}

export interface SendTargetModel {
  x: number;
  y: number;
  z: number;
}

export interface ReverseKResponseModel {
  [jointName: string]: number;
}

export interface TargetFrame {
  time: number;   // seconds since recording started
  x: number;
  y: number;
  z: number;
}

export interface Sequence {
  name: string;
  createdAt: string;      // ISO timestamp
  frames: TargetFrame[];
}

export interface setMotorAngleModel {
  motor: string;
  angle: number;
}

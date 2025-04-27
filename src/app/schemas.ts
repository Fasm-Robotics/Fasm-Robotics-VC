export interface JointControl {
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

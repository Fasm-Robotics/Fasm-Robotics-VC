import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import {MotorAngleResponse, ReverseKResponseModel, SendTargetModel, setMotorAngleModel} from "../../app/schemas";

@Injectable({
  providedIn: 'root'
})
export class PositionApiService {
  baseUrlRealReverse = 'http://127.0.0.1:8000/reverseK';
  baseUrlPreviewReverse = 'http://127.0.0.1:8000/preview-reverseK';
  baseUrlSetClosedLoop = 'http://127.0.0.1:8000/set-closed-loop'
  baseUrlSetIdle = 'http://127.0.0.1:8000/set-idle';
  baseUrlCalibrateSync = 'http://127.0.0.1:8000/calibrate-sync';
  baseUrlSetMotorAngle = 'http://127.0.0.1:8000/set-motor-angle';
  baseUrlGetMotorAngle = 'http://127.0.0.1:8000/get-motor-angle';
  dataSetData = {
    "motors" : [
      "SH1",
      "SH2",
      "SH3"
    ]
  }
  constructor(private http: HttpClient) { }

  getReverseK(data: SendTargetModel) {
    return this.http.post<ReverseKResponseModel>(this.baseUrlRealReverse, data);
  }
  getPreviewReverseK(data: SendTargetModel) {
    return this.http.post<ReverseKResponseModel>(this.baseUrlPreviewReverse, data);
  }

  setClosedLoop() {
    return this.http.post(this.baseUrlSetClosedLoop, this.dataSetData);
  }

  setIdle() {
    return this.http.post(this.baseUrlSetIdle, this.dataSetData);
  }

  calibrateSync(){
    return this.http.post(this.baseUrlCalibrateSync, this.dataSetData);
  }

  setMotorAngle(data : setMotorAngleModel) {
    return this.http.post(this.baseUrlSetMotorAngle, data);
  }

  getMotorAngle(nameMotor: string) {
    // fill in parameter "motor" = nameMotor
    const data = {
      "motor": nameMotor
    };
    return this.http.get<MotorAngleResponse>(this.baseUrlGetMotorAngle, {params: data});
  }
}

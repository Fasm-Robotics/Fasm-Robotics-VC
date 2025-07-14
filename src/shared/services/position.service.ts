import { Injectable } from '@angular/core';
import { PositionApiService } from './position.api.service';
import {MotorAngleResponse, ReverseKResponseModel, SendTargetModel, setMotorAngleModel} from '../../app/schemas';
import {map} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PositionService {
  constructor(private positionApiService: PositionApiService) { }

  getReverseK(data: SendTargetModel) {
    return this.positionApiService.getReverseK(data)
      .pipe(
        map((response: ReverseKResponseModel) => response)
      );
  }
  getPreviewReverseK(data: SendTargetModel) {
    return this.positionApiService.getPreviewReverseK(data)
      .pipe(
        map((response: ReverseKResponseModel) => response)
      );
  }

  setClosedLoop() {
    return this.positionApiService.setClosedLoop()
      .pipe(
        map(response => response)
      );
  }

  setIdle() {
    return this.positionApiService.setIdle()
      .pipe(
        map(response => response)
      );
  }

  calibrateSync() {
    return this.positionApiService.calibrateSync()
      .pipe(
        map(response => response)
      );
  }

  setMotorAngle(data: setMotorAngleModel) {
    return this.positionApiService.setMotorAngle(data)
      .pipe(
        map(response => response)
      );
  }

  getMotorAngle(nameMotor: string) {
    return this.positionApiService.getMotorAngle(nameMotor)
      .pipe(
        map((response: MotorAngleResponse) => response)
      );
  }
}

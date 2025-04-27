import { Injectable } from '@angular/core';
import { PositionApiService } from './position.api.service';
import { ReverseKResponseModel, SendTargetModel } from '../../app/schemas';
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
}

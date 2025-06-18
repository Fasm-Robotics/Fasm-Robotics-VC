import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import { ReverseKResponseModel, SendTargetModel } from "../../app/schemas";

@Injectable({
  providedIn: 'root'
})
export class PositionApiService {
  baseUrlRealReverse = 'http://127.0.0.1:8000/reverseK';
  baseUrlPreviewReverse = 'http://127.0.0.1:8000/preview-reverseK';
  constructor(private http: HttpClient) { }

  getReverseK(data: SendTargetModel) {
    return this.http.post<ReverseKResponseModel>(this.baseUrlRealReverse, data);
  }
  getPreviewReverseK(data: SendTargetModel) {
    return this.http.post<ReverseKResponseModel>(this.baseUrlPreviewReverse, data);
  }
}

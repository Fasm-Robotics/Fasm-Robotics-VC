import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import { ReverseKResponseModel, SendTargetModel } from "../../app/schemas";

@Injectable({
  providedIn: 'root'
})
export class PositionApiService {
  baseUrl = 'http://127.0.0.1:8000/reverseK';
  constructor(private http: HttpClient) { }

  getReverseK(data: SendTargetModel) {
    return this.http.post<ReverseKResponseModel>(this.baseUrl, data);
  }
}

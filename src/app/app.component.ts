import { Component } from '@angular/core';
import {UrdfViewerComponent} from './urdf-viewer/urdf-viewer.component';
import {CameraWindowComponent} from './camera-window/camera-window.component';
import {NgIf} from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [
    UrdfViewerComponent,
    CameraWindowComponent,
    NgIf
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Fasm-Robotics-VC';
  showCamera = true;
  cameraShoulderAngles = { x: 0, y: 0, z: 0 };
  cameraElbowAngle = 0;

  onArmAngles(a: {x:number;y:number;z:number}) { this.cameraShoulderAngles = a; }
  onElbowAngle(e: number) { this.cameraElbowAngle = e; }


  toggleCamera() {
    this.showCamera = !this.showCamera;
  }
}

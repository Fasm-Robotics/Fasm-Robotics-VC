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
  cameraSH2Angle = 0;
  cameraSH3Angle = 0;

  onElbowAngle(e: number) { 
    this.cameraElbowAngle = e;
  }

  onSH2Angle(s: number) {
    this.cameraSH2Angle = s;
  }

  onSH3Angle(s: number) {
    this.cameraSH3Angle = s;
  }

  toggleCamera() {
    this.showCamera = !this.showCamera;
  }
}

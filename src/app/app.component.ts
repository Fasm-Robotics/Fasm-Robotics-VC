import { Component } from '@angular/core';
import {UrdfViewerComponent} from './urdf-viewer/urdf-viewer.component';

@Component({
  selector: 'app-root',
  imports: [
    UrdfViewerComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Fasm-Robotics-VC';
}

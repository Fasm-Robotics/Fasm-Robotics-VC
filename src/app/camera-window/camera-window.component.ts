import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-camera-window',
  imports: [NgIf],
  templateUrl: './camera-window.component.html',
  styleUrl: './camera-window.component.scss'
})
export class CameraWindowComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;

  cameraActive = false;
  cameraSupported = true;
  errorMessage = '';
  stream: MediaStream | null = null;
  isMinimized = false;

  ngOnInit() {
    this.checkCameraSupport();
  }

  ngOnDestroy() {
    this.stopCamera();
  }

  checkCameraSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.cameraSupported = false;
      this.errorMessage = 'Camera not supported in this browser';
    }
  }

  async startCamera() {
    try {
      this.errorMessage = '';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      this.stream = stream;
      if (this.videoElement) {
        this.videoElement.nativeElement.srcObject = stream;
        this.videoElement.nativeElement.play();
        this.cameraActive = true;
      }
    } catch (error: any) {
      this.errorMessage = `Camera error: ${error.message}`;
      this.cameraActive = false;
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.cameraActive = false;
    }
  }

  toggleCamera() {
    if (this.cameraActive) {
      this.stopCamera();
    } else {
      this.startCamera();
    }
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
  }

  toggleFullscreen() {
    if (this.videoElement) {
      const element = this.videoElement.nativeElement;
      if (!document.fullscreenElement) {
        element.requestFullscreen().catch(err => {
          this.errorMessage = `Error attempting to enable fullscreen: ${err.message}`;
        });
      } else {
        document.exitFullscreen();
      }
    }
  }
}

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { NgIf } from '@angular/common';

import {
  FilesetResolver,
  PoseLandmarker,
  PoseLandmarkerResult
} from '@mediapipe/tasks-vision';

// Exponential smoothing filter
class SmoothingFilter {
  private prev: number | null = null;
  constructor(private smoothingFactor = 0.85) {}
  
  update(v: number): number {
    if (this.prev === null) this.prev = v;
    else this.prev = this.smoothingFactor * this.prev + (1 - this.smoothingFactor) * v;
    return this.prev;
  }
  
  reset() {
    this.prev = null;
  }
}

@Component({
  selector: 'app-camera-window',
  imports: [NgIf],
  templateUrl: './camera-window.component.html',
  styleUrl: './camera-window.component.scss'
})
export class CameraWindowComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayCanvas', { static: false }) overlayCanvas!: ElementRef<HTMLCanvasElement>;
  @Output() elbowAngle = new EventEmitter<number>();
  @Output() sh2Angle = new EventEmitter<number>();
  @Output() sh3Angle = new EventEmitter<number>();

  cameraActive = false;
  cameraSupported = true;
  errorMessage = '';
  stream: MediaStream | null = null;
  isMinimized = false;

  calibrationStatus = 'Initializing...';
  calibrationTimeRemaining = 0;

  // ---- Pose tracking
  private poseLandmarker: PoseLandmarker | null = null;
  private rafId: number | null = null;

  // MediaPipe Pose indices (BlazePose 33)
  private readonly RIGHT_SHOULDER = 12;
  private readonly RIGHT_ELBOW = 14;
  private readonly RIGHT_WRIST = 16;

  private readonly VISIBILITY_THRESHOLD = 0.6;

  private readonly ELBOW_MIN = 0;
  private readonly ELBOW_MAX = 135;
  private readonly ELBOW_MAX_DISTANCE = 0.4;
  
  private readonly SH2_MIN = -90;
  private readonly SH2_MAX = 180;
  
  private readonly SH3_MIN = -70;
  private readonly SH3_MAX = 180;
  
  private readonly CALIBRATION_TIME_MS = 5000;
  
  private smoothingFilterElbow = new SmoothingFilter(0.85);
  private smoothingFilterSH2 = new SmoothingFilter(0.85);
  private smoothingFilterSH3 = new SmoothingFilter(0.85);
  
  private distanceCalibrationReference: number | null = null;
  private sh3CalibrationReference: number | null = null;
  private calibrationStartTime: number | null = null;
  private isCalibrating = false;
  public isCalibrationComplete = false;

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

      const video = this.videoElement.nativeElement;
      video.srcObject = stream;
      await video.play();

      this.cameraActive = true;

      await this.initPoseLandmarkerIfNeeded();
      this.resizeOverlayToVideo();
      
      this.startCalibration();
      
      this.startTrackingLoop();
    } catch (error: any) {
      this.errorMessage = `Camera error: ${error?.message ?? error}`;
      this.cameraActive = false;
    }
  }

  stopCamera() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.cameraActive = false;
  }

  toggleCamera() {
    if (this.cameraActive) this.stopCamera();
    else this.startCamera();
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
  }

  toggleFullscreen() {
    const element = this.videoElement?.nativeElement;
    if (!element) return;

    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        this.errorMessage = `Error attempting to enable fullscreen: ${err.message}`;
      });
    } else {
      document.exitFullscreen();
    }
  }

  private startCalibration() {
    console.log('📐 CALIBRATION STARTED - Keep your arm along your body for 5 seconds');
    this.isCalibrating = true;
    this.isCalibrationComplete = false;
    this.calibrationStartTime = performance.now();
    this.distanceCalibrationReference = null;
    this.sh3CalibrationReference = null;
    this.smoothingFilterElbow.reset();
    this.smoothingFilterSH2.reset();
    this.smoothingFilterSH3.reset();
  }

  private async initPoseLandmarkerIfNeeded() {
    if (this.poseLandmarker) return;

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
    );

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.7,
      minPosePresenceConfidence: 0.7
    });
  }

  private resizeOverlayToVideo() {
    const video = this.videoElement.nativeElement;
    const canvas = this.overlayCanvas.nativeElement;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
  }

  private startTrackingLoop() {
    const tick = () => {
      if (!this.cameraActive || !this.poseLandmarker) return;

      const video = this.videoElement.nativeElement;
      if (video.readyState < 2) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      const canvas = this.overlayCanvas.nativeElement;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        this.resizeOverlayToVideo();
      }

      const nowMs = performance.now();
      const result = this.poseLandmarker.detectForVideo(video, nowMs);

      this.drawRightArm(result);

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private drawRightArm(result: PoseLandmarkerResult) {
    const ctx = this.overlayCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lm = result.landmarks?.[0];
    if (!lm) return;

    const s = lm[this.RIGHT_SHOULDER];
    const e = lm[this.RIGHT_ELBOW];
    const w = lm[this.RIGHT_WRIST];

    if (!this.isVisible(s) || !this.isVisible(e) || !this.isVisible(w)) return;

    const sx = s.x * canvas.width, sy = s.y * canvas.height;
    const ex = e.x * canvas.width, ey = e.y * canvas.height;
    const wx = w.x * canvas.width, wy = w.y * canvas.height;

    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.stroke();

    this.drawDot(ctx, sx, sy, 6, 'rgba(255,0,0,0.9)');
    this.drawDot(ctx, ex, ey, 6, 'rgba(0,255,0,0.9)');
    this.drawDot(ctx, wx, wy, 6, 'rgba(0,150,255,0.9)');

    const shoulderToElbow = Math.sqrt(
      (e.x - s.x) ** 2 + (e.y - s.y) ** 2
    );
    
    const elbowToWrist = Math.sqrt(
      (w.x - e.x) ** 2 + (w.y - e.y) ** 2
    );
    
    const shoulderToWrist = Math.sqrt(
      (w.x - s.x) ** 2 + (w.y - s.y) ** 2
    );
    
    if (shoulderToElbow === 0 || elbowToWrist === 0) {
      return;
    }
    
    const cosAngle = (
      (shoulderToElbow ** 2) + (elbowToWrist ** 2) - (shoulderToWrist ** 2)
    ) / (2 * shoulderToElbow * elbowToWrist);
    
    const cosAngleClamped = Math.max(-1, Math.min(1, cosAngle));
    
    const rawAngleDeg = Math.acos(cosAngleClamped) * (180 / Math.PI);
    
    const elbowAngleDeg = Math.max(0, Math.min(135, 180 - rawAngleDeg));

    const elbowToWristX = w.x - e.x;
    const elbowToWristY = w.y - e.y;
    const elbowToWristZ = w.z - e.z;
    
    const elbowToWristXZ = Math.sqrt(elbowToWristX ** 2 + elbowToWristZ ** 2);
    let sh3AngleRad = Math.atan2(elbowToWristX, elbowToWristXZ);
    let sh3AngleDeg = sh3AngleRad * (180 / Math.PI);
    
    while (sh3AngleDeg > 180) sh3AngleDeg -= 360;
    while (sh3AngleDeg < -180) sh3AngleDeg += 360;

    // SH2 (Shoulder elevation): use ONLY shoulder->elbow vector, not wrist
    // This way bending elbow doesn't affect shoulder height
    const shoulderToElbowY = e.y - s.y;
    const shoulderToElbowZ = e.z - s.z;
    
    const shoulderToElbowYZ = Math.sqrt(shoulderToElbowY ** 2 + shoulderToElbowZ ** 2);
    let sh2AngleRad = Math.atan2(-shoulderToElbowY, shoulderToElbowYZ);
    let sh2AngleDeg = sh2AngleRad * (180 / Math.PI);
    
    sh2AngleDeg = sh2AngleDeg * 2 + 90;
    if (sh2AngleDeg > 180) sh2AngleDeg = 180;

    if (this.isCalibrating && this.calibrationStartTime !== null) {
      const elapsed = performance.now() - this.calibrationStartTime;
      this.calibrationTimeRemaining = Math.max(0, Math.ceil((this.CALIBRATION_TIME_MS - elapsed) / 1000));
      this.calibrationStatus = `📐 CALIBRATING... Keep arm along body (${this.calibrationTimeRemaining}s)`;
      
      if (this.sh3CalibrationReference === null) {
        this.sh3CalibrationReference = sh3AngleDeg;
      } else {
        this.sh3CalibrationReference = 0.95 * this.sh3CalibrationReference + 0.05 * sh3AngleDeg;
      }
      
      console.log('📐 Calibrating... EL1:', elbowAngleDeg.toFixed(1), '° SH3 Raw:', sh3AngleDeg.toFixed(1), '° (Ref: ' + this.sh3CalibrationReference?.toFixed(1) + '°)');
      
      if (elapsed >= this.CALIBRATION_TIME_MS) {
        this.isCalibrating = false;
        this.isCalibrationComplete = true;
        this.calibrationStatus = '✅ CALIBRATION DONE - Ready to control!';
        console.log('✅ CALIBRATION DONE - SH3 Reference:', this.sh3CalibrationReference?.toFixed(1), '°');
      }
      return;
    }
    
    if (this.isCalibrationComplete && !this.isCalibrating) {
      this.calibrationStatus = `🟢 CONTROL ACTIVE | EL1: ${elbowAngleDeg.toFixed(1)}° | SH2: ${sh2AngleDeg.toFixed(1)}° | SH3: ${sh3AngleDeg.toFixed(1)}°`;
    }
    
    const sh2AngleFinal = Math.max(this.SH2_MIN, Math.min(this.SH2_MAX, sh2AngleDeg));
    
    const sh3Normalized = Math.min(1, Math.max(-1, sh3AngleDeg / 90));
    const sh3FinalAngle = sh3Normalized * 100;
    const sh3AngleFinal = Math.max(this.SH3_MIN, Math.min(this.SH3_MAX, sh3FinalAngle));
    
    const smoothedElbowAngle = this.smoothingFilterElbow.update(elbowAngleDeg);
    const smoothedSH2Angle = this.smoothingFilterSH2.update(sh2AngleFinal);
    const smoothedSH3Angle = this.smoothingFilterSH3.update(sh3AngleFinal);

    this.calibrationStatus = `🎮 EL1: ${smoothedElbowAngle.toFixed(1)}° | SH2: ${smoothedSH2Angle.toFixed(1)}° | SH3: ${smoothedSH3Angle.toFixed(1)}°`;

    this.elbowAngle.emit(-smoothedElbowAngle);
    this.sh2Angle.emit(smoothedSH2Angle);
    this.sh3Angle.emit(smoothedSH3Angle * 2 + 90);
  }

  private drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private isVisible(lm: any) {
    return (lm?.visibility ?? 1) >= this.VISIBILITY_THRESHOLD;
  }
}

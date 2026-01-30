import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { DecimalPipe, NgIf } from '@angular/common';
import { Output, EventEmitter } from '@angular/core';


import {
  FilesetResolver,
  PoseLandmarker,
  PoseLandmarkerResult
} from '@mediapipe/tasks-vision';

class SmoothingFilter {
  constructor(private smoothingFactor = 0.92) {}
  private prev: number | null = null;

  update(v: number) {
    if (this.prev === null) this.prev = v;
    else this.prev = this.smoothingFactor * this.prev + (1 - this.smoothingFactor) * v;
    return this.prev;
  }

  reset() {
    this.prev = null;
  }
}

class VelocityFilter {
  private prev: number | null = null;
  private readonly VELOCITY_THRESHOLD = 15; // degrés par frame
  
  update(v: number): number {
    if (this.prev === null) {
      this.prev = v;
      return v;
    }
    
    const delta = Math.abs(v - this.prev);
    
    // Si le changement est trop brusque (spike), ignorer
    if (delta > this.VELOCITY_THRESHOLD) {
      console.warn('📊 Velocity spike detected:', delta, '° -> Ignored');
      return this.prev; // retourner la dernière bonne valeur
    }
    
    this.prev = v;
    return v;
  }
  
  reset() {
    this.prev = null;
  }
}

type Vec3 = { x: number; y: number; z: number };

@Component({
  selector: 'app-camera-window',
  imports: [NgIf, DecimalPipe],
  templateUrl: './camera-window.component.html',
  styleUrl: './camera-window.component.scss'
})
export class CameraWindowComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayCanvas', { static: false }) overlayCanvas!: ElementRef<HTMLCanvasElement>;
  @Output() armAngles = new EventEmitter<{ x: number; y: number; z: number }>();
  @Output() elbowAngle = new EventEmitter<number>(); // optionnel si tu veux EL1


  cameraActive = false;
  cameraSupported = true;
  errorMessage = '';
  stream: MediaStream | null = null;
  isMinimized = false;

  // ---- Pose tracking
  private poseLandmarker: PoseLandmarker | null = null;
  private rafId: number | null = null;

  // ---- Calibration
  calibrating = false;
  private calibrationStartMs = 0;
  readonly CALIBRATION_DURATION_MS = 3000;
  remainingCalibration = 0;
  private calibrationAngles: { x: number; y: number; z: number } | null = null;

  // ---- Smoothing
  private filterX = new SmoothingFilter(0.80);
  private filterY = new SmoothingFilter(0.80);
  private filterZ = new SmoothingFilter(0.80);
  private filterElbow = new SmoothingFilter(0.80); // Nouveau filtre pour le coude

  // ---- Velocity filters (pour éliminer les spikes)
  private velocityFilterX = new VelocityFilter();
  private velocityFilterY = new VelocityFilter();
  private velocityFilterZ = new VelocityFilter();
  private velocityFilterElbow = new VelocityFilter();

  // ---- Output angles (for HUD + your Three.js/URDF)
  angles = { x: 0, y: 0, z: 0 };
  smoothedElbowAngle = 0;
  
  // ---- Deadzone pour le coude (quand bras le long du corps)
  private readonly ELBOW_DEADZONE = 5; // degrés

  // ---- MediaPipe Pose indices (BlazePose 33) - RIGHT ARM ONLY
  private readonly RIGHT_SHOULDER = 12;
  private readonly RIGHT_ELBOW = 14;
  private readonly RIGHT_WRIST = 16;
  private readonly RIGHT_HIP = 24;

  // ---- Visibility threshold (avoid spikes)
  private readonly VISIBILITY_THRESHOLD = 0.6;

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
      this.restartCalibration();
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

    // Reset tracking state (keep poseLandmarker cached for faster restart)
    this.calibrating = false;
    this.calibrationAngles = null;
    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
    this.filterElbow.reset();
    this.velocityFilterX.reset();
    this.velocityFilterY.reset();
    this.velocityFilterZ.reset();
    this.velocityFilterElbow.reset();
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

  restartCalibration() {
    this.calibrationAngles = null;
    this.calibrating = true;
    this.calibrationStartMs = performance.now();
    this.remainingCalibration = this.CALIBRATION_DURATION_MS / 1000;

    this.filterX.reset();
    this.filterY.reset();
    this.filterZ.reset();
  }

  // -------- MediaPipe setup (PoseLandmarker)
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
      minPoseDetectionConfidence: 0.7,    // Augmenté pour meilleure détection
      minPosePresenceConfidence: 0.7      // Augmenté pour meilleur suivi
    });
  }

  private resizeOverlayToVideo() {
    const video = this.videoElement.nativeElement;
    const canvas = this.overlayCanvas.nativeElement;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
  }

  // -------- Tracking loop
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

      // RIGHT ARM ONLY:
      this.drawRightArmOnly(result);
      this.computeRightShoulderAngles(result, nowMs);

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  // -------- Draw ONLY right arm (shoulder->elbow->wrist)
  private drawRightArmOnly(result: PoseLandmarkerResult) {
    const ctx = this.overlayCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lm = result.landmarks?.[0];
    if (!lm) return;

    const s = lm[this.RIGHT_SHOULDER];
    const e = lm[this.RIGHT_ELBOW];
    const w = lm[this.RIGHT_WRIST];

    // Require good visibility to avoid drawing random junk
    if (!this.isVisible(s) || !this.isVisible(e) || !this.isVisible(w)) return;

    const sx = s.x * canvas.width, sy = s.y * canvas.height;
    const ex = e.x * canvas.width, ey = e.y * canvas.height;
    const wx = w.x * canvas.width, wy = w.y * canvas.height;

    // Lines
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(wx, wy);
    ctx.stroke();

    // Points
    this.drawDot(ctx, sx, sy, 6, 'rgba(255,0,0,0.9)');     // shoulder
    this.drawDot(ctx, ex, ey, 6, 'rgba(0,255,0,0.9)');     // elbow
    this.drawDot(ctx, wx, wy, 6, 'rgba(0,150,255,0.9)');   // wrist
  }

  private drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private isVisible(lm: any) {
    // Some builds omit "visibility" — if missing, assume visible
    return (lm?.visibility ?? 1) >= this.VISIBILITY_THRESHOLD;
  }

  // -------- Compute shoulder angles (RIGHT ARM ONLY) + calibration + smoothing
  private computeRightShoulderAngles(result: PoseLandmarkerResult, nowMs: number) {
    // For stability: use worldLandmarks if available, but check visibility using 2D landmarks
    const normLm = result.landmarks?.[0];
    if (normLm) {
      const s2d = normLm[this.RIGHT_SHOULDER];
      const e2d = normLm[this.RIGHT_ELBOW];
      const w2d = normLm[this.RIGHT_WRIST];
      if (!this.isVisible(s2d) || !this.isVisible(e2d) || !this.isVisible(w2d)) return;
    }

    const world = result.worldLandmarks?.[0];
    const norm = result.landmarks?.[0];
    const lm = world ?? norm;
    if (!lm) return;

    const shoulder = lm[this.RIGHT_SHOULDER];
    const elbow = lm[this.RIGHT_ELBOW];
    const wrist = lm[this.RIGHT_WRIST];
    const hip = lm[this.RIGHT_HIP];

    if (!shoulder || !elbow || !hip || !wrist) return;

    // ---- Vector: shoulder to elbow (biceps)
    const v2: Vec3 = {
      x: elbow.x - shoulder.x,
      y: elbow.y - shoulder.y,
      z: elbow.z - shoulder.z
    };

    // ---- Vector: elbow to wrist (forearm)
    const v3: Vec3 = {
      x: wrist.x - elbow.x,
      y: wrist.y - elbow.y,
      z: wrist.z - elbow.z
    };

    // Same math as your Python example
    const angleXraw = this.rad2deg(Math.atan2(v2.y, v2.z));
    const angleYraw = this.rad2deg(Math.atan2(v2.x, v2.z));
    const angleZraw = this.rad2deg(Math.atan2(v2.y, v2.x));

    // ---- Angle du coude (angle entre biceps et avant-bras) - CORRIGÉ
    // Utiliser la formule du produit scalaire: angle = arccos(dot(v1,v2) / (|v1|*|v2|))
    const dotProduct = v2.x * v3.x + v2.y * v3.y + v2.z * v3.z;
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    const mag3 = Math.sqrt(v3.x * v3.x + v3.y * v3.y + v3.z * v3.z);
    
    if (mag2 < 0.001 || mag3 < 0.001) return; // Avoid division by zero
    
    const cosBeta = dotProduct / (mag2 * mag3);
    // Clamp pour éviter les erreurs numériques asin(-1.00001) ou asin(1.00001)
    const cosBetaClamped = Math.max(-1, Math.min(1, cosBeta));
    const angleBetweenVectors = this.rad2deg(Math.acos(cosBetaClamped));
    
    // L'angle du coude = 180° - angle entre les deux vecteurs
    // Car quand l'angle entre les vecteurs = 0° (bras tendu, vecteurs alignés), le coude = 180°
    // Quand l'angle entre vecteurs = 180° (bras plié, vecteurs opposés), le coude = 0°
    const elbowFlexionRaw = 180 - angleBetweenVectors;

    // ---- Calibration phase (3s)
    if (this.calibrating) {
      const elapsed = nowMs - this.calibrationStartMs;
      this.remainingCalibration = Math.max(0, (this.CALIBRATION_DURATION_MS - elapsed) / 1000);

      // take first reference sample (simple) — can be replaced by averaging if needed
      if (!this.calibrationAngles) {
        this.calibrationAngles = { x: angleXraw, y: angleYraw, z: angleZraw };
      }

      if (elapsed >= this.CALIBRATION_DURATION_MS) {
        this.calibrating = false;
      }
      return;
    }

    if (!this.calibrationAngles) return;

    // ---- Apply calibration offsets
    let x = angleXraw - this.calibrationAngles.x;
    let y = angleYraw - this.calibrationAngles.y;
    let z = angleZraw - this.calibrationAngles.z;

    // ---- Apply velocity filters (éliminer les spikes)
    x = this.velocityFilterX.update(x);
    y = this.velocityFilterY.update(y);
    z = this.velocityFilterZ.update(z);

    // ---- Smooth (lissage exponentiel)
    x = this.filterX.update(x);
    y = this.filterY.update(y);
    z = this.filterZ.update(z);

    // ---- Appliquer la deadzone au coude
    let elbowToEmit = elbowFlexionRaw;
    if (Math.abs(elbowFlexionRaw) < this.ELBOW_DEADZONE) {
      // Bras trop proche de la verticale, mettre angle du coude = 0
      elbowToEmit = 0;
      console.log('🪨 Elbow deadzone applied');
    }

    // ---- Appliquer le velocity filter au coude
    elbowToEmit = this.velocityFilterElbow.update(elbowToEmit);

    // Lisser aussi l'angle du coude
    this.smoothedElbowAngle = this.filterElbow.update(elbowToEmit);

    this.angles = { x, y, z };

    // 👉 Hook for your robot arm:
    // this.armService.setShoulderAngles(this.angles);
    this.armAngles.emit(this.angles);
    this.elbowAngle.emit(this.smoothedElbowAngle);
  }

  private rad2deg(r: number) {
    return r * 180 / Math.PI;
  }
}

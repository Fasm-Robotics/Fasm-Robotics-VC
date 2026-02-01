import { Component, ElementRef, NgZone, OnInit, ViewChild, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import {FormsModule} from '@angular/forms';
import {DecimalPipe, NgForOf, NgIf} from '@angular/common';

import { gsap } from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import URDFLoader from 'urdf-loader';

import {PositionService} from '../../shared/services/position.service';
import {JointControl, MotorAngleResponse, SendTargetModel, Sequence, setMotorAngleModel} from '../schemas';

@Component({
  selector: 'app-urdf-viewer',
  imports: [
    FormsModule,
    NgForOf,
    DecimalPipe,
    NgIf
  ],
  templateUrl: './urdf-viewer.component.html',
  styleUrl: './urdf-viewer.component.scss'
})

export class UrdfViewerComponent implements OnInit, OnChanges {
  // THREEJS VARIABLES
  @ViewChild('rendererContainer', {static: true}) rendererContainer!: ElementRef;
  @Output() toggleCamera = new EventEmitter<void>();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  controls!: OrbitControls;

  robot: any = null;
  previewRobot!: any;

  manager = new THREE.LoadingManager();
  loader = new URDFLoader(this.manager);

  manualMode = false;
  modeManual: 'live' | 'preview' = 'preview';
  mode: 'closedLoop' | 'idle' = 'idle';

  jointLabels: Record<string, string> = {
    SH1: 'Épaule : Moteur 1',
    SH2: 'Moteur 2',
    SH3: 'Moteur 3',
    EL1: 'Bras : Moteur 1',
  };

  // URDF JOINTS
  joints: JointControl[] = [];
  previewJoints: JointControl[] = [];
  liveJoints: JointControl[] = [];

  // TARGET 3D
  targetMarker!: THREE.Mesh;
  targets: SendTargetModel = {
    x: 0,
    y: 0,
    z: 0
  }
  hasBeenPreviewed = false;

  bbSpace: number = -5.846990346908569; // OFFSET FOR THE ROBOT
  M_inv = new THREE.Matrix4(); // INVERSE KINEMATICS MATRIX

  // SEQUENCE VARIABLES
  recording = false;
  recordStartTime = 0;
  currentSequence?: Sequence;
  sequences: Sequence[] = [];
  editingSequence = false;
  renameMode = false;
  nameInput = '';
  movementTime = 0;

  // Sidebar variables
  sidebars = {
    sequences: true,
    angleInfo: true,
    targetControls: true,
    manualControls: false,
    settings: true
  };

  @Input() cameraShoulderAngles: { x: number; y: number; z: number } | null = null;
  @Input() cameraElbowAngle: number | null = null;
  @Input() cameraSH3Angle: number | null = null;

// limites + gain pour mapper camera -> joints
  @Input() cameraGain = {
    sh1: 1.0,
    sh2: 1.0,
    sh3: 1.0,
    el1: 1.0
  };

  @Input() jointLimitsDeg = {
    SH1: { min: -90, max: 90 },
    SH2: { min: -90, max: 90 },
    SH3: { min: -70, max: 180 },
    EL1: { min: 0, max: 135 }
  };

  constructor(private positionService: PositionService, private ngZone: NgZone) {
    this.targets.x = 0.5
    this.targets.y = 0.5
    this.targets.z = 0.5
  }

  ngOnInit() {
    this.init();
    this.animate();
    this.createTargetMarker();
  }

  ngOnChanges(changes: SimpleChanges) {
    // update shoulder joints
    if (changes['cameraShoulderAngles'] && this.cameraShoulderAngles) {
      this.applyCameraToShoulderJoints(this.cameraShoulderAngles);
    }

    // update elbow joint
    if (changes['cameraElbowAngle'] && this.cameraElbowAngle !== null && this.cameraElbowAngle !== undefined) {
      this.applyCameraToElbowJoint(this.cameraElbowAngle);
    }

    // update SH3 joint (rotation du bras)
    if (changes['cameraSH3Angle'] && this.cameraSH3Angle !== null && this.cameraSH3Angle !== undefined) {
      this.applyCameraToSH3Joint(this.cameraSH3Angle);
    }
  }



  // ---------------ALL THESE FUNCTIONS ARE FOR THE URDF VIEWER------------------------------------

  // Initialize the scene, camera, and renderer
  init() {
    this.scene.background = new THREE.Color(0x263238);

    this.camera.position.set(-8.651569347210018, 7.143686928994331, 4.33116267945635);
    this.camera.rotation.set(-0.9885528450565825,-0.9559398272407933,-0.8924123366635133);
    this.camera.zoom = 1;

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.setScalar(1024);
    directionalLight.position.set(-5, 30, -5);
    this.scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambientLight);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.scale.setScalar(30);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Uncomment this to get the help grid
    // const grid = new THREE.GridHelper(10, 10, 0x000000, 0x888888);
    // this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 4;
    this.controls.target.y = 1;
    this.controls.update();

    // ----------------------------LOADER URDF------------------------------------

    this.loader.load('assets/robotarm_corrected.urdf', result => {
      this.robot = result;
    });

    this.loader.load('assets/robotarm_corrected.urdf', result => {
      this.previewRobot = result;
    });

    this.manager.onLoad = () => {
      this.robot.rotation.x = -Math.PI / 2;
      this.previewRobot.rotation.x = -Math.PI / 2;

      this.robot.traverse((c: { castShadow: boolean; }) => {
        c.castShadow = true;
      });
      this.previewRobot.traverse((c: any) => {
        if (c.material) {
          c.material = c.material.clone();
          c.material.transparent = true;
          c.material.opacity = 0.3;
        }
      });

      const bb = new THREE.Box3().setFromObject(this.robot);
      console.log('bb', bb.min.y);
      this.bbSpace = bb.min.y;

      this.robot.position.y -= this.bbSpace;
      this.previewRobot.position.y -= this.bbSpace;

      this.scene.add(this.robot);
      this.scene.add(this.previewRobot);
      this.robot.updateMatrixWorld(true);
      this.previewRobot.updateMatrixWorld(true);

      this.M_inv.copy(this.robot.matrixWorld).invert();

      for (const name in (this.robot as any).joints) {
        const joint = (this.robot as any).joints[name];
        if (joint.jointType === 'fixed') continue;
        const real = true;
        this.joints.push({ real, name, angle: 0, joint });
        this.liveJoints.push({ real, name, angle: 0, joint });
      }
      for (const name in (this.previewRobot as any).joints) {
        const joint = (this.previewRobot as any).joints[name];
        if (joint.jointType === 'fixed') continue;
        const real = false;
        this.previewJoints.push({ real, name, angle: 0, joint });
      }
      for (const joint of this.liveJoints) {
        this.getMotorAngle(joint);
      }
      console.log('Joints loaded:', this.previewJoints);
    };

    // ----------------------------LOADER URDF------------------------------------

    this.onResize();
    window.addEventListener('resize', this.onResize);
  }

  // Update the camera and renderer on window resize
  onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  // Animation loop
  private animate(): void {
    this.ngZone.runOutsideAngular(() => {
      const loop = () => {
        requestAnimationFrame(loop);
        if (this.robot) {
          this.robot.updateMatrixWorld(true);
        }
        if (this.previewRobot) {
          this.previewRobot.updateMatrixWorld(true);
        }
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    });
  }

  createTargetMarker() {
    const geometry = new THREE.SphereGeometry(0.05, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false,
      depthWrite: false
    });
    this.targetMarker = new THREE.Mesh(geometry, material);
    this.targetMarker.renderOrder = 999;
    this.targets.y -= this.bbSpace;
    this.scene.add(this.targetMarker);
    this.updateTargetMarker();
  }


  updateTargetMarker() {
    console.log('update targetMarker', this.hasBeenPreviewed);
    if (this.targetMarker) {
      this.targetMarker.position.set(this.targets.x, this.targets.y, this.targets.z);
    }
    if (this.hasBeenPreviewed) {
      this.hasBeenPreviewed = false
    }
  }

  // ---------------------------------------------------------------

  getRealJoint(name: string): JointControl | undefined {
    return this.joints.find(j => j.name === name);
  }

  getPreviewJoint(name: string): JointControl {
    return <JointControl>this.previewJoints.find(j => j.name === name);
  }

  getLiveJoint(name: string): JointControl | undefined {
    return this.liveJoints.find(j => j.name === name);
  }

  // UPDATE JOINTS FUNCTIONS
  updateJoint(ctrl: JointControl, angleInDegrees: boolean = true): void {
    const rad = angleInDegrees
      ? THREE.MathUtils.degToRad(ctrl.angle)
      : ctrl.angle;
    ctrl.joint.setJointValue(rad);
  }

  getMotorAngle(ctrl: JointControl): void {
    if (ctrl.name == "EL1") {
      return;
    }
    this.positionService.getMotorAngle(ctrl.name)
      .subscribe({
        next: (resp: MotorAngleResponse) => {
          if (resp.status === 'success') {
            const deg = resp.angle_degrees;
            console.log(`Motor ${ctrl.name} angle:`, deg);
            ctrl.angle = deg;
          } else {
            console.error(`API returned error status for ${ctrl.name}`, resp);
            alert(`Impossible de récupérer l'angle du moteur ${ctrl.name} (status=${resp.status})`);
          }
        },
        error: err => {
          console.error(`Error getting motor ${ctrl.name} angle:`, err);
          alert(`Erreur de récupération de l'angle du moteur ${ctrl.name} : ${err.message || err}`);
        }
      });
  }

  setMotorAngle(ctrl: JointControl): void {
    const jointName: string = ctrl.name;
    const angle = ctrl.angle;
    if (!ctrl.real) {
      this.updateJoint(ctrl, true);
      return;
    }
    const payload: setMotorAngleModel = {
      motor: jointName,
      angle: angle
    }
    this.positionService.setMotorAngle(payload).subscribe({
      next: () => {
        console.log(`Motor ${jointName} set to angle ${angle}`);
        this.updateJoint(ctrl, true);
      },
      error: (err) => {
        console.error(`Error setting motor ${jointName} angle:`, err);
        alert(`Erreur de réglage du moteur ${jointName} : ${err.message || err}`);
      },
    });
  }


  // RESET JOINTS TO BASE POSITION
  resetJoints(): void {
    this.joints.forEach(ctrl => {
      gsap.to(ctrl, {
        angle: 0,
        duration: 1,
        ease: 'power2.inOut',
        onUpdate: () => this.updateJoint(ctrl),
      });
    });
    this.previewJoints.forEach(ctrl => {
      gsap.to(ctrl, {
        angle: 0,
        duration: 1,
        ease: 'power2.inOut',
        onUpdate: () => this.updateJoint(ctrl),
      });
    });
  }

  unPreviewed(): void {
    this.hasBeenPreviewed = false;
  }

  hasPreviewed(): void {
    this.hasBeenPreviewed = true;
  }

  sendTarget(): void {
    const worldPt = new THREE.Vector3(
      this.targets.x,
      this.targets.y,
      this.targets.z
    );

    const localPt = worldPt.applyMatrix4(this.M_inv);

    const payload: SendTargetModel = {
      x: localPt.x,
      y: localPt.y,
      z: localPt.z
    };

    this.positionService.getReverseK(payload).subscribe({
      next: (response: Record<string, number>) => {
        console.log('IK response:', response);
        this.joints.forEach(ctrl => {
          const jointName = ctrl.name;
          if (jointName in response) {
            gsap.to(ctrl, {
              angle: response[jointName],
              duration: 1,
              ease: 'power2.inOut',
              onUpdate: () => this.updateJoint(ctrl, true),
              onComplete: () => this.getMotorAngle(ctrl)
            });
          }
        });
        this.previewJoints.forEach(ctrl => {
          const jointName = ctrl.name;
          if (jointName in response) {
            gsap.to(ctrl, {
              angle: response[jointName],
              duration: 1,
              ease: 'power2.inOut',
              onUpdate: () => this.updateJoint(ctrl, true),
            });
          }
        });
      },
      error: (err) => {
        console.error('ReverseK API error:', err);
        alert(`Erreur inverse-kinématique : ${err.message || err}`);
      },
    });
  }

  previewTarget(): void {
    const worldPt = new THREE.Vector3(
      this.targets.x,
      this.targets.y,
      this.targets.z
    );

    const localPt = worldPt.applyMatrix4(this.M_inv);

    const payload: SendTargetModel = {
      x: localPt.x,
      y: localPt.y,
      z: localPt.z
    };

    this.positionService.getPreviewReverseK(payload).subscribe({
      next: (response: Record<string, number>) => {
        console.log('IK response:', response);
        this.previewJoints.forEach(ctrl => {
          const jointName = ctrl.name;
          if (jointName in response) {
            gsap.to(ctrl, {
              angle: response[jointName],
              duration: 1,
              ease: 'power2.inOut',
              onUpdate: () => this.updateJoint(ctrl, true),
            });
          }
          this.hasPreviewed();
        });
      },
      error: (err) => {
        console.error('ReverseK API error:', err);
        alert(`Erreur inverse-kinématique : ${err.message || err}`);
      },
    });
  }

  // SEQUENCE FUNCTIONS
  startRecording() {
    const now = new Date().toISOString();
    this.currentSequence = {
      name: `Sequence ${now}`,
      createdAt: now,
      frames: []
    };
    this.sequences.push(this.currentSequence);
    this.recording = true;
    this.recordStartTime = performance.now();
  }

  stopRecording() {
    this.recording = false;
    if (this.currentSequence) {
      this.renameMode = true;
      this.nameInput = this.currentSequence.name;
    }
  }

  saveSequenceName() {
    if (this.currentSequence && this.nameInput.trim()) {
      this.currentSequence.name = this.nameInput.trim();
    }
    this.renameMode = false;
  }

  playSequence(seq: Sequence) {
    if (!this.currentSequence) return;
    this.currentSequence.frames.forEach(frame => {
      setTimeout(() => {
        // restore targets
        this.targets.x = frame.x;
        this.targets.y = frame.y;
        this.targets.z = frame.z;
        // call preview (you could batch them or space them however you like)
        this.sendTarget();
      }, frame.time * 1000);
    });
  }

  downloadSequence(seq: Sequence) {
    if (!this.currentSequence) return;
    const blob = new Blob(
      [ JSON.stringify(this.currentSequence, null, 2) ],
      { type: 'application/json' }
    );
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${this.currentSequence.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  selectSequence(seq: Sequence) {
    this.currentSequence = seq;
    this.editingSequence = false;
  }

  deleteSequence(index: number) {
    this.sequences.splice(index, 1);
    this.renameMode = false;
  }

  uploadSequence(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = () => {
      try {
        // Assuming your Sequence interface lives here
        const seq: Sequence = JSON.parse(reader.result as string);

        // Optional: validate seq.frames, seq.name, etc.
        if (!Array.isArray(seq.frames)) {
          throw new Error("Invalid sequence format");
        }

        this.sequences.push(seq);
        // Optionally select it immediately:
        this.selectSequence(seq);
        // Reset the input so you can re-upload the same file if desired
        input.value = '';
      } catch (e) {
        console.error("Failed to load sequence:", e);
        alert("Invalid sequence JSON file.");
      }
    };

    reader.readAsText(file);
  }

  deleteFrame(index: number) {
    if ((this.editingSequence || this.recording) && this.currentSequence) {
      this.currentSequence.frames.splice(index, 1);
    }
  }

  saveMovement() {
    if (!this.recording || !this.currentSequence) return;

    const frames = this.currentSequence.frames;
    const lastTime = frames.length
      ? frames[frames.length - 1].time
      : 0;

    const t = lastTime + this.movementTime;

    frames.push({
      time: t,
      x: this.targets.x,
      y: this.targets.y,
      z: this.targets.z
    });

    this.movementTime = 0;
  }

  // Toggle sidebar visibility
  toggleSidebar(name: keyof typeof this.sidebars) {
      this.sidebars[name] = !this.sidebars[name];
  }

  // Toggle manual mode
  toggleManualMode() {
    this.manualMode = !this.manualMode;
    this.sidebars.manualControls = !this.sidebars.manualControls;
    if (this.manualMode) {
      this.sidebars.sequences = false;
      this.sidebars.angleInfo = false;
      this.sidebars.targetControls = false;
    } else {
      this.sidebars.sequences = true;
      this.sidebars.angleInfo = true;
      this.sidebars.targetControls = true;
    }
  }

  // Toggle camera window visibility
  onToggleCamera() {
    this.toggleCamera.emit();
  }

  // Setting functions

  calibrateSync() {
    this.positionService.calibrateSync().subscribe({
      next: () => {
        console.log('Calibration sync successful');
        alert('Calibration sync successful');
      },
      error: (err) => {
        console.error('Calibration sync error:', err);
        alert(`Calibration sync error: ${err.message || err}`);
      }
    });
  }

  setIdleMode() {
    this.positionService.setIdle().subscribe({
      next: () => {
        console.log('Set to idle mode');
        this.setMode('idle');
      },
      error: (err) => {
        console.error('Set idle mode error:', err);
        alert(`Set idle mode error: ${err.message || err}`);
      }
    })
  }

  setClosedLoopMode() {
    this.positionService.setClosedLoop().subscribe({
      next: () => {
        console.log('Set to closed loop mode');
        this.setMode('closedLoop');
      },
      error: (err) => {
        console.error('Set closed loop mode error:', err);
        alert(`Set closed loop mode error: ${err.message || err}`);
      }
    })
  }

  setMode(m: 'closedLoop'|'idle') {
    this.mode = m;
  }

  private lastSendMs = 0;
  private readonly SEND_INTERVAL_MS = 50; // 20Hz

// ---- Helpers
  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  private applyStep(currentDeg: number, targetDeg: number, stepDeg = 0.5) {
    return Math.abs(targetDeg - currentDeg) < stepDeg ? currentDeg : targetDeg;
  }

  applyCameraAngles(cameraShoulder: {x:number;y:number;z:number}, elbowFlexDeg?: number) {
    const gain = {
      sh1: 1.0,
      sh2: 1.0,
      sh3: 1.0,
      el1: 1.0
    };

    const invert = {
      sh1: false,
      sh2: false,
      sh3: false,
      el1: false
    };

    let sh1 = cameraShoulder.z * gain.sh1;
    let sh2 = cameraShoulder.x * gain.sh2;
    let sh3 = cameraShoulder.y * gain.sh3;
    let el1 = (elbowFlexDeg ?? 0) * gain.el1;

    if (invert.sh1) sh1 *= -1;
    if (invert.sh2) sh2 *= -1;
    if (invert.sh3) sh3 *= -1;
    if (invert.el1) el1 *= -1;

    // ---- 3) Clamp (URDF: +/-180°)
    sh1 = this.clamp(sh1, -180, 180);
    sh2 = this.clamp(sh2, -180, 180);
    sh3 = this.clamp(sh3, -180, 180);
    el1 = this.clamp(el1, -180, 180);

    // ---- 4) Appliquer sur preview (et live si tu veux)
    const p1 = this.getPreviewJoint('SH1'); if (p1) { p1.angle = this.applyStep(p1.angle, sh1); this.updateJoint(p1, true); }
    const p2 = this.getPreviewJoint('SH2'); if (p2) { p2.angle = this.applyStep(p2.angle, sh2); this.updateJoint(p2, true); }
    const p3 = this.getPreviewJoint('SH3'); if (p3) { p3.angle = this.applyStep(p3.angle, sh3); this.updateJoint(p3, true); }
    const p4 = this.getPreviewJoint('EL1'); if (p4) { p4.angle = this.applyStep(p4.angle, el1); this.updateJoint(p4, true); }

    // Si tu veux aussi bouger le robot "live" (non transparent):
    const l1 = this.getRealJoint('SH1'); if (l1) { l1.angle = sh1; this.updateJoint(l1, true); }
    const l2 = this.getRealJoint('SH2'); if (l2) { l2.angle = sh2; this.updateJoint(l2, true); }
    const l3 = this.getRealJoint('SH3'); if (l3) { l3.angle = sh3; this.updateJoint(l3, true); }
    const l4 = this.getRealJoint('EL1'); if (l4) { l4.angle = el1; this.updateJoint(l4, true); }
  }

  private applyAngleToJoint(name: string, angleDeg: number) {
    const ctrlLive = this.getPreviewJoint(name);
    if (ctrlLive) {
      ctrlLive.angle = angleDeg;
      this.updateJoint(ctrlLive, true);

      const now = performance.now();
      if (now - this.lastSendMs > this.SEND_INTERVAL_MS) {
        this.lastSendMs = now;
        this.setMotorAngle(ctrlLive);
      }
    }
  }

  private applyCameraToShoulderJoints(a: { x: number; y: number; z: number }) {
    // Mapping simple (à ajuster selon ton sens d’axes URDF)
    // Exemple:
    //  - SH1 <- Z
    //  - SH2 <- Y
    //  - SH3 <- X
    // Si c’est inversé, mets des "-" devant.
    const sh1 = -a.z * this.cameraGain.sh1;
    const sh2 = -a.y * this.cameraGain.sh2;
    const sh3 = -a.x * this.cameraGain.sh3;

    const sh1c = this.clamp(sh1, this.jointLimitsDeg.SH1.min, this.jointLimitsDeg.SH1.max);
    const sh2c = this.clamp(sh2, this.jointLimitsDeg.SH2.min, this.jointLimitsDeg.SH2.max);
    const sh3c = this.clamp(sh3, this.jointLimitsDeg.SH3.min, this.jointLimitsDeg.SH3.max);

    console.log('📷 Camera shoulder angles:', a);
    console.log('📐 Mapped to joints - SH1:', sh1c, 'SH2:', sh2c, 'SH3:', sh3c);

    this.applyAngleToJoint('SH1', sh1c);
    this.applyAngleToJoint('SH2', sh2c);
    this.applyAngleToJoint('SH3', sh3c);
  }

  private applyCameraToElbowJoint(elbowDeg: number) {
    const elc = this.clamp(elbowDeg, -135, 0);
    
    console.log('🤖 URDF Elbow raw:', elbowDeg.toFixed(1), '° | Clamped EL1:', elc.toFixed(1), '°');
    this.applyAngleToJoint('EL1', elc);
  }

  private applyCameraToSH3Joint(sh3Deg: number) {
    const sh3c = this.clamp(sh3Deg, -70, 180);
    
    console.log('🤖 URDF SH3 raw:', sh3Deg.toFixed(1), '° | Clamped SH3:', sh3c.toFixed(1), '°');
    this.applyAngleToJoint('SH3', sh3c);
  }



  protected readonly THREE = THREE;
}

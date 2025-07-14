import {Component, ElementRef, NgZone, OnInit, ViewChild} from '@angular/core';
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

export class UrdfViewerComponent implements OnInit {
  // THREEJS VARIABLES
  @ViewChild('rendererContainer', {static: true}) rendererContainer!: ElementRef;
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

  getPreviewJoint(name: string): JointControl | undefined {
    return this.previewJoints.find(j => j.name === name);
  }

  getLiveJoint(name: string): JointControl | undefined {
    return this.liveJoints.find(j => j.name === name);
  }

  // UPDATE JOINTS FUNCTIONS
  updateJoint(ctrl: JointControl, angleInDegrees: boolean = true): void {
    const rad = angleInDegrees
      ? THREE.MathUtils.degToRad(ctrl.angle)
      : ctrl.angle;
    console.log("EP")
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

  protected readonly THREE = THREE;
}

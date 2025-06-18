import {Component, ElementRef, NgZone, OnInit, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {DecimalPipe, NgForOf} from '@angular/common';

import { gsap } from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import URDFLoader from 'urdf-loader';

import {PositionService} from '../../shared/services/position.service';
import {JointControl, SendTargetModel} from '../schemas';

@Component({
  selector: 'app-urdf-viewer',
  imports: [
    FormsModule,
    NgForOf,
    DecimalPipe
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

  // URDF JOINTS
  joints: JointControl[] = [];
  previewJoints: JointControl[] = [];

  // TARGET 3D
  targetMarker!: THREE.Mesh;
  targets: SendTargetModel = {
    x: 0,
    y: 0,
    z: 0
  }

  bbSpace: number = -5.846990346908569; // OFFSET FOR THE ROBOT
  M_inv = new THREE.Matrix4(); // INVERSE KINEMATICS MATRIX

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
        this.joints.push({ name, angle: 0, joint });
      }
      for (const name in (this.previewRobot as any).joints) {
        const joint = (this.previewRobot as any).joints[name];
        if (joint.jointType === 'fixed') continue;
        this.previewJoints.push({ name, angle: 0, joint });
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
    const geometry = new THREE.SphereGeometry(0.02, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    this.targetMarker = new THREE.Mesh(geometry, material);
    this.targets.y -= this.bbSpace
    this.scene.add(this.targetMarker);
    this.updateTargetMarker();
  }

  updateTargetMarker() {
    if (this.targetMarker) {
      this.targetMarker.position.set(this.targets.x, this.targets.y, this.targets.z);
    }
  }

  // ---------------------------------------------------------------

  // UPDATE JOINTS FUNCTIONS
  updateJoint(ctrl: JointControl, angleInDegrees: boolean = true): void {
    const rad = angleInDegrees
      ? THREE.MathUtils.degToRad(ctrl.angle)
      : ctrl.angle;
    console.log(rad);
    ctrl.joint.setJointValue(rad);
  }

  // ON CONFIRM BUTTON CLICK
  confirmMovement() {
    this.joints.forEach((ctrl, i )=> {
      const targetAngle = this.previewJoints[i].angle;
      gsap.to(ctrl, {
        angle: targetAngle,
        duration: 1,
        ease: 'power2.inOut',
        onUpdate: () => {
        const rad = THREE.MathUtils.degToRad(ctrl.angle);
        ctrl.joint.setJointValue(rad);
        },
      });
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
            const rad = response[jointName] * Math.PI / 180;
            gsap.to(ctrl, {
              angle: rad,
              duration: 1,
              ease: 'power2.inOut',
              onUpdate: () => this.updateJoint(ctrl, false),
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
        });
      },
      error: (err) => {
        console.error('ReverseK API error:', err);
        alert(`Erreur inverse-kinématique : ${err.message || err}`);
      },
    });
  }

  printState() {
    const state = this.previewJoints.map(joint => ({
      name: joint.name,
      angle: joint.angle
    }));
    console.log('Current joint state:', state);
  }

  protected readonly THREE = THREE;
}

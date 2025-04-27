import {Component, ElementRef, NgZone, OnInit, ViewChild} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import URDFLoader from 'urdf-loader';
import { JointControl } from '../schemas';

@Component({
  selector: 'app-urdf-viewer',
  imports: [],
  templateUrl: './urdf-viewer.component.html',
  styleUrl: './urdf-viewer.component.scss'
})
export class UrdfViewerComponent implements OnInit {
  @ViewChild('rendererContainer', {static: true}) rendererContainer!: ElementRef;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  controls!: OrbitControls;
  robot: any = null;
  manager = new THREE.LoadingManager();
  loader = new URDFLoader(this.manager);
  joints: JointControl[] = [];
  bbSpace: number = -5.846990346908569; // Placeholder for the actual bounding box space
  M_inv = new THREE.Matrix4();

  constructor(private ngZone: NgZone) {}

  ngOnInit() {
    this.init();
    this.animate();
  }

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

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 4;
    this.controls.target.y = 1;
    this.controls.update();

    // ----------------------------LOADER URDF------------------------------------

    this.loader.load('assets/robotarm_corrected.urdf', result => {
      this.robot = result;
    });

    this.manager.onLoad = () => {
      this.robot.rotation.x = -Math.PI / 2;
      this.robot.traverse((c: { castShadow: boolean; }) => {
        c.castShadow = true;
      });

      const bb = new THREE.Box3().setFromObject(this.robot);
      console.log('bb', bb.min.y);
      this.bbSpace = bb.min.y;
      this.robot.position.y -= this.bbSpace;

      this.scene.add(this.robot);
      this.robot.updateMatrixWorld(true);

      this.M_inv.copy(this.robot.matrixWorld).invert();

      for (const name in (this.robot as any).joints) {
        const joint = (this.robot as any).joints[name];
        if (joint.jointType === 'fixed') continue;
        this.joints.push({ name, angle: 0, joint });
      }
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
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    });
  }
}

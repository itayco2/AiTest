// src/app/components/avatar/avatar-viewer/avatar-viewer.component.ts
import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Angular Material imports
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBarModule } from '@angular/material/snack-bar';

// Three.js imports
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';

// RxJS imports
import { Subject, debounceTime, takeUntil } from 'rxjs';

export interface AvatarData {
  avatarId: string;
  avatarUrl: string;
  thumbnailUrl?: string;
  measurements?: any;
  metadata?: any;
  clothing?: ClothingItem[];
  facePhotoUrl?: string;
}

export interface ClothingItem {
  id: string;
  type: string;
  modelUrl: string;
  textureUrl?: string;
  size: string;
}

@Component({
  selector: 'app-avatar-viewer',
  templateUrl: './avatar-viewer.component.html',
  styleUrls: ['./avatar-viewer.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatChipsModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatMenuModule,
    MatSnackBarModule
  ]
})
export class AvatarViewerComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef;
  
  @Input() avatarData?: AvatarData;
  @Output() avatarLoaded = new EventEmitter<boolean>();
  @Output() clothingFitted = new EventEmitter<ClothingItem>();
  
  // Three.js objects
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private loader!: GLTFLoader;
  private dracoLoader!: DRACOLoader;
  
  // Avatar and clothing meshes
  private avatarGroup?: THREE.Group;
  public clothingGroups: Map<string, THREE.Group> = new Map();
  private mixer?: THREE.AnimationMixer;
  private clock = new THREE.Clock();
  
  // Animation state
  private isWalking = false;
  private walkAction?: THREE.AnimationAction;
  private idleAction?: THREE.AnimationAction;
  
  // UI state
  loading = false;
  error?: string;
  currentView: 'front' | 'side' | 'back' | '360' = 'front';
  
  // Measurement visualization
  showMeasurements = false;
  measurementLines: THREE.Line[] = [];
  measurementLabels: THREE.Sprite[] = [];
  
  // Resize observer
  private resizeObserver?: ResizeObserver;
  private resizeSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  
  // Fixed camera settings
  private readonly CAMERA_DISTANCE = 3;
  private readonly CAMERA_HEIGHT = 1.5;
  private readonly CAMERA_TARGET_HEIGHT = 0.85;
  
  constructor() {}
  
  ngOnInit(): void {
    this.initThreeJS();
    this.setupEventListeners();
    
    if (this.avatarData) {
      this.loadAvatar(this.avatarData.avatarUrl);
    }
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['avatarData'] && !changes['avatarData'].firstChange) {
      // Reload avatar when data changes
      if (this.avatarData) {
        this.loadAvatar(this.avatarData.avatarUrl);
      }
    }
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }
  
  private initThreeJS(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f5);
    this.scene.fog = new THREE.Fog(0xf5f5f5, 10, 50);
    
    // Camera setup with fixed position
    this.camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      1000
    );
    this.camera.position.set(0, this.CAMERA_HEIGHT, this.CAMERA_DISTANCE);
    
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    container.appendChild(this.renderer.domElement);
    
    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 15;
    this.controls.maxPolarAngle = Math.PI * 0.75;
    this.controls.minPolarAngle = 0.1;
    this.controls.target.set(0, this.CAMERA_TARGET_HEIGHT, 0);
    this.controls.update();
    
    // Loaders
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(this.dracoLoader);
    
    // Lighting
    this.setupLighting();
    
    // Environment
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    
    // Floor
    this.addFloor();
    
    // Start animation loop
    this.animate();
  }
  
  private setupLighting(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    // Main key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(5, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.001;
    this.scene.add(keyLight);
    
    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-5, 5, 0);
    this.scene.add(fillLight);
    
    // Rim light
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, 5, -5);
    this.scene.add(rimLight);
  }
  
  private addFloor(): void {
    // Create floor
    const floorGeometry = new THREE.CircleGeometry(5, 64);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xe0e0e0,
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    
    // Add grid
    const gridHelper = new THREE.GridHelper(10, 20, 0xcccccc, 0xcccccc);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);
  }
  
  private setupEventListeners(): void {
    // Resize handling
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeSubject.next();
    });
    this.resizeObserver.observe(this.canvasContainer.nativeElement);
    
    this.resizeSubject.pipe(
      debounceTime(100),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.onResize();
    });
  }
  
  private onResize(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
  }
  
  async loadAvatar(url: string): Promise<void> {
    this.loading = true;
    this.error = undefined;
    
    try {
      // Remove existing avatar
      if (this.avatarGroup) {
        this.scene.remove(this.avatarGroup);
        this.avatarGroup = undefined;
      }
      
      // Load new avatar
      const gltf = await this.loader.loadAsync(url);
      
      this.avatarGroup = gltf.scene;
      
      // Setup materials and shadows
      this.avatarGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(this.setupMaterial);
            } else {
              this.setupMaterial(child.material);
            }
          }
        }
      });
      
      // Center and scale avatar
      const box = new THREE.Box3().setFromObject(this.avatarGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Center the model
      this.avatarGroup.position.x = -center.x;
      this.avatarGroup.position.z = -center.z;
      
      // Scale to realistic human height (half the normal size)
      const currentHeight = size.y;
      let targetHeight = 1.7; // Default 1.7m (170cm)
      if (this.avatarData?.measurements?.height) {
        targetHeight = this.avatarData.measurements.height / 100; // Convert cm to meters
      }
      // Make the avatar 2 times smaller
      const scaleFactor = (targetHeight / currentHeight) * 0.25; // Changed from 0.5 to 0.25 for 2x smaller
      this.avatarGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
      
      // Place feet on ground after scaling
      this.avatarGroup.position.y = -box.min.y * 0;
      
      this.scene.add(this.avatarGroup);
      
      // Setup animations if available
      if (gltf.animations && gltf.animations.length > 0) {
        this.setupAnimations(gltf.animations);
      }
      
      // Apply face texture if available
      if (this.avatarData?.facePhotoUrl) {
        this.applyFaceTexture();
      }
      
      this.loading = false;
      this.avatarLoaded.emit(true);
      
    } catch (error) {
      this.loading = false;
      this.error = 'Failed to load avatar model';
      this.avatarLoaded.emit(false);
      console.error('Avatar loading error:', error);
    }
  }
  
  private applyFaceTexture(): void {
    if (!this.avatarGroup || !this.avatarData?.facePhotoUrl) return;
    
    const textureLoader = new THREE.TextureLoader();
    
    this.avatarGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const name = child.name.toLowerCase();
        
        // Apply face texture to head mesh
        if (name.includes('head') || name.includes('face')) {
          textureLoader.load(
            this.avatarData!.facePhotoUrl!,
            (texture) => {
              texture.encoding = THREE.sRGBEncoding;
              texture.flipY = false;
              
              const skinMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.7,
                metalness: 0.0,
                normalScale: new THREE.Vector2(0.5, 0.5)
              });
              
              child.material = skinMaterial;
            },
            undefined,
            (error) => {
              console.error('Failed to load face texture:', error);
            }
          );
        }
      }
    });
  }
  
  private setupAnimations(animations: THREE.AnimationClip[]): void {
    if (!this.avatarGroup) return;
    
    this.mixer = new THREE.AnimationMixer(this.avatarGroup);
    
    // Find idle and walk animations
    const idleClip = animations.find(clip => 
      clip.name.toLowerCase().includes('idle') || 
      clip.name.toLowerCase().includes('breathing')
    ) || animations[0];
    
    const walkClip = animations.find(clip => 
      clip.name.toLowerCase().includes('walk') || 
      clip.name.toLowerCase().includes('walking')
    );
    
    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
      this.idleAction.play();
    }
    
    if (walkClip) {
      this.walkAction = this.mixer.clipAction(walkClip);
    }
  }
  
  private setupMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.envMapIntensity = 0.5;
      material.needsUpdate = true;
    }
  }
  
  async loadClothing(clothing: ClothingItem): Promise<void> {
    try {
      // Load clothing model
      const gltf = await this.loader.loadAsync(clothing.modelUrl);
      const clothingGroup = gltf.scene;
      
      // Setup clothing materials
      clothingGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // Apply texture if provided
          if (clothing.textureUrl && child.material) {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(clothing.textureUrl, (texture) => {
              texture.encoding = THREE.sRGBEncoding;
              if (child.material instanceof THREE.MeshStandardMaterial) {
                child.material.map = texture;
                child.material.needsUpdate = true;
              }
            });
          }
        }
      });
      
      // Remove existing clothing of same type
      const existingClothing = this.clothingGroups.get(clothing.type);
      if (existingClothing) {
        this.scene.remove(existingClothing);
      }
      
      // Add new clothing
      this.clothingGroups.set(clothing.type, clothingGroup);
      this.scene.add(clothingGroup);
      
      // Position clothing on avatar
      if (this.avatarGroup) {
        this.fitClothingToAvatar(clothingGroup, clothing);
      }
      
      this.clothingFitted.emit(clothing);
      
    } catch (error) {
      console.error('Failed to load clothing:', error);
    }
  }
  
  private fitClothingToAvatar(clothingGroup: THREE.Group, clothing: ClothingItem): void {
    if (!this.avatarGroup) return;
    
    // Copy avatar position and scale
    clothingGroup.position.copy(this.avatarGroup.position);
    clothingGroup.scale.copy(this.avatarGroup.scale);
    
    // Apply size adjustments
    const sizeScale = this.getSizeScale(clothing.size);
    clothingGroup.scale.multiplyScalar(sizeScale);
  }
  
  private getSizeScale(size: string): number {
    const sizeScales: Record<string, number> = {
      'XS': 0.95,
      'S': 0.97,
      'M': 1.0,
      'L': 1.03,
      'XL': 1.06,
      'XXL': 1.09
    };
    
    return sizeScales[size] || 1.0;
  }
  
  // View controls
  setView(view: 'front' | 'side' | 'back' | '360'): void {
    this.currentView = view;
    
    if (!this.avatarGroup) return;
    
    // Stop walking animation when changing view
    if (this.isWalking && view !== '360') {
      this.toggleWalkAnimation();
    }
    
    switch (view) {
      case 'front':
        this.animateCamera(
          new THREE.Vector3(0, this.CAMERA_HEIGHT, this.CAMERA_DISTANCE),
          new THREE.Vector3(0, this.CAMERA_TARGET_HEIGHT, 0)
        );
        break;
      case 'side':
        this.animateCamera(
          new THREE.Vector3(this.CAMERA_DISTANCE, this.CAMERA_HEIGHT, 0),
          new THREE.Vector3(0, this.CAMERA_TARGET_HEIGHT, 0)
        );
        break;
      case 'back':
        this.animateCamera(
          new THREE.Vector3(0, this.CAMERA_HEIGHT, -this.CAMERA_DISTANCE),
          new THREE.Vector3(0, this.CAMERA_TARGET_HEIGHT, 0)
        );
        break;
      case '360':
        this.start360Rotation();
        if (!this.isWalking && this.walkAction) {
          this.toggleWalkAnimation();
        }
        break;
    }
  }
  
  private toggleWalkAnimation(): void {
    if (!this.mixer || !this.walkAction || !this.idleAction) return;
    
    this.isWalking = !this.isWalking;
    
    if (this.isWalking) {
      this.idleAction.fadeOut(0.5);
      this.walkAction.reset().fadeIn(0.5).play();
    } else {
      this.walkAction.fadeOut(0.5);
      this.idleAction.reset().fadeIn(0.5).play();
    }
  }

  // UI Handler methods
  async handleScreenshot(): Promise<void> {
    try {
      this.loading = true;
      const dataURL = await this.takeScreenshot();
      
      // Create download link
      const link = document.createElement('a');
      link.download = `avatar-screenshot-${Date.now()}.png`;
      link.href = dataURL;
      link.click();
      
      this.loading = false;
    } catch (error) {
      this.loading = false;
      this.error = 'Failed to take screenshot';
      console.error('Screenshot error:', error);
    }
  }

  async handleExport(): Promise<void> {
    try {
      this.loading = true;
      const blob = await this.exportModel('glb');
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `avatar-model-${Date.now()}.glb`;
      link.href = url;
      link.click();
      
      // Clean up
      URL.revokeObjectURL(url);
      
      this.loading = false;
    } catch (error) {
      this.loading = false;
      this.error = 'Failed to export model';
      console.error('Export error:', error);
    }
  }
  
  private animateCamera(
    targetPosition: THREE.Vector3,
    targetLookAt: THREE.Vector3,
    duration: number = 1000
  ): void {
    const startPosition = this.camera.position.clone();
    const startLookAt = this.controls.target.clone();
    
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Interpolate
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);
      this.controls.target.lerpVectors(startLookAt, targetLookAt, eased);
      this.controls.update();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  private rotation360?: number;
  
  private start360Rotation(): void {
    if (!this.avatarGroup) return;
    
    this.controls.target.set(0, this.CAMERA_TARGET_HEIGHT, 0);
    
    const animate = () => {
      if (this.currentView !== '360') {
        this.rotation360 = undefined;
        return;
      }
      
      if (this.rotation360 === undefined) {
        this.rotation360 = 0;
      }
      
      this.rotation360 += 0.005;
      
      this.camera.position.x = Math.sin(this.rotation360) * this.CAMERA_DISTANCE;
      this.camera.position.y = this.CAMERA_HEIGHT;
      this.camera.position.z = Math.cos(this.rotation360) * this.CAMERA_DISTANCE;
      
      this.controls.update();
      
      requestAnimationFrame(animate);
    };
    
    animate();
  }
  
  // Measurement visualization
  toggleMeasurements(): void {
    this.showMeasurements = !this.showMeasurements;
    
    if (this.showMeasurements) {
      this.createMeasurementLines();
      // Pull camera back when showing measurements
      this.camera.position.set(2.5, this.CAMERA_HEIGHT, 5);
      this.controls.update();
    } else {
      this.removeMeasurementLines();
      // Reset to default camera position
      this.setView(this.currentView);
    }
  }
  
  private createMeasurementLines(): void {
    if (!this.avatarGroup || !this.avatarData?.measurements) return;
    
    const measurements = this.avatarData.measurements;
    const box = new THREE.Box3().setFromObject(this.avatarGroup);
    
    // Height line
    if (measurements.height) {
      const heightLine = this.createMeasurementLine(
        new THREE.Vector3(box.max.x + 0.3, box.min.y, 0),
        new THREE.Vector3(box.max.x + 0.3, box.max.y, 0),
        `${measurements.height}cm`,
        0xff0000
      );
      this.measurementLines.push(heightLine);
      this.scene.add(heightLine);
      
      const label = this.createTextLabel(`Height: ${measurements.height}cm`, 
        new THREE.Vector3(box.max.x + 0.5, box.max.y / 2, 0)
      );
      this.measurementLabels.push(label);
      this.scene.add(label);
    }
    
    // Chest line
    if (measurements.chest) {
      const chestY = box.min.y + (box.max.y - box.min.y) * 0.65;
      const chestLine = this.createMeasurementLine(
        new THREE.Vector3(box.min.x - 0.1, chestY, box.max.z + 0.1),
        new THREE.Vector3(box.max.x + 0.1, chestY, box.max.z + 0.1),
        `${measurements.chest}cm`,
        0x00ff00
      );
      this.measurementLines.push(chestLine);
      this.scene.add(chestLine);
      
      const label = this.createTextLabel(`Chest: ${measurements.chest}cm`, 
        new THREE.Vector3(0, chestY, box.max.z + 0.3)
      );
      this.measurementLabels.push(label);
      this.scene.add(label);
    }
    
    // Waist line
    if (measurements.waist) {
      const waistY = box.min.y + (box.max.y - box.min.y) * 0.45;
      const waistLine = this.createMeasurementLine(
        new THREE.Vector3(box.min.x - 0.1, waistY, box.max.z + 0.15),
        new THREE.Vector3(box.max.x + 0.1, waistY, box.max.z + 0.15),
        `${measurements.waist}cm`,
        0x0000ff
      );
      this.measurementLines.push(waistLine);
      this.scene.add(waistLine);
      
      const label = this.createTextLabel(`Waist: ${measurements.waist}cm`, 
        new THREE.Vector3(0, waistY, box.max.z + 0.35)
      );
      this.measurementLabels.push(label);
      this.scene.add(label);
    }
    
    // Hips line
    if (measurements.hips) {
      const hipsY = box.min.y + (box.max.y - box.min.y) * 0.3;
      const hipsLine = this.createMeasurementLine(
        new THREE.Vector3(box.min.x - 0.1, hipsY, box.max.z + 0.2),
        new THREE.Vector3(box.max.x + 0.1, hipsY, box.max.z + 0.2),
        `${measurements.hips}cm`,
        0xff00ff
      );
      this.measurementLines.push(hipsLine);
      this.scene.add(hipsLine);
      
      const label = this.createTextLabel(`Hips: ${measurements.hips}cm`, 
        new THREE.Vector3(0, hipsY, box.max.z + 0.4)
      );
      this.measurementLabels.push(label);
      this.scene.add(label);
    }
  }
  
  private createMeasurementLine(
    start: THREE.Vector3,
    end: THREE.Vector3,
    label: string,
    color: number = 0xff0000
  ): THREE.Line {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: color,
      linewidth: 2,
      scale: 1,
      dashSize: 0.05,
      gapSize: 0.05,
      depthTest: false,
      depthWrite: false
    });
    
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    
    return line;
  }
  
  private createTextLabel(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    
    const context = canvas.getContext('2d');
    if (!context) return new THREE.Sprite();
    
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.font = 'Bold 24px Arial';
    context.fillStyle = 'black';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
      map: texture,
      depthTest: false,
      depthWrite: false
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(0.5, 0.125, 1);
    
    return sprite;
  }
  
  private removeMeasurementLines(): void {
    this.measurementLines.forEach(line => {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.measurementLines = [];
    
    this.measurementLabels.forEach(label => {
      this.scene.remove(label);
      if (label.material.map) {
        label.material.map.dispose();
      }
      label.material.dispose();
    });
    this.measurementLabels = [];
  }
  
  // Clothing management
  removeClothing(type: string): void {
    const clothing = this.clothingGroups.get(type);
    if (clothing) {
      this.scene.remove(clothing);
      this.clothingGroups.delete(type);
    }
  }
  
  removeAllClothing(): void {
    this.clothingGroups.forEach((clothing) => {
      this.scene.remove(clothing);
    });
    this.clothingGroups.clear();
  }
  
  // Screenshot functionality
  async takeScreenshot(): Promise<string> {
    // Render at higher resolution
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);
    
    const screenshotSize = new THREE.Vector2(1920, 1080);
    this.renderer.setSize(screenshotSize.x, screenshotSize.y);
    
    // Update camera aspect
    this.camera.aspect = screenshotSize.x / screenshotSize.y;
    this.camera.updateProjectionMatrix();
    
    // Render
    this.renderer.render(this.scene, this.camera);
    
    // Get data URL
    const dataURL = this.renderer.domElement.toDataURL('image/png');
    
    // Restore original size
    this.renderer.setSize(originalSize.x, originalSize.y);
    this.camera.aspect = originalSize.x / originalSize.y;
    this.camera.updateProjectionMatrix();
    
    return dataURL;
  }
  
  // Export functionality
  async exportModel(format: 'glb' | 'obj' = 'glb'): Promise<Blob> {
    if (!this.avatarGroup) {
      throw new Error('No avatar loaded');
    }
    
    // Combine avatar and clothing
    const exportGroup = new THREE.Group();
    exportGroup.add(this.avatarGroup.clone());
    
    this.clothingGroups.forEach((clothing) => {
      exportGroup.add(clothing.clone());
    });
    
    if (format === 'glb') {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter');
      const exporter = new GLTFExporter();
      
      return new Promise((resolve, reject) => {
        exporter.parse(
          exportGroup,
          (result) => {
            const blob = new Blob([result as ArrayBuffer], {
              type: 'model/gltf-binary'
            });
            resolve(blob);
          },
          (error) => {
            reject(error);
          },
          { binary: true }
        );
      });
    } else {
      throw new Error('OBJ export not implemented');
    }
  }
  
  // Animation loop
  private animate(): void {
    requestAnimationFrame(() => this.animate());
    
    const delta = this.clock.getDelta();
    
    // Update controls
    this.controls.update();
    
    // Update animations
    if (this.mixer) {
      this.mixer.update(delta);
    }
    
    // Update measurement labels to face camera
    this.measurementLabels.forEach(label => {
      label.lookAt(this.camera.position);
    });
    
    // Render
    this.renderer.render(this.scene, this.camera);
  }
  
  // Cleanup
  private cleanup(): void {
    // Stop resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    // Dispose Three.js resources
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => {
              this.disposeMaterial(material);
            });
          } else {
            this.disposeMaterial(child.material);
          }
        }
      }
    });
    
    // Dispose renderer
    this.renderer.dispose();
    
    // Remove canvas
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
  
  private disposeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial) {
      if (material.map) material.map.dispose();
      if (material.normalMap) material.normalMap.dispose();
      if (material.roughnessMap) material.roughnessMap.dispose();
      if (material.metalnessMap) material.metalnessMap.dispose();
      if (material.aoMap) material.aoMap.dispose();
      if (material.envMap) material.envMap.dispose();
    }
    material.dispose();
  }
}
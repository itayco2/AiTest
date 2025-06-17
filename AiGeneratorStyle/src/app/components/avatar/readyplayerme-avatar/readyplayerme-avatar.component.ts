// src/app/components/avatar/readyplayerme-avatar/readyplayerme-avatar.component.ts
import { Component, OnInit, OnDestroy, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Angular Material imports
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';

import { AvatarService, Measurements, IframeConfig } from '../../../services/avatar.service';
import { AvatarData } from '../avatar-viewer/avatar-viewer.component';

@Component({
  selector: 'app-readyplayerme-avatar',
  templateUrl: './readyplayerme-avatar.component.html',
  styleUrls: ['./readyplayerme-avatar.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatStepperModule,
    MatDialogModule,
    MatDividerModule
  ]
})
export class ReadyPlayerMeAvatarComponent implements OnInit, OnDestroy {
  @ViewChild('rpmFrame', { static: false }) rpmFrame!: ElementRef<HTMLIFrameElement>;
  @ViewChild('photoUpload', { static: false }) photoUpload!: ElementRef<HTMLInputElement>;
  
  @Output() avatarCreated = new EventEmitter<AvatarData>();
  @Output() avatarUpdated = new EventEmitter<AvatarData>();
  
  // Component state
  loading = false;
  showIframe = false;
  currentStep: 'upload' | 'customize' | 'complete' = 'upload';
  uploadedPhotoFile?: File;
  
  // Avatar data
  avatarUrl?: string;
  avatarId?: string;
  selectedPhoto?: File;
  photoPreview?: string;
  
  // Measurements (loaded from localStorage or defaults)
  measurements: Measurements = {
    height: 170,
    weight: 70,
    chest: 95,
    waist: 80,
    hips: 95,
    gender: 'neutral'
  };
  
  // Ready Player Me configuration
  rpmConfig = {
    gender: 'neutral',
    bodyType: 'fullbody'
  };
  
  // Iframe configuration from backend
  iframeConfig?: IframeConfig;
  iframeUrl?: SafeResourceUrl;
  
  // Message listener reference
  private messageListener?: (event: MessageEvent) => void;
  
  constructor(
    private avatarService: AvatarService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {}
  
  ngOnInit(): void {
    // Load iframe configuration from backend
    this.loadIframeConfig();
    
    // Load saved measurements if available
    const savedMeasurements = localStorage.getItem('userMeasurements');
    if (savedMeasurements) {
      try {
        const parsed = JSON.parse(savedMeasurements);
        this.measurements = { ...this.measurements, ...parsed };
        if (parsed.gender) {
          this.rpmConfig.gender = parsed.gender;
        }
      } catch (error) {
        console.error('Failed to parse saved measurements:', error);
      }
    }
    
    // Set up message listener for iframe communication
    this.messageListener = this.handleReadyPlayerMeMessage.bind(this);
    window.addEventListener('message', this.messageListener);
  }
  
  ngOnDestroy(): void {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
    }
  }
  
  // Load iframe configuration from backend
  private loadIframeConfig(): void {
    this.avatarService.getIframeConfig().subscribe({
      next: (config) => {
        console.log('Loaded iframe config:', config);
        this.iframeConfig = config;
      },
      error: (error) => {
        console.error('Failed to load iframe config:', error);
        this.snackBar.open('Failed to load Ready Player Me configuration', 'OK', {
          duration: 3000
        });
      }
    });
  }
  
  // Update iframe URL for photo upload
  private updateIframeUrlForPhoto(): void {
    if (!this.iframeConfig) return;
    
    // Add specific parameters for photo upload
    const params = new URLSearchParams({
      ...this.iframeConfig.parameters,
      ...(this.rpmConfig.gender !== 'neutral' && { gender: this.rpmConfig.gender }),
      'selectAvatar': 'false', // Skip avatar selection, go straight to photo
      'skipIntro': 'true' // Skip introduction
    });
    
    const url = `${this.iframeConfig.iframeUrl}?${params.toString()}`;
    console.log('Photo upload iframe URL:', url);
    this.iframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
  
  // Handle photo selection
  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedPhoto = input.files[0];
      this.uploadedPhotoFile = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.photoPreview = e.target?.result as string;
        // Automatically start avatar creation after photo is selected
        this.startPhotoAvatarCreation();
      };
      reader.readAsDataURL(this.selectedPhoto);
    }
  }
  
  // Remove selected photo
  removePhoto(): void {
    this.selectedPhoto = undefined;
    this.photoPreview = undefined;
    this.uploadedPhotoFile = undefined;
    if (this.photoUpload) {
      this.photoUpload.nativeElement.value = '';
    }
  }
  
  // Start avatar creation directly with photo
  private startPhotoAvatarCreation(): void {
    if (!this.selectedPhoto) return;
    
    // Update iframe URL for photo upload
    this.updateIframeUrlForPhoto();
    
    // Show iframe
    this.showIframe = true;
    this.currentStep = 'customize';
    this.loading = false;
    
    // Show instructions
    this.snackBar.open(
      'Ready Player Me will open. Click "Upload a photo" and use your selected image.',
      'OK',
      { duration: 7000 }
    );
  }
  
  // Start avatar creation process
  startAvatarCreation(): void {
    // This is now only called when clicking "Create Avatar with Photo"
    if (this.selectedPhoto) {
      this.startPhotoAvatarCreation();
    } else {
      this.snackBar.open('Please select a photo first', 'OK', { duration: 3000 });
    }
  }
  
  // Show Ready Player Me iframe for manual creation
  showReadyPlayerMeCreator(): void {
    if (!this.iframeConfig) {
      this.snackBar.open('Configuration not loaded yet', 'OK', { duration: 3000 });
      return;
    }
    
    // Update iframe URL for manual creation
    const params = new URLSearchParams({
      ...this.iframeConfig.parameters,
      ...(this.rpmConfig.gender !== 'neutral' && { gender: this.rpmConfig.gender })
    });
    
    const url = `${this.iframeConfig.iframeUrl}?${params.toString()}`;
    this.iframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    
    this.showIframe = true;
    this.currentStep = 'customize';
    this.loading = false;
  }
  
  // Handle messages from Ready Player Me iframe
  private handleReadyPlayerMeMessage(event: MessageEvent): void {
    // Only process messages from Ready Player Me
    if (!this.iframeConfig) return;
    
    const validOrigins = [
      `https://${this.iframeConfig.subdomain}.readyplayer.me`,
      'https://readyplayer.me'
    ];
    
    if (!validOrigins.includes(event.origin)) {
      return;
    }
    
    console.log('Ready Player Me message:', event.data);
    
    try {
      // Parse message
      const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      
      // Handle different message types
      switch (message.eventName) {
        case 'v1.frame.ready':
          console.log('Ready Player Me iframe is ready');
          if (this.uploadedPhotoFile) {
            // Inform user to upload photo in the iframe
            setTimeout(() => {
              this.snackBar.open(
                'Click "Upload a photo" in Ready Player Me and select your image',
                'OK',
                { duration: 5000 }
              );
            }, 1000);
          }
          break;
          
        case 'v1.avatar.exported':
          // Avatar has been exported
          if (message.data && message.data.url) {
            console.log('Avatar exported:', message.data.url);
            this.handleAvatarExported(message.data.url);
          }
          break;
          
        case 'v1.user.set':
          console.log('User logged in to Ready Player Me');
          break;
          
        case 'v1.avatar.failed':
          console.error('Avatar creation failed');
          this.snackBar.open('Avatar creation failed', 'OK', { duration: 3000 });
          this.loading = false;
          break;
          
        case 'v1.photo.uploaded':
          console.log('Photo uploaded successfully');
          this.snackBar.open('Processing your photo...', 'OK', { duration: 2000 });
          break;
      }
    } catch (error) {
      // Handle string messages (legacy format)
      if (typeof event.data === 'string' && event.data.includes('.glb')) {
        console.log('Received avatar URL (legacy):', event.data);
        this.handleAvatarExported(event.data);
      }
    }
  }
  
  // Handle avatar export from Ready Player Me
  private handleAvatarExported(avatarUrl: string): void {
    this.loading = true;
    this.showIframe = false;
    
    console.log('Saving avatar URL:', avatarUrl);
    
    // Save avatar through backend
    this.avatarService.saveIframeAvatar(avatarUrl, this.measurements).subscribe({
      next: (response) => {
        console.log('Avatar saved:', response);
        
        // Create avatar data for viewer
        const avatarData: AvatarData = {
          avatarId: response.avatarId,
          avatarUrl: response.avatarUrl,
          thumbnailUrl: response.thumbnailUrl,
          measurements: this.measurements,
          metadata: {
            ...response.metadata,
            hasCustomFace: true,
            createdFrom: 'photo'
          }
        };
        
        // Update state
        this.avatarUrl = avatarUrl;
        this.avatarId = response.avatarId;
        this.currentStep = 'complete';
        
        // Emit the created avatar
        this.avatarCreated.emit(avatarData);
        
        this.snackBar.open('Your look-alike avatar has been created!', 'OK', {
          duration: 3000
        });
      },
      error: (error) => {
        console.error('Error saving avatar:', error);
        this.snackBar.open('Failed to save avatar', 'OK', {
          duration: 3000
        });
        
        // Still show the avatar even if saving failed
        this.avatarUrl = avatarUrl;
        this.currentStep = 'complete';
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
  
  // Update configuration
  updateConfig(config: any): void {
    this.rpmConfig = { ...this.rpmConfig, ...config };
    
    // Update measurements gender if changed
    if (config.gender) {
      this.measurements = {
        ...this.measurements,
        gender: config.gender
      };
    }
  }
  
  // Reset component
  reset(): void {
    this.currentStep = 'upload';
    this.showIframe = false;
    this.selectedPhoto = undefined;
    this.photoPreview = undefined;
    this.uploadedPhotoFile = undefined;
    this.avatarUrl = undefined;
    this.avatarId = undefined;
    this.loading = false;
  }
  
  // Handle image loading errors
  onImageError(event: any): void {
    console.error('Image load error');
    // Use placeholder
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U0ZTRlNCIvPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSI0MCIgZmlsbD0iIzk5OSIvPgogIDxwYXRoIGQ9Ik01MCAxNTBoMTAwYzAgMjcuNi0yMi40IDUwLTUwIDUwcy01MC0yMi40LTUwLTUweiIgZmlsbD0iIzk5OSIvPgo8L3N2Zz4=';
  }
}
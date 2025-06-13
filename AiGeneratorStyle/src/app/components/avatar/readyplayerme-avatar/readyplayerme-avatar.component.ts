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

import { AvatarService, Measurements } from '../../../services/avatar.service';
import { AvatarData } from '../avatar-viewer/avatar-viewer.component';
import { MatDividerModule } from '@angular/material/divider';

export interface ReadyPlayerMeConfig {
  subdomain: string;
  clearCache?: boolean;
  bodyType?: 'fullbody' | 'halfbody';
  quickStart?: boolean;
  gender?: 'male' | 'female' | 'neutral';
  language?: string;
}

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
    FormsModule,
    MatDividerModule
  ]
})
export class ReadyPlayerMeAvatarComponent implements OnInit, OnDestroy {
  @ViewChild('rpmFrame', { static: false }) rpmFrame!: ElementRef<HTMLIFrameElement>;
  @ViewChild('photoUpload', { static: false }) photoUpload!: ElementRef<HTMLInputElement>;
  
  @Output() avatarCreated = new EventEmitter<AvatarData>();
  @Output() avatarUpdated = new EventEmitter<AvatarData>();
  
  // Ready Player Me configuration
  rpmConfig: ReadyPlayerMeConfig = {
    subdomain: 'styleit', // Your actual subdomain from backend
    clearCache: true,
    bodyType: 'fullbody',
    quickStart: false,
    gender: 'neutral',
    language: 'en'
  };
  
  // Component state
  loading = false;
  showIframe = false;
  currentStep: 'upload' | 'customize' | 'complete' = 'upload';
  
  // Avatar data
  avatarUrl?: string;
  avatarId?: string;
  selectedPhoto?: File;
  photoPreview?: string;
  measurements: Measurements = {
    height: 170,
    weight: 70,
    chest: 95,
    waist: 80,
    hips: 95
  };
  
  // Iframe URL
  iframeUrl?: SafeResourceUrl;
  iframeConfig: any = {};
  
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
      } catch (error) {
        console.error('Failed to parse saved measurements:', error);
      }
    }
    
    // Set up message listener
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
      next: (response) => {
        this.iframeConfig = response;
        
        // Update config with backend values
        if (response.subdomain) {
          this.rpmConfig.subdomain = response.subdomain;
        }
        
        // Build iframe URL
        this.updateIframeUrl();
      },
      error: (error) => {
        console.error('Failed to load iframe config:', error);
        // Use default configuration
        this.updateIframeUrl();
      }
    });
  }
  
  // Update iframe URL based on current config
  private updateIframeUrl(): void {
    const baseUrl = this.iframeConfig.iframeUrl || `https://${this.rpmConfig.subdomain}.readyplayer.me/avatar`;
    
    const params = new URLSearchParams({
      frameApi: '',
      clearCache: 'true',
      bodyType: this.rpmConfig.bodyType || 'fullbody',
      quickStart: 'false',
      ...(this.rpmConfig.gender && this.rpmConfig.gender !== 'neutral' && { gender: this.rpmConfig.gender }),
      ...(this.rpmConfig.language && { language: this.rpmConfig.language })
    });
    
    const url = `${baseUrl}?${params.toString()}`;
    this.iframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
  
  // Handle photo selection
  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedPhoto = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.photoPreview = e.target?.result as string;
      };
      reader.readAsDataURL(this.selectedPhoto);
    }
  }
  
  // Remove selected photo
  removePhoto(): void {
    this.selectedPhoto = undefined;
    this.photoPreview = undefined;
    if (this.photoUpload) {
      this.photoUpload.nativeElement.value = '';
    }
  }
  
  // Start avatar creation process
  async startAvatarCreation(): Promise<void> {
    this.loading = true;
    
    try {
      // If we have a photo, process it first
      if (this.selectedPhoto) {
        await this.processPhotoWithBackend();
      } else {
        // Show Ready Player Me iframe for manual creation
        this.showReadyPlayerMeCreator();
      }
    } catch (error) {
      console.error('Avatar creation error:', error);
      this.snackBar.open('Failed to start avatar creation', 'OK', {
        duration: 3000
      });
      this.loading = false;
    }
  }
  
  // Process photo with backend
  private async processPhotoWithBackend(): Promise<void> {
    if (!this.selectedPhoto) return;
    
    try {
      // Add gender to measurements
      const measurementsWithGender: Measurements = {
        ...this.measurements,
        gender: this.rpmConfig.gender || 'neutral'
      };
      
      // Generate base avatar
      this.avatarService.generateAvatar(measurementsWithGender).subscribe({
        next: (avatarResponse) => {
          this.avatarId = avatarResponse.avatarId;
          
          // Process face photo
          this.avatarService.processFacePhoto(this.avatarId, this.selectedPhoto!).subscribe({
            next: (faceResponse) => {
              // Since backend doesn't directly integrate with RPM for photos,
              // show the iframe and let user upload there
              this.showReadyPlayerMeCreator();
              this.snackBar.open('Please use your photo in the Ready Player Me creator', 'OK', {
                duration: 5000
              });
            },
            error: (error) => {
              console.error('Face processing error:', error);
              this.showReadyPlayerMeCreator();
            }
          });
        },
        error: (error) => {
          console.error('Avatar generation error:', error);
          this.showReadyPlayerMeCreator();
        },
        complete: () => {
          this.loading = false;
        }
      });
    } catch (error) {
      console.error('Photo processing error:', error);
      this.showReadyPlayerMeCreator();
      this.loading = false;
    }
  }
  
  // Show Ready Player Me iframe
  showReadyPlayerMeCreator(): void {
    this.showIframe = true;
    this.currentStep = 'customize';
    this.loading = false;
  }
  
  // Handle messages from Ready Player Me iframe
  private handleReadyPlayerMeMessage(event: MessageEvent): void {
    // Verify origin
    const validOrigins = [
      `https://${this.rpmConfig.subdomain}.readyplayer.me`,
      'https://readyplayer.me'
    ];
    
    if (!validOrigins.some(origin => event.origin === origin)) {
      return;
    }
    
    console.log('Ready Player Me message received:', event.data);
    
    try {
      // Try to parse as JSON first
      const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      
      // Handle different message types
      if (message.eventName === 'v1.frame.ready') {
        console.log('Ready Player Me iframe is ready');
      } else if (message.eventName === 'v1.avatar.exported') {
        // Avatar has been exported
        if (message.data && message.data.url) {
          this.handleAvatarExported(message.data.url);
        }
      } else if (message.eventName === 'v1.user.set') {
        console.log('User logged in to Ready Player Me');
      }
    } catch (error) {
      // Handle string messages (legacy format)
      if (typeof event.data === 'string') {
        if (event.data === 'v1.frame.ready') {
          console.log('Ready Player Me iframe ready (legacy)');
        } else if (event.data.includes('.glb')) {
          // Direct avatar URL
          this.handleAvatarExported(event.data);
        }
      }
    }
  }
  
  // Handle avatar export from Ready Player Me
  private handleAvatarExported(avatarUrl: string): void {
    this.loading = true;
    this.showIframe = false;
    
    // Add gender to measurements
    const measurementsToSave: Measurements = {
      ...this.measurements,
      gender: this.rpmConfig.gender || 'neutral'
    };
    
    // Save avatar through backend
    this.avatarService.saveIframeAvatar(avatarUrl, measurementsToSave).subscribe({
      next: (response) => {
        // Create avatar data
        const avatarData: AvatarData = {
          avatarId: response.avatarId,
          avatarUrl: response.avatarUrl,
          thumbnailUrl: response.thumbnailUrl,
          measurements: this.measurements,
          metadata: response.metadata || {
            provider: 'readyplayerme',
            created_at: new Date().toISOString()
          }
        };
        
        // Update the avatar URL for display
        this.avatarUrl = avatarUrl;
        
        // Emit the created avatar
        this.avatarCreated.emit(avatarData);
        this.currentStep = 'complete';
        
        this.snackBar.open('Ready Player Me avatar created successfully!', 'OK', {
          duration: 3000
        });
      },
      error: (error) => {
        console.error('Error saving avatar:', error);
        this.snackBar.open('Failed to save avatar', 'OK', {
          duration: 3000
        });
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
  
  // Update avatar configuration
  updateConfig(config: Partial<ReadyPlayerMeConfig>): void {
    this.rpmConfig = { ...this.rpmConfig, ...config };
    
    // Update measurements gender if changed
    if (config.gender) {
      this.measurements = {
        ...this.measurements,
        gender: config.gender
      };
    }
    
    // Reload iframe URL with new config
    this.updateIframeUrl();
  }
  
  // Reset component
  reset(): void {
    this.currentStep = 'upload';
    this.showIframe = false;
    this.selectedPhoto = undefined;
    this.photoPreview = undefined;
    this.avatarUrl = undefined;
    this.avatarId = undefined;
    this.loading = false;
  }
  
  // Handle image loading errors
  onImageError(event: any): void {
    // Fallback to placeholder
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U0ZTRlNCIvPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSI0MCIgZmlsbD0iIzk5OSIvPgogIDxwYXRoIGQ9Ik01MCAxNTBoMTAwYzAgMjcuNi0yMi40IDUwLTUwIDUwcy01MC0yMi40LTUwLTUweiIgZmlsbD0iIzk5OSIvPgo8L3N2Zz4=';
  }
}
// src/app/components/home/home.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MeasurementFormComponent } from '../../avatar/measurement-form/measurement-form.component';
import { AvatarData, AvatarViewerComponent } from '../../avatar/avatar-viewer/avatar-viewer.component';
import { ReadyPlayerMeAvatarComponent } from '../../avatar/readyplayerme-avatar/readyplayerme-avatar.component';
import { AvatarService } from '../../../services/avatar.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSnackBarModule,
    MeasurementFormComponent,
    AvatarViewerComponent,
    ReadyPlayerMeAvatarComponent
  ]
})
export class HomeComponent implements OnInit {
  avatarData: AvatarData | null = null;
  currentMeasurements: any = null;
  selectedPhoto: File | null = null;
  isUploadingPhoto = false;
  
  // UI state
  showMeasurementForm = false;
  showReadyPlayerMe = false;
  
  constructor(
    private avatarService: AvatarService,
    private snackBar: MatSnackBar
  ) {}
  
  ngOnInit() {
    // Check if there's an existing avatar in storage
    this.loadExistingAvatar();
  }
  
  private loadExistingAvatar() {
    const currentAvatar = this.avatarService.getCurrentAvatar();
    if (currentAvatar) {
      // Convert the stored avatar data to the format expected by avatar-viewer
      this.avatarData = {
        avatarId: currentAvatar.avatarId,
        avatarUrl: currentAvatar.avatarUrl,
        thumbnailUrl: currentAvatar.thumbnailUrl,
        measurements: currentAvatar.metadata?.measurements || {},
        metadata: currentAvatar.metadata,
        clothing: [],
        facePhotoUrl: currentAvatar.metadata?.facePhotoUrl
      };
      
      this.snackBar.open('Welcome back! Your avatar has been loaded.', 'OK', {
        duration: 3000
      });
    }
  }
  
  onAvatarGenerated(event: any) {
    console.log('Avatar generated:', event);
    
    // Format the data for the avatar viewer
    this.avatarData = {
      avatarId: event.avatarId,
      avatarUrl: event.avatarUrl,
      thumbnailUrl: event.thumbnailUrl,
      measurements: event.measurements,
      metadata: {
        measurements: event.measurements,
        created_at: new Date().toISOString()
      },
      clothing: []
    };
    
    // Hide forms
    this.showMeasurementForm = false;
    this.showReadyPlayerMe = false;
    
    this.snackBar.open('Avatar created successfully!', 'OK', {
      duration: 3000
    });
  }
  
  onReadyPlayerMeAvatarCreated(avatarData: AvatarData) {
    console.log('Ready Player Me avatar created:', avatarData);
    this.avatarData = avatarData;
    
    // Hide forms
    this.showMeasurementForm = false;
    this.showReadyPlayerMe = false;
    
    this.snackBar.open('Ready Player Me avatar created successfully!', 'OK', {
      duration: 3000
    });
  }
  
  onAvatarUpdated(avatarData: AvatarData) {
    console.log('Avatar updated:', avatarData);
    this.avatarData = avatarData;
  }
  
  onMeasurementsChanged(measurements: any) {
    this.currentMeasurements = measurements;
    console.log('Measurements updated:', measurements);
  }
  
  onAvatarLoaded(success: boolean) {
    if (success) {
      console.log('Avatar loaded successfully in viewer');
    } else {
      this.snackBar.open('Failed to load avatar model', 'Retry', {
        duration: 5000
      }).onAction().subscribe(() => {
        // Retry loading
        if (this.avatarData) {
          // Force reload by resetting and setting avatar data
          const tempData = this.avatarData;
          this.avatarData = null;
          setTimeout(() => {
            this.avatarData = tempData;
          }, 100);
        }
      });
    }
  }
  
  onClothingFitted(clothing: any) {
    console.log('Clothing fitted:', clothing);
    this.snackBar.open(`${clothing.type} added successfully!`, 'OK', {
      duration: 2000
    });
  }
  
  backToOptions() {
    // Confirm before going back
    if (confirm('Do you want to go back? Your current avatar will be saved.')) {
      this.avatarData = null;
      this.showMeasurementForm = false;
      this.showReadyPlayerMe = false;
    }
  }
  
  editAvatar() {
    if (this.avatarData?.metadata?.provider === 'readyplayerme') {
      this.showReadyPlayerMe = true;
      this.avatarData = null;
    } else {
      this.showMeasurementForm = true;
      this.avatarData = null;
    }
  }
  
  resetAvatar() {
    if (confirm('Are you sure you want to reset? This will delete your current avatar and measurements.')) {
      // Clear stored data
      this.avatarService.clearStoredAvatar();
      localStorage.removeItem('userMeasurements');
      
      // Reset component state
      this.avatarData = null;
      this.currentMeasurements = null;
      this.showMeasurementForm = false;
      this.showReadyPlayerMe = false;
      
      this.snackBar.open('Avatar reset successfully', 'OK', {
        duration: 2000
      });
    }
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedPhoto = input.files[0];
      this.uploadPhoto();
    }
  }

  uploadPhoto() {
    if (!this.selectedPhoto) return;
    this.isUploadingPhoto = true;
    
    // Generate a temporary avatar to get an ID
    const measurements = this.currentMeasurements || { 
      height: 170, 
      weight: 70, 
      chest: 95,
      waist: 80,
      hips: 95,
      gender: 'neutral', 
      bodyType: 'average' 
    };
    
    this.avatarService.generateAvatar(measurements).subscribe(avatar => {
      this.avatarService.processFacePhoto(avatar.avatarId, this.selectedPhoto!).subscribe(
        (response) => {
          this.isUploadingPhoto = false;
          if (response.success && response.updatedAvatarUrl) {
            this.avatarData = {
              avatarId: avatar.avatarId,
              avatarUrl: response.updatedAvatarUrl,
              thumbnailUrl: response.updatedThumbnailUrl || avatar.thumbnailUrl,
              measurements: measurements,
              metadata: {
                ...avatar.metadata,
                hasFacePhoto: true,
                provider: 'readyplayerme'
              }
            };
            
            // Hide forms
            this.showMeasurementForm = false;
            this.showReadyPlayerMe = false;
            
            this.snackBar.open('Photo uploaded and 3D avatar generated!', 'Close', { duration: 3000 });
          } else {
            this.snackBar.open('Failed to process photo: ' + (response.error || response.message), 'Close', { duration: 4000 });
          }
        },
        (error) => {
          this.isUploadingPhoto = false;
          this.snackBar.open('Photo upload failed.', 'Close', { duration: 4000 });
        }
      );
    });
  }
}
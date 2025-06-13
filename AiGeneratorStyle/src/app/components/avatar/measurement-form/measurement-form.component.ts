// src/app/components/measurement-form/measurement-form.component.ts
import { Component, OnInit, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

// Angular Material imports
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatStepperModule } from '@angular/material/stepper';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AvatarService } from '../../../services/avatar.service';

// Service import

export interface Measurements {
  height: number;
  weight: number;
  chest: number;
  waist: number;
  hips: number;
  neck?: number;
  shoulders?: number;
  armLength?: number;
  legLength?: number;
  userId?: string;
}

export interface AvatarGenerationResult {
  avatarId: string;
  avatarUrl: string;
  thumbnailUrl: string;
  measurements: Measurements;
}

@Component({
  selector: 'app-measurement-form',
  templateUrl: './measurement-form.component.html',
  styleUrls: ['./measurement-form.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatStepperModule,
    MatExpansionModule,
    MatTooltipModule
  ]
})
export class MeasurementFormComponent implements OnInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  @Output() avatarGenerated = new EventEmitter<AvatarGenerationResult>();
  @Output() measurementsChanged = new EventEmitter<Measurements>();
  
  measurementForm: FormGroup;
  loading = false;
  currentStep = 0;
  
  // Form groups for stepper validation
  basicInfoGroup!: FormGroup;
  bodyMeasurementsGroup!: FormGroup;
  
  // Measurement guides
  measurementGuides = {
    height: 'Stand straight against a wall and measure from head to toe',
    weight: 'Use a scale for accurate weight measurement',
    chest: 'Measure around the fullest part of your chest',
    waist: 'Measure around your natural waistline',
    hips: 'Measure around the fullest part of your hips',
    neck: 'Measure around the base of your neck',
    shoulders: 'Measure from shoulder to shoulder across your back',
    armLength: 'Measure from shoulder to wrist with arm slightly bent',
    legLength: 'Measure from waist to ankle along the outside of leg'
  };
  
  // Face photo
  facePhotoFile?: File;
  facePhotoPreview?: string;
  
  // Size presets
  sizePresets = {
    XS: { chest: 86, waist: 71, hips: 89 },
    S: { chest: 91, waist: 76, hips: 94 },
    M: { chest: 97, waist: 81, hips: 99 },
    L: { chest: 107, waist: 91, hips: 109 },
    XL: { chest: 117, waist: 101, hips: 119 },
    XXL: { chest: 127, waist: 111, hips: 129 }
  };
  
  constructor(
    private fb: FormBuilder,
    private avatarService: AvatarService,
    private snackBar: MatSnackBar
  ) {
    this.measurementForm = this.createForm();
  }
  
  ngOnInit(): void {
    // Initialize form groups for stepper
    this.basicInfoGroup = this.fb.group({
      height: this.measurementForm.get('height'),
      weight: this.measurementForm.get('weight'),
      gender: this.measurementForm.get('gender'),
      bodyType: this.measurementForm.get('bodyType')
    });
    
    this.bodyMeasurementsGroup = this.fb.group({
      chest: this.measurementForm.get('chest'),
      waist: this.measurementForm.get('waist'),
      hips: this.measurementForm.get('hips')
    });
    
    // Load saved measurements if available
    this.loadSavedMeasurements();
    
    // Subscribe to form changes
    this.measurementForm.valueChanges.subscribe(values => {
      this.measurementsChanged.emit(values);
      this.saveMeasurements();
    });
  }
  
  private createForm(): FormGroup {
    return this.fb.group({
      // Basic measurements
      height: [170, [
        Validators.required,
        Validators.min(140),
        Validators.max(220)
      ]],
      weight: [70, [
        Validators.required,
        Validators.min(40),
        Validators.max(200)
      ]],
      chest: [95, [
        Validators.required,
        Validators.min(70),
        Validators.max(150)
      ]],
      waist: [80, [
        Validators.required,
        Validators.min(60),
        Validators.max(140)
      ]],
      hips: [95, [
        Validators.required,
        Validators.min(70),
        Validators.max(150)
      ]],
      
      // Optional detailed measurements
      neck: [null, [Validators.min(30), Validators.max(60)]],
      shoulders: [null, [Validators.min(35), Validators.max(60)]],
      armLength: [null, [Validators.min(50), Validators.max(80)]],
      legLength: [null, [Validators.min(70), Validators.max(120)]],
      
      // User preferences
      gender: ['neutral'],
      bodyType: ['average'],
      units: ['cm']
    });
  }
  
  private loadSavedMeasurements(): void {
    // First try to load from localStorage
    const savedMeasurements = localStorage.getItem('userMeasurements');
    
    if (savedMeasurements) {
      try {
        const measurements = JSON.parse(savedMeasurements);
        this.measurementForm.patchValue(measurements);
      } catch (error) {
        console.error('Failed to load saved measurements:', error);
      }
    }
    
    // Then check if there's a current avatar with measurements
    const currentAvatar = this.avatarService.getCurrentAvatar();
    if (currentAvatar && currentAvatar.metadata && currentAvatar.metadata.measurements) {
      this.measurementForm.patchValue(currentAvatar.metadata.measurements);
    }
  }
  
  private saveMeasurements(): void {
    if (this.measurementForm.valid) {
      const measurements = this.measurementForm.value;
      localStorage.setItem('userMeasurements', JSON.stringify(measurements));
    }
  }
  
  // Step navigation
  nextStep(): void {
    if (this.currentStep < 2) {
      this.currentStep++;
    }
  }
  
  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
  }
  
  // Size preset selection
  selectSizePreset(size: string): void {
    const preset = this.sizePresets[size as keyof typeof this.sizePresets];
    if (preset) {
      this.measurementForm.patchValue(preset);
      this.snackBar.open(`Size ${size} measurements applied`, 'OK', {
        duration: 2000
      });
    }
  }
  
  // Face photo handling
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.facePhotoFile = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.facePhotoPreview = e.target?.result as string;
      };
      reader.readAsDataURL(this.facePhotoFile);
    }
  }
  
  removeFacePhoto(): void {
    this.facePhotoFile = undefined;
    this.facePhotoPreview = undefined;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }
  
  // Avatar generation
  async generateAvatar(): Promise<void> {
    if (!this.measurementForm.valid) {
      this.snackBar.open('Please fill in all required measurements', 'OK', {
        duration: 3000
      });
      return;
    }
    
    this.loading = true;
    
    try {
      const measurements = this.measurementForm.value;
      
      // Add userId if available
      measurements.userId = this.avatarService.getUserId();
      
      // Generate avatar
      const response = await this.avatarService.generateAvatar(measurements).toPromise();
      
      if (!response) {
        throw new Error('No response from avatar generation');
      }
      
      // Process face photo if provided
      if (this.facePhotoFile && response.avatarId) {
        try {
          const faceResponse = await this.avatarService
            .processFacePhoto(response.avatarId, this.facePhotoFile)
            .toPromise();
          
          if (faceResponse?.updatedAvatarUrl) {
            response.avatarUrl = faceResponse.updatedAvatarUrl;
          }
        } catch (faceError) {
          console.error('Face processing failed:', faceError);
          this.snackBar.open('Avatar created but face processing failed', 'OK', {
            duration: 3000
          });
        }
      }
      
      // Emit result
      const result: AvatarGenerationResult = {
        avatarId: response.avatarId,
        avatarUrl: response.avatarUrl,
        thumbnailUrl: response.thumbnailUrl,
        measurements: measurements
      };
      
      this.avatarGenerated.emit(result);
      
      this.snackBar.open('Avatar generated successfully!', 'OK', {
        duration: 3000
      });
      
    } catch (error) {
      console.error('Avatar generation failed:', error);
      this.snackBar.open('Failed to generate avatar. Please try again.', 'OK', {
        duration: 3000
      });
    } finally {
      this.loading = false;
    }
  }
  
  // Update existing avatar
  async updateAvatar(): Promise<void> {
    const currentAvatar = this.avatarService.getCurrentAvatar();
    if (!currentAvatar) {
      this.generateAvatar();
      return;
    }
    
    if (!this.measurementForm.valid) {
      this.snackBar.open('Please fill in all required measurements', 'OK', {
        duration: 3000
      });
      return;
    }
    
    this.loading = true;
    
    try {
      const measurements = this.measurementForm.value;
      const response = await this.avatarService
        .updateAvatar(currentAvatar.avatarId, measurements)
        .toPromise();
      
      if (!response) {
        throw new Error('No response from avatar update');
      }
      
      const result: AvatarGenerationResult = {
        avatarId: response.avatarId,
        avatarUrl: response.avatarUrl,
        thumbnailUrl: response.thumbnailUrl,
        measurements: measurements
      };
      
      this.avatarGenerated.emit(result);
      
      this.snackBar.open('Avatar updated successfully!', 'OK', {
        duration: 3000
      });
      
    } catch (error) {
      console.error('Avatar update failed:', error);
      this.snackBar.open('Failed to update avatar. Please try again.', 'OK', {
        duration: 3000
      });
    } finally {
      this.loading = false;
    }
  }
  
  // Validation helpers
  isStepValid(step: number): boolean {
    switch (step) {
      case 0: // Basic measurements
        const heightValid = this.measurementForm.get('height')?.valid ?? false;
        const weightValid = this.measurementForm.get('weight')?.valid ?? false;
        return heightValid && weightValid;
      case 1: // Body measurements
        const chestValid = this.measurementForm.get('chest')?.valid ?? false;
        const waistValid = this.measurementForm.get('waist')?.valid ?? false;
        const hipsValid = this.measurementForm.get('hips')?.valid ?? false;
        return chestValid && waistValid && hipsValid;
      case 2: // Optional measurements and photo
        return true; // Optional step
      default:
        return false;
    }
  }
  
  getErrorMessage(fieldName: string): string {
    const field = this.measurementForm.get(fieldName);
    if (!field) return '';
    
    if (field.hasError('required')) {
      return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is required`;
    }
    if (field.hasError('min')) {
      return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is too small`;
    }
    if (field.hasError('max')) {
      return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is too large`;
    }
    
    return '';
  }
  
  // Unit conversion
  convertUnits(): void {
    const currentUnit = this.measurementForm.get('units')?.value;
    const newUnit = currentUnit === 'cm' ? 'inch' : 'cm';
    
    const conversionFactor = currentUnit === 'cm' ? 0.393701 : 2.54;
    
    const fieldsToConvert = [
      'height', 'chest', 'waist', 'hips', 
      'neck', 'shoulders', 'armLength', 'legLength'
    ];
    
    fieldsToConvert.forEach(field => {
      const value = this.measurementForm.get(field)?.value;
      if (value !== null && value !== undefined) {
        const convertedValue = Math.round(value * conversionFactor * 10) / 10;
        this.measurementForm.patchValue({ [field]: convertedValue }, { emitEvent: false });
      }
    });
    
    this.measurementForm.patchValue({ units: newUnit });
  }
  
  // Reset form
  resetForm(): void {
    this.measurementForm.reset({
      height: 170,
      weight: 70,
      chest: 95,
      waist: 80,
      hips: 95,
      gender: 'neutral',
      bodyType: 'average',
      units: 'cm'
    });
    this.removeFacePhoto();
    this.currentStep = 0;
  }
}
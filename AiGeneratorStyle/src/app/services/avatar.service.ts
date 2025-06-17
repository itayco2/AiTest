// src/app/services/avatar.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, of, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AvatarResponse {
  avatarId: string;
  avatarUrl: string;
  thumbnailUrl: string;
  metadata?: any;
}

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
  gender?: string;
  bodyType?: string;
}

export interface IframeConfig {
  iframeUrl: string;
  subdomain: string;
  parameters: any;
  instructions?: string[];
}

export interface FacePhotoResponse {
  success: boolean;
  avatarId: string;
  message?: string;
  iframeUrl?: string;
  instructions?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AvatarService {
  private apiUrl = environment.apiUrl || 'http://localhost:8000/api';
  private currentAvatarSubject = new BehaviorSubject<AvatarResponse | null>(null);
  public currentAvatar$ = this.currentAvatarSubject.asObservable();
  
  constructor(private http: HttpClient) {
    // Load saved avatar from localStorage
    const savedAvatar = localStorage.getItem('currentAvatar');
    if (savedAvatar) {
      try {
        this.currentAvatarSubject.next(JSON.parse(savedAvatar));
      } catch (error) {
        console.error('Failed to load saved avatar:', error);
      }
    }
  }
  
  // Generate avatar from measurements (returns default avatar)
  generateAvatar(measurements: Measurements): Observable<AvatarResponse> {
    return this.http.post<AvatarResponse>(`${this.apiUrl}/avatar/generate`, measurements)
      .pipe(
        tap(response => {
          console.log('Avatar generated:', response);
          this.setCurrentAvatar(response);
        }),
        catchError(error => {
          console.error('Avatar generation error:', error);
          throw error;
        })
      );
  }
  
  // Get Ready Player Me iframe configuration
  getIframeConfig(): Observable<IframeConfig> {
    return this.http.get<IframeConfig>(`${this.apiUrl}/avatar/iframe-config`)
      .pipe(
        tap(config => {
          console.log('Iframe config loaded:', config);
        }),
        catchError(error => {
          console.error('Failed to get iframe config:', error);
          // Return default config as fallback
          return of({
            iframeUrl: 'https://styleit.readyplayer.me/avatar',
            subdomain: 'styleit',
            parameters: {
              frameApi: '',
              bodyType: 'fullbody',
              clearCache: '',
              quickStart: 'false',
              gender: 'neutral'
            }
          });
        })
      );
  }
  
  // Save avatar from Ready Player Me iframe
  saveIframeAvatar(avatarUrl: string, measurements: Measurements): Observable<AvatarResponse> {
    return this.http.post<AvatarResponse>(`${this.apiUrl}/avatar/from-iframe`, {
      avatarUrl: avatarUrl,
      measurements: measurements
    }).pipe(
      tap(response => {
        console.log('Avatar saved from iframe:', response);
        this.setCurrentAvatar(response);
      }),
      catchError(error => {
        console.error('Failed to save iframe avatar:', error);
        throw error;
      })
    );
  }
  
  // Get avatar by ID
  getAvatar(avatarId: string): Observable<AvatarResponse> {
    return this.http.get<AvatarResponse>(`${this.apiUrl}/avatar/${avatarId}`)
      .pipe(
        catchError(error => {
          console.error('Get avatar error:', error);
          // Return current avatar if available
          const current = this.getCurrentAvatar();
          if (current && current.avatarId === avatarId) {
            return of(current);
          }
          throw error;
        })
      );
  }
  
  // Update avatar measurements
  updateAvatar(avatarId: string, measurements: Measurements): Observable<AvatarResponse> {
    return this.http.put<AvatarResponse>(`${this.apiUrl}/avatar/${avatarId}/update`, measurements)
      .pipe(
        tap(response => {
          this.setCurrentAvatar(response);
        }),
        catchError(error => {
          console.error('Avatar update error:', error);
          throw error;
        })
      );
  }
  
  // Process face photo (returns instructions to use iframe)
  processFacePhoto(avatarId: string, facePhoto: File): Observable<FacePhotoResponse> {
    const formData = new FormData();
    formData.append('face_photo', facePhoto, facePhoto.name);

    return this.http.post<FacePhotoResponse>(`${this.apiUrl}/avatar/${avatarId}/face`, formData)
      .pipe(
        tap(response => {
          console.log('Face photo response:', response);
        }),
        catchError(error => {
          console.error('Face photo processing error:', error);
          return of({
            success: false,
            avatarId: avatarId,
            message: 'Please use the Ready Player Me creator to upload photos',
            iframeUrl: 'https://styleit.readyplayer.me/avatar'
          });
        })
      );
  }
  
  // Get clothing catalog
  getClothingCatalog(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/clothing/catalog`)
      .pipe(
        catchError(error => {
          console.error('Get clothing catalog error:', error);
          return of([]);
        })
      );
  }
  
  // Fit clothing to avatar
  fitClothing(request: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/clothing/fit`, request)
      .pipe(
        catchError(error => {
          console.error('Clothing fit error:', error);
          throw error;
        })
      );
  }
  
  // Get/set current avatar
  getCurrentAvatar(): AvatarResponse | null {
    return this.currentAvatarSubject.value;
  }
  
  setCurrentAvatar(avatar: AvatarResponse): void {
    this.currentAvatarSubject.next(avatar);
    localStorage.setItem('currentAvatar', JSON.stringify(avatar));
  }
  
  clearCurrentAvatar(): void {
    this.currentAvatarSubject.next(null);
    localStorage.removeItem('currentAvatar');
  }
  
  // Get user ID (for multi-user support)
  getUserId(): string {
    let userId = localStorage.getItem('userId');
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('userId', userId);
    }
    return userId;
  }
  
  // Test API connection
  testConnection(): Observable<any> {
    return this.http.get(`${this.apiUrl.replace('/api', '')}/`)
      .pipe(
        catchError(error => {
          console.error('API connection error:', error);
          throw error;
        })
      );
  }
}
// src/app/services/avatar.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, of } from 'rxjs';
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

export interface FacePhotoResponse {
  success: boolean;
  updatedAvatarUrl?: string;
  updatedThumbnailUrl?: string;
  message?: string;
  error?: string;
}

export interface ClothingFitRequest {
  avatarId: string;
  clothingId: string;
  clothingType: string;
  size?: string;
  autoFit?: boolean;
}

export interface ClothingFitResponse {
  success: boolean;
  fittedModelUrl: string;
  fitScore: number;
  recommendations?: string[];
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
  
  // Generate avatar from measurements using Ready Player Me
  generateAvatar(measurements: Measurements): Observable<AvatarResponse> {
    return this.http.post<AvatarResponse>(`${this.apiUrl}/avatar/generate`, measurements)
      .pipe(
        tap(response => {
          this.setCurrentAvatar(response);
        }),
        catchError(error => {
          console.error('Avatar generation error:', error);
          
          // Fallback to mock Ready Player Me style response
          const mockResponse: AvatarResponse = {
            avatarId: `rpm_avatar_${Date.now()}`,
            avatarUrl: this.getReadyPlayerMeAvatarUrl(measurements),
            thumbnailUrl: this.getWorkingAvatarThumbnail(measurements),
            metadata: {
              measurements,
              created_at: new Date().toISOString(),
              isHumanModel: true,
              provider: 'readyplayerme'
            }
          };
          
          this.setCurrentAvatar(mockResponse);
          return of(mockResponse);
        })
      );
  }

  // Generate a Ready Player Me style avatar URL (mock implementation)
  private getReadyPlayerMeAvatarUrl(measurements: Measurements): string {
    // This is a placeholder; in a real implementation, you would generate a URL based on measurements
    // For now, return a working avatar URL based on gender/bodyType
    return this.getWorkingAvatarUrl(measurements);
  }
  
  // Get working avatar URLs that are actually accessible
  private getWorkingAvatarUrl(measurements: Measurements): string {
    // Use gender and body type to select appropriate model
    const gender = measurements.gender || 'neutral';
    const bodyType = measurements.bodyType || 'average';
    
    // These are publicly available sample models that work
    const avatarUrls: Record<string, string> = {
      // Working Ready Player Me public avatars
      neutral: 'https://models.readyplayer.me/64f02b5e17883fd37c13df96.glb',
      male: 'https://models.readyplayer.me/64f02cdc17883fd37c13e01e.glb',
      female: 'https://models.readyplayer.me/64efd41017883fd37c0fe856.glb',
      
      // Fallback to Three.js examples if RPM fails
      fallback_male: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb',
      fallback_female: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Michelle.glb',
      fallback_neutral: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb'
    };
    
    // Try Ready Player Me avatars first
    if (gender === 'male') {
      return avatarUrls['male'];
    } else if (gender === 'female') {
      return avatarUrls['female'];
    }
    
    return avatarUrls['neutral'];
  }
  
  private getWorkingAvatarThumbnail(measurements: Measurements): string {
    // Return a default thumbnail or generate one
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U0ZTRlNCIvPgogIDxjaXJjbGUgY3g9IjEwMCIgY3k9IjcwIiByPSI0MCIgZmlsbD0iIzk5OSIvPgogIDxwYXRoIGQ9Ik01MCAxNTBoMTAwYzAgMjcuNi0yMi40IDUwLTUwIDUwcy01MC0yMi40LTUwLTUweiIgZmlsbD0iIzk5OSIvPgo8L3N2Zz4=';
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
          
          // Fallback: update the stored avatar with new measurements
          const current = this.getCurrentAvatar();
          if (current && current.avatarId === avatarId) {
            const updated = {
              ...current,
              metadata: {
                ...current.metadata,
                measurements,
                updated_at: new Date().toISOString()
              }
            };
            this.setCurrentAvatar(updated);
            return of(updated);
          }
          
          throw error;
        })
      );
  }
  
  // Process face photo
  processFacePhoto(avatarId: string, facePhoto: File): Observable<FacePhotoResponse> {
    const formData = new FormData();
    formData.append('face_photo', facePhoto, facePhoto.name);

    return this.http.post<FacePhotoResponse>(`${this.apiUrl}/avatar/${avatarId}/face`, formData)
      .pipe(
        tap(response => {
          if (response.success && response.updatedAvatarUrl) {
            // Update current avatar with new face data
            const currentAvatar = this.getCurrentAvatar();
            if (currentAvatar && currentAvatar.avatarId === avatarId) {
              const updatedAvatar = {
                ...currentAvatar,
                avatarUrl: response.updatedAvatarUrl,
                thumbnailUrl: response.updatedThumbnailUrl || currentAvatar.thumbnailUrl,
                metadata: {
                  ...currentAvatar.metadata,
                  hasFacePhoto: true,
                  facePhotoUrl: response.updatedAvatarUrl
                }
              };
              this.setCurrentAvatar(updatedAvatar);
            }
          }
        }),
        catchError(error => {
          console.error('Face photo processing error:', error);
          return of({
            success: false,
            error: 'Failed to process face photo'
          });
        })
      );
  }
  
  // Get Ready Player Me iframe configuration
  getIframeConfig(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/avatar/iframe-config`)
      .pipe(
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
        this.setCurrentAvatar(response);
      }),
      catchError(error => {
        console.error('Failed to save iframe avatar:', error);
        
        // Create a fallback response
        const fallbackResponse: AvatarResponse = {
          avatarId: `rpm_avatar_${Date.now()}`,
          avatarUrl: avatarUrl,
          thumbnailUrl: avatarUrl.replace('.glb', '.png'),
          metadata: {
            measurements,
            created_at: new Date().toISOString(),
            provider: 'readyplayerme-iframe'
          }
        };
        
        this.setCurrentAvatar(fallbackResponse);
        return of(fallbackResponse);
      })
    );
  }
  
  // Fit clothing to avatar
  fitClothing(request: ClothingFitRequest): Observable<ClothingFitResponse> {
    return this.http.post<ClothingFitResponse>(`${this.apiUrl}/clothing/fit`, request)
      .pipe(
        catchError(error => {
          console.error('Clothing fit error:', error);
          // Return mock response for development
          return of({
            success: true,
            fittedModelUrl: 'https://example.com/fitted-clothing.glb',
            fitScore: 0.85,
            recommendations: ['Size M fits well', 'Consider size L for a looser fit']
          });
        })
      );
  }
  
  // Get available clothing items
  getClothingCatalog(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/clothing/catalog`)
      .pipe(
        catchError(error => {
          console.error('Get clothing catalog error:', error);
          // Return mock data
          return of([
            {
              id: 'shirt_001',
              name: 'Basic T-Shirt',
              type: 'shirt',
              modelUrl: 'https://example.com/tshirt.glb',
              sizes: ['XS', 'S', 'M', 'L', 'XL'],
              colors: ['white', 'black', 'blue', 'red']
            },
            {
              id: 'pants_001',
              name: 'Classic Jeans',
              type: 'pants',
              modelUrl: 'https://example.com/jeans.glb',
              sizes: ['XS', 'S', 'M', 'L', 'XL'],
              colors: ['blue', 'black', 'grey']
            }
          ]);
        })
      );
  }
  
  // Size recommendation based on measurements
  getRecommendedSize(measurements: Measurements, clothingType: string): Observable<string> {
    return this.http.post<{ size: string }>(`${this.apiUrl}/clothing/recommend-size`, {
      measurements,
      clothingType
    }).pipe(
      map(response => response.size),
      catchError(error => {
        console.error('Size recommendation error:', error);
        // Simple calculation for fallback
        const avgMeasurement = (measurements.chest + measurements.waist + measurements.hips) / 3;
        if (avgMeasurement < 85) return of('XS');
        if (avgMeasurement < 92) return of('S');
        if (avgMeasurement < 100) return of('M');
        if (avgMeasurement < 110) return of('L');
        if (avgMeasurement < 120) return of('XL');
        return of('XXL');
      })
    );
  }
  
  // Get/set current avatar
  getCurrentAvatar(): AvatarResponse | null {
    return this.currentAvatarSubject.value;
  }
  
  public setCurrentAvatar(avatar: AvatarResponse): void {
    this.currentAvatarSubject.next(avatar);
    localStorage.setItem('currentAvatar', JSON.stringify(avatar));
  }
  
  clearCurrentAvatar(): void {
    this.currentAvatarSubject.next(null);
    localStorage.removeItem('currentAvatar');
  }
  
  // Alias for backward compatibility
  clearStoredAvatar(): void {
    this.clearCurrentAvatar();
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
  
  // Save avatar to user profile
  saveAvatarToProfile(avatarId: string): Observable<any> {
    const userId = this.getUserId();
    return this.http.post(`${this.apiUrl}/user/${userId}/avatar`, { avatarId })
      .pipe(
        catchError(error => {
          console.error('Save avatar to profile error:', error);
          // Save locally as fallback
          const savedAvatars = JSON.parse(localStorage.getItem('savedAvatars') || '[]');
          savedAvatars.push(avatarId);
          localStorage.setItem('savedAvatars', JSON.stringify(savedAvatars));
          return of({ success: true });
        })
      );
  }
  
  // Get user's saved avatars
  getUserAvatars(): Observable<AvatarResponse[]> {
    const userId = this.getUserId();
    return this.http.get<AvatarResponse[]>(`${this.apiUrl}/user/${userId}/avatars`)
      .pipe(
        catchError(error => {
          console.error('Get user avatars error:', error);
          // Return from localStorage
          const savedAvatars = JSON.parse(localStorage.getItem('savedAvatars') || '[]');
          return of(savedAvatars);
        })
      );
  }
  
  // Export avatar
  exportAvatar(avatarId: string, format: 'glb' | 'obj' = 'glb'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/avatar/${avatarId}/export?format=${format}`, {
      responseType: 'blob'
    }).pipe(
      catchError(error => {
        console.error('Export avatar error:', error);
        throw error;
      })
    );
  }
  
  // Share avatar
  shareAvatar(avatarId: string): Observable<{ shareUrl: string }> {
    return this.http.post<{ shareUrl: string }>(`${this.apiUrl}/avatar/${avatarId}/share`, {})
      .pipe(
        catchError(error => {
          console.error('Share avatar error:', error);
          // Generate local share URL
          return of({ 
            shareUrl: `${window.location.origin}/avatar/${avatarId}` 
          });
        })
      );
  }
}
// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HomeComponent } from './app/components/page/home/home.component';


// Define routes (even if just one component)
const routes = [
  { path: '', component: HomeComponent },
  { path: '**', redirectTo: '' }
];

// Bootstrap the application with HomeComponent as root
bootstrapApplication(HomeComponent, {
  providers: [
    provideAnimations(), // Required for Angular Material animations
    provideHttpClient(withFetch()), // Provides HttpClient with fetch API
    provideRouter(routes) // Provides routing
  ]
}).catch(err => console.error('Bootstrap Error:', err));
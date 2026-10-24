import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withHashLocation,
  withNavigationErrorHandler,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/jwt.interceptor';
import { provideApiConfig } from './core/api-config.service';
import { reloadOnStaleChunk } from './core/stale-chunk';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withHashLocation(),
      withComponentInputBinding(),
      withNavigationErrorHandler((e) => void reloadOnStaleChunk(e)),
    ),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    ...provideApiConfig(),
  ],
};

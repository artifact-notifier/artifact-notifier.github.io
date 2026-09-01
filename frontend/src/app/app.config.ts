import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import {provideRouter, withHashLocation} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/jwt.interceptor';
import { provideApiConfig } from './core/api-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    ...provideApiConfig(),
  ],
};

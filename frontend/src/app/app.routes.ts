import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './login/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { PreferencesComponent } from './preferences/preferences.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/callback', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'preferences', component: PreferencesComponent, canActivate: [authGuard] },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

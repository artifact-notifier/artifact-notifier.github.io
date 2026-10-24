import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core/auth.guard';
import { LoginComponent } from './login/login.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { PreferencesComponent } from './preferences/preferences.component';
import { AdminComponent } from './admin/admin.component';
import { ProjectComponent } from './projects/project.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/callback', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'preferences', component: PreferencesComponent, canActivate: [authGuard] },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard] },
  { path: 'projects/:id', component: ProjectComponent, canActivate: [authGuard] },
  // lazy: the file parsers (TOML/YAML libraries) only load on this page
  {
    path: 'import',
    loadComponent: () => import('./import/import.component').then((m) => m.ImportComponent),
    canActivate: [authGuard],
  },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

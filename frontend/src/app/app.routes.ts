import { Routes } from '@angular/router';
import { guestOnlyGuard } from './core/auth/guest-only.guard';
import { profileGuard } from './core/auth/profile.guard';
import { ngoOnlyGuard } from './core/auth/ngo-only.guard';
import { individualOnlyGuard } from './core/auth/individual-only.guard';
import { adminOnlyGuard } from './core/auth/admin-only.guard';

export const routes: Routes = [
  {
    path: 'admin',
    canActivate: [adminOnlyGuard],
    loadComponent: () => import('./layouts/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: 'dashboard', data: { section: 'dashboard' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: 'ngos/pending', loadComponent: () => import('./features/admin/pages/pending-ngos-page/pending-ngos-page').then((m) => m.PendingNgosPage) },
      { path: 'ngos/:ngoId/verification', loadComponent: () => import('./features/admin/pages/ngo-verification-review-page/ngo-verification-review-page').then((m) => m.NgoVerificationReviewPage) },
      { path: 'users', data: { section: 'users' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: 'users/:userId', data: { section: 'user-detail' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: 'needs', data: { section: 'needs' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: 'needs/:needId', data: { section: 'need-detail' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: 'reports', data: { section: 'reports' }, loadComponent: () => import('./features/admin/pages/admin-workspace-page/admin-workspace-page').then((m) => m.AdminWorkspacePage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  {
    path: 'individual',
    canActivate: [individualOnlyGuard],
    loadComponent: () => import('./layouts/individual-layout/individual-layout').then((m) => m.IndividualLayout),
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/individual/pages/dashboard-page/dashboard-page').then((m) => m.IndividualDashboardPage) },
      { path: 'needs', loadComponent: () => import('./features/needs/pages/needs-list-page/needs-list-page').then((m) => m.NeedsListPage) },
      { path: 'needs/:id', loadComponent: () => import('./features/needs/pages/need-detail-page/need-detail-page').then((m) => m.NeedDetailPage) },
      { path: 'responses', loadComponent: () => import('./features/individual/pages/responses-page/responses-page').then((m) => m.IndividualResponsesPage) },
      { path: 'applications', loadComponent: () => import('./features/individual/pages/responses-page/responses-page').then((m) => m.IndividualResponsesPage) },
      { path: 'matching', loadComponent: () => import('./features/matching/pages/recommendations-page/recommendations-page').then((m) => m.RecommendationsPage) },
      { path: 'contributions', loadComponent: () => import('./features/contributions/pages/my-contributions-page/my-contributions-page').then((m) => m.MyContributionsPage) },
      { path: 'profile', loadComponent: () => import('./features/profile/pages/profile-page/profile-page').then((m) => m.ProfilePage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  {
    path: 'ngo',
    canActivate: [ngoOnlyGuard],
    loadComponent: () => import('./layouts/ngo-layout/ngo-layout').then((m) => m.NgoLayout),
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/ngo/pages/dashboard-page/ngo-dashboard-page').then((m) => m.NgoDashboardPage) },
      { path: 'needs', loadComponent: () => import('./features/ngo/pages/needs-page/ngo-needs-page').then((m) => m.NgoNeedsPage) },
      { path: 'needs/new', loadComponent: () => import('./features/needs/pages/need-editor-page/need-editor-page').then((m) => m.NeedEditorPage) },
      { path: 'needs/:id/edit', loadComponent: () => import('./features/needs/pages/need-editor-page/need-editor-page').then((m) => m.NeedEditorPage) },
      { path: 'needs/:id/responses', loadComponent: () => import('./features/needs/pages/need-responses-page/need-responses-page').then((m) => m.NeedResponsesPage) },
      { path: 'needs/:id', loadComponent: () => import('./features/needs/pages/need-detail-page/need-detail-page').then((m) => m.NeedDetailPage) },
      { path: 'responses', loadComponent: () => import('./features/ngo/pages/responses-page/ngo-responses-page').then((m) => m.NgoResponsesPage) },
      { path: 'profile', loadComponent: () => import('./features/profile/pages/profile-page/profile-page').then((m) => m.ProfilePage) },
      { path: 'verification', loadComponent: () => import('./features/verification/pages/verification-page/verification-page').then((m) => m.VerificationPage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  {
    path: '',
    loadComponent: () =>
      import('./layouts/public-layout/public-layout').then((m) => m.PublicLayout),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/home/pages/landing-page/landing-page').then(
            (m) => m.LandingPage,
          ),
      },
      {
        path: 'login',
        canActivate: [guestOnlyGuard],
        loadComponent: () =>
          import('./features/auth/pages/login-page/login-page').then(
            (m) => m.LoginPage,
          ),
      },
      {
        path: 'verify-email',
        loadComponent: () =>
          import('./features/auth/pages/email-verification-page/email-verification-page').then(
            (m) => m.EmailVerificationPage,
          ),
      },
      {
        path: 'register',
        canActivate: [guestOnlyGuard],
        loadComponent: () =>
          import('./features/auth/pages/registration-page/registration-page').then(
            (m) => m.RegistrationPage,
          ),
      },
      {
        path: 'profile',
        canActivate: [profileGuard],
        loadComponent: () =>
          import('./features/profile/pages/profile-page/profile-page').then(
            (m) => m.ProfilePage,
          ),
      },
      {
        path: 'verification',
        canActivate: [ngoOnlyGuard],
        loadComponent: () =>
          import('./features/verification/pages/verification-page/verification-page').then(
            (m) => m.VerificationPage,
          ),
      },
      {
        path: 'matching',
        canActivate: [individualOnlyGuard],
        loadComponent: () =>
          import('./features/matching/pages/recommendations-page/recommendations-page').then(
            (m) => m.RecommendationsPage,
          ),
      },
      {
        path: 'my-contributions',
        canActivate: [individualOnlyGuard],
        loadComponent: () =>
          import('./features/contributions/pages/my-contributions-page/my-contributions-page').then(
            (m) => m.MyContributionsPage,
          ),
      },
      {
        path: 'needs',
        loadComponent: () =>
          import('./features/needs/pages/needs-list-page/needs-list-page').then(
            (m) => m.NeedsListPage,
          ),
      },
      {
        path: 'needs/manage/new',
        canActivate: [ngoOnlyGuard],
        loadComponent: () =>
          import('./features/needs/pages/need-editor-page/need-editor-page').then(
            (m) => m.NeedEditorPage,
          ),
      },
      {
        path: 'needs/manage/:id/edit',
        canActivate: [ngoOnlyGuard],
        loadComponent: () =>
          import('./features/needs/pages/need-editor-page/need-editor-page').then(
            (m) => m.NeedEditorPage,
          ),
      },
      {
        path: 'needs/manage/:id/responses',
        canActivate: [ngoOnlyGuard],
        loadComponent: () =>
          import('./features/needs/pages/need-responses-page/need-responses-page').then(
            (m) => m.NeedResponsesPage,
          ),
      },
      {
        path: 'needs/:id',
        loadComponent: () =>
          import('./features/needs/pages/need-detail-page/need-detail-page').then(
            (m) => m.NeedDetailPage,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

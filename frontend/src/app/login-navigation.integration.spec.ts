import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';

import { App } from './app';
import { environment } from '../environments/environment';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { adminOnlyGuard } from './core/auth/admin-only.guard';
import { guestOnlyGuard } from './core/auth/guest-only.guard';
import { individualOnlyGuard } from './core/auth/individual-only.guard';
import { ngoOnlyGuard } from './core/auth/ngo-only.guard';
import { LoginPage } from './features/auth/pages/login-page/login-page';
import { IndividualLayout } from './layouts/individual-layout/individual-layout';
import { NgoLayout } from './layouts/ngo-layout/ngo-layout';
import { AdminLayout } from './layouts/admin-layout/admin-layout';
import { PublicLayout } from './layouts/public-layout/public-layout';

@Component({ standalone: true, template: '<p>Authenticated destination</p>' })
class DestinationStub {}

describe('login navigation with the real layouts and role guards', () => {
  const cases = [
    { role: 'INDIVIDUAL', destination: '/individual/dashboard' },
    { role: 'NGO', destination: '/ngo/dashboard' },
    { role: 'ADMIN', destination: '/admin/dashboard' },
  ] as const;

  let http: HttpTestingController;
  let router: Router;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;

  beforeEach(() => {
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'individual', canActivate: [individualOnlyGuard], component: IndividualLayout, children: [
            { path: 'dashboard', component: DestinationStub },
          ] },
          { path: 'ngo', canActivate: [ngoOnlyGuard], component: NgoLayout, children: [
            { path: 'dashboard', component: DestinationStub },
          ] },
          { path: 'admin', canActivate: [adminOnlyGuard], component: AdminLayout, children: [
            { path: 'dashboard', component: DestinationStub },
          ] },
          { path: '', component: PublicLayout, children: [
            { path: 'login', canActivate: [guestOnlyGuard], component: LoginPage },
          ] },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(App);
  });

  afterEach(() => {
    try { http.verify(); } finally {
      TestBed.resetTestingModule();
      window.sessionStorage.clear();
    }
  });

  it.each(cases)('persists the session, updates the navbar and immediately leaves /login for $role', async ({ role, destination }) => {
    fixture.detectChanges();
    await router.navigateByUrl('/login');
    fixture.detectChanges();

    const email = fixture.nativeElement.querySelector('#login-email') as HTMLInputElement;
    const password = fixture.nativeElement.querySelector('#login-password') as HTMLInputElement;
    email.value = 'member@example.org';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'correct-password';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    const login = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    const destinationNavigation = firstValueFrom(router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd && event.urlAfterRedirects === destination),
      take(1),
    ));
    login.flush({
      success: true,
      message: 'Login successful',
      data: {
        token: 'fresh.jwt.token',
        user: { userId: 'user-1', name: 'Asha Rao', email: 'member@example.org', role, phone: null, city: null, availability: null },
      },
    });

    // The HTTP success callback persists the token/user synchronously. The
    // real layouts read that state while Router navigates through the guards.
    fixture.detectChanges();
    expect(window.sessionStorage.getItem('ngo-connect.access-token')).toBe('fresh.jwt.token');
    expect(JSON.parse(window.sessionStorage.getItem('ngo-connect.auth-user') ?? 'null').role).toBe(role);
    expect(fixture.nativeElement.textContent).toContain('Asha Rao');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);

    await destinationNavigation;
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/notifications/unread-count`).flush({
      success: true, message: 'Retrieved', data: { unreadCount: 0 },
    });

    expect(router.url).toBe(destination);
    expect(fixture.nativeElement.querySelector('#login-email')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Authenticated destination');

    if (role === 'NGO') {
      http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'ok', data: {
        ngo_id: 'ngo-1', user_id: 'user-1', name: 'Community NGO', description: null, email: 'ngo@example.org',
        phone: null, address: null, city: 'Jaipur', website_url: null, verification_status: 'NOT_SUBMITTED',
        created_at: '', updated_at: '',
      } });
    }
  });
});

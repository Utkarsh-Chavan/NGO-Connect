import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { individualOnlyGuard } from '../../../core/auth/individual-only.guard';
import { ngoOnlyGuard } from '../../../core/auth/ngo-only.guard';
import { adminOnlyGuard } from '../../../core/auth/admin-only.guard';
import { LoginPage } from './login-page/login-page';
import { RegistrationPage } from './registration-page/registration-page';
import { EmailVerificationPage } from './email-verification-page/email-verification-page';

@Component({ standalone: true, template: '' })
class RouteStub {}

const enterText = (fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string, value: string) => {
  const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
};

describe('Authentication pages', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginPage, RegistrationPage],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: RouteStub },
          { path: 'individual', canActivate: [individualOnlyGuard], children: [{ path: 'dashboard', component: RouteStub }] },
          { path: 'ngo', canActivate: [ngoOnlyGuard], children: [{ path: 'dashboard', component: RouteStub }] },
          { path: 'admin/dashboard', canActivate: [adminOnlyGuard], component: RouteStub },
          { path: 'login', component: LoginPage },
          { path: 'register', component: RegistrationPage },
          { path: 'verify-email', component: EmailVerificationPage },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.clear();
  });

  it('submits the backend-supported NGO registration fields and navigates to sign-in', async () => {
    const fixture = TestBed.createComponent(RegistrationPage);
    fixture.detectChanges();

    const ngoRadio = fixture.nativeElement.querySelector('input[value="ngo"]') as HTMLInputElement;
    ngoRadio.checked = true;
    ngoRadio.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    enterText(fixture, '#register-name', ' Samira Khan ');
    enterText(fixture, '#register-email', 'samira@example.org');
    enterText(fixture, '#register-phone', '5551234567');
    enterText(fixture, '#register-city', ' Jaipur ');
    enterText(fixture, '#register-password', 'strong-password');
    enterText(fixture, '#confirm-password', 'strong-password');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/auth/register`);
    expect(request.request.body).toEqual({
      name: 'Samira Khan',
      email: 'samira@example.org',
      password: 'strong-password',
      role: 'NGO',
      phone: '5551234567',
      city: 'Jaipur',
    });
    request.flush({
      success: true,
      message: 'Account created. Open the verification link printed in the backend terminal before signing in.',
      data: { user_id: 'id' },
      deliveryMode: 'development',
    });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Verify your email to continue');
    expect(fixture.nativeElement.textContent).toContain('printed in the backend terminal');
    expect(fixture.nativeElement.querySelector('a[routerLink="/verify-email"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).not.toBe('/login');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('displays invalid-credential errors and keeps the user on the login page', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    enterText(fixture, '#login-email', 'person@example.org');
    enterText(fixture, '#login-password', 'wrong-password');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    expect(request.request.body).toEqual({ email: 'person@example.org', password: 'wrong-password' });
    request.flush({ success: false, message: 'Invalid email or password' }, {
      status: 401,
      statusText: 'Unauthorized',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Invalid email or password');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('offers an explicit generic resend after an unverified login and does not resend automatically', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    enterText(fixture, '#login-email', 'person@example.org');
    enterText(fixture, '#login-password', 'correct-password');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http.expectOne(`${environment.apiBaseUrl}/auth/login`).flush({
      success: false, code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in',
    }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    const resendButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Resend verification link')) as HTMLButtonElement;
    expect(fixture.nativeElement.textContent).toContain('Verify your email to continue');
    expect(fixture.nativeElement.textContent).toContain('Resend verification link');
    http.expectNone(`${environment.apiBaseUrl}/auth/resend-verification`);
    resendButton.click();
    const resend = http.expectOne(`${environment.apiBaseUrl}/auth/resend-verification`);
    expect(resend.request.body).toEqual({ email: 'person@example.org' });
    resend.flush({ success: true, message: 'If the account is eligible, a verification message will be sent.' }, {
      status: 202, statusText: 'Accepted',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('If this address belongs to an eligible unverified account');
  });

  it.each([
    ['INDIVIDUAL', '/individual/dashboard'],
    ['NGO', '/ngo/dashboard'],
    ['ADMIN', '/admin/dashboard'],
  ] as const)('stores the authenticated session before navigating an %s user to %s', async (role, destination) => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    enterText(fixture, '#login-email', 'person@example.org');
    enterText(fixture, '#login-password', 'password');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    request.flush({ success: true, message: 'Login successful', data: { token: 'signed.jwt.value', user: {
      userId: 'u1', name: 'Asha', email: 'person@example.org', role, phone: null, city: null, availability: null,
    } } });
    await fixture.whenStable();
    const authUser = JSON.parse(window.sessionStorage.getItem('ngo-connect.auth-user') ?? 'null');
    expect(window.sessionStorage.getItem('ngo-connect.access-token')).toBe('signed.jwt.value');
    expect(authUser.role).toBe(role);
    expect(TestBed.inject(Router).url).toBe(destination);
  });
});

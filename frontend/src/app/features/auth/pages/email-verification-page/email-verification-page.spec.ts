import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from '../../../../../environments/environment';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { App } from '../../../../app';
import { EmailVerificationPage } from './email-verification-page';

@Component({ standalone: true, template: '<p>Sign-in page</p>' })
class LoginStub {}

describe('EmailVerificationPage', () => {
  let http: HttpTestingController;
  let router: Router;
  let location: Location;
  let fixture: ReturnType<typeof TestBed.createComponent<App>>;

  beforeEach(() => {
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideLocationMocks(),
        provideRouter([
          { path: 'verify-email', component: EmailVerificationPage },
          { path: 'login', component: LoginStub },
          { path: '**', component: LoginStub },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.clear();
  });

  it('posts the fragment token, removes it from the address and offers sign-in on success', async () => {
    const token = 'A'.repeat(43);
    await router.navigateByUrl(`/verify-email#token=${token}`);
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/auth/verify-email`);
    expect(request.request.body).toEqual({ token });
    expect(location.path(true)).toBe('/verify-email');
    expect(fixture.nativeElement.textContent).not.toContain(token);
    request.flush({ success: true, message: 'Email verified successfully', data: { emailVerified: true } });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Your email is verified');
    expect(fixture.nativeElement.querySelector('a[routerLink="/login"]')).not.toBeNull();
  });

  it('shows a missing-token state and allows a pasted development link to be verified', async () => {
    await router.navigateByUrl('/verify-email');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('paste the development link');

    const token = 'B'.repeat(43);
    const input = fixture.nativeElement.querySelector('#verification-link') as HTMLInputElement;
    input.value = `http://localhost:4200/verify-email#token=${token}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const request = http.expectOne(`${environment.apiBaseUrl}/auth/verify-email`);
    expect(request.request.body).toEqual({ token });
    request.flush({ success: true, message: 'Email verified successfully', data: { emailVerified: true } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your email is verified');
  });

  it('shows an invalid or expired state when the backend rejects a token', async () => {
    await router.navigateByUrl(`/verify-email#token=${'C'.repeat(43)}`);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/auth/verify-email`).flush({
      success: false, message: 'Verification link is invalid or expired',
    }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('invalid or has expired');
    expect(fixture.nativeElement.querySelector('a[routerLink="/login"]')).not.toBeNull();
  });

  it('rejects malformed pasted tokens without calling the backend', async () => {
    await router.navigateByUrl('/verify-email');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#verification-link') as HTMLInputElement;
    input.value = 'not-a-token';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    http.expectNone(`${environment.apiBaseUrl}/auth/verify-email`);
    expect(fixture.nativeElement.textContent).toContain('invalid or has expired');
  });
});

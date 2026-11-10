import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Component } from '@angular/core';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';
import { getApiErrorMessages } from '../http/api-error';

@Component({ standalone: true, template: '' })
class RouteStub {}

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '', component: RouteStub }, { path: 'login', component: RouteStub }]),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.clear();
  });

  it('posts the backend registration contract without storing a session', () => {
    const input = {
      name: 'Asha Rao',
      email: 'asha@example.org',
      password: 'correct horse battery staple',
      role: 'INDIVIDUAL' as const,
      phone: '5551234567',
      city: 'Pune',
    };
    let completed = false;

    auth.register(input).subscribe(() => { completed = true; });
    const request = http.expectOne(`${environment.apiBaseUrl}/auth/register`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(input);
    request.flush({
      success: true,
      message: 'User registered successfully',
      data: { user_id: 'id', name: input.name, email: input.email, role: input.role },
    });

    expect(completed).toBe(true);
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });

  it('posts login credentials, stores the returned JWT in session storage, and clears it on logout', () => {
    const user = {
      userId: '10000000-0000-4000-8000-000000000001',
      name: 'Asha Rao',
      email: 'asha@example.org',
      role: 'INDIVIDUAL' as const,
      phone: null,
      city: 'Pune',
      availability: null,
    };
    let completed = false;

    auth.login({ email: user.email, password: 'correct horse battery staple' }).subscribe(() => {
      completed = true;
      expect(auth.currentUser()).toEqual(user);
      expect(auth.getAccessToken()).toBe('signed.jwt.value');
      expect(window.sessionStorage.getItem('ngo-connect.auth-user')).toBe(JSON.stringify(user));
    });
    const request = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: user.email, password: 'correct horse battery staple' });
    request.flush({ success: true, message: 'Login successful', data: { token: 'signed.jwt.value', user } });

    expect(completed).toBe(true);
    expect(auth.getAccessToken()).toBe('signed.jwt.value');
    expect(auth.currentUser()).toEqual(user);
    expect(window.sessionStorage.getItem('ngo-connect.access-token')).toBe('signed.jwt.value');
    expect(window.localStorage.getItem('ngo-connect.access-token')).toBeNull();

    auth.logout();
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.currentUser()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('adds the bearer token to API calls and clears the session after a protected 401', () => {
    const user = {
      userId: '10000000-0000-4000-8000-000000000001', name: 'Asha Rao', email: 'asha@example.org',
      role: 'INDIVIDUAL' as const, phone: null, city: null, availability: null,
    };
    auth.login({ email: user.email, password: 'password' }).subscribe();
    http.expectOne(`${environment.apiBaseUrl}/auth/login`).flush({
      success: true, message: 'Login successful', data: { token: 'signed.jwt.value', user },
    });

    TestBed.inject(HttpClient).get(`${environment.apiBaseUrl}/users/me`).subscribe({ error: () => {} });
    const request = http.expectOne(`${environment.apiBaseUrl}/users/me`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer signed.jwt.value');
    request.flush({ success: false, message: 'Invalid or expired authentication token' }, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(auth.getAccessToken()).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });
});

describe('API error messages', () => {
  it('shows server validation errors and handles duplicate and network failures', () => {
    expect(getApiErrorMessages(new HttpErrorResponse({
      status: 400,
      error: { message: 'Validation failed', errors: [{ msg: 'Email is required' }, { msg: 'Name is required' }] },
    }), 'Fallback')).toEqual(['Email is required', 'Name is required']);
    expect(getApiErrorMessages(new HttpErrorResponse({
      status: 409,
      error: { message: 'Email is already registered' },
    }), 'Fallback')).toEqual(['Email is already registered']);
    expect(getApiErrorMessages(new HttpErrorResponse({ status: 0 }), 'Fallback')[0]).toContain('backend is running');
  });
});

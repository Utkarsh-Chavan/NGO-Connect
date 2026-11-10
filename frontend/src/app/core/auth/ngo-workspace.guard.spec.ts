import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ngoOnlyGuard } from './ngo-only.guard';

@Component({ standalone: true, template: '' }) class RouteStub {}

describe('ngoOnlyGuard workspace protection', () => {
  afterEach(() => window.sessionStorage.clear());
  const configure = () => TestBed.configureTestingModule({ providers: [provideRouter([
    { path: 'ngo/dashboard', canActivate: [ngoOnlyGuard], component: RouteStub },
    { path: 'login', component: RouteStub }, { path: 'needs', component: RouteStub },
  ])] });
  it('redirects guests to login', async () => {
    configure();
    await TestBed.inject(Router).navigateByUrl('/ngo/dashboard');
    expect(TestBed.inject(Router).url).toBe('/login');
  });
  it('keeps non-NGO roles outside the NGO workspace', async () => {
    window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
    window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'Individual', email: 'person@example.org', role: 'INDIVIDUAL', phone: null, city: null }));
    configure();
    await TestBed.inject(Router).navigateByUrl('/ngo/dashboard');
    expect(TestBed.inject(Router).url).toBe('/needs');
  });
});

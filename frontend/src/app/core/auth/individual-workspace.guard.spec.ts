import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { individualOnlyGuard } from './individual-only.guard';

@Component({ standalone: true, template: '' }) class RouteStub {}

describe('individualOnlyGuard', () => {
  afterEach(() => window.sessionStorage.clear());
  const configure = () => TestBed.configureTestingModule({ providers: [provideRouter([
    { path: 'individual', canActivate: [individualOnlyGuard], component: RouteStub },
    { path: 'login', component: RouteStub }, { path: 'needs', component: RouteStub },
  ])] });
  it('redirects guests to login', async () => {
    configure();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/individual');
    expect(router.url).toBe('/login');
  });
  it('redirects a non-Individual role away from Individual routes', async () => {
    window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
    window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'NGO', email: 'ngo@example.org', role: 'NGO', phone: null, city: null, availability: null }));
    configure();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/individual');
    expect(router.url).toBe('/needs');
  });
});

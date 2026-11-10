import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { adminOnlyGuard } from '../../../core/auth/admin-only.guard';
import { individualOnlyGuard } from '../../../core/auth/individual-only.guard';
import { PendingNgosPage } from '../../admin/pages/pending-ngos-page/pending-ngos-page';
import { RecommendationsPage } from './recommendations-page/recommendations-page';

@Component({ standalone: true, template: '' })
class RouteStub {}

const tokenKey = 'ngo-connect.access-token';
const userKey = 'ngo-connect.auth-user';
const setSession = (role: 'INDIVIDUAL' | 'NGO' | 'ADMIN') => {
  window.sessionStorage.setItem(tokenKey, 'test.jwt.token');
  window.sessionStorage.setItem(userKey, JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000001', name: 'Test User', email: 'test@example.org',
    role, phone: null, city: 'Pune', availability: null,
  }));
};

const configure = () => TestBed.configureTestingModule({
  imports: [RecommendationsPage, PendingNgosPage],
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideHttpClientTesting(),
    provideRouter([{ path: 'needs/:id', component: RouteStub }]),
  ],
});

const matchingNeed = (id: string) => ({
  need_id: id, cause_id: '40000000-0000-4000-8000-000000000001', title: 'Reading mentors',
  description: 'Support a community school.', contribution_type: 'VOLUNTEER', location: 'Pune',
  availability: null, quantity_required: null, quantity_fulfilled: 0, priority: 'HIGH', deadline: null,
  status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ngo_name: 'Community Care', cause_name: 'Education', score: 47, reasons: ['Matches your cause preference: Education'],
});

const pendingNgo = (id = '20000000-0000-4000-8000-000000000001') => ({
  ngo_id: id, name: 'Community Care', description: 'Local support organization.', email: 'care@example.org',
  phone: null, address: null, city: 'Pune', verification_status: 'PENDING',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

describe('Matching and admin pages', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http?.verify();
    window.sessionStorage.clear();
  });

  it('renders the backend score and reasons and paginates using the returned total', async () => {
    setSession('INDIVIDUAL');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RecommendationsPage);
    fixture.detectChanges();
    const first = http.expectOne(`${environment.apiBaseUrl}/matching/recommendations?limit=12&offset=0`);
    expect(first.request.method).toBe('GET');
    expect(first.request.headers.get('Authorization')).toBe('Bearer test.jwt.token');
    first.flush({ success: true, message: 'Retrieved', data: {
      items: [matchingNeed('30000000-0000-4000-8000-000000000001')],
      pagination: { limit: 12, offset: 0, total: 13 },
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('47 points');
    expect(fixture.nativeElement.textContent).toContain('Matches your cause preference: Education');
    expect(fixture.nativeElement.querySelector('a[href="/needs/30000000-0000-4000-8000-000000000001"]')).not.toBeNull();

    (fixture.nativeElement.querySelector('[aria-label="Recommendation pages"] button:last-child') as HTMLButtonElement).click();
    fixture.detectChanges();
    const next = http.expectOne(`${environment.apiBaseUrl}/matching/recommendations?limit=12&offset=12`);
    next.flush({ success: true, message: 'Retrieved', data: {
      items: [matchingNeed('30000000-0000-4000-8000-000000000002')],
      pagination: { limit: 12, offset: 12, total: 13 },
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Showing 13–13 of 13');
  });

  it('shows the empty matching state and preserves API errors', async () => {
    setSession('INDIVIDUAL');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RecommendationsPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/matching/recommendations?limit=12&offset=0`).flush({
      success: true, message: 'Retrieved', data: { items: [], pagination: { limit: 12, offset: 0, total: 0 } },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No recommendations yet');
  });

  it('requires confirmation and sends the exact approval body, then refreshes pending rows', async () => {
    setSession('ADMIN');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PendingNgosPage);
    fixture.detectChanges();
    const list = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/pending?limit=12&offset=0`);
    expect(list.request.method).toBe('GET');
    expect(list.request.headers.get('Authorization')).toBe('Bearer test.jwt.token');
    list.flush({ success: true, message: 'Retrieved', data: { items: [pendingNgo()], pagination: { limit: 12, offset: 0 } } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/admin/ngos/20000000-0000-4000-8000-000000000001/verification"]')).not.toBeNull();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Approve')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Confirm approval of Community Care?');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    fixture.detectChanges();
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/20000000-0000-4000-8000-000000000001/verification`);
    expect(decision.request.method).toBe('PUT');
    expect(decision.request.body).toEqual({ verificationStatus: 'APPROVED' });
    decision.flush({ success: true, message: 'Saved', data: { ...pendingNgo(), verification_status: 'APPROVED' } });
    await fixture.whenStable();
    const refresh = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/pending?limit=12&offset=0`);
    refresh.flush({ success: true, message: 'Retrieved', data: { items: [], pagination: { limit: 12, offset: 0 } } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO profile approved successfully.');
    expect(fixture.nativeElement.textContent).toContain('No profiles are awaiting review');
  });

  it('sends the supported rejection decision and shows API errors on failure', async () => {
    setSession('ADMIN');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PendingNgosPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/pending?limit=12&offset=0`).flush({
      success: true, message: 'Retrieved', data: { items: [pendingNgo()], pagination: { limit: 12, offset: 0 } },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Reject')!.click();
    fixture.detectChanges();
    const rejectionMessage = fixture.nativeElement.querySelector('#quick-rejection-message') as HTMLTextAreaElement;
    rejectionMessage.value = 'Registration details could not be verified.';
    rejectionMessage.dispatchEvent(new Event('input', { bubbles: true }));
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    fixture.detectChanges();
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/20000000-0000-4000-8000-000000000001/verification`);
    expect(decision.request.body).toEqual({
      verificationStatus: 'REJECTED', message: 'Registration details could not be verified.',
    });
    decision.flush({ success: false, message: 'NGO profile not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO profile not found');
  });

  it('loads the next pending NGO page when the current page is full', async () => {
    setSession('ADMIN');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PendingNgosPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/pending?limit=12&offset=0`).flush({
      success: true, message: 'Retrieved',
      data: { items: Array.from({ length: 12 }, (_, index) => pendingNgo(`20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)), pagination: { limit: 12, offset: 0 } },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[aria-label="Pending NGO pages"] button:last-child') as HTMLButtonElement).click();
    fixture.detectChanges();
    const next = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/pending?limit=12&offset=12`);
    next.flush({ success: true, message: 'Retrieved', data: { items: [pendingNgo('20000000-0000-4000-8000-000000000099')], pagination: { limit: 12, offset: 12 } } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Showing 13–13');
  });

  it('blocks non-admin roles from the admin guard and allows admins', () => {
    setSession('INDIVIDUAL');
    configure();
    const router = TestBed.inject(Router);
    const denied = TestBed.runInInjectionContext(() => adminOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(router.serializeUrl(denied as ReturnType<Router['parseUrl']>)).toBe('/');
    TestBed.resetTestingModule();

    window.sessionStorage.clear();
    setSession('ADMIN');
    configure();
    const allowed = TestBed.runInInjectionContext(() => adminOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(allowed).toBe(true);
  });

  it('redirects non-individual accounts away from matching', () => {
    setSession('NGO');
    configure();
    const router = TestBed.inject(Router);
    const denied = TestBed.runInInjectionContext(() => individualOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(router.serializeUrl(denied as ReturnType<Router['parseUrl']>)).toBe('/needs');
  });
});

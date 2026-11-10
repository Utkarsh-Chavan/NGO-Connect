import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { IndividualDashboardPage } from './dashboard-page/dashboard-page';

const storeSession = () => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'Asha Rao', email: 'asha@example.org', role: 'INDIVIDUAL', phone: null, city: 'Pune', availability: null }));
};

describe('Individual workspace dashboard', () => {
  let http: HttpTestingController;
  afterEach(() => { http.verify(); window.sessionStorage.clear(); });

  it('renders actual engagement statistics, activity, and API recommendations', async () => {
    storeSession();
    TestBed.configureTestingModule({ imports: [IndividualDashboardPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IndividualDashboardPage);
    fixture.detectChanges();
    const dashboard = http.expectOne(`${environment.apiBaseUrl}/users/me/dashboard`);
    const matching = http.expectOne(`${environment.apiBaseUrl}/matching/recommendations?limit=3&offset=0`);
    dashboard.flush({ success: true, message: 'Retrieved', data: {
      pending: 1, accepted: 1, in_progress: 0, completed: 1,
      pending_applications: 1, pending_contributions: 0, accepted_applications: 0, accepted_contributions: 1,
      in_progress_contributions: 0, completed_applications: 1, completed_contributions: 0,
      recent_activity: [{ engagement_id: 'a1', need_id: 'n1', need_title: 'Garden day', ngo_name: 'Green Hands', engagement_type: 'VOLUNTEER_APPLICATION', contribution_type: 'VOLUNTEER', status: 'COMPLETED', submitted_at: '2026-02-01T00:00:00Z' }],
    } });
    matching.flush({ success: true, message: 'Retrieved', data: { items: [{ need_id: 'n2', title: 'Food kits', ngo_name: 'Care Group', contribution_type: 'MATERIAL', location: 'Pune', priority: 'HIGH', description: 'Pack food kits', score: 42, reasons: ['Cause match'] }], pagination: { limit: 3, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const expected of ['Welcome back, Asha.', '1 applications · 0 contributions', 'Garden day', 'Completed', 'Food kits', 'Care Group', 'View details']) expect(text).toContain(expected);
  });

  it('shows useful empty states when there is no activity or recommendation', async () => {
    storeSession();
    TestBed.configureTestingModule({ imports: [IndividualDashboardPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(IndividualDashboardPage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/dashboard`).flush({ success: true, message: 'Retrieved', data: { pending: 0, accepted: 0, in_progress: 0, completed: 0, pending_applications: 0, pending_contributions: 0, accepted_applications: 0, accepted_contributions: 0, in_progress_contributions: 0, completed_applications: 0, completed_contributions: 0, recent_activity: [] } });
    http.expectOne(`${environment.apiBaseUrl}/matching/recommendations?limit=3&offset=0`).flush({ success: true, message: 'Retrieved', data: { items: [], pagination: { limit: 3, offset: 0, total: 0 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No recommendations yet');
    expect(fixture.nativeElement.textContent).toContain('Your applications and contributions will appear here.');
  });
});

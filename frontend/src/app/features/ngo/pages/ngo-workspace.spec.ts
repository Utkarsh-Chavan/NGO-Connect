import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { NgoDashboardPage } from './dashboard-page/ngo-dashboard-page';
import { NgoNeedsPage } from './needs-page/ngo-needs-page';
import { NgoResponsesPage } from './responses-page/ngo-responses-page';

const base = environment.apiBaseUrl;
const needId = '30000000-0000-4000-8000-000000000001';
const storeNgoSession = () => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'Maya', email: 'maya@example.org', role: 'NGO', phone: null, city: null }));
};
const ngoProfile = { ngo_id: 'g1', user_id: 'u1', name: 'Community Care', description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune', website_url: null, verification_status: 'APPROVED', created_at: '', updated_at: '' };

describe('NGO workspace pages', () => {
  let http: HttpTestingController;
  afterEach(() => { http.verify(); window.sessionStorage.clear(); });

  it('shows real dashboard counts and a useful empty activity state', async () => {
    storeNgoSession();
    TestBed.configureTestingModule({ imports: [NgoDashboardPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoDashboardPage); fixture.detectChanges();
    http.expectOne(`${base}/ngos/me`).flush({ success: true, message: 'ok', data: ngoProfile });
    http.expectOne(`${base}/ngos/me/dashboard`).flush({ success: true, message: 'ok', data: { active_needs: 2, draft_needs: 1, completed_needs: 3, pending_responses: 4, total_responses: 7, recent_activity: [] } });
    await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const label of ['Welcome, Community Care.', 'Active needs', '2', 'Draft needs', 'Completed needs', 'Pending responses', 'Total responses', 'No responses yet']) expect(text).toContain(label);
  });

  it('renders owned needs with backend material reservation values and status', async () => {
    storeNgoSession();
    TestBed.configureTestingModule({ imports: [NgoNeedsPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoNeedsPage); fixture.detectChanges();
    http.expectOne(`${base}/ngos/me/needs?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [{ need_id: needId, ngo_id: 'g1', cause_id: 'c1', title: 'Winter kits', description: 'Warm clothes', contribution_type: 'MATERIAL', location: null, availability: null, quantity_required: 10, quantity_fulfilled: 2, quantity_reserved: 3, quantity_available: 5, priority: 'HIGH', deadline: null, status: 'ACTIVE', created_at: '2026-01-01', updated_at: '', ngo_name: 'Community Care', cause_name: 'Relief' }], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const label of ['Winter kits', 'MATERIAL', 'HIGH priority', 'ACTIVE', 'Required', 'Reserved', 'Fulfilled', 'Available', '10', '3', '2', '5']) expect(text).toContain(label);
  });

  it('explains closure consequences and closes the need only after confirmation', async () => {
    storeNgoSession();
    TestBed.configureTestingModule({ imports: [NgoNeedsPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoNeedsPage); fixture.detectChanges();
    const need = { need_id: needId, ngo_id: 'g1', cause_id: 'c1', title: 'Winter kits', description: 'Warm clothes', contribution_type: 'MATERIAL', location: null, availability: null, quantity_required: 10, quantity_fulfilled: 2, quantity_reserved: 3, quantity_available: 5, priority: 'HIGH', deadline: null, status: 'ACTIVE', created_at: '2026-01-01', updated_at: '', ngo_name: 'Community Care', cause_name: 'Relief', accepted_application_count: 1, accepted_contribution_count: 1, in_progress_contribution_count: 1 };
    http.expectOne(`${base}/ngos/me/needs?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [need], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    ([...fixture.nativeElement.querySelectorAll('button')].find((button: Element) => button.textContent?.includes('Close need')) as HTMLButtonElement).click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Pending applications and contributions will be rejected');
    expect(fixture.nativeElement.textContent).toContain('Accepted applications and accepted or in-progress contributions will stay active');
    const confirm = [...fixture.nativeElement.querySelectorAll('button')].find((button: Element) => button.textContent?.includes('Confirm close')) as HTMLButtonElement;
    confirm.click(); fixture.detectChanges();
    const closeRequest = http.expectOne(`${base}/ngos/me/needs/${needId}/close`);
    expect(closeRequest.request.method).toBe('POST');
    closeRequest.flush({ success: true, message: 'Closed', data: { need: { ...need, status: 'CLOSED' }, canceledEngagements: { applications: 2, contributions: 1 }, preservedEngagements: { accepted_applications: 1, accepted_contributions: 1, in_progress_contributions: 1 }, alreadyClosed: false } });
    http.expectOne(`${base}/ngos/me/needs?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [{ ...need, status: 'CLOSED' }], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 pending applications and 1 pending contributions were canceled');
    expect(fixture.nativeElement.textContent).toContain('Remaining engagements');
  });

  it('shows read-only historical MONEY response records and excludes decision actions', async () => {
    storeNgoSession();
    TestBed.configureTestingModule({ imports: [NgoResponsesPage], providers: [
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
    ] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoResponsesPage); fixture.detectChanges();
    http.expectOne(`${base}/ngos/me/needs?limit=100`).flush({ success: true, message: 'ok', data: { items: [], pagination: { limit: 100, offset: 0, total: 0 } } });
    http.expectOne(`${base}/ngos/me/responses?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [{ response_id: 'r1', need_id: needId, need_title: 'Community fund', response_kind: 'CONTRIBUTION', contribution_type: 'MONEY', details: null, quantity: null, amount: 25, status: 'PENDING', submitted_at: '2026-01-01', updated_at: '2026-01-01', individual_name: 'Alex', individual_city: null }], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Historical record only');
    expect(fixture.nativeElement.textContent).toContain('Future money support is arranged directly');
    const actionText = [...fixture.nativeElement.querySelectorAll('article button')].map((button: Element) => button.textContent?.trim() ?? '');
    expect(actionText.some((label: string) => ['Accept', 'Reject', 'Complete', 'Mark in progress'].includes(label))).toBe(false);
  });

  it('confirms an eligible response decision and only retrieves contact after acceptance', async () => {
    storeNgoSession();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({ imports: [NgoResponsesPage], providers: [
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
    ] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoResponsesPage); fixture.detectChanges();
    http.expectOne(`${base}/ngos/me/needs?limit=100`).flush({ success: true, message: 'ok', data: { items: [], pagination: { limit: 100, offset: 0, total: 0 } } });
    const pending = { response_id: 'r2', need_id: needId, need_title: 'Garden day', response_kind: 'APPLICATION', contribution_type: 'VOLUNTEER', details: 'I can help.', quantity: null, amount: null, status: 'APPLIED', submitted_at: '2026-01-01', updated_at: '2026-01-01', individual_name: 'Alex', individual_city: 'Pune' };
    http.expectOne(`${base}/ngos/me/responses?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [pending], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('alex@example.org');
    const accept = [...fixture.nativeElement.querySelectorAll('article button')].find((button: Element) => button.textContent?.trim() === 'Accept') as HTMLButtonElement;
    accept.click(); fixture.detectChanges();
    expect(globalThis.confirm).toHaveBeenCalled();
    const decision = http.expectOne(`${base}/needs/${needId}/applications/r2`);
    expect(decision.request.method).toBe('PUT');
    decision.flush({ success: true, message: 'Accepted', data: { ...pending, status: 'ACCEPTED' } });
    http.expectOne(`${base}/ngos/me/responses?limit=50&offset=0`).flush({ success: true, message: 'ok', data: { items: [{ ...pending, status: 'ACCEPTED' }], pagination: { limit: 50, offset: 0, total: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Accepted');
    expect(fixture.nativeElement.textContent).not.toContain('alex@example.org');
    const viewContact = [...fixture.nativeElement.querySelectorAll('article button')].find((button: Element) => button.textContent?.includes('View individual contact')) as HTMLButtonElement;
    viewContact.click(); fixture.detectChanges();
    http.expectOne(`${base}/engagements/applications/r2/contact`).flush({ success: true, message: 'Retrieved', data: { name: 'Alex', email: 'alex@example.org', phone: null } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('alex@example.org');
  });
});

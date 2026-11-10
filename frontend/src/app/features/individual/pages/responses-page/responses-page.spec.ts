import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { IndividualResponsesPage } from './responses-page';

describe('IndividualResponsesPage', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
    window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'Asha', email: 'asha@example.org', role: 'INDIVIDUAL', phone: null, city: null, availability: null }));
    TestBed.configureTestingModule({ imports: [IndividualResponsesPage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); window.sessionStorage.clear(); });
  it('shows owned response status and requests contact only for accepted applications', async () => {
    const fixture = TestBed.createComponent(IndividualResponsesPage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [
      { application_id: 'a1', need_id: 'n1', status: 'ACCEPTED', message: 'I can help', applied_at: '2026-03-01T00:00:00Z', need_title: 'Garden day', ngo_name: 'Green Hands' },
      { application_id: 'a2', need_id: 'n2', status: 'REJECTED', message: null, applied_at: '2026-03-02T00:00:00Z', need_title: 'Clinic support', ngo_name: 'Care Group' },
    ] });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Accepted');
    expect(fixture.nativeElement.textContent).toContain('Rejected');
    expect(fixture.nativeElement.textContent).toContain('Garden day');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect([...buttons].some((button: HTMLButtonElement) => button.textContent.includes('View organization contact'))).toBe(true);
    fixture.nativeElement.querySelector('button').click();
    const contact = http.expectOne(`${environment.apiBaseUrl}/engagements/applications/a1/contact`);
    contact.flush({ success: true, message: 'Retrieved', data: { name: 'Green Hands', email: 'ngo@example.org', phone: null } });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ngo@example.org');
  });
  it('renders the useful no-response state', async () => {
    const fixture = TestBed.createComponent(IndividualResponsesPage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [] });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No volunteer applications yet');
  });
  it('keeps closed need application history without linking to an unavailable public detail', async () => {
    const fixture = TestBed.createComponent(IndividualResponsesPage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [
      { application_id: 'closed-app', need_id: 'closed-need', status: 'ACCEPTED', need_status: 'CLOSED', need_moderation_status: 'VISIBLE', need_title: 'Closed garden', ngo_name: 'Green Hands' },
    ] });
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('article a')).toBeNull();
    expect(fixture.nativeElement.querySelector('article').textContent).toContain('This need is closed');
    expect(fixture.nativeElement.querySelector('article').textContent).toContain('Closed garden');
  });
});

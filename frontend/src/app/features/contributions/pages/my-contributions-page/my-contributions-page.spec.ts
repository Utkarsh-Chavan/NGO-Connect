import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../../environments/environment';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { PublicLayout } from '../../../../layouts/public-layout/public-layout';
import { MyContributionsPage } from './my-contributions-page';

const needId = '30000000-0000-4000-8000-000000000001';
const response = (data: unknown[]) => ({ success: true, message: 'Retrieved', data });
const row = (status: string, type: string, id: string) => ({
  contribution_id: id,
  need_id: needId,
  need_title: 'Community garden supplies',
  contribution_type: type,
  quantity: type === 'MATERIAL' ? 4 : null,
  amount: type === 'MONEY' ? '25.00' : null,
  description: `Details for ${type}`,
  status,
  created_at: '2026-02-10T12:00:00.000Z',
  ngo_name: 'Green Future',
});

const storeSession = (role: 'INDIVIDUAL' | 'NGO' | 'ADMIN') => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000001',
    name: 'Test User',
    email: 'test@example.org',
    role,
    phone: null,
    city: null,
    availability: null,
  }));
};

describe('MyContributionsPage', () => {
  let http: HttpTestingController;

  const configure = () => TestBed.configureTestingModule({
    imports: [MyContributionsPage],
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });

  afterEach(() => {
    http?.verify();
    window.sessionStorage.clear();
  });

  it('renders contribution types, NGO and need names, quantities, amounts, dates, and all status labels', async () => {
    storeSession('INDIVIDUAL');
    await configure().compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MyContributionsPage);
    fixture.detectChanges();
    const request = http.expectOne(`${environment.apiBaseUrl}/users/me/contributions`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test.jwt.token');
    request.flush(response([
      row('PENDING', 'MATERIAL', '50000000-0000-4000-8000-000000000001'),
      row('ACCEPTED', 'MONEY', '50000000-0000-4000-8000-000000000002'),
      row('IN_PROGRESS', 'SKILL', '50000000-0000-4000-8000-000000000003'),
      row('COMPLETED', 'MATERIAL', '50000000-0000-4000-8000-000000000004'),
      row('REJECTED', 'SKILL', '50000000-0000-4000-8000-000000000005'),
    ]));
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    for (const expected of [
      'Community garden supplies', 'Green Future', 'MATERIAL', 'MONEY', 'SKILL',
      'Quantity', '4', 'Legacy amount field', '25.00', 'Historical record only', 'Details for SKILL',
      'Pending', 'Accepted', 'In progress', 'Completed', 'Rejected', '2026',
    ]) expect(text).toContain(expected);

    const pending = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Pending')!;
    pending.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Community garden supplies');
    expect(fixture.nativeElement.textContent).not.toContain('Details for MONEY');
  });

  it('shows loading and empty states', async () => {
    storeSession('INDIVIDUAL');
    await configure().compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MyContributionsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading your contributions');
    http.expectOne(`${environment.apiBaseUrl}/users/me/contributions`).flush(response([]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No contributions yet');
  });

  it('shows a useful API error state', async () => {
    storeSession('INDIVIDUAL');
    await configure().compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MyContributionsPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/contributions`).flush({ success: false, message: 'Service unavailable' }, {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Service unavailable');
  });

  it('keeps a closed need contribution history without linking to unavailable public detail', async () => {
    storeSession('INDIVIDUAL');
    await configure().compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MyContributionsPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/contributions`).flush(response([
      { ...row('REJECTED', 'MATERIAL', '50000000-0000-4000-8000-000000000006'), need_status: 'CLOSED', need_moderation_status: 'VISIBLE' },
    ]));
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('article a')).toBeNull();
    expect(fixture.nativeElement.querySelector('article').textContent).toContain('This need is closed');
    expect(fixture.nativeElement.querySelector('article').textContent).toContain('Community garden supplies');
  });

  it('shows the navigation link only to Individual accounts', async () => {
    for (const role of ['INDIVIDUAL', 'NGO', 'ADMIN'] as const) {
      storeSession(role);
      await TestBed.configureTestingModule({
        imports: [PublicLayout],
        providers: [provideRouter([])],
      }).compileComponents();
      const fixture = TestBed.createComponent(PublicLayout);
      fixture.detectChanges();
      const link = fixture.nativeElement.querySelector('a[routerLink="/individual/dashboard"]');
      expect(!!link).toBe(role === 'INDIVIDUAL');
      fixture.destroy();
      TestBed.resetTestingModule();
      window.sessionStorage.clear();
    }
  });
});

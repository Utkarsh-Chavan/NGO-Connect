import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';

import { routes } from '../../../../app.routes';
import { environment } from '../../../../../environments/environment';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { ngoOnlyGuard } from '../../../../core/auth/ngo-only.guard';
import { NgoVerificationData, NgoVerificationStatus, VerificationFileSelection } from '../../../../core/verification/verification.models';
import { PublicLayout } from '../../../../layouts/public-layout/public-layout';
import { VerificationPage, canSubmitVerification, MAX_VERIFICATION_FILE_SIZE, MAX_SUPPORTING_DOCUMENTS, validateVerificationSelection } from './verification-page';

@Component({ standalone: true, template: '' })
class RouteStub {}

const tokenKey = 'ngo-connect.access-token';
const userKey = 'ngo-connect.auth-user';
const setSession = (role: 'INDIVIDUAL' | 'NGO' | 'ADMIN') => {
  window.sessionStorage.setItem(tokenKey, 'verification.test.token');
  window.sessionStorage.setItem(userKey, JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000001', name: 'Test User', email: 'test@example.org',
    role, phone: null, city: 'Pune', availability: null,
  }));
};

const verificationData = (status: NgoVerificationStatus): NgoVerificationData => ({
  ngo: {
    ngo_id: '20000000-0000-4000-8000-000000000001', name: 'Community Care',
    description: null, email: 'care@example.org', phone: null, address: null, city: 'Pune',
    verification_status: status, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  },
  currentSubmission: status === 'NOT_SUBMITTED' ? null : {
    submission_id: '30000000-0000-4000-8000-000000000001', submission_number: 1,
    status: status === 'NEEDS_INFO' || status === 'REJECTED' || status === 'APPROVED' ? status : 'PENDING',
    submitted_at: '2026-02-01T00:00:00.000Z', created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    documents: [{
      document_id: '40000000-0000-4000-8000-000000000001', document_type: 'REGISTRATION_CERTIFICATE',
      original_filename: 'registration.pdf', content_type: 'application/pdf', size_bytes: 15,
      created_at: '2026-02-01T00:00:00.000Z',
    }],
  },
  history: status === 'NOT_SUBMITTED' ? [] : [{
    history_id: '50000000-0000-4000-8000-000000000001', verification_status_snapshot: status,
    submission_id_snapshot: '30000000-0000-4000-8000-000000000001', actor_name_snapshot: 'Review Admin',
    action: status === 'NEEDS_INFO' ? 'INFO_REQUESTED' : status === 'PENDING' ? 'SUBMITTED' : status,
    message: status === 'NEEDS_INFO' ? 'Please attach a clearer certificate.' : null,
    created_at: '2026-02-01T00:00:00.000Z',
  }],
});

const configurePage = () => {
  TestBed.configureTestingModule({
    imports: [VerificationPage],
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([{ path: 'profile', component: RouteStub }, { path: 'login', component: RouteStub }]),
    ],
  });
};

const makeFile = (name = 'registration.pdf', type = 'application/pdf', size = 16) =>
  new File([new Uint8Array(size)], name, { type });

const setInputFiles = (input: HTMLInputElement, files: File[]) => {
  const list = Object.assign([...files], { item: (index: number) => files[index] ?? null }) as unknown as FileList;
  Object.defineProperty(input, 'files', { configurable: true, value: list });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const initialSelection = (): VerificationFileSelection => ({
  registrationCertificate: null, pan: null, ngoDarpan: null, supportingDocuments: [],
});

describe('NGO verification page', () => {
  let http!: HttpTestingController;

  afterEach(() => {
    http?.verify();
    window.sessionStorage.clear();
  });

  const visibleStatuses: Array<[NgoVerificationStatus, string]> = [
    ['NOT_SUBMITTED', 'Not submitted'],
    ['PENDING', 'Pending review'],
    ['NEEDS_INFO', 'More information needed'],
    ['APPROVED', 'Approved'],
    ['REJECTED', 'Rejected'],
  ];

  for (const [status, label] of visibleStatuses) {
    it(`renders ${status} and the matching upload eligibility`, async () => {
      setSession('NGO');
      configurePage();
      http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(VerificationPage);
      fixture.detectChanges();
      const request = http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`);
      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('Authorization')).toBe('Bearer verification.test.token');
      request.flush({ success: true, message: 'Retrieved', data: verificationData(status) });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(label);
      expect(fixture.nativeElement.textContent).toContain('Community Care');
      expect(Boolean(fixture.nativeElement.querySelector('form'))).toBe(canSubmitVerification(status));
      if (status !== 'NOT_SUBMITTED') {
        expect(fixture.nativeElement.textContent).toContain('registration.pdf');
        expect(fixture.nativeElement.textContent).toContain('Verification history');
      }
    });
  }

  it('guides an NGO without a profile to profile completion', async () => {
    setSession('NGO');
    configurePage();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerificationPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`).flush(
      { success: false, message: 'NGO profile not found' },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Complete your NGO profile first');
    expect(fixture.nativeElement.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it('validates required certificate, types, size, and supporting document count', () => {
    expect(validateVerificationSelection(initialSelection())).toContain('A registration certificate is required.');
    expect(validateVerificationSelection({
      ...initialSelection(), registrationCertificate: makeFile('registration.exe', 'application/pdf'),
    }).some((message) => message.includes('must be a PDF'))).toBe(true);
    expect(validateVerificationSelection({
      ...initialSelection(), registrationCertificate: makeFile('registration.pdf', 'application/pdf', MAX_VERIFICATION_FILE_SIZE + 1),
    }).some((message) => message.includes('5 MiB'))).toBe(true);
    expect(validateVerificationSelection({
      ...initialSelection(), registrationCertificate: makeFile(),
      supportingDocuments: Array.from({ length: MAX_SUPPORTING_DOCUMENTS + 1 }, (_, index) => makeFile(`support-${index}.pdf`)),
    })).toContain(`Choose no more than ${MAX_SUPPORTING_DOCUMENTS} supporting documents.`);
  });

  it('uploads optional files and multiple supporting files, then refreshes backend status', async () => {
    setSession('NGO');
    configurePage();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerificationPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`).flush({
      success: true, message: 'Retrieved', data: verificationData('NOT_SUBMITTED'),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    setInputFiles(fixture.nativeElement.querySelector('#registration-certificate') as HTMLInputElement, [makeFile()]);
    setInputFiles(fixture.nativeElement.querySelector('#pan-document') as HTMLInputElement, [makeFile('pan.jpg', 'image/jpeg')]);
    setInputFiles(fixture.nativeElement.querySelector('#ngo-darpan') as HTMLInputElement, [makeFile('darpan.png', 'image/png')]);
    setInputFiles(fixture.nativeElement.querySelector('#supporting-documents') as HTMLInputElement, [makeFile('support-one.pdf'), makeFile('support-two.pdf')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('registration.pdf');
    expect(fixture.nativeElement.textContent).toContain('support-two.pdf');

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    const upload = http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification/submissions`);
    expect(upload.request.method).toBe('POST');
    expect(upload.request.headers.get('Authorization')).toBe('Bearer verification.test.token');
    expect(upload.request.headers.has('Content-Type')).toBe(false);
    expect(upload.request.body instanceof FormData).toBe(true);
    const body = upload.request.body as FormData;
    expect((body.get('registrationCertificate') as File).name).toBe('registration.pdf');
    expect((body.get('pan') as File).name).toBe('pan.jpg');
    expect((body.get('ngoDarpan') as File).name).toBe('darpan.png');
    expect(body.getAll('supportingDocuments').map((file) => (file as File).name)).toEqual(['support-one.pdf', 'support-two.pdf']);

    upload.flush({ success: true, message: 'Submitted', data: verificationData('PENDING') });
    await fixture.whenStable();
    const refresh = http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`);
    refresh.flush({ success: true, message: 'Retrieved', data: verificationData('PENDING') });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your verification documents were submitted successfully.');
    expect(fixture.nativeElement.textContent).toContain('Pending review');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('allows removing selected files before submitting', async () => {
    setSession('NGO');
    configurePage();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerificationPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`).flush({
      success: true, message: 'Retrieved', data: verificationData('NOT_SUBMITTED'),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    setInputFiles(fixture.nativeElement.querySelector('#registration-certificate') as HTMLInputElement, [makeFile()]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('registration.pdf');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Remove')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('registration.pdf');
    expect(fixture.nativeElement.textContent).toContain('A registration certificate is required.');
  });

  it('prevents duplicate requests and displays backend validation errors', async () => {
    setSession('NGO');
    configurePage();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerificationPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`).flush({
      success: true, message: 'Retrieved', data: verificationData('NOT_SUBMITTED'),
    });
    await fixture.whenStable();
    setInputFiles(fixture.nativeElement.querySelector('#registration-certificate') as HTMLInputElement, [makeFile()]);
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const upload = http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification/submissions`);
    expect(fixture.nativeElement.textContent).toContain('Submitting…');
    upload.flush({ success: false, message: 'Validation failed', errors: [{ msg: 'Document signature is invalid.' }] }, {
      status: 400, statusText: 'Bad Request',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Document signature is invalid.');
  });

  it('shows API errors when verification status cannot be loaded', async () => {
    setSession('NGO');
    configurePage();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(VerificationPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me/verification`).flush(
      { success: false, message: 'Service unavailable' },
      { status: 503, statusText: 'Unavailable' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Service unavailable');
    expect(fixture.nativeElement.textContent).toContain('Try again');
  });

  it('allows only NGO users through the NGO route guard', () => {
    configurePage();
    const router = TestBed.inject(Router);
    setSession('NGO');
    expect(TestBed.runInInjectionContext(() => ngoOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot))).toBe(true);
    TestBed.resetTestingModule();

    configurePage();
    setSession('INDIVIDUAL');
    const denied = TestBed.runInInjectionContext(() => ngoOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(router.serializeUrl(denied as ReturnType<Router['parseUrl']>)).toBe('/needs');
    TestBed.resetTestingModule();

    configurePage();
    setSession('ADMIN');
    const adminDenied = TestBed.runInInjectionContext(() => ngoOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(router.serializeUrl(adminDenied as ReturnType<Router['parseUrl']>)).toBe('/needs');
    TestBed.resetTestingModule();

    configurePage();
    window.sessionStorage.clear();
    const anonymous = TestBed.runInInjectionContext(() => ngoOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    expect(router.serializeUrl(anonymous as ReturnType<Router['parseUrl']>)).toBe('/login');
  });

  it('registers the verification page as a lazy NGO-guarded route', () => {
    const publicRoutes = routes.find((route) => route.path === '')?.children ?? [];
    const verificationRoute = publicRoutes.find((route) => route.path === 'verification');
    expect(verificationRoute?.canActivate).toContain(ngoOnlyGuard);
    expect(verificationRoute?.loadComponent).toBeDefined();
  });

  it('shows verification navigation only to NGO accounts', async () => {
    TestBed.configureTestingModule({
      imports: [PublicLayout],
      providers: [provideHttpClient(), provideRouter([{ path: '', component: RouteStub }])],
    });
    setSession('NGO');
    const ngoFixture = TestBed.createComponent(PublicLayout);
    ngoFixture.detectChanges();
    expect(ngoFixture.nativeElement.querySelector('a[href="/verification"]')).not.toBeNull();
    ngoFixture.destroy();
    window.sessionStorage.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PublicLayout],
      providers: [provideHttpClient(), provideRouter([{ path: '', component: RouteStub }])],
    });
    setSession('INDIVIDUAL');
    const individualFixture = TestBed.createComponent(PublicLayout);
    individualFixture.detectChanges();
    expect(individualFixture.nativeElement.querySelector('a[href="/verification"]')).toBeNull();
    individualFixture.destroy();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PublicLayout],
      providers: [provideHttpClient(), provideRouter([{ path: '', component: RouteStub }])],
    });
    setSession('ADMIN');
    const adminFixture = TestBed.createComponent(PublicLayout);
    adminFixture.detectChanges();
    expect(adminFixture.nativeElement.querySelector('a[href="/admin/ngos/pending"]')).not.toBeNull();
    expect(adminFixture.nativeElement.querySelector('a[href="/verification"]')).toBeNull();
  });
});

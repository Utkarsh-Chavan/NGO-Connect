import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ActivatedRouteSnapshot, convertToParamMap, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { vi } from 'vitest';

import { routes } from '../../../../app.routes';
import { environment } from '../../../../../environments/environment';
import { adminOnlyGuard } from '../../../../core/auth/admin-only.guard';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { NgoVerificationData, NgoVerificationStatus } from '../../../../core/verification/verification.models';
import { NgoVerificationReviewPage } from './ngo-verification-review-page';

const ngoId = '20000000-0000-4000-8000-000000000001';
const adminId = '10000000-0000-4000-8000-000000000001';
const tokenKey = 'ngo-connect.access-token';
const userKey = 'ngo-connect.auth-user';

const setSession = (role: 'NGO' | 'INDIVIDUAL' | 'ADMIN') => {
  window.sessionStorage.setItem(tokenKey, 'admin-review.test.token');
  window.sessionStorage.setItem(userKey, JSON.stringify({
    userId: adminId, name: 'Admin Reviewer', email: 'admin@example.org', role,
    phone: null, city: 'Pune', availability: null,
  }));
};

const profile = (status: NgoVerificationStatus = 'PENDING') => ({
  ngo_id: ngoId, name: 'Community Care', description: 'Community support organization.',
  email: 'care@example.org', phone: '555-0102', address: '4 Public Road', city: 'Pune',
  verification_status: status, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
});

const verificationData = (status: NgoVerificationStatus = 'PENDING'): NgoVerificationData => ({
  ngo: profile(status),
  currentSubmission: {
    submission_id: '30000000-0000-4000-8000-000000000001', submission_number: 2,
    status: status === 'NEEDS_INFO' || status === 'APPROVED' || status === 'REJECTED' ? status : 'PENDING',
    submitted_at: '2026-02-01T00:00:00.000Z', created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    documents: [
      ['REGISTRATION_CERTIFICATE', 'registration-certificate.pdf', 'application/pdf'],
      ['PAN', 'pan-card.jpg', 'image/jpeg'],
      ['NGO_DARPAN', 'darpan.png', 'image/png'],
      ['SUPPORTING_DOCUMENT', 'annual-report.pdf', 'application/pdf'],
    ].map(([document_type, original_filename, content_type], index) => ({
      document_id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      document_type: document_type as 'REGISTRATION_CERTIFICATE' | 'PAN' | 'NGO_DARPAN' | 'SUPPORTING_DOCUMENT',
      original_filename,
      content_type,
      size_bytes: 1024 + index,
      created_at: '2026-02-01T00:00:00.000Z',
    })),
  },
  history: [
    {
      history_id: '50000000-0000-4000-8000-000000000001', verification_status_snapshot: 'PENDING',
      submission_id_snapshot: '30000000-0000-4000-8000-000000000001', actor_name_snapshot: 'Admin Reviewer',
      action: 'INFO_REQUESTED', message: 'Please provide a clearer certificate copy.', created_at: '2026-01-15T10:00:00.000Z',
    },
    {
      history_id: '50000000-0000-4000-8000-000000000002', verification_status_snapshot: 'PENDING',
      submission_id_snapshot: '30000000-0000-4000-8000-000000000001', actor_name_snapshot: null,
      action: 'RESUBMITTED', message: null, created_at: '2026-02-01T10:00:00.000Z',
    },
  ],
});

const configure = () => TestBed.configureTestingModule({
  imports: [NgoVerificationReviewPage],
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ ngoId }) } } },
  ],
});

const initializePage = async (initial: NgoVerificationData = verificationData()) => {
  setSession('ADMIN');
  configure();
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(NgoVerificationReviewPage);
  fixture.detectChanges();
  const request = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification`);
  expect(request.request.headers.get('Authorization')).toBe('Bearer admin-review.test.token');
  request.flush({ success: true, message: 'Verification retrieved', data: initial });
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http };
};

const enterMessage = (fixture: ComponentFixture<NgoVerificationReviewPage>, message: string) => {
  const textarea = fixture.nativeElement.querySelector('#decision-message') as HTMLTextAreaElement;
  textarea.value = message;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Admin NGO verification review page', () => {
  let http: HttpTestingController | undefined;

  afterEach(() => {
    http?.verify();
    http = undefined;
    window.sessionStorage.clear();
  });

  it('registers a lazy admin-guarded detail route and blocks non-admin roles', () => {
    const adminLayoutRoute = routes.find((route) => route.path === 'admin');
    const adminRoute = adminLayoutRoute?.children?.find((route) => route.path === 'ngos/:ngoId/verification');
    expect(adminLayoutRoute?.canActivate).toContain(adminOnlyGuard);
    expect(adminLayoutRoute?.loadComponent).toBeDefined();
    expect(adminRoute?.loadComponent).toBeDefined();

    configure();
    const router = TestBed.inject(Router);
    setSession('NGO');
    const denied = TestBed.runInInjectionContext(() => adminOnlyGuard(
      {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot,
    ));
    expect(router.serializeUrl(denied as ReturnType<Router['parseUrl']>)).toBe('/');
    TestBed.resetTestingModule();

    configure();
    setSession('ADMIN');
    expect(TestBed.runInInjectionContext(() => adminOnlyGuard(
      {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot,
    ))).toBe(true);
  });

  it('renders NGO profile, all document metadata, and previous admin history messages', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Community Care');
    expect(text).toContain('care@example.org');
    expect(text).toContain('555-0102');
    expect(text).toContain('Submission #2');
    expect(text).toContain('Registration certificate');
    expect(text).toContain('PAN');
    expect(text).toContain('NGO Darpan');
    expect(text).toContain('annual-report.pdf');
    expect(text).toContain('Please provide a clearer certificate copy.');
    expect(text).not.toContain('storage_key');
    expect(text).not.toContain('storage_provider');
    expect(text).not.toContain('sha256');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('retrieves documents through authenticated admin HTTP and revokes its temporary object URL', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createUrl = vi.fn(() => 'blob:private-document');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const { fixture, http: controller } = await initializePage();
      http = controller;
      const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
        .find((item) => item.textContent?.includes('Download securely'))!;
      button.click();
      fixture.detectChanges();
      const download = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/documents/40000000-0000-4000-8000-000000000001`);
      expect(download.request.method).toBe('GET');
      expect(download.request.responseType).toBe('blob');
      expect(download.request.headers.get('Authorization')).toBe('Bearer admin-review.test.token');
      download.flush(new Blob(['private PDF bytes'], { type: 'application/pdf' }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(createUrl).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(fixture.nativeElement.textContent).toContain('Downloaded registration-certificate.pdf.');
      fixture.destroy();
      expect(revokeUrl).toHaveBeenCalledWith('blob:private-document');
    } finally {
      click.mockRestore();
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('shows a clear message when a private document is unavailable', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Download securely'))!.click();
    const download = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/documents/40000000-0000-4000-8000-000000000001`);
    download.flush(new Blob(['not found']), { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This document is no longer available for this NGO.');
  });

  it('confirms approval, posts the optional message to the exact endpoint, and reloads detail', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Approve')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Confirm: Approve NGO');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    fixture.detectChanges();
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/approve`);
    expect(decision.request.method).toBe('POST');
    expect(decision.request.body).toEqual({});
    decision.flush({ success: true, message: 'Saved', data: profile('APPROVED') });
    await fixture.whenStable();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification`).flush({
      success: true, message: 'Refreshed', data: verificationData('APPROVED'),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO verification approved.');
    expect(fixture.nativeElement.textContent).toContain('APPROVED');
  });

  it('requires a rejection message and posts it to the reject endpoint', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Reject')!.click();
    fixture.detectChanges();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enter a meaningful message');
    http.expectNone(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/reject`);

    enterMessage(fixture, 'The registration certificate is not legible.');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/reject`);
    expect(decision.request.method).toBe('POST');
    expect(decision.request.body).toEqual({ message: 'The registration certificate is not legible.' });
    decision.flush({ success: true, message: 'Saved', data: profile('REJECTED') });
    await fixture.whenStable();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification`).flush({
      success: true, message: 'Refreshed', data: verificationData('REJECTED'),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO verification rejected.');
  });

  it('requires a message and posts request-information decisions to the exact endpoint', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Request information')!.click();
    fixture.detectChanges();
    enterMessage(fixture, 'Please upload the current registration certificate.');
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!.click();
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/request-info`);
    expect(decision.request.method).toBe('POST');
    expect(decision.request.body).toEqual({ message: 'Please upload the current registration certificate.' });
    decision.flush({ success: true, message: 'Saved', data: profile('NEEDS_INFO') });
    await fixture.whenStable();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification`).flush({
      success: true, message: 'Refreshed', data: verificationData('NEEDS_INFO'),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Additional information requested.');
  });

  it('prevents duplicate decisions and displays backend decision errors', async () => {
    const { fixture, http: controller } = await initializePage();
    http = controller;
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Approve')!.click();
    fixture.detectChanges();
    const confirm = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.trim() === 'Confirm decision')!;
    confirm.click();
    fixture.detectChanges();
    confirm.dispatchEvent(new Event('click', { bubbles: true }));
    const decision = http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification/approve`);
    expect(confirm.disabled).toBe(true);
    decision.flush({ success: false, message: 'Only a pending verification submission can be reviewed.' }, {
      status: 409, statusText: 'Conflict',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Only a pending verification submission can be reviewed.');
  });

  it('shows authorization and unavailable-record errors from the detail API', async () => {
    setSession('ADMIN');
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NgoVerificationReviewPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/admin/ngos/${ngoId}/verification`).flush(
      { success: false, message: 'NGO profile not found' },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO profile not found');
    expect(fixture.nativeElement.textContent).toContain('Reload record');
  });
});

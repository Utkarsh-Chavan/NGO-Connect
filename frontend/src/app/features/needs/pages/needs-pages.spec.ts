import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import { NeedDetailPage } from './need-detail-page/need-detail-page';
import { NeedEditorPage } from './need-editor-page/need-editor-page';
import { NeedResponsesPage } from './need-responses-page/need-responses-page';
import { NeedsListPage } from './needs-list-page/needs-list-page';

@Component({ standalone: true, template: '' })
class RouteStub {}

const ngoId = '20000000-0000-4000-8000-000000000001';
const needId = '30000000-0000-4000-8000-000000000001';
const causeId = '40000000-0000-4000-8000-000000000001';

const storeNgoSession = () => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000001', name: 'Asha Rao', email: 'asha@example.org',
    role: 'NGO', phone: null, city: 'Pune', availability: null,
  }));
};

const storeIndividualSession = () => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'individual.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000002', name: 'Asha Rao', email: 'asha@example.org',
    role: 'INDIVIDUAL', phone: null, city: 'Pune', availability: null,
  }));
};

const configure = (routeId?: string) => {
  TestBed.configureTestingModule({
    imports: [NeedsListPage, NeedDetailPage, NeedEditorPage, NeedResponsesPage],
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: '', component: RouteStub },
        { path: 'needs/:id', component: RouteStub },
        { path: 'needs/manage/:id/edit', component: RouteStub },
        { path: 'needs/manage/:id/responses', component: RouteStub },
      ]),
      ...(routeId ? [{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId } } } }] : []),
    ],
  });
};

const setValue = (fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string, value: string) => {
  const field = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  fixture.detectChanges();
};

const flushCauseOptions = (http: HttpTestingController) => {
  http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [
    { cause_id: causeId, name: 'Education', description: null, is_active: true },
  ] });
};

const pagination = (total: number, offset = 0, limit = 12, pageCount?: number) => ({
  limit, offset, total, hasPrevious: offset > 0, hasNext: (offset + limit) < total || pageCount === limit,
});

const flushNgoEditorSetup = (http: HttpTestingController) => {
  http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
    ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
    description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
    verification_status: 'APPROVED', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  } });
  http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [
    { cause_id: causeId, name: 'Education', description: null, is_active: true },
  ] });
};

describe('Needs pages', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('renders public needs returned by the backend and requests the first page', async () => {
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedsListPage);
    fixture.detectChanges();

    flushCauseOptions(http);
    const request = http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, message: 'Needs retrieved', data: { items: [{
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors',
      description: 'Support a local after-school group.', contribution_type: 'VOLUNTEER',
      location: 'Pune', availability: null, quantity_required: 4, quantity_fulfilled: 1,
      priority: 'HIGH', deadline: null, status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', ngo_name: 'Community Care', cause_name: 'Education',
    }], pagination: pagination(1) } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Reading mentors');
    expect(fixture.nativeElement.textContent).toContain('Community Care');
    expect(fixture.nativeElement.textContent).toContain('1 fulfilled · 0 reserved · 0 available');
  });

  it('shows every existing volunteer application status on individual need cards', async () => {
    storeIndividualSession();
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedsListPage);
    fixture.detectChanges();
    flushCauseOptions(http);
    http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`).flush({ success: true, message: 'Needs retrieved', data: {
      items: ['APPLIED', 'ACCEPTED', 'REJECTED', 'COMPLETED'].map((_, index) => ({
        need_id: `30000000-0000-4000-8000-00000000000${index + 1}`, ngo_id: ngoId, cause_id: causeId,
        title: `Volunteer need ${index + 1}`, description: 'Help the community.', contribution_type: 'VOLUNTEER',
        location: null, availability: null, quantity_required: null, quantity_fulfilled: 0, priority: 'MEDIUM',
        deadline: null, status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        ngo_name: 'Community Care', cause_name: 'Education',
      })), pagination: pagination(4),
    } });
    const statuses = ['APPLIED', 'ACCEPTED', 'REJECTED', 'COMPLETED'];
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: statuses.map((status, index) => ({
      application_id: `60000000-0000-4000-8000-00000000000${index + 1}`,
      need_id: `30000000-0000-4000-8000-00000000000${index + 1}`, status,
    })) });
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent;
    expect(content).toContain('Application submitted');
    expect(content).toContain('Accepted');
    expect(content).toContain('Rejected');
    expect(content).toContain('Completed');
  });

  it('leaves NGO and ADMIN need browsing independent of individual application status lookup', async () => {
    for (const role of ['NGO', 'ADMIN']) {
      window.sessionStorage.setItem('ngo-connect.access-token', 'role.jwt.token');
      window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
        userId: '10000000-0000-4000-8000-000000000001', name: 'Test account', email: 'test@example.org',
        role, phone: null, city: null, availability: null,
      }));
      configure();
      http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(NeedsListPage);
      fixture.detectChanges();
      flushCauseOptions(http);
      http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`).flush({ success: true, message: 'Needs retrieved', data: {
        items: [], pagination: pagination(0),
      } });
      await fixture.whenStable();
      http.expectNone(`${environment.apiBaseUrl}/users/me/applications`);
      fixture.destroy();
      TestBed.resetTestingModule();
      window.sessionStorage.clear();
    }
  });

  it('filters public results, keeps applied filters on paging, and clears back to the first unfiltered page', async () => {
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedsListPage);
    const resultNeed = {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Book drive', description: 'Collect books',
      contribution_type: 'MATERIAL', location: 'Pune', availability: null, quantity_required: 10,
      quantity_fulfilled: 0, priority: 'MEDIUM', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      ngo_name: 'Community Care', cause_name: 'Education',
    };
    fixture.detectChanges();
    flushCauseOptions(http);
    http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`).flush({ success: true, message: 'Retrieved', data: {
      items: [], pagination: pagination(25),
    } });
    await fixture.whenStable();
    fixture.detectChanges();

    setValue(fixture, '#public-need-search', ' books ');
    setValue(fixture, '#public-need-cause', causeId);
    setValue(fixture, '#public-need-type', 'MATERIAL');
    setValue(fixture, '#public-need-location', 'Pune');
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const filtered = http.expectOne((request) => request.url === `${environment.apiBaseUrl}/needs` && request.params.get('search') === 'books'
      && request.params.get('causeId') === causeId && request.params.get('contributionType') === 'MATERIAL'
      && request.params.get('location') === 'Pune' && request.params.get('offset') === '0');
    filtered.flush({ success: true, message: 'Retrieved', data: { items: [resultNeed], pagination: pagination(25) } });
    await fixture.whenStable();
    fixture.detectChanges();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.trim() === 'Next')!.click();
    fixture.detectChanges();
    const next = http.expectOne((request) => request.url === `${environment.apiBaseUrl}/needs` && request.params.get('search') === 'books'
      && request.params.get('causeId') === causeId && request.params.get('contributionType') === 'MATERIAL'
      && request.params.get('location') === 'Pune' && request.params.get('offset') === '12');
    next.flush({ success: true, message: 'Retrieved', data: { items: [resultNeed], pagination: pagination(25, 12) } });
    await fixture.whenStable();
    fixture.detectChanges();

    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.trim() === 'Clear filters')!.click();
    fixture.detectChanges();
    const cleared = http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`);
    cleared.flush({ success: true, message: 'Retrieved', data: { items: [], pagination: pagination(0) } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#public-need-search').value).toBe('');
    expect(fixture.nativeElement.textContent).toContain('No public needs right now');
  });

  it('shows a retryable public listing error and a clear empty result state', async () => {
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedsListPage);
    fixture.detectChanges();
    flushCauseOptions(http);
    http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`).flush({ success: false, message: 'Unavailable' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.includes('Try again'))!.click();
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs?limit=12&offset=0`).flush({ success: true, message: 'Retrieved', data: { items: [], pagination: pagination(0) } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No public needs right now');
    expect(fixture.nativeElement.querySelector('form[role="search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('label[for="public-need-location"]')).not.toBeNull();
  });

  it('shows unavailable state for a need hidden by the public endpoint', async () => {
    configure(needId);
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { paramMap: { get: () => needId } } } });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedDetailPage);
    fixture.detectChanges();

    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: false, message: 'Need not found' }, {
      status: 404, statusText: 'Not Found',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This need is unavailable');
    expect(fixture.nativeElement.textContent).toContain('Need not found');
  });

  it('creates an unapproved NGO draft with supported fields and does not expose ACTIVE publishing', async () => {
    storeNgoSession();
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedEditorPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
      description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
      verification_status: 'PENDING', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [
      { cause_id: causeId, name: 'Education', description: null, is_active: true },
    ] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#need-status option[value="ACTIVE"]')).toBeNull();
    setValue(fixture, '#need-title', 'Reading mentors');
    setValue(fixture, '#need-description', 'Help local students practice reading.');
    setValue(fixture, '#need-cause', causeId);
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/needs`);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test.jwt.token');
    expect(request.request.body).toEqual({
      causeId, title: 'Reading mentors', description: 'Help local students practice reading.',
      contributionType: 'VOLUNTEER', location: null, availability: null, quantityRequired: null,
      priority: 'MEDIUM', deadline: null, status: 'DRAFT',
    });
    request.flush({ success: true, message: 'Need created', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors',
      description: 'Help local students practice reading.', contribution_type: 'VOLUNTEER',
      location: null, availability: null, quantity_required: null, quantity_fulfilled: 0,
      priority: 'MEDIUM', deadline: null, status: 'DRAFT', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(Router).url).toBe(`/needs/manage/${needId}/edit`);
  });

  it('confirms and publishes a need only for an approved NGO', async () => {
    storeNgoSession();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    configure();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedEditorPage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
      description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
      verification_status: 'APPROVED', created_at: '', updated_at: '',
    } });
    http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [
      { cause_id: causeId, name: 'Education', description: null, is_active: true },
    ] });
    await fixture.whenStable(); fixture.detectChanges();
    setValue(fixture, '#need-cause', causeId);
    setValue(fixture, '#need-title', 'Publishable need');
    setValue(fixture, '#need-description', 'A verified organization need.');
    setValue(fixture, '#need-status', 'ACTIVE');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(globalThis.confirm).toHaveBeenCalled();
    const create = http.expectOne(`${environment.apiBaseUrl}/needs`);
    expect(create.request.body.status).toBe('ACTIVE');
    create.flush({ success: true, message: 'Created', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Publishable need', description: 'A verified organization need.',
      contribution_type: 'VOLUNTEER', location: null, availability: null, quantity_required: null, quantity_fulfilled: 0,
      priority: 'MEDIUM', deadline: null, status: 'ACTIVE', created_at: '', updated_at: '',
    } });
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe(`/needs/${needId}`);
  });

  it('updates an owned ACTIVE need without allowing a transition back to DRAFT', async () => {
    storeNgoSession();
    configure(needId);
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { paramMap: { get: () => needId } } } });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedEditorPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
      description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
      verification_status: 'APPROVED', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [
      { cause_id: causeId, name: 'Education', description: null, is_active: true },
    ] });
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors',
      description: 'Help local students practice reading.', contribution_type: 'VOLUNTEER',
      location: 'Pune', availability: { days: ['Saturday'] }, quantity_required: 4, quantity_fulfilled: 1,
      priority: 'HIGH', deadline: null, status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z', ngo_name: 'Community Care', cause_name: 'Education',
    } });
    await fixture.whenStable();
    fixture.detectChanges();

    setValue(fixture, '#need-title', 'Updated reading mentors');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.status).toBe('ACTIVE');
    expect(request.request.body.availability).toEqual({ days: ['Saturday'] });
    expect(request.request.body).not.toHaveProperty('ngoId');
    expect(request.request.body).not.toHaveProperty('ngo_id');
    request.flush({ success: true, message: 'Need updated', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Updated reading mentors',
      description: 'Help local students practice reading.', contribution_type: 'VOLUNTEER',
      location: 'Pune', availability: { days: ['Saturday'] }, quantity_required: 4, quantity_fulfilled: 1,
      priority: 'HIGH', deadline: null, status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    } });
    await fixture.whenStable();
    expect(request.request.body.status).not.toBe('DRAFT');
  });

  it('shows external money support information without an in-platform amount form', async () => {
    storeIndividualSession();
    configure(needId);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedDetailPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'School supplies',
      description: 'Help purchase supplies.', contribution_type: 'MONEY', location: null, availability: null,
      quantity_required: null, quantity_fulfilled: 0, priority: 'HIGH', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      ngo_name: 'Community Care', cause_name: 'Education',
      ngo_website_url: 'https://community.example.org/donate', ngo_contact_email: 'contact@example.org', ngo_contact_phone: '555-0100',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Support this NGO directly');
    expect(fixture.nativeElement.textContent).toContain('Any transaction happens outside NGO Connect.');
    expect(fixture.nativeElement.textContent).toContain('not independently verified this website');
    expect(fixture.nativeElement.querySelector('a[href="https://community.example.org/donate"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#contribution-amount')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    http.expectNone(`${environment.apiBaseUrl}/needs/${needId}/contributions`);
  });

  it('shows the normal apply action before submitting and then hides it after success', async () => {
    storeIndividualSession();
    configure(needId);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedDetailPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors',
      description: 'Support local students.', contribution_type: 'VOLUNTEER', location: 'Pune', availability: null,
      quantity_required: null, quantity_fulfilled: 0, priority: 'MEDIUM', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      ngo_name: 'Community Care', cause_name: 'Education',
    } });
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Apply to volunteer');
    setValue(fixture, '#application-message', 'I can help on Saturdays.');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/applications`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ message: 'I can help on Saturdays.' });
    request.flush({ success: true, message: 'Application submitted', data: {
      application_id: '60000000-0000-4000-8000-000000000001', need_id: needId,
      user_id: '10000000-0000-4000-8000-000000000002', message: 'I can help on Saturdays.',
      status: 'APPLIED', applied_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application submitted');
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
  });

  it('refreshes application status after the backend rejects a duplicate submission', async () => {
    storeIndividualSession();
    configure(needId);
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { paramMap: { get: () => needId } } } });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedDetailPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors', description: 'Help students.',
      contribution_type: 'VOLUNTEER', location: null, availability: null, quantity_required: null,
      quantity_fulfilled: 0, priority: 'MEDIUM', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ngo_name: 'Community Care', cause_name: 'Education',
    } });
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/applications`).flush({ success: false, message: 'An application for this need already exists' }, {
      status: 409, statusText: 'Conflict',
    });
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [{ application_id: '60000000-0000-4000-8000-000000000003', need_id: needId, status: 'REJECTED' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rejected');
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
  });

  it('shows an existing accepted application on the detail page and hides Apply to volunteer', async () => {
    storeIndividualSession();
    configure(needId);
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { paramMap: { get: () => needId } } } });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedDetailPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors', description: 'Help students.',
      contribution_type: 'VOLUNTEER', location: null, availability: null, quantity_required: null,
      quantity_fulfilled: 0, priority: 'MEDIUM', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ngo_name: 'Community Care', cause_name: 'Education',
    } });
    http.expectOne(`${environment.apiBaseUrl}/users/me/applications`).flush({ success: true, message: 'Retrieved', data: [{ application_id: '60000000-0000-4000-8000-000000000004', need_id: needId, status: 'ACCEPTED' }] });
    http.expectOne(`${environment.apiBaseUrl}/engagements/applications/60000000-0000-4000-8000-000000000004/contact`).flush({
      success: true, message: 'Contact retrieved', data: { name: 'Community Care', email: 'contact@example.org', phone: null },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Accepted');
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
  });

  it('lets the owning NGO accept and then complete an application through supported transitions', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    storeNgoSession();
    configure(needId);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedResponsesPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
      description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
      verification_status: 'APPROVED', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'Reading mentors',
      description: 'Support local students.', contribution_type: 'VOLUNTEER', location: 'Pune', availability: null,
      quantity_required: null, quantity_fulfilled: 0, priority: 'MEDIUM', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      ngo_name: 'Community Care', cause_name: 'Education',
    } });
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/applications`).flush({ success: true, message: 'Retrieved', data: [{
      application_id: '60000000-0000-4000-8000-000000000001', need_id: needId,
      applicant_id: '10000000-0000-4000-8000-000000000002', applicant_name: 'Asha Rao', applicant_city: 'Pune',
      message: 'I can help.', status: 'APPLIED', applied_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }] });
    await fixture.whenStable();
    fixture.detectChanges();
    const accept = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.trim() === 'Accept')!;
    accept.click();
    fixture.detectChanges();
    const acceptRequest = http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/applications/60000000-0000-4000-8000-000000000001`);
    expect(acceptRequest.request.method).toBe('PUT');
    expect(acceptRequest.request.body).toEqual({ status: 'ACCEPTED' });
    acceptRequest.flush({ success: true, message: 'Updated', data: {
      application_id: '60000000-0000-4000-8000-000000000001', need_id: needId,
      user_id: '10000000-0000-4000-8000-000000000002', message: 'I can help.', status: 'ACCEPTED',
      applied_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ACCEPTED');
    const complete = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((button) => button.textContent?.trim() === 'Complete')!;
    complete.click();
    fixture.detectChanges();
    const completeRequest = http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/applications/60000000-0000-4000-8000-000000000001`);
    expect(completeRequest.request.body).toEqual({ status: 'COMPLETED' });
    completeRequest.flush({ success: true, message: 'Updated', data: {
      application_id: '60000000-0000-4000-8000-000000000001', need_id: needId,
      user_id: '10000000-0000-4000-8000-000000000002', message: 'I can help.', status: 'COMPLETED',
      applied_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('COMPLETED');
  });

  it('advances contributions only through the documented NGO review sequence', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    storeNgoSession();
    configure(needId);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NeedResponsesPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: ngoId, user_id: '10000000-0000-4000-8000-000000000001', name: 'Community Care',
      description: null, email: 'contact@example.org', phone: null, address: null, city: 'Pune',
      verification_status: 'APPROVED', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}`).flush({ success: true, message: 'Retrieved', data: {
      need_id: needId, ngo_id: ngoId, cause_id: causeId, title: 'School supplies',
      description: 'Collect supplies.', contribution_type: 'MATERIAL', location: null, availability: null,
      quantity_required: 10, quantity_fulfilled: 0, priority: 'HIGH', deadline: null, status: 'ACTIVE',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      ngo_name: 'Community Care', cause_name: 'Education',
    } });
    const contributionId = '50000000-0000-4000-8000-000000000002';
    const responseRow = (status: string) => ({
      contribution_id: contributionId, need_id: needId, user_id: '10000000-0000-4000-8000-000000000002',
      contribution_type: 'MATERIAL', description: 'Books', quantity: 3, amount: null, status,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    });
    http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/contributions`).flush({ success: true, message: 'Retrieved', data: [responseRow('PENDING')] });
    await fixture.whenStable();
    fixture.detectChanges();

    const updateStatus = async (buttonLabel: string, nextStatus: string) => {
      const button = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
        .find((item) => item.textContent?.trim() === buttonLabel)!;
      button.click();
      fixture.detectChanges();
      const request = http.expectOne(`${environment.apiBaseUrl}/needs/${needId}/contributions/${contributionId}/status`);
      expect(request.request.body).toEqual({ status: nextStatus });
      request.flush({ success: true, message: 'Updated', data: responseRow(nextStatus) });
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await updateStatus('Accept', 'ACCEPTED');
    expect(fixture.nativeElement.textContent).toContain('ACCEPTED');
    await updateStatus('Mark in progress', 'IN_PROGRESS');
    expect(fixture.nativeElement.textContent).toContain('IN_PROGRESS');
    await updateStatus('Complete', 'COMPLETED');
    expect(fixture.nativeElement.textContent).toContain('COMPLETED');
    expect(fixture.nativeElement.textContent).not.toContain('Mark in progress');
  });
});

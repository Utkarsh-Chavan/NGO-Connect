import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../../environments/environment';
import { authInterceptor } from '../../../../core/auth/auth.interceptor';
import { ProfilePage } from './profile-page';

@Component({ standalone: true, template: '' })
class RouteStub {}

const storeSession = (role: 'INDIVIDUAL' | 'NGO') => {
  window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
  window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
    userId: '10000000-0000-4000-8000-000000000001',
    name: 'Asha Rao',
    email: 'asha@example.org',
    role,
    phone: null,
    city: 'Pune',
    availability: null,
  }));
};

const setValue = (fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string, value: string) => {
  const field = fixture.nativeElement.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
};

describe('Profile integration', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
    window.sessionStorage.clear();
  });

  it('loads and updates permitted individual details while loading preference catalogs', async () => {
    storeSession('INDIVIDUAL');
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: RouteStub }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/users/me`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test.jwt.token');
    request.flush({ success: true, message: 'User profile retrieved successfully', data: {
      user_id: '10000000-0000-4000-8000-000000000001', name: 'Asha Rao', email: 'asha@example.org',
      role: 'INDIVIDUAL', phone: null, city: 'Pune', availability: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    http.expectOne(`${environment.apiBaseUrl}/users/me/preferences`).flush({ success: true, message: 'Retrieved', data: { causes: [], skills: [] } });
    http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [] });
    http.expectOne(`${environment.apiBaseUrl}/skills`).flush({ success: true, message: 'Retrieved', data: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('#individual-name') as HTMLInputElement).value).toBe('Asha Rao');
    expect(fixture.nativeElement.textContent).toContain('Causes you care about');
    expect(fixture.nativeElement.querySelector('#individual-name')).not.toBeNull();
    setValue(fixture, '#individual-name', 'Asha Nair');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const update = http.expectOne(`${environment.apiBaseUrl}/users/me`);
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({ name: 'Asha Nair', phone: null, city: 'Pune', availability: null });
    update.flush({ success: true, message: 'Updated', data: {
      user_id: '10000000-0000-4000-8000-000000000001', name: 'Asha Nair', email: 'asha@example.org',
      role: 'INDIVIDUAL', phone: null, city: 'Pune', availability: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your profile has been updated.');
  });

  it('adds selected causes and skills through the authenticated preference APIs', async () => {
    storeSession('INDIVIDUAL');
    TestBed.configureTestingModule({ imports: [ProfilePage], providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([{ path: 'login', component: RouteStub }])] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProfilePage); fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/users/me`).flush({ success: true, message: 'Retrieved', data: {
      user_id: '10000000-0000-4000-8000-000000000001', name: 'Asha Rao', email: 'asha@example.org', role: 'INDIVIDUAL', phone: null, city: 'Pune', availability: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    const flushPreferenceReads = (causeSelections: unknown[] = [], skillSelections: unknown[] = []) => {
      http.expectOne(`${environment.apiBaseUrl}/users/me/preferences`).flush({ success: true, message: 'Retrieved', data: { causes: causeSelections, skills: skillSelections } });
      http.expectOne(`${environment.apiBaseUrl}/causes`).flush({ success: true, message: 'Retrieved', data: [{ cause_id: 'c1', name: 'Education', description: null, is_active: true }] });
      http.expectOne(`${environment.apiBaseUrl}/skills`).flush({ success: true, message: 'Retrieved', data: [{ skill_id: 's1', name: 'Teaching', description: null, is_active: true }] });
    };
    flushPreferenceReads(); await fixture.whenStable(); fixture.detectChanges();
    const causeChoice = fixture.nativeElement.querySelector('#cause-choice') as HTMLSelectElement;
    causeChoice.value = 'c1'; causeChoice.dispatchEvent(new Event('change', { bubbles: true })); fixture.detectChanges();
    [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.includes('Add cause'))!.click();
    const addCause = http.expectOne(`${environment.apiBaseUrl}/users/me/causes`);
    expect(addCause.request.method).toBe('POST'); expect(addCause.request.body).toEqual({ causeId: 'c1' });
    addCause.flush({ success: true, message: 'Added', data: {} });
    flushPreferenceReads([{ cause_id: 'c1', name: 'Education', description: null, is_active: true }]);
    await fixture.whenStable(); fixture.detectChanges();
    const skillChoice = fixture.nativeElement.querySelector('#skill-choice') as HTMLSelectElement;
    skillChoice.value = 's1'; skillChoice.dispatchEvent(new Event('change', { bubbles: true })); fixture.detectChanges();
    [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent.includes('Add skill'))!.click();
    const addSkill = http.expectOne(`${environment.apiBaseUrl}/users/me/skills`);
    expect(addSkill.request.method).toBe('POST'); expect(addSkill.request.body).toEqual({ skillId: 's1', proficiencyLevel: 'BEGINNER' });
    addSkill.flush({ success: true, message: 'Added', data: {} });
    flushPreferenceReads([{ cause_id: 'c1', name: 'Education', description: null, is_active: true }], [{ skill_id: 's1', name: 'Teaching', description: null, is_active: true, proficiency_level: 'BEGINNER' }]);
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Education');
    expect(fixture.nativeElement.textContent).toContain('Teaching');
  });

  it('creates an NGO profile using only permitted fields when none exists', async () => {
    storeSession('NGO');
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: RouteStub }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();

    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: false, message: 'NGO profile not found' }, {
      status: 404,
      statusText: 'Not Found',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    setValue(fixture, '#ngo-name', 'Community Care');
    setValue(fixture, '#ngo-email', 'contact@example.org');
    setValue(fixture, '#ngo-city', 'Pune');
    setValue(fixture, '#ngo-description', 'Local support');
    setValue(fixture, '#ngo-phone', '5551234567');
    setValue(fixture, '#ngo-address', '1 Main Street');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/ngos/me`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Community Care', description: 'Local support', email: 'contact@example.org',
      phone: '5551234567', address: '1 Main Street', city: 'Pune', websiteUrl: null,
    });
    request.flush({ success: true, message: 'NGO profile created successfully', data: {
      ngo_id: '20000000-0000-4000-8000-000000000001', user_id: '10000000-0000-4000-8000-000000000001',
      name: 'Community Care', description: 'Local support', email: 'contact@example.org',
      phone: '5551234567', address: '1 Main Street', city: 'Pune', website_url: null, verification_status: 'NOT_SUBMITTED',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Complete verification to submit it for review');
    expect(fixture.nativeElement.textContent).toContain('NOT_SUBMITTED');
  });

  it('loads and updates an existing NGO profile without sending ownership or verification fields', async () => {
    storeSession('NGO');
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: RouteStub }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();

    http.expectOne(`${environment.apiBaseUrl}/ngos/me`).flush({ success: true, message: 'Retrieved', data: {
      ngo_id: '20000000-0000-4000-8000-000000000001', user_id: '10000000-0000-4000-8000-000000000001',
      name: 'Community Care', description: null, email: 'contact@example.org', phone: null,
      address: null, city: 'Pune', website_url: null, verification_status: 'APPROVED',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();

    setValue(fixture, '#ngo-name', 'Community Care Foundation');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const request = http.expectOne(`${environment.apiBaseUrl}/ngos/me`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'Community Care Foundation', description: null, email: 'contact@example.org',
      phone: null, address: null, city: 'Pune', websiteUrl: null,
    });
    expect(request.request.body).not.toHaveProperty('user_id');
    expect(request.request.body).not.toHaveProperty('verification_status');
    request.flush({ success: true, message: 'Updated', data: {
      ngo_id: '20000000-0000-4000-8000-000000000001', user_id: '10000000-0000-4000-8000-000000000001',
      name: 'Community Care Foundation', description: null, email: 'contact@example.org', phone: null,
      address: null, city: 'Pune', website_url: null, verification_status: 'APPROVED',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('NGO profile updated.');
  });
});

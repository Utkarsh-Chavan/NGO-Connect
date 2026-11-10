import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IndividualLayout } from './individual-layout';

describe('IndividualLayout', () => {
  afterEach(() => window.sessionStorage.clear());
  it('shows workspace navigation and responsive menu control for the Individual layout', async () => {
    window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
    window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({ userId: 'u1', name: 'Asha', email: 'asha@example.org', role: 'INDIVIDUAL', phone: null, city: null, availability: null }));
    TestBed.configureTestingModule({ imports: [IndividualLayout], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(IndividualLayout); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    for (const label of ['Dashboard', 'Browse Needs', 'My Applications', 'My Contributions', 'My Profile', 'Sign out']) expect(text).toContain(label);
    expect(text).not.toContain('My Responses');
    expect(fixture.nativeElement.querySelector('button[aria-controls="individual-navigation"]')).not.toBeNull();
  });
});

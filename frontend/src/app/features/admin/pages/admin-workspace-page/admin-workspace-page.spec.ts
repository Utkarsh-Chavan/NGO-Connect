import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { AdminWorkspacePage } from './admin-workspace-page';

describe('AdminWorkspacePage', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminWorkspacePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin/dashboard', component: AdminWorkspacePage, data: { section: 'dashboard' } }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('loads real dashboard metrics through the Admin route and renders them', async () => {
    await router.navigateByUrl('/admin/dashboard');
    const fixture = TestBed.createComponent(AdminWorkspacePage);
    fixture.detectChanges();
    const request = http.expectOne(`${environment.apiBaseUrl}/admin/dashboard`);
    request.flush({
      success: true,
      message: 'Admin dashboard retrieved',
      data: {
        total_individuals: 14, total_ngos: 3, verified_ngos: 2, pending_ngos: 1,
        total_needs: 9, active_needs: 5, completed_needs: 2, total_applications: 8,
        total_contributions: 4, suspended_users: 0, hidden_needs: 0, recentActivity: [],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('14');
    expect(fixture.nativeElement.textContent).toContain('Individuals');
    expect(fixture.nativeElement.textContent).toContain('NGO reviews pending');
    fixture.destroy();
  });
});

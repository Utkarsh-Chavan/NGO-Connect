import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { NotificationCenter } from './notification-center';

const api = environment.apiBaseUrl.replace(/\/$/, '');
const notification = {
  notification_id: '70000000-0000-4000-8000-000000000001', event_type: 'APPLICATION_ACCEPTED',
  title: 'Application accepted', message: 'Your application was accepted.', related_entity_type: 'APPLICATION',
  related_entity_id: '60000000-0000-4000-8000-000000000001', created_at: '2026-01-01T00:00:00.000Z',
  read_at: null, navigation_target: '/individual/responses',
};
const page = (items = [notification], total = items.length, hasNext = false) => ({
  success: true, message: 'Retrieved', data: {
    items, pagination: { limit: 10, offset: 0, total, hasPrevious: false, hasNext }, unreadOnly: false,
  },
});
const firstTen = Array.from({ length: 10 }, (_, index) => ({
  ...notification,
  notification_id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
}));

describe('NotificationCenter', () => {
  let http: HttpTestingController;

  const create = () => {
    window.sessionStorage.setItem('ngo-connect.access-token', 'test.jwt.token');
    window.sessionStorage.setItem('ngo-connect.auth-user', JSON.stringify({
      userId: '10000000-0000-4000-8000-000000000001', name: 'Member', email: 'member@example.test',
      role: 'INDIVIDUAL', phone: null, city: null, availability: null,
    }));
    TestBed.configureTestingModule({
      imports: [NotificationCenter],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotificationCenter);
    fixture.detectChanges();
    http.expectOne(`${api}/notifications/unread-count`).flush({ success: true, message: 'Retrieved', data: { unreadCount: 1 } });
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => {
    try { http.verify(); } finally {
      window.sessionStorage.clear();
      TestBed.resetTestingModule();
    }
  });

  const flushRefreshCount = () => http.expectOne(`${api}/notifications/unread-count`)
    .flush({ success: true, message: 'Retrieved', data: { unreadCount: 1 } });

  it('shows the unread badge and loads the inbox on demand', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('[aria-label="Notifications, 1 unread"]')).toBeTruthy();
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    flushRefreshCount();
    const request = http.expectOne((req) => req.url === `${api}/notifications` && req.params.get('offset') === '0');
    expect(request.request.params.get('unreadOnly')).toBe('false');
    request.flush(page(firstTen, 11, true));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application accepted');
    expect(fixture.nativeElement.textContent).toContain('Your application was accepted.');
    const loadMore = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Load more') as HTMLButtonElement;
    loadMore.click();
    const nextPage = http.expectOne((req) => req.url === `${api}/notifications` && req.params.get('offset') === '10');
    nextPage.flush({
      ...page([notification], 11, false),
      data: { ...page([notification], 11, false).data, pagination: { limit: 10, offset: 10, total: 11, hasPrevious: true, hasNext: false } },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application accepted');
  });

  it('marks an item read, updates the unread badge, and navigates to its internal target', async () => {
    const fixture = create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    flushRefreshCount();
    http.expectOne(`${api}/notifications?limit=10&offset=0&unreadOnly=false`).flush(page());
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[aria-label^="Mark notification as read"]') as HTMLButtonElement).click();
    const request = http.expectOne(`${api}/notifications/${notification.notification_id}/read`);
    request.flush({ success: true, message: 'Updated', data: { ...notification, read_at: '2026-01-02T00:00:00.000Z' } });
    http.expectOne(`${api}/notifications/unread-count`).flush({ success: true, message: 'Retrieved', data: { unreadCount: 0 } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Mark notification as read');
    expect(fixture.nativeElement.querySelector('[aria-label="Notifications"]')).toBeTruthy();
    const notificationLink = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Application accepted')) as HTMLButtonElement;
    notificationLink.click();
    expect(navigate).toHaveBeenCalledWith('/individual/responses');
  });

  it('shows empty and retryable error states and preserves paging controls', () => {
    const fixture = create();
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    flushRefreshCount();
    http.expectOne(`${api}/notifications?limit=10&offset=0&unreadOnly=false`).flush(page([], 0));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You are all caught up.');
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    flushRefreshCount();
    const request = http.expectOne(`${api}/notifications?limit=10&offset=0&unreadOnly=false`);
    request.flush({ success: false, message: 'Unavailable', data: null }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Close notifications"]')).toBeTruthy();
  });

  it('marks all notifications read and clears an unread-only list', () => {
    const fixture = create();
    (fixture.nativeElement.querySelector('button[aria-controls="notification-panel"]') as HTMLButtonElement).click();
    flushRefreshCount();
    http.expectOne(`${api}/notifications?limit=10&offset=0&unreadOnly=false`).flush(page());
    fixture.detectChanges();
    const unreadButton = [...fixture.nativeElement.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Unread') as HTMLButtonElement;
    unreadButton.click();
    http.expectOne(`${api}/notifications?limit=10&offset=0&unreadOnly=true`).flush({ ...page(), data: { ...page().data, unreadOnly: true } });
    fixture.detectChanges();
    const markAll = [...fixture.nativeElement.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Mark all read') as HTMLButtonElement;
    markAll.click();
    http.expectOne(`${api}/notifications/read-all`).flush({ success: true, message: 'Updated', data: { updatedCount: 1 } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No unread notifications.');
  });
});

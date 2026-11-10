import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../auth/auth.models';
import { AppNotification, NotificationPage } from './notification.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);

  list(options: { limit: number; offset: number; unreadOnly: boolean }) {
    const params = new HttpParams()
      .set('limit', options.limit)
      .set('offset', options.offset)
      .set('unreadOnly', options.unreadOnly);
    return this.http.get<ApiResponse<NotificationPage>>(`${apiUrl}/notifications`, { params });
  }

  unreadCount() {
    return this.http.get<ApiResponse<{ unreadCount: number }>>(`${apiUrl}/notifications/unread-count`);
  }

  markRead(notificationId: string) {
    return this.http.patch<ApiResponse<AppNotification>>(
      `${apiUrl}/notifications/${encodeURIComponent(notificationId)}/read`, {},
    );
  }

  markAllRead() {
    return this.http.patch<ApiResponse<{ updatedCount: number }>>(`${apiUrl}/notifications/read-all`, {});
  }
}

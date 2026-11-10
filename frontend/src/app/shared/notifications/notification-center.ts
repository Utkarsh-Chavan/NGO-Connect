import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, inject, OnInit, signal, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessages } from '../../core/http/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { AppNotification } from '../../core/notifications/notification.models';
import { NotificationService } from '../../core/notifications/notification.service';

@Component({
  selector: 'app-notification-center',
  imports: [DatePipe],
  templateUrl: './notification-center.html',
  styles: [':host{position:relative;display:block}'],
})
export class NotificationCenter implements OnInit {
  @ViewChild('toggleButton') private toggleButton?: ElementRef<HTMLButtonElement>;

  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notifications = signal<AppNotification[]>([]);
  protected readonly unreadCount = signal(0);
  protected readonly unreadOnly = signal(false);
  protected readonly hasNext = signal(false);
  protected readonly total = signal(0);
  protected readonly limit = 10;

  private readonly service = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.refreshUnreadCount();
  }

  protected togglePanel(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    this.unreadOnly.set(false);
    this.notifications.set([]);
    this.loadPage(0, false);
    this.refreshUnreadCount();
  }

  protected loadPage(offset: number, append: boolean): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.service.list({ limit: this.limit, offset, unreadOnly: this.unreadOnly() }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => {
        const page = response.data;
        this.notifications.set(append ? [...this.notifications(), ...page.items] : page.items);
        this.total.set(page.pagination.total);
        this.hasNext.set(page.pagination.hasNext);
      },
      error: (error: unknown) => this.error.set(getApiErrorMessages(error, 'Unable to load notifications.').join(' ')),
    });
  }

  protected retry(): void {
    this.loadPage(this.notifications().length, this.notifications().length > 0);
  }

  protected showUnreadOnly(value: boolean): void {
    if (this.loading() || value === this.unreadOnly()) return;
    this.unreadOnly.set(value);
    this.notifications.set([]);
    this.total.set(0);
    this.loadPage(0, false);
  }

  protected loadMore(): void {
    if (this.hasNext() && !this.loading()) this.loadPage(this.notifications().length, true);
  }

  protected markRead(notification: AppNotification): void {
    if (notification.read_at || this.saving()) return;
    this.saving.set(true);
    this.service.markRead(notification.notification_id).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (response) => {
        this.updateReadState(response.data);
        this.refreshUnreadCount();
      },
      error: (error: unknown) => this.error.set(getApiErrorMessages(error, 'Unable to mark this notification as read.').join(' ')),
    });
  }

  protected markAllRead(): void {
    if (this.saving() || this.unreadCount() === 0) return;
    this.saving.set(true);
    this.service.markAllRead().pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        const now = new Date().toISOString();
        this.notifications.update((items) => items.map((item) => item.read_at ? item : { ...item, read_at: now }));
        this.unreadCount.set(0);
        if (this.unreadOnly()) {
          this.notifications.set([]);
          this.total.set(0);
          this.hasNext.set(false);
        }
      },
      error: (error: unknown) => this.error.set(getApiErrorMessages(error, 'Unable to mark notifications as read.').join(' ')),
    });
  }

  protected openNotification(notification: AppNotification): void {
    const target = notification.navigation_target;
    if (!target || !target.startsWith('/') || target.startsWith('//')) return;
    const navigate = () => {
      this.open.set(false);
      void this.router.navigateByUrl(target);
    };
    if (notification.read_at) {
      navigate();
      return;
    }
    this.service.markRead(notification.notification_id).subscribe({
      next: (response) => {
        this.updateReadState(response.data);
        this.refreshUnreadCount();
        navigate();
      },
      error: (error: unknown) => {
        this.error.set(getApiErrorMessages(error, 'Unable to update notification status.').join(' '));
        navigate();
      },
    });
  }

  protected closePanel(): void {
    this.open.set(false);
    this.toggleButton?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) this.closePanel();
  }

  private refreshUnreadCount(): void {
    if (!this.auth.isAuthenticated()) return;
    this.service.unreadCount().subscribe({
      next: (response) => this.unreadCount.set(response.data.unreadCount),
      error: () => this.unreadCount.set(0),
    });
  }

  private updateReadState(updated: AppNotification): void {
    const wasUnread = this.notifications().some((item) => item.notification_id === updated.notification_id && !item.read_at);
    this.notifications.update((items) => items.map((item) =>
      item.notification_id === updated.notification_id ? { ...item, read_at: updated.read_at } : item,
    ));
    if (wasUnread) this.unreadCount.update((count) => Math.max(0, count - 1));
    if (wasUnread && this.unreadOnly()) {
      this.notifications.update((items) => items.filter((item) => item.notification_id !== updated.notification_id));
      this.total.update((value) => Math.max(0, value - 1));
    }
  }
}

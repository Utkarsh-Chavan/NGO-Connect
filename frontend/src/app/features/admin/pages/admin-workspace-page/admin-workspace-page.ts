import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, Observable } from 'rxjs';
import { AdminAnalytics, AdminDashboard, AdminNeed, AdminNeedDetail, AdminPage, AdminUser, AdminUserDetail } from '../../../../core/admin/admin.models';
import { AdminService } from '../../../../core/admin/admin.service';
import { getApiErrorMessages } from '../../../../core/http/api-error';

type Section = 'dashboard' | 'users' | 'user-detail' | 'needs' | 'need-detail' | 'reports';
type AdminAction = 'suspend-user' | 'reactivate-user' | 'hide-need' | 'restore-need';

@Component({
  selector: 'app-admin-workspace-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './admin-workspace-page.html',
})
export class AdminWorkspacePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly admin = inject(AdminService);
  protected readonly section: Section = this.route.snapshot.data['section'] ?? 'dashboard';
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly dashboard = signal<AdminDashboard | null>(null);
  protected readonly analytics = signal<AdminAnalytics | null>(null);
  protected readonly users = signal<AdminPage<AdminUser> | null>(null);
  protected readonly user = signal<AdminUserDetail | null>(null);
  protected readonly needs = signal<AdminPage<AdminNeed> | null>(null);
  protected readonly need = signal<AdminNeedDetail | null>(null);
  protected readonly search = signal('');
  protected readonly role = signal('');
  protected readonly accountStatus = signal('');
  protected readonly needStatus = signal('');
  protected readonly moderationStatus = signal('');
  protected readonly contributionType = signal('');
  protected readonly offset = signal(0);
  protected readonly readonlyPageSize = 20;
  protected readonly actionReason = signal('');
  protected readonly pendingAction = signal<'suspend-user' | 'reactivate-user' | 'hide-need' | 'restore-need' | null>(null);
  protected readonly saving = signal(false);

  ngOnInit(): void { this.load(); }

  protected load(): void {
    this.loading.set(true);
    this.errors.set([]);
    if (this.section === 'dashboard') this.admin.getDashboard().pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.dashboard.set(r.data), error: (e: unknown) => this.fail(e) });
    else if (this.section === 'reports') this.admin.getAnalytics().pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.analytics.set(r.data), error: (e: unknown) => this.fail(e) });
    else if (this.section === 'users') this.admin.listUsers({ search: this.search().trim() || undefined, role: this.role() || undefined, status: this.accountStatus() || undefined, limit: this.readonlyPageSize, offset: this.offset() }).pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.users.set(r.data), error: (e: unknown) => this.fail(e) });
    else if (this.section === 'user-detail') {
      const id = this.route.snapshot.paramMap.get('userId');
      if (!id) { this.loading.set(false); this.errors.set(['The user route is missing an ID.']); return; }
      this.admin.getUser(id).pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.user.set(r.data), error: (e: unknown) => this.fail(e) });
    } else if (this.section === 'needs') this.admin.listNeeds({ search: this.search().trim() || undefined, status: this.needStatus() || undefined, moderationStatus: this.moderationStatus() || undefined, contributionType: this.contributionType() || undefined, limit: this.readonlyPageSize, offset: this.offset() }).pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.needs.set(r.data), error: (e: unknown) => this.fail(e) });
    else {
      const id = this.route.snapshot.paramMap.get('needId');
      if (!id) { this.loading.set(false); this.errors.set(['The need route is missing an ID.']); return; }
      this.admin.getNeed(id).pipe(finalize(() => this.loading.set(false))).subscribe({ next: (r) => this.need.set(r.data), error: (e: unknown) => this.fail(e) });
    }
  }

  protected runSearch(): void { this.offset.set(0); this.load(); }
  protected previous(): void { this.offset.update((n) => Math.max(0, n - this.readonlyPageSize)); this.load(); }
  protected next(total: number): void { if (this.offset() + this.readonlyPageSize < total) { this.offset.update((n) => n + this.readonlyPageSize); this.load(); } }
  protected requestAction(action: AdminAction): void {
    this.pendingAction.set(action); this.actionReason.set(''); this.errors.set([]); this.notice.set('');
  }
  protected cancelAction(): void { if (!this.saving()) { this.pendingAction.set(null); this.actionReason.set(''); } }
  protected confirmAction(): void {
    const action = this.pendingAction();
    const reason = this.actionReason().trim();
    if (!action || !reason) { this.errors.set(['Enter a reason before confirming this action.']); return; }
    this.saving.set(true); this.errors.set([]);
    const userId = this.route.snapshot.paramMap.get('userId');
    const needId = this.route.snapshot.paramMap.get('needId');
    const request: Observable<unknown> | null = action.includes('user') && userId
      ? this.admin.setUserSuspension(userId, action === 'suspend-user', reason)
      : needId ? this.admin.setNeedModeration(needId, action === 'hide-need', reason) : null;
    if (!request) { this.saving.set(false); this.errors.set(['The selected item could not be updated.']); return; }
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.pendingAction.set(null); this.actionReason.set(''); this.notice.set('Administrative action completed and recorded.'); this.load(); },
      error: (error: unknown) => this.fail(error),
    });
  }
  protected categoryLabel(value: string): string { return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  private fail(error: unknown): void { this.errors.set(getApiErrorMessages(error, 'Unable to load this Admin workspace view.')); }
}

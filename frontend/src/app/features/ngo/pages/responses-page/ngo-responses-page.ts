import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, Observable } from 'rxjs';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { NgoOwnedNeed, NgoResponseFilters, NgoResponseItem, NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';
import { ContributionReviewStatus, EngagementContact, VolunteerReviewStatus } from '../../../../core/needs/need-engagement.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';
import { ContributionType } from '../../../../core/needs/need.models';

@Component({ selector: 'app-ngo-responses-page', imports: [DatePipe, RouterLink], templateUrl: './ngo-responses-page.html' })
export class NgoResponsesPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly responses = signal<NgoResponseItem[]>([]);
  protected readonly needs = signal<NgoOwnedNeed[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly limit = 50;
  protected readonly searchInput = signal('');
  protected readonly appliedSearch = signal('');
  protected readonly status = signal<NgoResponseFilters['status']>('');
  protected readonly type = signal<ContributionType | ''>('');
  protected readonly needId = signal('');
  protected readonly busyId = signal<string | null>(null);
  protected readonly notices = signal<Record<string, string>>({});
  protected readonly rowErrors = signal<Record<string, string>>({});
  protected readonly contacts = signal<Record<string, EngagementContact>>({});
  protected readonly contactBusy = signal<string | null>(null);
  protected readonly contactErrors = signal<Record<string, string>>({});
  private readonly route = inject(ActivatedRoute);
  private readonly workspace = inject(NgoWorkspaceService);
  private readonly engagement = inject(NeedEngagementService);
  ngOnInit(): void {
    this.needId.set(this.route.snapshot.queryParamMap.get('needId') ?? '');
    this.workspace.listNeeds({ limit: 100 }).subscribe({ next: (response) => this.needs.set(response.data.items) });
    this.load();
  }
  protected load(): void {
    this.loading.set(true); this.errors.set([]);
    const filters: NgoResponseFilters = { limit: this.limit, offset: this.offset(), status: this.status(), contributionType: this.type(), needId: this.needId(), search: this.appliedSearch() };
    this.workspace.listResponses(filters).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => { this.responses.set(response.data.items); this.total.set(response.data.pagination.total); },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load responses received.')),
    });
  }
  protected filterChanged(kind: 'status' | 'type' | 'needId', value: string): void {
    if (kind === 'status') this.status.set(value as NgoResponseFilters['status']);
    else if (kind === 'type') this.type.set(value as ContributionType | '');
    else this.needId.set(value);
    this.offset.set(0); this.load();
  }
  protected search(): void { this.appliedSearch.set(this.searchInput().trim()); this.offset.set(0); this.load(); }
  protected previous(): void { this.offset.update((value) => Math.max(0, value - this.limit)); this.load(); }
  protected next(): void { if (this.offset() + this.limit < this.total()) { this.offset.update((value) => value + this.limit); this.load(); } }
  protected statusLabel(status: string): string { return ({ APPLIED: 'Applied', PENDING: 'Pending', ACCEPTED: 'Accepted', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', REJECTED: 'Rejected' } as Record<string, string>)[status] ?? status; }
  protected typeLabel(row: NgoResponseItem): string { return row.response_kind === 'APPLICATION' ? 'Volunteer application' : `${row.contribution_type} contribution`; }
  protected actions(row: NgoResponseItem): string[] {
    if (row.response_kind === 'APPLICATION') {
      if (row.status === 'APPLIED') return ['ACCEPTED', 'REJECTED'];
      if (row.status === 'ACCEPTED') return ['COMPLETED'];
      return [];
    }
    if (row.contribution_type === 'MONEY') return [];
    if (row.status === 'PENDING') return ['ACCEPTED', 'REJECTED'];
    if (row.status === 'ACCEPTED') return ['IN_PROGRESS'];
    if (row.status === 'IN_PROGRESS') return ['COMPLETED'];
    return [];
  }
  protected actionLabel(action: string): string { return ({ ACCEPTED: 'Accept', REJECTED: 'Reject', IN_PROGRESS: 'Mark in progress', COMPLETED: 'Complete' } as Record<string, string>)[action] ?? action; }
  protected update(row: NgoResponseItem, action: string): void {
    if (this.busyId()) return;
    const label = this.actionLabel(action).toLowerCase();
    if (!globalThis.confirm(`Are you sure you want to ${label} this response for “${row.need_title}”?`)) return;
    this.busyId.set(row.response_id); this.rowErrors.update((map) => ({ ...map, [row.response_id]: '' }));
    const request: Observable<unknown> = row.response_kind === 'APPLICATION'
      ? this.engagement.reviewApplication(row.need_id, row.response_id, action as VolunteerReviewStatus)
      : this.engagement.updateContributionStatus(row.need_id, row.response_id, action as ContributionReviewStatus);
    request.pipe(finalize(() => this.busyId.set(null))).subscribe({
      next: () => {
        const result = action === 'ACCEPTED' ? 'accepted' : action === 'REJECTED' ? 'rejected' : action === 'COMPLETED' ? 'marked complete' : 'marked in progress';
        this.notices.update((map) => ({ ...map, [row.response_id]: `Response ${result}.` }));
        this.load();
      },
      error: (error: unknown) => this.rowErrors.update((map) => ({ ...map, [row.response_id]: getApiErrorMessages(error, 'Unable to update this response.')[0] })),
    });
  }
  protected canViewContact(row: NgoResponseItem): boolean {
    if (row.contribution_type === 'MONEY') return false;
    return row.response_kind === 'APPLICATION'
      ? ['ACCEPTED', 'COMPLETED'].includes(row.status)
      : ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(row.status);
  }
  protected loadContact(row: NgoResponseItem): void {
    if (!this.canViewContact(row) || this.contactBusy() || this.contacts()[row.response_id]) return;
    this.contactBusy.set(row.response_id); this.contactErrors.update((map) => ({ ...map, [row.response_id]: '' }));
    const request = row.response_kind === 'APPLICATION'
      ? this.engagement.getApplicationContact(row.response_id)
      : this.engagement.getContributionContact(row.response_id);
    request.pipe(finalize(() => this.contactBusy.set(null))).subscribe({
      next: (response) => this.contacts.update((map) => ({ ...map, [row.response_id]: response.data })),
      error: (error: unknown) => this.contactErrors.update((map) => ({ ...map, [row.response_id]: getApiErrorMessages(error, 'Contact details are unavailable.')[0] })),
    });
  }
}

import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { NgoNeedFilters, NgoOwnedNeed, NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';
import { ContributionType, NeedStatus } from '../../../../core/needs/need.models';

@Component({ selector: 'app-ngo-needs-page', imports: [DatePipe, RouterLink], templateUrl: './ngo-needs-page.html' })
export class NgoNeedsPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly needs = signal<NgoOwnedNeed[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly searchInput = signal('');
  protected readonly appliedSearch = signal('');
  protected readonly status = signal<NeedStatus | ''>('');
  protected readonly type = signal<ContributionType | ''>('');
  protected readonly statuses: NeedStatus[] = ['DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'COMPLETED', 'FULFILLED', 'EXPIRED', 'CLOSED'];
  protected readonly pendingCloseId = signal<string | null>(null);
  protected readonly closingId = signal<string | null>(null);
  protected readonly types: ContributionType[] = ['VOLUNTEER', 'MATERIAL', 'MONEY', 'SKILL'];
  protected readonly limit = 50;
  private readonly service = inject(NgoWorkspaceService);
  ngOnInit(): void { this.load(); }
  protected load(): void {
    this.loading.set(true); this.errors.set([]);
    const filters: NgoNeedFilters = { limit: this.limit, offset: this.offset(), status: this.status(), contributionType: this.type(), search: this.appliedSearch() };
    this.service.listNeeds(filters).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => { this.needs.set(response.data.items); this.total.set(response.data.pagination.total); },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load your needs.')),
    });
  }
  protected applyFilters(): void { this.offset.set(0); this.appliedSearch.set(this.searchInput().trim()); this.load(); }
  protected setStatus(value: string): void { this.status.set(value as NeedStatus | ''); this.offset.set(0); this.load(); }
  protected setType(value: string): void { this.type.set(value as ContributionType | ''); this.offset.set(0); this.load(); }
  protected previous(): void { this.offset.update((value) => Math.max(0, value - this.limit)); this.load(); }
  protected next(): void { if (this.offset() + this.limit < this.total()) { this.offset.update((value) => value + this.limit); this.load(); } }
  protected statusLabel(status: NeedStatus): string { return status === 'FULFILLED' ? 'Fulfilled' : status.replaceAll('_', ' '); }
  protected canClose(need: NgoOwnedNeed): boolean { return ['DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'EXPIRED'].includes(need.status); }
  protected requestClose(need: NgoOwnedNeed): void { this.pendingCloseId.set(need.need_id); this.errors.set([]); }
  protected cancelClose(): void { if (!this.closingId()) this.pendingCloseId.set(null); }
  protected confirmClose(need: NgoOwnedNeed): void {
    if (this.closingId() || this.pendingCloseId() !== need.need_id) return;
    this.errors.set([]);
    this.closingId.set(need.need_id);
    this.service.closeNeed(need.need_id).pipe(finalize(() => this.closingId.set(null))).subscribe({
      next: (response) => {
        const result = response.data;
        this.notice.set(result.alreadyClosed
          ? 'This need was already closed.'
          : `Need closed. ${result.canceledEngagements?.applications ?? 0} pending applications and ${result.canceledEngagements?.contributions ?? 0} pending contributions were canceled. Accepted and in-progress engagements remain active.`);
        this.pendingCloseId.set(null);
        this.load();
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to close this need.')),
    });
  }
  protected detailRoute(need: NgoOwnedNeed): string[] { return ['/ngo/needs', need.need_id]; }
  protected editRoute(need: NgoOwnedNeed): string[] { return ['/ngo/needs', need.need_id, 'edit']; }
}

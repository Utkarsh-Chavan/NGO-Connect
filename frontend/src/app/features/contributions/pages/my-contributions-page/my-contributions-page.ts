import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import { ContributionStatus, EngagementContact, IndividualContribution } from '../../../../core/needs/need-engagement.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';

type ContributionFilter = 'ALL' | ContributionStatus;

@Component({
  selector: 'app-my-contributions-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './my-contributions-page.html',
})
export class MyContributionsPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly contributions = signal<IndividualContribution[]>([]);
  protected readonly filter = signal<ContributionFilter>('ALL');
  protected readonly contactDetails = signal<Record<string, EngagementContact>>({});
  protected readonly contactLoading = signal<Record<string, boolean>>({});
  protected readonly contactErrors = signal<Record<string, string>>({});
  protected readonly visibleContributions = computed(() => {
    const selected = this.filter();
    return selected === 'ALL'
      ? this.contributions()
      : this.contributions().filter((contribution) => contribution.status === selected);
  });

  private readonly engagement = inject(NeedEngagementService);
  private readonly router = inject(Router);
  protected browseNeedsRoute(): string { return this.router.url.startsWith('/individual') ? '/individual/needs' : '/needs'; }
  protected needRoute(needId: string): string[] { return this.router.url.startsWith('/individual') ? ['/individual/needs', needId] : ['/needs', needId]; }
  protected canOpenNeed(item: IndividualContribution): boolean {
    return item.need_moderation_status !== 'HIDDEN' && !['CLOSED', 'EXPIRED', 'COMPLETED', 'FULFILLED'].includes(item.need_status ?? '');
  }

  ngOnInit(): void {
    this.engagement.listMyContributions()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.contributions.set(response.data),
        error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load your contributions.')),
      });
  }

  protected setFilter(filter: ContributionFilter): void {
    this.filter.set(filter);
  }

  protected statusLabel(status: ContributionStatus): string {
    return {
      PENDING: 'Pending',
      ACCEPTED: 'Accepted',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      REJECTED: 'Rejected',
    }[status];
  }

  protected canViewContact(contribution: IndividualContribution): boolean {
    return contribution.contribution_type !== 'MONEY'
      && ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(contribution.status);
  }

  protected loadContact(contribution: IndividualContribution): void {
    const id = contribution.contribution_id;
    if (!this.canViewContact(contribution) || this.contactLoading()[id] || this.contactDetails()[id]) return;
    this.contactLoading.update((items) => ({ ...items, [id]: true }));
    this.contactErrors.update((items) => ({ ...items, [id]: '' }));
    this.engagement.getContributionContact(id).pipe(finalize(() => {
      this.contactLoading.update((items) => ({ ...items, [id]: false }));
    })).subscribe({
      next: (response) => this.contactDetails.update((items) => ({ ...items, [id]: response.data })),
      error: (error: unknown) => this.contactErrors.update((items) => ({
        ...items,
        [id]: getApiErrorMessages(error, 'Unable to load accepted engagement contact details.')[0],
      })),
    });
  }
}

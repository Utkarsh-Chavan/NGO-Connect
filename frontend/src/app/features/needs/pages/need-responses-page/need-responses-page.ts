import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import {
  Contribution,
  ContributionReviewStatus,
  EngagementContact,
  VolunteerApplication,
  VolunteerReviewStatus,
} from '../../../../core/needs/need-engagement.models';
import { Need } from '../../../../core/needs/need.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';
import { ProfileService } from '../../../../core/profiles/profile.service';
import { NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';
import { NeedsService } from '../../../../core/needs/needs.service';

@Component({
  selector: 'app-need-responses-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './need-responses-page.html',
})
export class NeedResponsesPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly rowErrors = signal<Record<string, string>>({});
  protected readonly need = signal<Need | null>(null);
  protected readonly contributions = signal<Contribution[]>([]);
  protected readonly applications = signal<VolunteerApplication[]>([]);
  protected readonly busyId = signal<string | null>(null);
  protected readonly contactDetails = signal<Record<string, EngagementContact>>({});
  protected readonly contactBusyId = signal<string | null>(null);
  protected readonly contactErrors = signal<Record<string, string>>({});

  private readonly route = inject(ActivatedRoute);
  private readonly profiles = inject(ProfileService);
  private readonly engagement = inject(NeedEngagementService);
  private readonly ngoWorkspace = inject(NgoWorkspaceService);
  private readonly needs = inject(NeedsService);

  ngOnInit(): void {
    const needId = this.route.snapshot.paramMap.get('id');
    if (!needId) {
      this.errors.set(['Need not found.']);
      this.loading.set(false);
      return;
    }
    const needRequest = globalThis.location?.pathname.startsWith('/ngo/')
      ? this.ngoWorkspace.getNeed(needId)
      : this.needs.getNeed(needId);
    forkJoin({ profile: this.profiles.getNgoProfile(), need: needRequest }).subscribe({
      next: ({ profile, need }) => {
        if (profile.data.ngo_id !== need.data.ngo_id) {
          this.errors.set(['You can view responses only for needs owned by your NGO.']);
          this.loading.set(false);
          return;
        }
        this.need.set(need.data);
        if (need.data.contribution_type === 'VOLUNTEER') {
          this.engagement.listApplications(needId)
            .pipe(finalize(() => this.loading.set(false)))
            .subscribe({
              next: (response) => this.applications.set(response.data),
              error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load applications for this need.')),
            });
        } else {
          this.engagement.listContributions(needId)
            .pipe(finalize(() => this.loading.set(false)))
            .subscribe({
              next: (response) => this.contributions.set(response.data),
              error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load contributions for this need.')),
            });
        }
      },
      error: (error: unknown) => {
        this.errors.set(getApiErrorMessages(error, 'Unable to verify need ownership.'));
        this.loading.set(false);
      },
    });
  }

  protected contributionActions(contribution: Contribution): ContributionReviewStatus[] {
    if (contribution.contribution_type === 'MONEY') return [];
    if (contribution.status === 'PENDING') return ['ACCEPTED', 'REJECTED'];
    if (contribution.status === 'ACCEPTED') return ['IN_PROGRESS'];
    if (contribution.status === 'IN_PROGRESS') return ['COMPLETED'];
    return [];
  }

  protected applicationActions(application: VolunteerApplication): VolunteerReviewStatus[] {
    if (application.status === 'APPLIED') return ['ACCEPTED', 'REJECTED'];
    if (application.status === 'ACCEPTED') return ['COMPLETED'];
    return [];
  }

  protected updateContribution(contribution: Contribution, status: ContributionReviewStatus): void {
    const needId = this.need()?.need_id;
    if (!needId || this.busyId()) return;
    if (!globalThis.confirm(`Are you sure you want to ${this.actionLabel(status).toLowerCase()} this contribution?`)) return;
    this.startRowUpdate(contribution.contribution_id);
    this.engagement.updateContributionStatus(needId, contribution.contribution_id, status)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe({
        next: (response) => this.contributions.update((items) => items.map((item) =>
          item.contribution_id === response.data.contribution_id ? response.data : item,
        )),
        error: (error: unknown) => this.setRowError(contribution.contribution_id, error),
      });
  }

  protected updateApplication(application: VolunteerApplication, status: VolunteerReviewStatus): void {
    const needId = this.need()?.need_id;
    if (!needId || this.busyId()) return;
    if (!globalThis.confirm(`Are you sure you want to ${this.actionLabel(status).toLowerCase()} this application?`)) return;
    this.startRowUpdate(application.application_id);
    this.engagement.reviewApplication(needId, application.application_id, status)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe({
        next: (response) => this.applications.update((items) => items.map((item) =>
          item.application_id === response.data.application_id ? { ...item, ...response.data } : item,
        )),
        error: (error: unknown) => this.setRowError(application.application_id, error),
      });
  }

  protected actionLabel(status: ContributionReviewStatus | VolunteerReviewStatus): string {
    return {
      ACCEPTED: 'Accept',
      REJECTED: 'Reject',
      IN_PROGRESS: 'Mark in progress',
      COMPLETED: 'Complete',
    }[status];
  }

  protected canViewApplicationContact(application: VolunteerApplication): boolean {
    return ['ACCEPTED', 'COMPLETED'].includes(application.status);
  }

  protected canViewContributionContact(contribution: Contribution): boolean {
    return contribution.contribution_type !== 'MONEY'
      && ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(contribution.status);
  }

  protected loadApplicationContact(application: VolunteerApplication): void {
    if (this.contactBusyId() || this.contactDetails()[application.application_id]) return;
    this.contactErrors.update((errors) => ({ ...errors, [application.application_id]: '' }));
    this.contactBusyId.set(application.application_id);
    this.engagement.getApplicationContact(application.application_id)
      .pipe(finalize(() => this.contactBusyId.set(null)))
      .subscribe({
        next: (response) => this.contactDetails.update((items) => ({ ...items, [application.application_id]: response.data })),
        error: (error: unknown) => this.contactErrors.update((items) => ({
          ...items,
          [application.application_id]: getApiErrorMessages(error, 'Unable to load accepted engagement contact details.')[0],
        })),
      });
  }

  protected loadContributionContact(contribution: Contribution): void {
    if (this.contactBusyId() || this.contactDetails()[contribution.contribution_id]) return;
    this.contactErrors.update((errors) => ({ ...errors, [contribution.contribution_id]: '' }));
    this.contactBusyId.set(contribution.contribution_id);
    this.engagement.getContributionContact(contribution.contribution_id)
      .pipe(finalize(() => this.contactBusyId.set(null)))
      .subscribe({
        next: (response) => this.contactDetails.update((items) => ({ ...items, [contribution.contribution_id]: response.data })),
        error: (error: unknown) => this.contactErrors.update((items) => ({
          ...items,
          [contribution.contribution_id]: getApiErrorMessages(error, 'Unable to load accepted engagement contact details.')[0],
        })),
      });
  }

  private startRowUpdate(id: string): void {
    this.rowErrors.update((errors) => ({ ...errors, [id]: '' }));
    this.busyId.set(id);
  }

  private setRowError(id: string, error: unknown): void {
    this.rowErrors.update((errors) => ({
      ...errors,
      [id]: getApiErrorMessages(error, 'Unable to update this response.')[0],
    }));
  }
}

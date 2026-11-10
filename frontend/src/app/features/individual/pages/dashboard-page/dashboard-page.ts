import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { IndividualDashboardData, IndividualDashboardService } from '../../../../core/profiles/individual-dashboard.service';
import { MatchingRecommendation } from '../../../../core/matching/matching.models';
import { MatchingService } from '../../../../core/matching/matching.service';

@Component({ selector: 'app-individual-dashboard', imports: [DatePipe, RouterLink], templateUrl: './dashboard-page.html' })
export class IndividualDashboardPage implements OnInit {
  protected readonly name = inject(AuthService).currentUser()?.name?.split(' ')[0] ?? 'there';
  protected readonly dashboard = signal<IndividualDashboardData | null>(null);
  protected readonly dashboardLoading = signal(true);
  protected readonly dashboardErrors = signal<string[]>([]);
  protected readonly recommendations = signal<MatchingRecommendation[]>([]);
  protected readonly recommendationLoading = signal(true);
  protected readonly recommendationErrors = signal<string[]>([]);
  private readonly dashboardService = inject(IndividualDashboardService);
  private readonly matching = inject(MatchingService);

  ngOnInit(): void {
    this.dashboardService.get().pipe(finalize(() => this.dashboardLoading.set(false))).subscribe({
      next: (response) => this.dashboard.set(response.data),
      error: (error: unknown) => this.dashboardErrors.set(getApiErrorMessages(error, 'Unable to load your activity overview.')),
    });
    this.matching.getRecommendations(3, 0).pipe(finalize(() => this.recommendationLoading.set(false))).subscribe({
      next: (response) => this.recommendations.set(response.data.items),
      error: (error: unknown) => this.recommendationErrors.set(getApiErrorMessages(error, 'Unable to load recommendations.')),
    });
  }
  protected statusLabel(status: string): string { return ({ APPLIED: 'Application submitted', PENDING: 'Pending', ACCEPTED: 'Accepted', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', REJECTED: 'Rejected' } as Record<string, string>)[status] ?? status; }
  protected typeLabel(activity: { engagement_type: string; contribution_type: string }): string { return activity.engagement_type === 'VOLUNTEER_APPLICATION' ? 'Volunteer application' : `${activity.contribution_type} contribution`; }
  protected needRoute(needId: string): string[] { return ['/individual/needs', needId]; }
}

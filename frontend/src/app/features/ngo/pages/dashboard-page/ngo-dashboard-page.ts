import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { NgoDashboardData, NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';
import { NgoProfile } from '../../../../core/profiles/profile.models';
import { ProfileService } from '../../../../core/profiles/profile.service';

@Component({ selector: 'app-ngo-dashboard-page', imports: [DatePipe, RouterLink], templateUrl: './ngo-dashboard-page.html' })
export class NgoDashboardPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly profile = signal<NgoProfile | null>(null);
  protected readonly dashboard = signal<NgoDashboardData | null>(null);
  private readonly profiles = inject(ProfileService);
  private readonly workspace = inject(NgoWorkspaceService);
  ngOnInit(): void { this.load(); }
  protected load(): void {
    this.loading.set(true); this.errors.set([]);
    forkJoin({ profile: this.profiles.getNgoProfile(), dashboard: this.workspace.getDashboard() }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ profile, dashboard }) => { this.profile.set(profile.data); this.dashboard.set(dashboard.data); },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load your organization overview.')),
    });
  }
  protected statusLabel(status: string): string { return ({ APPLIED: 'New application', PENDING: 'Pending contribution', ACCEPTED: 'Accepted', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', REJECTED: 'Rejected' } as Record<string, string>)[status] ?? status; }
  protected responseType(item: { response_kind: string; contribution_type: string }): string { return item.response_kind === 'APPLICATION' ? 'Volunteer application' : `${item.contribution_type} contribution`; }
}

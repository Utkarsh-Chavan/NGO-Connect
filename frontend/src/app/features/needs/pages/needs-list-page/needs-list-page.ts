import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, map, of, switchMap } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import { AuthService } from '../../../../core/auth/auth.service';
import { CauseOption, ContributionType, Need, NeedPagination, PublicNeedFilters } from '../../../../core/needs/need.models';
import { VolunteerApplicationStatus, volunteerApplicationStatusLabel } from '../../../../core/needs/need-engagement.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';
import { NeedsService } from '../../../../core/needs/needs.service';

type NeedCard = Need & { applicationStatus: VolunteerApplicationStatus | null };
type ActiveFilters = { search: string; causeId: string; contributionType: ContributionType | ''; location: string };
const emptyFilters = (): ActiveFilters => ({ search: '', causeId: '', contributionType: '', location: '' });

@Component({
  selector: 'app-needs-list-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './needs-list-page.html',
})
export class NeedsListPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly causeErrors = signal<string[]>([]);
  protected readonly causesLoading = signal(false);
  protected readonly applicationStatusErrors = signal<string[]>([]);
  protected readonly needs = signal<NeedCard[]>([]);
  protected readonly causes = signal<CauseOption[]>([]);
  protected readonly filters = signal(emptyFilters());
  private readonly activeFilters = signal(emptyFilters());
  protected readonly offset = signal(0);
  protected readonly pagination = signal<NeedPagination | null>(null);
  protected readonly limit = 12;
  protected readonly Math = Math;
  protected readonly contributionTypes: ContributionType[] = ['VOLUNTEER', 'MATERIAL', 'MONEY', 'SKILL'];

  private readonly service = inject(NeedsService);
  private readonly engagement = inject(NeedEngagementService);
  private readonly currentUser = inject(AuthService).currentUser;
  private readonly router = inject(Router);
  private lastLoadedKey: string | null = null;
  private inFlightKey: string | null = null;

  ngOnInit(): void {
    this.loadCauses();
    this.load();
  }

  protected loadCauses(): void {
    if (this.causesLoading()) return;
    this.causesLoading.set(true);
    this.causeErrors.set([]);
    this.service.listCauses().pipe(finalize(() => this.causesLoading.set(false))).subscribe({
      next: (response) => this.causes.set(response.data),
      error: (error: unknown) => this.causeErrors.set(getApiErrorMessages(error, 'Unable to load cause filters.')),
    });
  }

  protected load(force = false): void {
    const filters = this.activeFilters();
    const requestFilters: PublicNeedFilters = {
      search: filters.search,
      causeId: filters.causeId,
      contributionType: filters.contributionType,
      location: filters.location,
    };
    const key = JSON.stringify({ offset: this.offset(), filters: requestFilters });
    if (this.inFlightKey === key) return;
    if (!force && key === this.lastLoadedKey) return;
    this.inFlightKey = key;
    this.loading.set(true);
    this.errors.set([]);
    this.applicationStatusErrors.set([]);
    this.service.listNeeds(this.limit, this.offset(), requestFilters).pipe(
      switchMap((response) => {
        if (this.currentUser()?.role !== 'INDIVIDUAL') {
          return of({ response, applications: [] as { need_id: string; status: VolunteerApplicationStatus }[] });
        }
        return this.engagement.listMyApplicationStatuses().pipe(
          map((applications) => ({ response, applications: applications.data })),
          catchError((error: unknown) => {
            this.applicationStatusErrors.set(getApiErrorMessages(error, 'Unable to load your application statuses.'));
            return of({ response, applications: [] as { need_id: string; status: VolunteerApplicationStatus }[] });
          }),
        );
      }),
      finalize(() => {
        this.loading.set(false);
        if (this.inFlightKey === key) this.inFlightKey = null;
      }),
    ).subscribe({
      next: ({ response, applications }) => {
        const statusByNeed = new Map(applications.map((application) => [application.need_id, application.status]));
        this.needs.set(response.data.items.map((need) => ({ ...need, applicationStatus: statusByNeed.get(need.need_id) ?? null })));
        this.pagination.set(response.data.pagination);
        this.lastLoadedKey = key;
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load needs.')),
    });
  }

  protected applyFilters(event?: Event): void {
    event?.preventDefault();
    if (this.loading()) return;
    const next = this.filters();
    const normalized = {
      search: next.search.trim(),
      causeId: next.causeId,
      contributionType: next.contributionType,
      location: next.location.trim(),
    };
    const changed = JSON.stringify(normalized) !== JSON.stringify(this.activeFilters());
    this.filters.set(normalized);
    this.activeFilters.set(normalized);
    const pageChanged = this.offset() !== 0;
    if (pageChanged) this.offset.set(0);
    if (changed || pageChanged) this.load();
  }

  protected clearFilters(): void {
    const wasFiltered = Object.values(this.filters()).some(Boolean) || Object.values(this.activeFilters()).some(Boolean) || this.offset() > 0;
    const cleared = emptyFilters();
    this.filters.set(cleared);
    this.activeFilters.set(cleared);
    this.offset.set(0);
    if (wasFiltered) this.load();
  }

  protected setFilter<K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]): void {
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  protected retry(): void {
    this.lastLoadedKey = null;
    this.load(true);
  }

  protected isIndividual(): boolean {
    return this.currentUser()?.role === 'INDIVIDUAL';
  }

  protected hasFilters(): boolean {
    return Object.values(this.filters()).some(Boolean);
  }

  protected applicationStatusLabel(status: VolunteerApplicationStatus): string {
    return volunteerApplicationStatusLabel(status);
  }

  protected needRoute(needId: string): string[] {
    return this.router.url.startsWith('/individual') ? ['/individual/needs', needId] : ['/needs', needId];
  }

  protected previousPage(): void {
    if (!this.pagination()?.hasPrevious || this.loading()) return;
    this.offset.update((value) => Math.max(0, value - this.limit));
    this.load();
  }

  protected nextPage(): void {
    if (!this.pagination()?.hasNext || this.loading()) return;
    this.offset.update((value) => value + this.limit);
    this.load();
  }
}

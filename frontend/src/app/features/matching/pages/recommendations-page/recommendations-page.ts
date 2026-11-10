import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import { MatchingRecommendation } from '../../../../core/matching/matching.models';
import { MatchingService } from '../../../../core/matching/matching.service';

@Component({
  selector: 'app-recommendations-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './recommendations-page.html',
})
export class RecommendationsPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly recommendations = signal<MatchingRecommendation[]>([]);
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly limit = 12;

  private readonly service = inject(MatchingService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errors.set([]);
    this.service.getRecommendations(this.limit, this.offset())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => {
          this.recommendations.set(response.data.items);
          this.total.set(response.data.pagination.total);
        },
        error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load recommendations.')),
      });
  }

  protected nextPage(): void {
    if (this.offset() + this.limit >= this.total()) return;
    this.offset.update((value) => value + this.limit);
    this.load();
  }

  protected previousPage(): void {
    this.offset.update((value) => Math.max(0, value - this.limit));
    this.load();
  }

  protected needRoute(needId: string): string[] { return this.router.url.startsWith('/individual') ? ['/individual/needs', needId] : ['/needs', needId]; }
  protected browseNeedsRoute(): string { return this.router.url.startsWith('/individual') ? '/individual/needs' : '/needs'; }
}

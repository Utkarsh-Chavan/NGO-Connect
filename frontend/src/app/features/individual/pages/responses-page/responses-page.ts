import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { EngagementContact, VolunteerApplicationStatusByNeed, volunteerApplicationStatusLabel } from '../../../../core/needs/need-engagement.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';

@Component({ selector: 'app-individual-responses', imports: [DatePipe, RouterLink], templateUrl: './responses-page.html' })
export class IndividualResponsesPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly applications = signal<VolunteerApplicationStatusByNeed[]>([]);
  protected readonly contacts = signal<Record<string, EngagementContact>>({});
  protected readonly contactLoading = signal<Record<string, boolean>>({});
  protected readonly contactErrors = signal<Record<string, string>>({});
  private readonly engagement = inject(NeedEngagementService);
  ngOnInit(): void { this.load(); }
  protected load(): void {
    this.loading.set(true); this.errors.set([]);
    this.engagement.listMyApplicationStatuses().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => this.applications.set(response.data),
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load your responses.')),
    });
  }
  protected statusLabel(status: VolunteerApplicationStatusByNeed['status']): string { return volunteerApplicationStatusLabel(status); }
  protected canOpenNeed(item: VolunteerApplicationStatusByNeed): boolean {
    return item.need_moderation_status !== 'HIDDEN' && !['CLOSED', 'EXPIRED', 'COMPLETED', 'FULFILLED'].includes(item.need_status ?? '');
  }
  protected canViewContact(item: VolunteerApplicationStatusByNeed): boolean { return ['ACCEPTED', 'COMPLETED'].includes(item.status); }
  protected loadContact(item: VolunteerApplicationStatusByNeed): void {
    if (!item.application_id || !this.canViewContact(item) || this.contactLoading()[item.application_id] || this.contacts()[item.application_id]) return;
    const id = item.application_id;
    this.contactLoading.update((map) => ({ ...map, [id]: true }));
    this.contactErrors.update((map) => ({ ...map, [id]: '' }));
    this.engagement.getApplicationContact(id).pipe(finalize(() => this.contactLoading.update((map) => ({ ...map, [id]: false })))).subscribe({
      next: (response) => this.contacts.update((map) => ({ ...map, [id]: response.data })),
      error: (error: unknown) => this.contactErrors.update((map) => ({ ...map, [id]: getApiErrorMessages(error, 'Unable to load organization contact details.')[0] })),
    });
  }
}

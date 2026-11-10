import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../../../core/auth/auth.service';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { Need } from '../../../../core/needs/need.models';
import { NeedsService } from '../../../../core/needs/needs.service';
import { Contribution, ContributionInput, EngagementContact, VolunteerApplicationStatus, volunteerApplicationStatusLabel } from '../../../../core/needs/need-engagement.models';
import { NeedEngagementService } from '../../../../core/needs/need-engagement.service';
import { ProfileService } from '../../../../core/profiles/profile.service';
import { NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';

@Component({
  selector: 'app-need-detail-page',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './need-detail-page.html',
})
export class NeedDetailPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly errors = signal<string[]>([]);
  protected readonly need = signal<Need | null>(null);
  protected readonly isOwner = signal(false);
  protected readonly canEdit = signal(false);
  protected readonly contributionSaving = signal(false);
  protected readonly applicationSaving = signal(false);
  protected readonly applicationStatusLoading = signal(false);
  protected readonly applicationStatusErrors = signal<string[]>([]);
  protected readonly contributionErrors = signal<string[]>([]);
  protected readonly applicationErrors = signal<string[]>([]);
  protected readonly contributionResult = signal<Contribution | null>(null);
  protected readonly applicationStatus = signal<VolunteerApplicationStatus | null>(null);
  protected readonly applicationId = signal<string | null>(null);
  protected readonly applicationContact = signal<EngagementContact | null>(null);
  protected readonly contactLoading = signal(false);
  protected readonly contactErrors = signal<string[]>([]);
  protected readonly currentUser = inject(AuthService).currentUser;
  protected readonly individualWorkspace = inject(Router).url.startsWith('/individual');
  protected readonly ngoWorkspace = inject(Router).url.startsWith('/ngo');
  protected readonly contributionForm = new FormGroup({
    description: new FormControl('', { nonNullable: true }),
    quantity: new FormControl('', { nonNullable: true }),
  });
  protected readonly applicationForm = new FormGroup({
    message: new FormControl('', { nonNullable: true }),
  });

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly needs = inject(NeedsService);
  private readonly engagement = inject(NeedEngagementService);
  private readonly profiles = inject(ProfileService);
  private readonly ngoNeeds = inject(NgoWorkspaceService);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      this.errors.set(['Need not found.']);
      return;
    }
    const request = this.ngoWorkspace ? this.ngoNeeds.getNeed(id) : this.needs.getNeed(id);
    request.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => {
        this.need.set(response.data);
        this.configureContributionValidation(response.data);
        if (this.isIndividual() && response.data.contribution_type === 'VOLUNTEER') {
          this.loadMyApplicationStatus(response.data.need_id);
        }
        if (this.currentUser()?.role === 'NGO') {
          this.profiles.getNgoProfile().subscribe({
            next: (profile) => {
              const isOwner = profile.data.ngo_id === response.data.ngo_id;
              this.isOwner.set(isOwner);
              this.canEdit.set(isOwner && (response.data.status === 'DRAFT'
                || (profile.data.verification_status === 'APPROVED' && response.data.status === 'ACTIVE')));
            },
          });
        }
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load this need.')),
    });
  }

  protected isIndividual(): boolean {
    return this.currentUser()?.role === 'INDIVIDUAL';
  }

  protected canSubmitContribution(): boolean {
    const item = this.need();
    return Boolean(item && ['MATERIAL', 'SKILL'].includes(item.contribution_type)
      && ['ACTIVE', 'PARTIALLY_FULFILLED'].includes(item.status));
  }

  protected externalNgoWebsite(): string | null {
    const raw = this.need()?.ngo_website_url;
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  protected canApply(): boolean {
    const item = this.need();
    return Boolean(item?.contribution_type === 'VOLUNTEER' && item.status === 'ACTIVE'
      && !this.applicationStatusLoading() && !this.applicationStatusErrors().length
      && !this.applicationStatus());
  }

  protected applicationStatusLabel(status: VolunteerApplicationStatus): string {
    return volunteerApplicationStatusLabel(status);
  }

  protected submitContribution(): void {
    const item = this.need();
    if (!item || this.contributionSaving()) return;
    this.contributionErrors.set([]);
    this.contributionResult.set(null);
    if (this.contributionForm.invalid) {
      this.contributionForm.markAllAsTouched();
      return;
    }

    const values = this.contributionForm.getRawValue();
    const input: ContributionInput = {
      contributionType: item.contribution_type as ContributionInput['contributionType'],
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
    };
    if (item.contribution_type === 'MATERIAL') input.quantity = Number(values.quantity);

    this.contributionSaving.set(true);
    this.engagement.submitContribution(item.need_id, input)
      .pipe(finalize(() => this.contributionSaving.set(false)))
      .subscribe({
        next: (response) => {
          this.contributionResult.set(response.data);
          this.contributionForm.reset({ description: '', quantity: '' });
        },
        error: (error: unknown) => this.contributionErrors.set(getApiErrorMessages(
          error, 'Unable to submit your contribution.',
        )),
      });
  }

  protected submitApplication(): void {
    const item = this.need();
    if (!item || this.applicationSaving()) return;
    this.applicationErrors.set([]);
    if (!this.canApply()) return;
    this.applicationSaving.set(true);
    const message = this.applicationForm.controls.message.value.trim();
    this.engagement.applyToNeed(item.need_id, message ? { message } : {})
      .pipe(finalize(() => this.applicationSaving.set(false)))
      .subscribe({
        next: (response) => {
          this.applicationStatus.set(response.data.status);
          this.applicationId.set(response.data.application_id);
          if (['ACCEPTED', 'COMPLETED'].includes(response.data.status)) {
            this.loadApplicationContact(response.data.application_id);
          }
          this.applicationForm.reset({ message: '' });
        },
        error: (error: unknown) => {
          this.applicationErrors.set(getApiErrorMessages(error, 'Unable to submit your application.'));
          if (error instanceof HttpErrorResponse && error.status === 409) {
            this.loadMyApplicationStatus(item.need_id);
          }
        },
      });
  }

  private loadMyApplicationStatus(needId: string): void {
    this.applicationStatusLoading.set(true);
    this.applicationStatusErrors.set([]);
    this.engagement.listMyApplicationStatuses()
      .pipe(finalize(() => this.applicationStatusLoading.set(false)))
      .subscribe({
        next: (response) => {
          const existing = response.data.find((application) => application.need_id === needId);
          this.applicationStatus.set(existing?.status ?? null);
          this.applicationId.set(existing?.application_id ?? null);
          if (existing && ['ACCEPTED', 'COMPLETED'].includes(existing.status)) this.loadApplicationContact(existing.application_id);
        },
        error: (error: unknown) => this.applicationStatusErrors.set(getApiErrorMessages(
          error, 'Unable to check whether you have already applied. Reload before applying.',
        )),
      });
  }

  protected quantityInvalid(): boolean {
    const control = this.contributionForm.controls.quantity;
    return control.touched && (!/^\d+$/.test(control.value) || Number(control.value) < 1 || Number(control.value) > 2147483647);
  }

  private configureContributionValidation(need: Need): void {
    if (need.contribution_type === 'MATERIAL') {
      this.contributionForm.controls.quantity.setValidators([Validators.required, Validators.pattern(/^\d+$/), Validators.min(1), Validators.max(2147483647)]);
    }
    this.contributionForm.updateValueAndValidity();
  }

  private loadApplicationContact(applicationId: string): void {
    this.contactLoading.set(true);
    this.contactErrors.set([]);
    this.engagement.getApplicationContact(applicationId)
      .pipe(finalize(() => this.contactLoading.set(false)))
      .subscribe({
        next: (response) => this.applicationContact.set(response.data),
        error: (error: unknown) => this.contactErrors.set(getApiErrorMessages(error, 'Unable to load accepted engagement contact details.')),
      });
  }
}

import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, finalize, map, of, switchMap } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import { AuthService } from '../../../../core/auth/auth.service';
import { CauseOption, ContributionType, EditableNeedStatus, Need, NeedInput, NeedPriority } from '../../../../core/needs/need.models';
import { NeedsService } from '../../../../core/needs/needs.service';
import { ProfileService } from '../../../../core/profiles/profile.service';
import { NgoVerificationStatus } from '../../../../core/verification/verification.models';
import { NgoWorkspaceService } from '../../../../core/ngo/ngo-workspace.service';

@Component({
  selector: 'app-need-editor-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './need-editor-page.html',
})
export class NeedEditorPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly causes = signal<CauseOption[]>([]);
  protected readonly verificationStatus = signal<NgoVerificationStatus | null>(null);
  protected readonly editingNeed = signal<Need | null>(null);
  protected readonly minDeadline = this.localDateTime(new Date());
  protected readonly types: ContributionType[] = ['VOLUNTEER', 'MATERIAL', 'MONEY', 'SKILL'];
  protected readonly priorities: NeedPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  protected readonly form = new FormGroup({
    causeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(150)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    contributionType: new FormControl<ContributionType>('VOLUNTEER', { nonNullable: true, validators: [Validators.required] }),
    location: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(150)] }),
    quantityRequired: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^\d+$/), Validators.min(1)] }),
    priority: new FormControl<NeedPriority>('MEDIUM', { nonNullable: true, validators: [Validators.required] }),
    deadline: new FormControl('', { nonNullable: true }),
    status: new FormControl<EditableNeedStatus>('DRAFT', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileService);
  private readonly service = inject(NeedsService);
  private readonly ngoWorkspace = inject(NgoWorkspaceService);
  private readonly editId = this.route.snapshot.paramMap.get('id');
  private readonly navigationNeed = (globalThis.history?.state?.need ?? null) as Need | null;

  get isEditing(): boolean {
    return Boolean(this.editId);
  }

  protected isNgoWorkspace(): boolean {
    return this.router.url.startsWith('/ngo');
  }

  ngOnInit(): void {
    const shared = {
      profile: this.profiles.getNgoProfile(),
      causes: this.service.listCauses(),
    };
    const request = forkJoin(shared).pipe(switchMap((result) => {
      if (!this.editId) return of({ ...result, need: null as null | { data: Need } });
      if (this.navigationNeed?.need_id === this.editId) {
        return of({ ...result, need: { data: this.navigationNeed } });
      }
      const ownedNeed = this.isNgoWorkspace()
        ? this.ngoWorkspace.getNeed(this.editId)
        : this.service.getNeed(this.editId);
      return ownedNeed.pipe(map((need) => ({ ...result, need })));
    }));

    request.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ profile, causes, need }) => {
        this.verificationStatus.set(profile.data.verification_status);
        this.causes.set(causes.data);
        if (need) {
          if (need.data.ngo_id !== profile.data.ngo_id) {
            this.errors.set(['You can edit only needs owned by your NGO.']);
            return;
          }
          if (need.data.status !== 'ACTIVE' && need.data.status !== 'DRAFT') {
            this.errors.set(['This need is not editable in its current status.']);
            return;
          }
          if (need.data.status === 'ACTIVE' && profile.data.verification_status !== 'APPROVED') {
            this.errors.set(['Your NGO must be approved to edit an ACTIVE need.']);
            return;
          }
          this.editingNeed.set(need.data);
          this.form.reset({
            causeId: need.data.cause_id,
            title: need.data.title,
            description: need.data.description,
            contributionType: need.data.contribution_type,
            location: need.data.location ?? '',
            quantityRequired: need.data.quantity_required === null ? '' : String(need.data.quantity_required),
            priority: need.data.priority,
            deadline: need.data.deadline ? this.localDateTime(new Date(need.data.deadline)) : '',
            status: need.data.status,
          });
        }
        if (globalThis.history?.state?.createdDraft) {
          this.notice.set('Draft saved. You can edit it here; draft details are not available from the public need endpoint.');
        }
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load the need editor.')),
    });
  }

  protected save(): void {
    this.errors.set([]);
    if (this.form.invalid || this.saving() || !this.causes().length) {
      this.form.markAllAsTouched();
      return;
    }
    const values = this.form.getRawValue();
    const nextStatus = this.isEditing && this.editingNeed()?.status === 'ACTIVE'
      ? 'ACTIVE'
      : values.status;
    if (nextStatus === 'ACTIVE' && (!this.editingNeed() || this.editingNeed()?.status !== 'ACTIVE')
        && !globalThis.confirm('Publish this need now? It will become visible to eligible individuals.')) return;
    const input: NeedInput = {
      causeId: values.causeId,
      title: values.title.trim(),
      description: values.description.trim(),
      contributionType: values.contributionType,
      location: values.location.trim() || null,
      availability: this.editingNeed()?.availability ?? null,
      quantityRequired: values.quantityRequired ? Number(values.quantityRequired) : null,
      priority: values.priority,
      deadline: values.deadline ? new Date(values.deadline).toISOString() : null,
      status: nextStatus as EditableNeedStatus,
    };

    this.saving.set(true);
    const request = this.isEditing
      ? this.service.updateNeed(this.editId!, input)
      : this.service.createNeed(input);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (response) => {
        if (response.data.status === 'DRAFT') {
          if (!this.isEditing) {
            void this.router.navigate(this.needRoute(response.data.need_id, 'edit'), {
              state: { need: response.data, createdDraft: true },
            });
          } else {
            this.editingNeed.set(response.data);
            this.notice.set('Draft saved. Drafts are not publicly listed.');
          }
          return;
        }
        void this.router.navigate(this.needRoute(response.data.need_id, 'detail'));
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to save this need.')),
    });
  }

  protected fieldInvalid(field: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[field];
    return control.invalid && control.touched;
  }

  private localDateTime(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  private needRoute(needId: string, destination: 'edit' | 'detail'): string[] {
    if (this.isNgoWorkspace()) return destination === 'edit'
      ? ['/ngo', 'needs', needId, 'edit']
      : ['/ngo', 'needs', needId];
    return destination === 'edit'
      ? ['/needs', 'manage', needId, 'edit']
      : ['/needs', needId];
  }
}

import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';

import { AuthService } from '../../../../core/auth/auth.service';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { IndividualProfile, NgoProfile, NgoProfileInput } from '../../../../core/profiles/profile.models';
import { ProfileService } from '../../../../core/profiles/profile.service';
import { CatalogItem, IndividualPreferences, PreferenceService, SelectedSkill } from '../../../../core/profiles/preference.service';

@Component({
  selector: 'app-profile-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './profile-page.html',
})
export class ProfilePage implements OnInit {
  protected readonly role = inject(AuthService).currentUser()?.role;
  private readonly auth = inject(AuthService);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly individualProfile = signal<IndividualProfile | null>(null);
  protected readonly ngoProfile = signal<NgoProfile | null>(null);
  protected readonly preferences = signal<IndividualPreferences>({ causes: [], skills: [] });
  protected readonly causeOptions = signal<CatalogItem[]>([]);
  protected readonly skillOptions = signal<CatalogItem[]>([]);
  protected readonly preferenceErrors = signal<string[]>([]);
  protected readonly preferenceLoading = signal(true);
  protected readonly causeToAdd = signal('');
  protected readonly skillToAdd = signal('');
  protected readonly proficiencyToAdd = signal<SelectedSkill['proficiency_level']>('BEGINNER');
  protected readonly individualForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] }),
  });
  protected readonly ngoForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(150)] }),
    description: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(150)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20)] }),
    address: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    websiteUrl: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(255), Validators.pattern(/^https?:\/\/[^\s]+$/i)],
    }),
  });

  private readonly profiles = inject(ProfileService);
  private readonly preferenceService = inject(PreferenceService);

  ngOnInit(): void {
    if (this.role === 'NGO') this.loadNgoProfile();
    else this.loadIndividualProfile();
  }

  protected loadIndividualProfile(): void {
    this.loading.set(true);
    this.errors.set([]);
    this.profiles.getIndividualProfile().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => {
        this.individualProfile.set(response.data);
        this.individualForm.reset({ name: response.data.name, phone: response.data.phone ?? '', city: response.data.city ?? '' });
        this.loadPreferences();
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load your profile.')),
    });
  }

  protected saveIndividualProfile(): void {
    this.errors.set([]); this.notice.set('');
    if (this.individualForm.invalid || this.saving()) { this.individualForm.markAllAsTouched(); return; }
    const value = this.individualForm.getRawValue();
    const availability = this.individualProfile()?.availability ?? null;
    this.saving.set(true);
    this.profiles.updateIndividualProfile({ name: value.name.trim(), phone: value.phone.trim() || null, city: value.city.trim() || null, availability })
      .pipe(finalize(() => this.saving.set(false))).subscribe({
        next: (response) => { this.individualProfile.set(response.data); this.auth.syncIndividualProfile(response.data); this.individualForm.reset({ name: response.data.name, phone: response.data.phone ?? '', city: response.data.city ?? '' }); this.notice.set('Your profile has been updated.'); },
        error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to update your profile.')),
      });
  }

  private loadPreferences(): void {
    this.preferenceLoading.set(true);
    this.preferenceErrors.set([]);
    forkJoin({ preferences: this.preferenceService.get(), causes: this.preferenceService.causes(), skills: this.preferenceService.skills() })
      .pipe(finalize(() => this.preferenceLoading.set(false))).subscribe({
        next: ({ preferences, causes, skills }) => {
          this.preferences.set(preferences.data);
          this.causeOptions.set(causes.data.filter((item) => item.is_active));
          this.skillOptions.set(skills.data.filter((item) => item.is_active));
        },
        error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to load your preferences.')),
      });
  }

  protected addCause(): void {
    const id = this.causeToAdd(); if (!id) return;
    this.preferenceService.addCause(id).subscribe({ next: () => { this.causeToAdd.set(''); this.loadPreferences(); }, error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to add this cause.')) });
  }
  protected removeCause(id: string): void { this.preferenceService.removeCause(id).subscribe({ next: () => this.loadPreferences(), error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to remove this cause.')) }); }
  protected isCauseSelected(id?: string): boolean { return Boolean(id && this.preferences().causes.some((item) => item.cause_id === id)); }
  protected isSkillSelected(id?: string): boolean { return Boolean(id && this.preferences().skills.some((item) => item.skill_id === id)); }
  protected addSkill(): void {
    const id = this.skillToAdd(); if (!id) return;
    this.preferenceService.addSkill(id, this.proficiencyToAdd()).subscribe({ next: () => { this.skillToAdd.set(''); this.loadPreferences(); }, error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to add this skill.')) });
  }
  protected updateSkillProficiency(skill: SelectedSkill, level: SelectedSkill['proficiency_level']): void { this.preferenceService.updateSkill(skill.skill_id, level).subscribe({ next: () => this.loadPreferences(), error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to update skill proficiency.')) }); }
  protected removeSkill(id: string): void { this.preferenceService.removeSkill(id).subscribe({ next: () => this.loadPreferences(), error: (error: unknown) => this.preferenceErrors.set(getApiErrorMessages(error, 'Unable to remove this skill.')) }); }

  protected loadNgoProfile(): void {
    this.loading.set(true);
    this.errors.set([]);
    this.profiles.getNgoProfile().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => {
        this.ngoProfile.set(response.data);
        this.patchNgoForm(response.data);
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.ngoProfile.set(null);
          this.ngoForm.reset({ name: '', description: '', email: '', phone: '', address: '', city: '', websiteUrl: '' });
          return;
        }
        this.errors.set(getApiErrorMessages(error, 'Unable to load your NGO profile.'));
      },
    });
  }

  protected saveNgoProfile(): void {
    this.errors.set([]);
    this.notice.set('');
    if (this.ngoForm.invalid || this.saving()) {
      this.ngoForm.markAllAsTouched();
      return;
    }

    const values = this.ngoForm.getRawValue();
    const input: NgoProfileInput = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      email: values.email.trim(),
      phone: values.phone.trim() || null,
      address: values.address.trim() || null,
      city: values.city.trim(),
      websiteUrl: values.websiteUrl.trim() || null,
    };
    const creating = !this.ngoProfile();
    this.saving.set(true);
    const request = creating ? this.profiles.createNgoProfile(input) : this.profiles.updateNgoProfile(input);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (response) => {
        this.ngoProfile.set(response.data);
        this.patchNgoForm(response.data);
        this.notice.set(creating ? 'NGO profile created. Complete verification to submit it for review.' : 'NGO profile updated.');
      },
      error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to save your NGO profile.')),
    });
  }

  protected fieldInvalid(field: keyof typeof this.ngoForm.controls): boolean {
    const control = this.ngoForm.controls[field];
    return control.invalid && control.touched;
  }

  private patchNgoForm(profile: NgoProfile): void {
    this.ngoForm.reset({
      name: profile.name,
      description: profile.description ?? '',
      email: profile.email,
      phone: profile.phone ?? '',
      address: profile.address ?? '',
      city: profile.city,
      websiteUrl: profile.website_url ?? '',
    });
  }
}

import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessages } from '../../../../core/http/api-error';
import {
  NgoVerificationData,
  NgoVerificationStatus,
  VerificationFileSelection,
} from '../../../../core/verification/verification.models';
import { VerificationService } from '../../../../core/verification/verification.service';

export const MAX_VERIFICATION_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_SUPPORTING_DOCUMENTS = 10;

const allowedMimeByExtension: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg', 'image/jpg'],
  '.jpeg': ['image/jpeg', 'image/jpg'],
  '.png': ['image/png'],
};

export const canSubmitVerification = (status: NgoVerificationStatus): boolean =>
  status === 'NOT_SUBMITTED' || status === 'NEEDS_INFO' || status === 'REJECTED';

export const validateVerificationSelection = (files: VerificationFileSelection): string[] => {
  const errors: string[] = [];
  if (!files.registrationCertificate) errors.push('A registration certificate is required.');
  if (files.supportingDocuments.length > MAX_SUPPORTING_DOCUMENTS) {
    errors.push(`Choose no more than ${MAX_SUPPORTING_DOCUMENTS} supporting documents.`);
  }

  const selected: Array<{ label: string; file: File }> = [];
  if (files.registrationCertificate) selected.push({ label: 'Registration certificate', file: files.registrationCertificate });
  if (files.pan) selected.push({ label: 'PAN document', file: files.pan });
  if (files.ngoDarpan) selected.push({ label: 'NGO Darpan document', file: files.ngoDarpan });
  files.supportingDocuments.forEach((file, index) => selected.push({ label: `Supporting document ${index + 1}`, file }));

  for (const { label, file } of selected) {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const allowedMimes = allowedMimeByExtension[extension];
    if (!allowedMimes || !allowedMimes.includes(file.type.toLowerCase())) {
      errors.push(`${label} must be a PDF, JPG/JPEG, or PNG file.`);
    }
    if (file.size === 0) errors.push(`${label} must not be empty.`);
    if (file.size > MAX_VERIFICATION_FILE_SIZE) errors.push(`${label} must be no larger than 5 MiB.`);
  }
  return errors;
};

export const toVerificationFormData = (files: VerificationFileSelection): FormData => {
  const formData = new FormData();
  if (files.registrationCertificate) formData.append('registrationCertificate', files.registrationCertificate);
  if (files.pan) formData.append('pan', files.pan);
  if (files.ngoDarpan) formData.append('ngoDarpan', files.ngoDarpan);
  for (const file of files.supportingDocuments) formData.append('supportingDocuments', file);
  return formData;
};

const emptySelection = (): VerificationFileSelection => ({
  registrationCertificate: null,
  pan: null,
  ngoDarpan: null,
  supportingDocuments: [],
});

@Component({
  selector: 'app-verification-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './verification-page.html',
})
export class VerificationPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly profileMissing = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected readonly validationErrors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly verification = signal<NgoVerificationData | null>(null);
  protected readonly files = signal<VerificationFileSelection>(emptySelection());
  private readonly hasInteractedWithFiles = signal(false);
  protected readonly canSubmit = computed(() => {
    const status = this.verification()?.ngo.verification_status;
    return !!status && canSubmitVerification(status);
  });

  private readonly service = inject(VerificationService);

  ngOnInit(): void {
    this.loadVerification();
  }

  protected loadVerification(): void {
    this.loading.set(true);
    this.errors.set([]);
    this.profileMissing.set(false);
    this.service.getMyVerification()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.verification.set(response.data),
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.profileMissing.set(true);
            this.verification.set(null);
            return;
          }
          this.errors.set(getApiErrorMessages(error, 'Unable to load your verification status.'));
        },
      });
  }

  protected selectSingleFile(field: 'registrationCertificate' | 'pan' | 'ngoDarpan', event: Event): void {
    this.hasInteractedWithFiles.set(true);
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    this.files.update((selected) => ({ ...selected, [field]: file }));
    this.updateValidationErrors();
  }

  protected selectSupportingFiles(event: Event): void {
    this.hasInteractedWithFiles.set(true);
    const input = event.target as HTMLInputElement;
    const addedFiles = input.files ? Array.from(input.files) : [];
    this.files.update((selected) => ({
      ...selected,
      supportingDocuments: [...selected.supportingDocuments, ...addedFiles],
    }));
    input.value = '';
    this.updateValidationErrors();
  }

  protected removeSingleFile(field: 'registrationCertificate' | 'pan' | 'ngoDarpan'): void {
    this.hasInteractedWithFiles.set(true);
    this.files.update((selected) => ({ ...selected, [field]: null }));
    this.updateValidationErrors();
  }

  protected removeSupportingFile(index: number): void {
    this.hasInteractedWithFiles.set(true);
    this.files.update((selected) => ({
      ...selected,
      supportingDocuments: selected.supportingDocuments.filter((_, itemIndex) => itemIndex !== index),
    }));
    this.updateValidationErrors();
  }

  protected submit(): void {
    this.notice.set('');
    this.errors.set([]);
    const selected = this.files();
    const validation = validateVerificationSelection(selected);
    this.validationErrors.set(validation);
    if (validation.length || !this.canSubmit() || this.submitting()) return;

    this.submitting.set(true);
    this.service.submitDocuments(toVerificationFormData(selected))
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.notice.set('Your verification documents were submitted successfully.');
          this.files.set(emptySelection());
          this.validationErrors.set([]);
          this.loadVerification();
        },
        error: (error: unknown) => this.errors.set(
          getApiErrorMessages(error, 'Unable to submit your verification documents.'),
        ),
      });
  }

  protected statusLabel(status: NgoVerificationStatus): string {
    const labels: Record<NgoVerificationStatus, string> = {
      NOT_SUBMITTED: 'Not submitted',
      PENDING: 'Pending review',
      NEEDS_INFO: 'More information needed',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
    };
    return labels[status];
  }

  protected statusClass(status: NgoVerificationStatus): string {
    const classes: Record<NgoVerificationStatus, string> = {
      NOT_SUBMITTED: 'bg-[#edf2ec] text-[#52645a]',
      PENDING: 'bg-[#fbf5e6] text-[#715e37]',
      NEEDS_INFO: 'bg-[#fff2dc] text-[#805a1d]',
      APPROVED: 'bg-[#e6f3e6] text-[#285b46]',
      REJECTED: 'bg-[#fff0ed] text-[#8e342d]',
    };
    return classes[status];
  }

  protected formatDocumentType(type: string): string {
    const labels: Record<string, string> = {
      REGISTRATION_CERTIFICATE: 'Registration certificate',
      PAN: 'PAN',
      NGO_DARPAN: 'NGO Darpan',
      SUPPORTING_DOCUMENT: 'Supporting document',
    };
    return labels[type] ?? type;
  }

  private updateValidationErrors(): void {
    const selected = this.files();
    const hasAnyFile = Boolean(
      selected.registrationCertificate || selected.pan || selected.ngoDarpan || selected.supportingDocuments.length,
    );
    this.validationErrors.set(hasAnyFile || this.hasInteractedWithFiles()
      ? validateVerificationSelection(selected)
      : []);
  }
}

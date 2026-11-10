import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AdminService } from '../../../../core/admin/admin.service';
import { AdminVerificationDecision } from '../../../../core/admin/admin.models';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { NgoVerificationData, VerificationDocumentMetadata } from '../../../../core/verification/verification.models';

@Component({
  selector: 'app-ngo-verification-review-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './ngo-verification-review-page.html',
})
export class NgoVerificationReviewPage implements OnInit, OnDestroy {
  protected readonly loading = signal(true);
  protected readonly savingDecision = signal(false);
  protected readonly downloadingDocumentId = signal<string | null>(null);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly verification = signal<NgoVerificationData | null>(null);
  protected readonly confirmation = signal<AdminVerificationDecision | null>(null);
  protected readonly decisionMessage = signal('');
  protected readonly canReview = computed(() => {
    const record = this.verification();
    return record?.ngo.verification_status === 'PENDING'
      && record.currentSubmission?.status === 'PENDING';
  });

  private readonly route = inject(ActivatedRoute);
  private readonly admin = inject(AdminService);
  private readonly objectUrls = new Set<string>();
  private readonly objectUrlTimers = new Map<string, number>();
  private readonly ngoId = this.route.snapshot.paramMap.get('ngoId');

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    for (const [objectUrl, timer] of this.objectUrlTimers) window.clearTimeout(timer);
    this.objectUrlTimers.clear();
    for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl);
    this.objectUrls.clear();
  }

  protected load(): void {
    if (!this.ngoId) {
      this.loading.set(false);
      this.errors.set(['The NGO verification route is missing an NGO ID.']);
      return;
    }
    this.loading.set(true);
    this.errors.set([]);
    this.admin.getNgoVerification(this.ngoId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.verification.set(response.data),
        error: (error: unknown) => this.errors.set(
          getApiErrorMessages(error, 'Unable to load this NGO verification record.'),
        ),
      });
  }

  protected requestDecision(decision: AdminVerificationDecision): void {
    if (!this.canReview() || this.savingDecision()) return;
    this.errors.set([]);
    this.notice.set('');
    this.decisionMessage.set('');
    this.confirmation.set(decision);
  }

  protected cancelDecision(): void {
    if (this.savingDecision()) return;
    this.confirmation.set(null);
    this.decisionMessage.set('');
    this.errors.set([]);
  }

  protected confirmDecision(): void {
    const decision = this.confirmation();
    if (!decision || this.savingDecision() || !this.canReview() || !this.ngoId) return;
    const message = this.decisionMessage().trim();
    if (decision !== 'APPROVED' && !message) {
      this.errors.set(['Enter a meaningful message for rejection or an information request.']);
      return;
    }

    this.savingDecision.set(true);
    this.errors.set([]);
    const request = decision === 'APPROVED'
      ? this.admin.approveNgoVerification(this.ngoId, message)
      : decision === 'REJECTED'
        ? this.admin.rejectNgoVerification(this.ngoId, message)
        : this.admin.requestNgoVerificationInformation(this.ngoId, message);

    request.pipe(finalize(() => this.savingDecision.set(false))).subscribe({
      next: () => {
        this.confirmation.set(null);
        this.decisionMessage.set('');
        this.notice.set(this.decisionSuccessMessage(decision));
        this.load();
      },
      error: (error: unknown) => this.errors.set(
        getApiErrorMessages(error, 'Unable to save the verification decision.'),
      ),
    });
  }

  protected downloadDocument(document: VerificationDocumentMetadata): void {
    if (!this.ngoId || this.downloadingDocumentId()) return;
    this.downloadingDocumentId.set(document.document_id);
    this.errors.set([]);
    this.admin.downloadVerificationDocument(this.ngoId, document.document_id)
      .pipe(finalize(() => this.downloadingDocumentId.set(null)))
      .subscribe({
        next: (blob) => {
          try {
            const objectUrl = URL.createObjectURL(blob);
            this.objectUrls.add(objectUrl);
            const anchor = globalThis.document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = document.original_filename;
            anchor.rel = 'noopener';
            anchor.hidden = true;
            globalThis.document.body.append(anchor);
            anchor.click();
            anchor.remove();
            const timer = window.setTimeout(() => {
              URL.revokeObjectURL(objectUrl);
              this.objectUrls.delete(objectUrl);
              this.objectUrlTimers.delete(objectUrl);
            }, 30_000);
            this.objectUrlTimers.set(objectUrl, timer);
            this.notice.set(`Downloaded ${document.original_filename}.`);
          } catch {
            this.errors.set(['The private document could not be opened for download.']);
          }
        },
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.errors.set(['This document is no longer available for this NGO.']);
          } else if (error instanceof HttpErrorResponse && error.status === 403) {
            this.errors.set(['You do not have permission to access this document.']);
          } else {
            this.errors.set(getApiErrorMessages(error, 'Unable to retrieve this private document.'));
          }
        },
      });
  }

  protected decisionTitle(decision: AdminVerificationDecision): string {
    if (decision === 'NEEDS_INFO') return 'Request additional information';
    return decision === 'APPROVED' ? 'Approve NGO' : 'Reject NGO';
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

  private decisionSuccessMessage(decision: AdminVerificationDecision): string {
    if (decision === 'NEEDS_INFO') return 'Additional information requested.';
    return decision === 'APPROVED' ? 'NGO verification approved.' : 'NGO verification rejected.';
  }
}

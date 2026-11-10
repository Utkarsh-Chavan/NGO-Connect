import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AdminService } from '../../../../core/admin/admin.service';
import { NgoVerificationDecision, PendingNgo } from '../../../../core/admin/admin.models';
import { getApiErrorMessages } from '../../../../core/http/api-error';

@Component({
  selector: 'app-pending-ngos-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './pending-ngos-page.html',
})
export class PendingNgosPage implements OnInit {
  protected readonly loading = signal(true);
  protected readonly savingNgoId = signal<string | null>(null);
  protected readonly errors = signal<string[]>([]);
  protected readonly notice = signal('');
  protected readonly ngos = signal<PendingNgo[]>([]);
  protected readonly offset = signal(0);
  protected readonly limit = 12;
  protected readonly confirmation = signal<{ ngoId: string; decision: NgoVerificationDecision } | null>(null);
  protected readonly decisionMessage = signal('');

  private readonly service = inject(AdminService);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.errors.set([]);
    this.service.listPendingNgos(this.limit, this.offset())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.ngos.set(response.data.items),
        error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to load pending NGO profiles.')),
      });
  }

  protected requestDecision(ngoId: string, decision: NgoVerificationDecision): void {
    this.notice.set('');
    this.errors.set([]);
    this.decisionMessage.set('');
    this.confirmation.set({ ngoId, decision });
  }

  protected cancelDecision(): void {
    this.confirmation.set(null);
    this.decisionMessage.set('');
  }

  protected confirmDecision(): void {
    const pending = this.confirmation();
    if (!pending) return;
    const message = this.decisionMessage().trim();
    if (pending.decision === 'REJECTED' && !message) {
      this.errors.set(['Enter a meaningful rejection message.']);
      return;
    }
    this.savingNgoId.set(pending.ngoId);
    this.errors.set([]);
    this.service.decideNgoVerification(pending.ngoId, pending.decision, message)
      .pipe(finalize(() => this.savingNgoId.set(null)))
      .subscribe({
        next: () => {
          this.confirmation.set(null);
          this.decisionMessage.set('');
          this.notice.set(`NGO profile ${pending.decision.toLowerCase()} successfully.`);
          this.load();
        },
        error: (error: unknown) => this.errors.set(getApiErrorMessages(error, 'Unable to save this verification decision.')),
      });
  }

  protected nextPage(): void {
    if (this.ngos().length < this.limit) return;
    this.offset.update((value) => value + this.limit);
    this.confirmation.set(null);
    this.load();
  }

  protected previousPage(): void {
    this.offset.update((value) => Math.max(0, value - this.limit));
    this.confirmation.set(null);
    this.load();
  }
}

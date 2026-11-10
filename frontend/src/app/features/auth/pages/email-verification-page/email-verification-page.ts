import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/auth/auth.service';

type VerificationState = 'loading' | 'success' | 'invalid' | 'missing' | 'error';

@Component({
  selector: 'app-email-verification-page',
  imports: [RouterLink],
  templateUrl: './email-verification-page.html',
})
export class EmailVerificationPage implements OnInit {
  protected readonly state = signal<VerificationState>('loading');
  protected readonly manualLink = signal('');

  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  ngOnInit(): void {
    const token = this.tokenFromFragment(this.route.snapshot.fragment);
    this.removeFragmentFromAddress();
    if (!token) {
      this.state.set('missing');
      return;
    }
    this.verify(token);
  }

  protected updateManualLink(value: string): void {
    this.manualLink.set(value);
  }

  protected submitManualLink(): void {
    const token = this.tokenFromManualInput(this.manualLink());
    this.manualLink.set('');
    if (!token) {
      this.state.set('invalid');
      return;
    }
    this.verify(token);
  }

  private verify(token: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      this.state.set('invalid');
      return;
    }

    this.state.set('loading');
    this.auth.verifyEmail(token)
      .pipe(finalize(() => {
        if (this.state() === 'loading') this.state.set('error');
      }))
      .subscribe({
        next: () => this.state.set('success'),
        error: (error: unknown) => {
          this.state.set(error instanceof HttpErrorResponse && error.status === 400 ? 'invalid' : 'error');
        },
      });
  }

  private tokenFromFragment(fragment: string | null): string | null {
    if (!fragment) return null;
    const token = new URLSearchParams(fragment).get('token');
    return token || null;
  }

  private tokenFromManualInput(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      if (trimmed.includes('#')) {
        const parsed = new URL(trimmed, globalThis.location?.origin ?? 'http://localhost');
        return this.tokenFromFragment(parsed.hash.slice(1));
      }
    } catch {
      return null;
    }
    if (trimmed.startsWith('token=')) return new URLSearchParams(trimmed).get('token');
    return trimmed;
  }

  private removeFragmentFromAddress(): void {
    const cleanPath = this.router.url.split('#')[0] || '/verify-email';
    this.location.replaceState(cleanPath);
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/auth/auth.service';
import { authenticatedHomeRoute } from '../../../../core/auth/auth.models';
import { getApiErrorMessages } from '../../../../core/http/api-error';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
})
export class LoginPage {
  protected readonly localDevelopment = !environment.production;
  protected passwordVisible = false;
  protected readonly submitting = signal(false);
  protected readonly apiErrors = signal<string[]>([]);
  protected readonly emailVerificationRequired = signal(false);
  protected readonly resendingVerification = signal(false);
  protected readonly resendNotice = signal('');
  protected readonly resendErrors = signal<string[]>([]);
  protected readonly registrationNotice = inject(ActivatedRoute).snapshot.queryParamMap.has('registered')
    ? 'Your account has been created. Sign in to continue.'
    : '';

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loginForm = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(150)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  constructor() {
    this.loginForm.valueChanges.subscribe(() => {
      this.apiErrors.set([]);
    });
    this.loginForm.controls.email.valueChanges.subscribe(() => {
      this.emailVerificationRequired.set(false);
      this.resendNotice.set('');
      this.resendErrors.set([]);
    });
  }

  protected get email() {
    return this.loginForm.controls.email;
  }

  protected get password() {
    return this.loginForm.controls.password;
  }

  protected submit(): void {
    this.apiErrors.set([]);
    this.emailVerificationRequired.set(false);
    if (this.loginForm.invalid || this.submitting()) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.auth.login({
      email: this.email.value.trim(),
      password: this.password.value,
    }).pipe(finalize(() => { this.submitting.set(false); })).subscribe({
      next: (response) => {
        const destination = authenticatedHomeRoute(this.auth.currentUser()?.role ?? response.data.user.role);
        void this.router.navigateByUrl(destination);
      },
      error: (error: unknown) => {
        this.emailVerificationRequired.set(
          error instanceof HttpErrorResponse && error.error?.code === 'EMAIL_NOT_VERIFIED',
        );
        this.apiErrors.set(getApiErrorMessages(error, 'Sign in failed. Please try again.'));
      },
    });
  }

  protected resendVerification(): void {
    this.resendNotice.set('');
    this.resendErrors.set([]);
    if (this.email.invalid || !this.email.value.trim()) {
      this.email.markAsTouched();
      this.resendErrors.set(['Enter a valid email address to request a verification link.']);
      return;
    }
    if (this.resendingVerification()) return;

    this.resendingVerification.set(true);
    this.auth.resendVerification(this.email.value.trim())
      .pipe(finalize(() => this.resendingVerification.set(false)))
      .subscribe({
        next: () => this.resendNotice.set(
          'If this address belongs to an eligible unverified account, a verification attempt has been made. In local development, check the backend terminal for the link.',
        ),
        error: (error: unknown) => this.resendErrors.set(
          getApiErrorMessages(error, 'Unable to request a verification link right now.'),
        ),
      });
  }
}

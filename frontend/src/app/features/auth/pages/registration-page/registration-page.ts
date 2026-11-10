import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/auth/auth.service';
import { getApiErrorMessages } from '../../../../core/http/api-error';

type AccountType = 'individual' | 'ngo';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation
    ? { passwordMismatch: true }
    : null;
}

@Component({
  selector: 'app-registration-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registration-page.html',
})
export class RegistrationPage {
  protected passwordVisible = false;
  protected confirmPasswordVisible = false;
  protected readonly submitting = signal(false);
  protected readonly apiErrors = signal<string[]>([]);
  protected readonly registrationComplete = signal<'development' | 'email' | 'failed' | null>(null);

  private readonly auth = inject(AuthService);

  protected readonly registrationForm = new FormGroup(
    {
      accountType: new FormControl<AccountType>('individual', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      fullName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(150)],
      }),
      phone: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(20)],
      }),
      city: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8)],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: [passwordsMatch] },
  );

  constructor() {
    this.registrationForm.valueChanges.subscribe(() => {
      this.apiErrors.set([]);
    });
  }

  protected get accountType() {
    return this.registrationForm.controls.accountType;
  }

  protected control(name: string): AbstractControl {
    return this.registrationForm.get(name)!;
  }

  protected showError(name: string): boolean {
    const field = this.control(name);
    return field.invalid && field.touched;
  }

  protected submit(): void {
    this.apiErrors.set([]);
    if (this.registrationForm.invalid || this.submitting()) {
      this.registrationForm.markAllAsTouched();
      return;
    }

    const values = this.registrationForm.getRawValue();
    this.submitting.set(true);
    this.auth.register({
      name: values.fullName.trim(),
      email: values.email.trim(),
      password: values.password,
      role: values.accountType === 'ngo' ? 'NGO' : 'INDIVIDUAL',
      ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      ...(values.city.trim() ? { city: values.city.trim() } : {}),
    }).pipe(finalize(() => { this.submitting.set(false); })).subscribe({
      next: (response) => {
        this.registrationComplete.set(response.deliveryMode === 'development' ? 'development' : 'email');
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.error?.code === 'EMAIL_DELIVERY_FAILED') {
          this.registrationComplete.set('failed');
          return;
        }
        this.apiErrors.set(getApiErrorMessages(error, 'Account creation failed. Please try again.'));
      },
    });
  }
}

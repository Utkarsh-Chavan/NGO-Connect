import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  ApiResponse,
  AuthUser,
  LoginRequest,
  LoginResponse,
  MessageResponse,
  RegisteredUser,
  RegisterResponse,
  RegisterRequest,
} from './auth.models';
import type { IndividualProfile } from '../profiles/profile.models';

const TOKEN_STORAGE_KEY = 'ngo-connect.access-token';
const USER_STORAGE_KEY = 'ngo-connect.auth-user';
const authUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/auth`;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private memoryToken: string | null = null;
  private readonly userState = signal<AuthUser | null>(this.readStoredUser());

  readonly currentUser = this.userState.asReadonly();
  readonly isAuthenticated = computed(() => {
    // Read the signal unconditionally so an initial unauthenticated check
    // remains reactive when login later updates the user in memory.
    const user = this.userState();
    return Boolean(user && this.getAccessToken());
  });

  register(input: RegisterRequest) {
    return this.http.post<RegisterResponse>(`${authUrl}/register`, input);
  }

  verifyEmail(token: string) {
    return this.http.post<MessageResponse>(`${authUrl}/verify-email`, { token });
  }

  resendVerification(email: string) {
    return this.http.post<MessageResponse>(`${authUrl}/resend-verification`, { email });
  }

  login(input: LoginRequest) {
    return this.http.post<ApiResponse<LoginResponse>>(`${authUrl}/login`, input).pipe(
      tap((response) => this.storeSession(response.data)),
    );
  }

  getAccessToken(): string | null {
    return this.readStorage(TOKEN_STORAGE_KEY) ?? this.memoryToken;
  }

  logout(): void {
    this.memoryToken = null;
    this.removeStorage(TOKEN_STORAGE_KEY);
    this.removeStorage(USER_STORAGE_KEY);
    this.userState.set(null);
  }

  syncIndividualProfile(profile: IndividualProfile): void {
    const user = this.userState();
    if (!user || user.role !== 'INDIVIDUAL' || user.userId !== profile.user_id) return;
    const updated = { ...user, name: profile.name, email: profile.email, phone: profile.phone, city: profile.city, availability: profile.availability };
    this.userState.set(updated);
    this.writeStorage(USER_STORAGE_KEY, JSON.stringify(updated));
  }

  private storeSession(session: LoginResponse): void {
    this.memoryToken = session.token;
    this.writeStorage(TOKEN_STORAGE_KEY, session.token);
    this.writeStorage(USER_STORAGE_KEY, JSON.stringify(session.user));
    this.userState.set(session.user);
  }

  private readStoredUser(): AuthUser | null {
    const token = this.readStorage(TOKEN_STORAGE_KEY);
    const storedUser = this.readStorage(USER_STORAGE_KEY);
    if (!token || !storedUser) {
      this.removeStorage(TOKEN_STORAGE_KEY);
      this.removeStorage(USER_STORAGE_KEY);
      return null;
    }

    try {
      return JSON.parse(storedUser) as AuthUser;
    } catch {
      this.removeStorage(TOKEN_STORAGE_KEY);
      this.removeStorage(USER_STORAGE_KEY);
      return null;
    }
  }

  private readStorage(key: string): string | null {
    try {
      return globalThis.sessionStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      globalThis.sessionStorage?.setItem(key, value);
    } catch {
      // The in-memory session still works when browser storage is unavailable.
    }
  }

  private removeStorage(key: string): void {
    try {
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      // Clearing in-memory state remains possible when browser storage is unavailable.
    }
  }
}

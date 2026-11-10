import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import {
  AdminNgoVerificationResponse,
  AdminVerificationDecision,
  NgoVerificationDecision,
  NgoVerificationResponse,
  PendingNgosResponse,
  AdminDashboard,
  AdminAnalytics,
  AdminNeedDetail,
  AdminPage,
  AdminNeed,
  AdminUser,
  AdminUserDetail,
} from './admin.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');
const queryParams = (filters: object) =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  getDashboard() { return this.http.get<{ success: boolean; message: string; data: AdminDashboard }>(`${apiUrl}/admin/dashboard`); }
  getAnalytics() { return this.http.get<{ success: boolean; message: string; data: AdminAnalytics }>(`${apiUrl}/admin/analytics`); }
  listUsers(filters: { search?: string; role?: string; status?: string; limit?: number; offset?: number }) {
    return this.http.get<{ success: boolean; message: string; data: AdminPage<AdminUser> }>(`${apiUrl}/admin/users`, { params: queryParams(filters) });
  }
  getUser(userId: string) { return this.http.get<{ success: boolean; message: string; data: AdminUserDetail }>(`${apiUrl}/admin/users/${encodeURIComponent(userId)}`); }
  setUserSuspension(userId: string, suspended: boolean, reason: string) {
    return this.http.patch<{ success: boolean; message: string; data: AdminUser }>(`${apiUrl}/admin/users/${encodeURIComponent(userId)}/status`, { suspended, reason });
  }
  listNeeds(filters: { search?: string; status?: string; moderationStatus?: string; contributionType?: string; limit?: number; offset?: number }) {
    return this.http.get<{ success: boolean; message: string; data: AdminPage<AdminNeed> }>(`${apiUrl}/admin/needs`, { params: queryParams(filters) });
  }
  getNeed(needId: string) { return this.http.get<{ success: boolean; message: string; data: AdminNeedDetail }>(`${apiUrl}/admin/needs/${encodeURIComponent(needId)}`); }
  setNeedModeration(needId: string, hidden: boolean, reason: string) {
    return this.http.patch<{ success: boolean; message: string; data: AdminNeed }>(`${apiUrl}/admin/needs/${encodeURIComponent(needId)}/moderation`, { hidden, reason });
  }

  listPendingNgos(limit = 12, offset = 0) {
    return this.http.get<PendingNgosResponse>(`${apiUrl}/admin/ngos/pending`, { params: { limit, offset } });
  }

  getNgoVerification(ngoId: string) {
    return this.http.get<AdminNgoVerificationResponse>(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification`,
    );
  }

  downloadVerificationDocument(ngoId: string, documentId: string) {
    return this.http.get(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification/documents/${encodeURIComponent(documentId)}`,
      { responseType: 'blob' },
    );
  }

  approveNgoVerification(ngoId: string, message?: string) {
    return this.http.post<NgoVerificationResponse>(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification/approve`,
      message?.trim() ? { message: message.trim() } : {},
    );
  }

  rejectNgoVerification(ngoId: string, message: string) {
    return this.http.post<NgoVerificationResponse>(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification/reject`,
      { message: message.trim() },
    );
  }

  requestNgoVerificationInformation(ngoId: string, message: string) {
    return this.http.post<NgoVerificationResponse>(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification/request-info`,
      { message: message.trim() },
    );
  }

  decideNgoVerification(ngoId: string, verificationStatus: NgoVerificationDecision, message?: string) {
    return this.http.put<NgoVerificationResponse>(
      `${apiUrl}/admin/ngos/${encodeURIComponent(ngoId)}/verification`,
      { verificationStatus, ...(message?.trim() ? { message: message.trim() } : {}) },
    );
  }
}

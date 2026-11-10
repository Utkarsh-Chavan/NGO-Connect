import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../auth/auth.models';
import { Need, NeedStatus, ContributionType, NeedPriority } from '../needs/need.models';
import { ContributionStatus, VolunteerApplicationStatus } from '../needs/need-engagement.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');
export interface NgoOwnedNeed extends Need {
  quantity_reserved: number | string;
  quantity_available: number | string | null;
  accepted_application_count: number;
  accepted_contribution_count: number;
  in_progress_contribution_count: number;
}
export interface CloseNeedResult {
  need: Need;
  preservedEngagements: { accepted_applications: number; accepted_contributions: number; in_progress_contributions: number };
  canceledEngagements?: { applications: number; contributions: number };
  alreadyClosed: boolean;
}
export interface NgoNeedPage { items: NgoOwnedNeed[]; pagination: { limit: number; offset: number; total: number }; }
export type NgoResponseStatus = VolunteerApplicationStatus | ContributionStatus;
export interface NgoResponseItem {
  response_id: string; need_id: string; need_title: string; response_kind: 'APPLICATION' | 'CONTRIBUTION';
  contribution_type: ContributionType; details: string | null; quantity: number | null; amount: number | string | null;
  status: NgoResponseStatus; submitted_at: string; updated_at: string; individual_name: string; individual_city: string | null;
  resolution_reason: string | null; need_status: NeedStatus; need_moderation_status: 'VISIBLE' | 'HIDDEN'; need_deadline: string | null;
}
export interface NgoResponsePage { items: NgoResponseItem[]; pagination: { limit: number; offset: number; total: number }; }
export interface NgoDashboardActivity {
  response_id: string; need_id: string; need_title: string; response_kind: 'APPLICATION' | 'CONTRIBUTION';
  contribution_type: ContributionType; status: NgoResponseStatus; submitted_at: string; updated_at: string; individual_name: string;
}
export interface NgoDashboardData {
  active_needs: number; draft_needs: number; completed_needs: number; closed_needs: number; expired_needs: number;
  pending_responses: number; total_responses: number; recent_activity: NgoDashboardActivity[];
}
export interface NgoNeedFilters { limit?: number; offset?: number; status?: NeedStatus | ''; contributionType?: ContributionType | ''; search?: string; }
export interface NgoResponseFilters { limit?: number; offset?: number; status?: NgoResponseStatus | ''; contributionType?: ContributionType | ''; needId?: string; search?: string; }

@Injectable({ providedIn: 'root' })
export class NgoWorkspaceService {
  private readonly http = inject(HttpClient);
  getDashboard() { return this.http.get<ApiResponse<NgoDashboardData>>(`${apiUrl}/ngos/me/dashboard`); }
  listNeeds(filters: NgoNeedFilters = {}) { return this.http.get<ApiResponse<NgoNeedPage>>(`${apiUrl}/ngos/me/needs`, { params: this.params(filters) }); }
  getNeed(id: string) { return this.http.get<ApiResponse<NgoOwnedNeed>>(`${apiUrl}/ngos/me/needs/${encodeURIComponent(id)}`); }
  closeNeed(id: string) { return this.http.post<ApiResponse<CloseNeedResult>>(`${apiUrl}/ngos/me/needs/${encodeURIComponent(id)}/close`, {}); }
  listResponses(filters: NgoResponseFilters = {}) { return this.http.get<ApiResponse<NgoResponsePage>>(`${apiUrl}/ngos/me/responses`, { params: this.params(filters) }); }
  private params(values: object): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== '') params[key] = value as string | number | boolean;
    }
    return params;
  }
}

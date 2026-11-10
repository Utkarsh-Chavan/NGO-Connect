import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../auth/auth.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');
export interface DashboardActivity {
  engagement_id: string; need_id: string; need_title: string; ngo_name: string;
  engagement_type: 'VOLUNTEER_APPLICATION' | 'CONTRIBUTION'; contribution_type: string;
  status: string; submitted_at: string;
}
export interface IndividualDashboardData {
  pending: number; accepted: number; in_progress: number; completed: number;
  pending_applications: number; pending_contributions: number;
  accepted_applications: number; accepted_contributions: number; in_progress_contributions: number;
  completed_applications: number; completed_contributions: number;
  recent_activity: DashboardActivity[];
}
@Injectable({ providedIn: 'root' })
export class IndividualDashboardService {
  private readonly http = inject(HttpClient);
  get() { return this.http.get<ApiResponse<IndividualDashboardData>>(`${apiUrl}/users/me/dashboard`); }
}

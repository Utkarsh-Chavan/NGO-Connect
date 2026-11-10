import { ApiResponse } from '../auth/auth.models';
import { ContributionType } from './need.models';

export type ContributionStatus = 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
export type ContributionReviewStatus = 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED';
export type VolunteerApplicationStatus = 'APPLIED' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED';
export type VolunteerReviewStatus = 'ACCEPTED' | 'REJECTED' | 'COMPLETED';

export interface VolunteerApplicationStatusByNeed {
  application_id: string;
  need_id: string;
  status: VolunteerApplicationStatus;
  message?: string | null;
  applied_at?: string;
  updated_at?: string;
  need_title?: string;
  ngo_name?: string;
  resolution_reason?: string | null;
  need_status?: import('./need.models').NeedStatus;
  need_moderation_status?: 'VISIBLE' | 'HIDDEN';
  need_deadline?: string | null;
  need_completed_at?: string | null;
  need_closed_at?: string | null;
  need_expired_at?: string | null;
}

export interface EngagementContact {
  name: string;
  email: string;
  phone: string | null;
}

export const volunteerApplicationStatusLabel = (status: VolunteerApplicationStatus): string => ({
  APPLIED: 'Application submitted',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
})[status];

export interface Contribution {
  contribution_id: string;
  need_id: string;
  user_id: string;
  contribution_type: Exclude<ContributionType, 'VOLUNTEER'>;
  description: string | null;
  quantity: number | null;
  amount: number | string | null;
  status: ContributionStatus;
  created_at: string;
  updated_at: string;
  resolution_reason?: string | null;
}

export interface IndividualContribution {
  contribution_id: string;
  need_id: string;
  need_title: string;
  contribution_type: Exclude<ContributionType, 'VOLUNTEER'>;
  quantity: number | null;
  amount: number | string | null;
  description: string | null;
  status: ContributionStatus;
  created_at: string;
  ngo_name: string;
  resolution_reason?: string | null;
  need_status?: import('./need.models').NeedStatus;
  need_moderation_status?: 'VISIBLE' | 'HIDDEN';
  need_deadline?: string | null;
  need_completed_at?: string | null;
  need_closed_at?: string | null;
  need_expired_at?: string | null;
}

export interface ContributionInput {
  contributionType: Exclude<ContributionType, 'VOLUNTEER' | 'MONEY'>;
  description?: string;
  quantity?: number;
}

export interface VolunteerApplication {
  application_id: string;
  need_id: string;
  applicant_id?: string;
  user_id?: string;
  message: string | null;
  status: VolunteerApplicationStatus;
  applied_at: string;
  updated_at: string;
  applicant_name?: string;
  applicant_city?: string | null;
}

export interface VolunteerApplicationInput {
  message?: string | null;
}

export type ContributionResponse = ApiResponse<Contribution>;
export type ContributionListResponse = ApiResponse<Contribution[]>;
export type IndividualContributionListResponse = ApiResponse<IndividualContribution[]>;
export type VolunteerApplicationResponse = ApiResponse<VolunteerApplication>;
export type VolunteerApplicationListResponse = ApiResponse<VolunteerApplication[]>;
export type VolunteerApplicationStatusListResponse = ApiResponse<VolunteerApplicationStatusByNeed[]>;
export type EngagementContactResponse = ApiResponse<EngagementContact>;

import { ApiResponse } from '../auth/auth.models';
import { NgoVerificationData } from '../verification/verification.models';

export type NgoVerificationDecision = 'APPROVED' | 'REJECTED';
export type AdminVerificationDecision = NgoVerificationDecision | 'NEEDS_INFO';
export type NgoVerificationStatus = 'PENDING' | NgoVerificationDecision;

export interface NgoProfileSummary {
  ngo_id: string;
  name: string;
  description: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string;
  verification_status: NgoVerificationStatus;
  created_at: string;
  updated_at: string;
}

export type PendingNgo = Omit<NgoProfileSummary, 'verification_status'> & { verification_status: 'PENDING' };

export interface PendingNgosData {
  items: PendingNgo[];
  pagination: { limit: number; offset: number };
}

export type PendingNgosResponse = ApiResponse<PendingNgosData>;
export type NgoVerificationResponse = ApiResponse<NgoProfileSummary>;
export type AdminNgoVerificationResponse = ApiResponse<NgoVerificationData>;

export interface AdminDashboard {
  total_individuals: number;
  total_ngos: number;
  verified_ngos: number;
  pending_ngos: number;
  total_needs: number;
  active_needs: number;
  completed_needs: number;
  total_applications: number;
  total_contributions: number;
  suspended_users: number;
  hidden_needs: number;
  recentActivity: Array<{ event_type: string; subject: string; detail: string; created_at: string }>;
}
export interface AdminUser {
  user_id: string; name: string; email: string; role: string; email_verified: boolean;
  email_verified_at: string | null; phone: string | null; city: string | null;
  created_at: string; updated_at: string; is_suspended: boolean;
  suspended_at: string | null; suspension_reason: string | null;
}
export interface AdminUserDetail extends AdminUser {
  ngo_id: string | null; ngo_name: string | null; ngo_verification_status: string | null;
  ngo_need_count: number; application_count: number; contribution_count: number;
  adminActions: Array<{ action: string; reason: string; created_at: string }>;
}
export interface AdminNeed {
  need_id: string; title: string; status: string; moderation_status: 'VISIBLE' | 'HIDDEN';
  contribution_type: string; created_at: string; updated_at: string; moderated_at: string | null;
  moderation_reason: string | null; ngo_id: string; ngo_name: string;
  ngo_verification_status: string; cause_name: string;
  completed_at?: string | null; closed_at?: string | null; expired_at?: string | null;
}
export interface AdminNeedDetail extends AdminNeed {
  description: string; ngo_email: string; ngo_city: string; location: string | null;
  quantity_required: number | null; quantity_fulfilled: number; priority: string;
  deadline: string | null; application_count: number; contribution_count: number;
  adminActions: Array<{ action: string; reason: string; created_at: string }>;
  lifecycleHistory: Array<{ event_type: string; from_status: string | null; to_status: string; actor_type: 'NGO' | 'SYSTEM'; reason: string; created_at: string }>;
}
export interface AdminPage<T> { items: T[]; total: number; }
export interface AdminAnalytics {
  registrations: Array<{ month: string; role: string; count: number }>;
  ngoVerification: Array<{ status: string; count: number }>;
  needs: Array<{ month: string; created: number; completed: number }>;
  completionDatesUnavailable: number;
  engagement: Array<{ month: string; applications: number; contributions: number }>;
  needCategories: Array<{ contribution_type: string; count: number }>;
}

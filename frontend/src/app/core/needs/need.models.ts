import { ApiResponse } from '../auth/auth.models';

export type ContributionType = 'VOLUNTEER' | 'MATERIAL' | 'MONEY' | 'SKILL';
export type NeedPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type EditableNeedStatus = 'DRAFT' | 'ACTIVE';
export type PublicNeedStatus = 'ACTIVE' | 'PARTIALLY_FULFILLED';
export type NeedStatus = EditableNeedStatus | PublicNeedStatus | 'FULFILLED' | 'COMPLETED' | 'EXPIRED' | 'CLOSED';

export interface CauseOption {
  cause_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface Need {
  need_id: string;
  ngo_id: string;
  cause_id: string;
  title: string;
  description: string;
  contribution_type: ContributionType;
  location: string | null;
  availability: Record<string, unknown> | null;
  quantity_required: number | null;
  quantity_fulfilled: number;
  quantity_reserved?: number | string;
  quantity_available?: number | string | null;
  priority: NeedPriority;
  deadline: string | null;
  status: NeedStatus;
  completed_at?: string | null;
  closed_at?: string | null;
  expired_at?: string | null;
  lifecycle_history?: Array<{ event_type: string; from_status: string | null; to_status: string; actor_type: 'NGO' | 'SYSTEM'; reason: string; created_at: string }>;
  accepted_application_count?: number;
  accepted_contribution_count?: number;
  in_progress_contribution_count?: number;
  created_at: string;
  updated_at: string;
  ngo_name?: string;
  ngo_website_url?: string | null;
  ngo_contact_email?: string | null;
  ngo_contact_phone?: string | null;
  cause_name?: string;
}

export interface NeedInput {
  causeId: string;
  title: string;
  description: string;
  contributionType: ContributionType;
  location: string | null;
  availability: Record<string, unknown> | null;
  quantityRequired: number | null;
  priority: NeedPriority;
  deadline: string | null;
  status: EditableNeedStatus;
}

export type NeedResponse = ApiResponse<Need>;
export interface PublicNeedFilters {
  search?: string;
  causeId?: string;
  contributionType?: ContributionType | '';
  location?: string;
}
export interface NeedPagination {
  limit: number;
  offset: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
export type NeedListResponse = ApiResponse<{
  items: Need[];
  pagination: NeedPagination;
}>;
export type CauseListResponse = ApiResponse<CauseOption[]>;

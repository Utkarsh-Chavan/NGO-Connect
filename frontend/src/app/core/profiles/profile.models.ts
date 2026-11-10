import { ApiResponse, UserRole } from '../auth/auth.models';
import { NgoVerificationStatus } from '../verification/verification.models';

export type ProfileResponse<T> = ApiResponse<T>;

export interface IndividualProfile {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  city: string | null;
  availability: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface NgoProfile {
  ngo_id: string;
  user_id: string;
  name: string;
  description: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string;
  website_url: string | null;
  verification_status: NgoVerificationStatus;
  created_at: string;
  updated_at: string;
}

export interface NgoProfileInput {
  name: string;
  description: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string;
  websiteUrl: string | null;
}

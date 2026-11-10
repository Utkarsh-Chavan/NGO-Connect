import { ApiResponse } from '../auth/auth.models';

export type NgoVerificationStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED'
  | 'REJECTED';

export type NgoVerificationSubmissionStatus =
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUPERSEDED';

export type NgoVerificationEventAction =
  | 'LEGACY_IMPORTED'
  | 'SUBMITTED'
  | 'RESUBMITTED'
  | 'INFO_REQUESTED'
  | 'APPROVED'
  | 'REJECTED';

export interface NgoVerificationProfile {
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

export interface VerificationDocumentMetadata {
  document_id: string;
  document_type: 'REGISTRATION_CERTIFICATE' | 'PAN' | 'NGO_DARPAN' | 'SUPPORTING_DOCUMENT';
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface CurrentVerificationSubmission {
  submission_id: string;
  submission_number: number;
  status: NgoVerificationSubmissionStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  documents: VerificationDocumentMetadata[];
}

export interface NgoVerificationHistoryEvent {
  history_id: string;
  verification_status_snapshot: NgoVerificationStatus;
  submission_id_snapshot: string | null;
  actor_name_snapshot: string | null;
  action: NgoVerificationEventAction;
  message: string | null;
  created_at: string;
}

export interface NgoVerificationData {
  ngo: NgoVerificationProfile;
  currentSubmission: CurrentVerificationSubmission | null;
  history: NgoVerificationHistoryEvent[];
}

export type NgoVerificationResponse = ApiResponse<NgoVerificationData>;

export interface VerificationFileSelection {
  registrationCertificate: File | null;
  pan: File | null;
  ngoDarpan: File | null;
  supportingDocuments: File[];
}

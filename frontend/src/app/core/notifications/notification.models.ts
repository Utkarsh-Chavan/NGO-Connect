export type NotificationEventType =
  | 'APPLICATION_RECEIVED'
  | 'APPLICATION_ACCEPTED'
  | 'APPLICATION_REJECTED'
  | 'APPLICATION_COMPLETED'
  | 'CONTRIBUTION_RECEIVED'
  | 'CONTRIBUTION_ACCEPTED'
  | 'CONTRIBUTION_REJECTED'
  | 'CONTRIBUTION_IN_PROGRESS'
  | 'CONTRIBUTION_COMPLETED'
  | 'NGO_VERIFICATION_SUBMITTED'
  | 'NGO_VERIFICATION_NEEDS_INFO'
  | 'NGO_VERIFICATION_APPROVED'
  | 'NGO_VERIFICATION_REJECTED'
  | 'NEED_CLOSED'
  | 'NEED_EXPIRED';

export interface AppNotification {
  notification_id: string;
  event_type: NotificationEventType;
  title: string;
  message: string;
  related_entity_type: 'APPLICATION' | 'CONTRIBUTION' | 'NGO_VERIFICATION' | 'NEED';
  related_entity_id: string;
  created_at: string;
  read_at: string | null;
  navigation_target: string | null;
}

export interface NotificationPage {
  items: AppNotification[];
  pagination: { limit: number; offset: number; total: number; hasPrevious: boolean; hasNext: boolean };
  unreadOnly: boolean;
}

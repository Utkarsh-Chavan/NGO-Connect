export type UserRole = 'INDIVIDUAL' | 'NGO' | 'ADMIN';

export const authenticatedHomeRoute = (role: UserRole): string => {
  switch (role) {
    case 'INDIVIDUAL': return '/individual/dashboard';
    case 'NGO': return '/ngo/dashboard';
    case 'ADMIN': return '/admin/dashboard';
  }
};

export interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  city: string | null;
  availability: Record<string, unknown> | null;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role: 'INDIVIDUAL' | 'NGO';
  phone?: string;
  city?: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  data: RegisteredUser;
  deliveryMode: 'development' | 'email';
}

export interface MessageResponse {
  success: boolean;
  message: string;
  data?: { emailVerified: boolean };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface RegisteredUser {
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

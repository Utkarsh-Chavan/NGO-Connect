import { HttpErrorResponse } from '@angular/common/http';

interface ApiErrorBody {
  message?: unknown;
  errors?: Array<{ msg?: unknown }>;
}

export function getApiErrorMessages(error: unknown, fallback: string): string[] {
  if (!(error instanceof HttpErrorResponse)) return [fallback];
  if (error.status === 0) return ['Could not connect to NGO Connect. Check that the backend is running.'];

  const body = error.error as ApiErrorBody | null;
  const validationMessages = Array.isArray(body?.errors)
    ? body.errors.map(({ msg }) => msg).filter((message): message is string => typeof message === 'string')
    : [];
  if (validationMessages.length) return [...new Set(validationMessages)];
  if (typeof body?.message === 'string' && body.message !== 'Validation failed') return [body.message];
  return [fallback];
}

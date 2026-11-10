import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { NgoVerificationResponse } from './verification.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class VerificationService {
  private readonly http = inject(HttpClient);

  getMyVerification() {
    return this.http.get<NgoVerificationResponse>(`${apiUrl}/ngos/me/verification`);
  }

  submitDocuments(formData: FormData) {
    // Do not set Content-Type: the browser must add the multipart boundary.
    return this.http.post<NgoVerificationResponse>(
      `${apiUrl}/ngos/me/verification/submissions`,
      formData,
    );
  }
}

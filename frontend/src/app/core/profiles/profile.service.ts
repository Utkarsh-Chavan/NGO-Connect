import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { ProfileResponse, IndividualProfile, NgoProfile, NgoProfileInput } from './profile.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);

  getIndividualProfile() {
    return this.http.get<ProfileResponse<IndividualProfile>>(`${apiUrl}/users/me`);
  }

  updateIndividualProfile(input: { name: string; phone: string | null; city: string | null; availability: Record<string, unknown> | null }) {
    return this.http.put<ProfileResponse<IndividualProfile>>(`${apiUrl}/users/me`, input);
  }

  getNgoProfile() {
    return this.http.get<ProfileResponse<NgoProfile>>(`${apiUrl}/ngos/me`);
  }

  createNgoProfile(input: NgoProfileInput) {
    return this.http.post<ProfileResponse<NgoProfile>>(`${apiUrl}/ngos/me`, input);
  }

  updateNgoProfile(input: NgoProfileInput) {
    return this.http.put<ProfileResponse<NgoProfile>>(`${apiUrl}/ngos/me`, input);
  }
}

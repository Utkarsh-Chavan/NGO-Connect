import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { CauseListResponse, NeedInput, NeedListResponse, NeedResponse, PublicNeedFilters } from './need.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class NeedsService {
  private readonly http = inject(HttpClient);

  listNeeds(limit = 12, offset = 0, filters: PublicNeedFilters = {}) {
    const params: Record<string, string | number> = { limit, offset };
    if (filters.search?.trim()) params['search'] = filters.search.trim();
    if (filters.causeId) params['causeId'] = filters.causeId;
    if (filters.contributionType) params['contributionType'] = filters.contributionType;
    if (filters.location?.trim()) params['location'] = filters.location.trim();
    return this.http.get<NeedListResponse>(`${apiUrl}/needs`, { params });
  }

  getNeed(id: string) {
    return this.http.get<NeedResponse>(`${apiUrl}/needs/${encodeURIComponent(id)}`);
  }

  listCauses() {
    return this.http.get<CauseListResponse>(`${apiUrl}/causes`);
  }

  createNeed(input: NeedInput) {
    return this.http.post<NeedResponse>(`${apiUrl}/needs`, input);
  }

  updateNeed(id: string, input: NeedInput) {
    return this.http.put<NeedResponse>(`${apiUrl}/needs/${encodeURIComponent(id)}`, input);
  }
}

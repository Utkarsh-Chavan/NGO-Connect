import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { MatchingRecommendationsResponse } from './matching.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class MatchingService {
  private readonly http = inject(HttpClient);

  getRecommendations(limit = 12, offset = 0) {
    return this.http.get<MatchingRecommendationsResponse>(`${apiUrl}/matching/recommendations`, {
      params: { limit, offset },
    });
  }
}

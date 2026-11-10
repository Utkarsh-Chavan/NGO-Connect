import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import {
  ContributionInput,
  ContributionListResponse,
  IndividualContributionListResponse,
  ContributionResponse,
  ContributionReviewStatus,
  EngagementContactResponse,
  VolunteerApplicationInput,
  VolunteerApplicationListResponse,
  VolunteerApplicationStatusListResponse,
  VolunteerApplicationResponse,
  VolunteerReviewStatus,
} from './need-engagement.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');

@Injectable({ providedIn: 'root' })
export class NeedEngagementService {
  private readonly http = inject(HttpClient);

  submitContribution(needId: string, input: ContributionInput) {
    return this.http.post<ContributionResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/contributions`, input,
    );
  }

  listMyContributions() {
    return this.http.get<IndividualContributionListResponse>(`${apiUrl}/users/me/contributions`);
  }

  listContributions(needId: string) {
    return this.http.get<ContributionListResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/contributions`,
    );
  }

  updateContributionStatus(needId: string, contributionId: string, status: ContributionReviewStatus) {
    return this.http.put<ContributionResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/contributions/${encodeURIComponent(contributionId)}/status`,
      { status },
    );
  }

  applyToNeed(needId: string, input: VolunteerApplicationInput = {}) {
    return this.http.post<VolunteerApplicationResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/applications`, input,
    );
  }

  listMyApplicationStatuses() {
    return this.http.get<VolunteerApplicationStatusListResponse>(`${apiUrl}/users/me/applications`);
  }

  getApplicationContact(applicationId: string) {
    return this.http.get<EngagementContactResponse>(
      `${apiUrl}/engagements/applications/${encodeURIComponent(applicationId)}/contact`,
    );
  }

  getContributionContact(contributionId: string) {
    return this.http.get<EngagementContactResponse>(
      `${apiUrl}/engagements/contributions/${encodeURIComponent(contributionId)}/contact`,
    );
  }

  listApplications(needId: string) {
    return this.http.get<VolunteerApplicationListResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/applications`,
    );
  }

  reviewApplication(needId: string, applicationId: string, status: VolunteerReviewStatus) {
    return this.http.put<VolunteerApplicationResponse>(
      `${apiUrl}/needs/${encodeURIComponent(needId)}/applications/${encodeURIComponent(applicationId)}`,
      { status },
    );
  }
}
